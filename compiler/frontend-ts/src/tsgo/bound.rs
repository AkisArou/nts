//! The types a program uses and does not own, each resolved to the type that
//! implements it: [`nts_semantic_schema::SemanticSnapshot::bound_types`].
//!
//! An overlay writes `/** @ntsBoundBy "nts:dom" Element */ interface Element {}`
//! beside lib.dom.d.ts. The interface merges into lib.dom's, so its node's type
//! is the type the program writes `Element` for; `"nts:dom" Element` names a
//! type alias declared in the ambient module `"nts:dom"`. Both are nodes this
//! frontend decoded, so the answer is read from the snapshot rather than asked
//! of the checker.
use nts_semantic_schema::binding::{module_declarations, parse};
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, TypeId, syntax};
use rustc_hash::FxHashMap;

/// Every `@ntsBoundBy` interface whose bound type exists, as `used -> bound`.
///
/// A binding naming a module or a name this program does not declare is left
/// out, not guessed at: the interface then has no representation and lowering
/// refuses it by name, as it does today.
pub(crate) fn bound_types(snapshot: &SemanticSnapshot) -> FxHashMap<TypeId, TypeId> {
    let declared = module_declarations(snapshot);
    let mut bound = FxHashMap::default();
    for (at, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::INTERFACE_DECLARATION) {
            continue;
        }
        let Some(binding) = node.native.as_ref().and_then(|native| native.bound_by.as_deref()).and_then(parse) else {
            continue;
        };
        let Ok(at) = u32::try_from(at) else { continue };
        let (module, name) = binding;
        let target = declared
            .get(&(module, name, syntax::TYPE_ALIAS_DECLARATION))
            .and_then(|alias| snapshot.node_types.get(alias));
        let (Some(used), Some(target)) = (snapshot.node_types.get(&NodeId(at)), target) else {
            continue;
        };
        if used != target {
            bound.insert(*used, *target);
        }
    }
    instantiations(snapshot, &mut bound);
    bound
}

/// Every instantiation of a bound generic interface, bound as the interface
/// is: `/** @ntsBoundBy "nts:dom" NodeList */ interface NodeListOf<T> {}`
/// binds `NodeListOf<Element>`, which `querySelectorAll` returns, and
/// `NodeListOf<HTMLLIElement>` beside it. The declaration's node has the type
/// with its own parameters; each instantiation is another type of the same
/// symbol, so the symbol is what carries the binding to it.
fn instantiations(snapshot: &SemanticSnapshot, bound: &mut FxHashMap<TypeId, TypeId>) {
    let by_symbol: FxHashMap<_, TypeId> = bound
        .iter()
        .filter_map(|(used, target)| Some((snapshot.types.get(used.0 as usize)?.symbol?, *target)))
        .collect();
    for (at, record) in snapshot.types.iter().enumerate() {
        let (Some(symbol), Ok(at)) = (record.symbol, u32::try_from(at)) else { continue };
        if let Some(target) = by_symbol.get(&symbol)
            && TypeId(at) != *target
        {
            bound.entry(TypeId(at)).or_insert(*target);
        }
    }
}
