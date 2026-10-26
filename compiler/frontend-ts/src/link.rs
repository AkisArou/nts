//! Module evaluation edges are nts policy over the owned semantic graph.

use nts_semantic_schema::{ModuleId, NodeId, NodeKind, SemanticSnapshot, SymbolId, syntax};
use rustc_hash::FxHashMap;

/// Fill in each module's imports: the module graph.
///
/// The target of an import comes from the *specifier's* symbol, whose
/// declaration is the imported file's root node. That is the checker's own
/// resolution, which is the point: this compiler must not contain a second
/// module resolver, because two resolvers that have to agree are two that
/// eventually do not. Extension rewriting, index files and path mapping all
/// stay where they already work.
///
/// The named bindings are no use here — `import { distance } from "./g.js"`
/// gives `distance` an *alias* symbol declared at the import site, which says
/// nothing about where it came from. Reading them was the first approach and it
/// resolved every import to the importing file.
///
/// Edges are in source order, deduplicated, because evaluation order depends on
/// the order a module's imports appear and a set would be discarding the
/// answer.
pub(crate) fn modules(snapshot: &mut SemanticSnapshot) {
    // Keyed by each module's own *symbol*, taken from its root node.
    //
    // The first version keyed on the symbol's declaration node instead, and it
    // was wrong in a way that passed every test I had: symbol interning is
    // first-write-wins, so a file importing one that has not been decoded yet
    // interns its module symbol with an empty declaration list, and the
    // declaration never arrives. Every early test happened to import
    // *backwards* in file order, where the declaration is already known. A
    // forward import -- which any cycle contains, and plenty of acyclic
    // programs do -- silently produced no edge at all.
    //
    // A module's root node carries its symbol whatever order the files were
    // decoded in, so this asks the question that has a stable answer.
    let by_symbol: FxHashMap<SymbolId, ModuleId> = snapshot
        .modules
        .iter()
        .enumerate()
        .filter_map(|(at, module)| {
            let symbol = snapshot.nodes.get(module.root.0 as usize)?.symbol?;
            Some((symbol, ModuleId(u32::try_from(at).unwrap_or(u32::MAX))))
        })
        .collect();
    let mut starts: Vec<u32> = snapshot
        .modules
        .iter()
        .map(|module| module.root.0)
        .collect();
    starts.sort_unstable();
    let total = u32::try_from(snapshot.nodes.len()).unwrap_or(u32::MAX);

    for at in 0..snapshot.modules.len() {
        let start = snapshot.modules[at].root.0;
        // A module owns the nodes from its root up to the next module's.
        let end = starts
            .iter()
            .copied()
            .find(|root| *root > start)
            .unwrap_or(total)
            .min(total);
        let mine = ModuleId(u32::try_from(at).unwrap_or(u32::MAX));
        let mut imports: Vec<ModuleId> = Vec::new();
        for node in start..end {
            // A re-export is an evaluation edge too: `export { two } from
            // "./base.js"` requires `base` to have been evaluated, exactly as an
            // import would. Scanning only imports missed it, and the chain
            // base -> mid -> main came out with `mid` importing nothing.
            //
            // A plain `export { x }` with no specifier is the same kind and
            // names no module, so it resolves to nothing and adds no edge --
            // which is why the specifier lookup is the test rather than the kind.
            if !matches!(
                snapshot.nodes[node as usize].kind,
                NodeKind::Syntax(syntax::IMPORT_DECLARATION | syntax::EXPORT_DECLARATION)
            ) {
                continue;
            }
            if let Some(target) = import_target(snapshot, NodeId(node), &by_symbol)
                && target != mine
                && !imports.contains(&target)
            {
                imports.push(target);
            }
        }
        snapshot.modules[at].imports = imports;
    }
}

/// Which module one import or re-export declaration names.
///
/// The specifier is the only child whose symbol is declared at a module's root
/// node, so this looks for that rather than for a particular child position.
fn import_target(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
    by_symbol: &FxHashMap<SymbolId, ModuleId>,
) -> Option<ModuleId> {
    let mut pending = vec![declaration];
    while let Some(id) = pending.pop() {
        let record = snapshot.nodes.get(id.0 as usize)?;
        pending.extend(record.children.iter().copied());
        if let Some(symbol) = record.symbol
            && let Some(target) = by_symbol.get(&symbol)
        {
            return Some(*target);
        }
    }
    None
}
