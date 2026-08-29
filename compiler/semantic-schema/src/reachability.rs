//! Declaration reachability over a semantic snapshot.
//!
//! # What this answers
//!
//! Which declarations a product can actually reach from its roots, and therefore
//! which types are worth resolving in depth.
//!
//! # Why it exists now
//!
//! Every deep frontend pass — type decomposition, call resolution, constant
//! folding — costs round trips per item, with no batch form. Seeded with
//! everything, the type closure does not stop at the program: measured on a
//! single 180-node file, decomposition reached **5,773 distinct types** and
//! exhausted its budget, because `Promise<void>` and a class prototype pull the
//! standard library's type graph in transitively.
//!
//! Reachability is what gives that walk an edge to stop at.
//!
//! # Why it lives in the schema crate
//!
//! It is a pure query over a [`SemanticSnapshot`] and nothing else, and its
//! caller is the *frontend* — which produces the snapshot and must not depend
//! on the IR crate. It was written in `nts-core` and re-exported from there, so
//! nothing that used it has to change.
//!
//! # This is not the RFC §7 reachability
//!
//! RFC §7 places reachability in the HIR analysis block, over *operations*, for
//! dead-code elimination during lowering. This is coarser and earlier: it works
//! on declarations and needs no IR, because the question it answers — what should
//! the frontend bother resolving — has to be answered before there is an IR.
//! The two are complementary; this one does not replace it.

use crate::{NodeId, SemanticSnapshot, SymbolId, TypeId};
use rustc_hash::FxHashSet;

/// What a walk from a set of roots reached.
#[derive(Debug, Clone, Default)]
pub struct Reachability {
    /// Nodes reachable from the roots.
    pub nodes: FxHashSet<NodeId>,
    /// Symbols named by a reachable node.
    pub symbols: FxHashSet<SymbolId>,
    /// Types of reachable nodes — the seed set for deep resolution.
    pub types: FxHashSet<TypeId>,
}

impl Reachability {
    /// Whether a node was reached.
    #[must_use]
    pub fn contains(&self, node: NodeId) -> bool {
        self.nodes.contains(&node)
    }

    /// Reachable types, as a seed set for the frontend's deep passes.
    #[must_use]
    pub fn seeds(&self) -> Vec<TypeId> {
        let mut seeds: Vec<TypeId> = self.types.iter().copied().collect();
        // Sorted so a build is reproducible: the walk uses hash sets, and an
        // unordered seed list would make cache keys differ run to run.
        seeds.sort_unstable();
        seeds
    }
}

/// Walk outward from every exported declaration.
///
/// The right roots for a library product: RFC §27.1 makes a shared library's
/// exports its public surface, so anything not reachable from them cannot be
/// called from outside and need not be resolved.
#[must_use]
pub fn from_exports(snapshot: &SemanticSnapshot) -> Reachability {
    let roots = snapshot
        .modules
        .iter()
        .flat_map(|module| module.exports.iter().map(|(_, symbol)| *symbol));
    from_symbols(snapshot, roots)
}

/// The roots the *frontend* must use: every export, plus every module's
/// top-level statements.
///
/// [`from_exports`] alone is the right answer for a library's public surface
/// and the wrong one for seeding the frontend, because module evaluation is
/// reachable from nothing. A program whose entry module exports nothing at all
/// is legal — an executable is exactly that — and seeding from its exports
/// would decompose no types, leaving every construct in it unrepresentable.
///
/// Statements only. Seeding the module's *root* would reach every node in the
/// file including the declarations already covered, which is the "seed with
/// everything" this exists to replace.
#[must_use]
pub fn for_frontend(snapshot: &SemanticSnapshot) -> Reachability {
    let exports = snapshot
        .modules
        .iter()
        .flat_map(|module| module.exports.iter().map(|(_, symbol)| *symbol));
    let statements = snapshot.modules.iter().flat_map(|module| {
        snapshot
            .nodes
            .get(module.root.0 as usize)
            .into_iter()
            .flat_map(|root| root.children.iter().copied())
    });
    from_roots(snapshot, exports, statements)
}

/// Walk outward from a given set of root symbols.
#[must_use]
pub fn from_symbols(
    snapshot: &SemanticSnapshot,
    roots: impl IntoIterator<Item = SymbolId>,
) -> Reachability {
    from_roots(snapshot, roots, std::iter::empty())
}

/// Walk outward from root symbols *and* root nodes.
///
/// Nodes as well as symbols because not everything worth reaching is named:
/// a module's top-level statements have no symbol to start from.
#[must_use]
pub fn from_roots(
    snapshot: &SemanticSnapshot,
    roots: impl IntoIterator<Item = SymbolId>,
    nodes: impl IntoIterator<Item = NodeId>,
) -> Reachability {
    let mut result = Reachability::default();
    let mut worklist: Vec<NodeId> = nodes.into_iter().collect();

    for symbol in roots {
        if result.symbols.insert(symbol)
            && let Some(record) = snapshot.symbols.get(symbol.0 as usize)
        {
            worklist.extend(record.declarations.iter().copied());
        }
    }

    while let Some(node) = worklist.pop() {
        if !result.nodes.insert(node) {
            continue;
        }
        let Some(record) = snapshot.nodes.get(node.0 as usize) else {
            continue;
        };

        if let Some(&ty) = snapshot.node_types.get(&node) {
            result.types.insert(ty);
        }

        // A node's subtree is part of its declaration.
        worklist.extend(record.children.iter().copied());

        // A reference names a symbol; following it to that symbol's declarations
        // is what makes this a graph walk rather than a subtree walk. Without this
        // edge, a function's body would be reached but nothing it calls would be.
        if let Some(symbol) = record.symbol
            && result.symbols.insert(symbol)
            && let Some(declared) = snapshot.symbols.get(symbol.0 as usize)
        {
            worklist.extend(declared.declarations.iter().copied());
        }

        // A resolved call reaches its callee even when nothing else does — the
        // callee may be a private helper that no export names directly.
        if let Some(target) = snapshot.call_targets.get(&node)
            && let Some(callee) = target.callee
        {
            worklist.push(callee);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeclarationModifiers, ModuleRecord, NodeData, NodeKind, NodeRecord, Origin, SymbolFlags,
        SymbolRecord, TypeKind, TypeRecord,
    };
    use nts_diagnostics::{Location, SourceId, Span};

    fn node(children: Vec<NodeId>, symbol: Option<SymbolId>) -> NodeRecord {
        NodeRecord {
            kind: NodeKind::Syntax(0),
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            }),
            parent: None,
            children,
            symbol,
            flags: 0,
            modifiers: DeclarationModifiers::default(),
            data: NodeData::Children {
                present: 0,
                small: 0,
            },
            text: None,
        }
    }

    fn symbol(name: &str, declarations: Vec<NodeId>) -> SymbolRecord {
        SymbolRecord {
            name: name.to_owned(),
            flags: SymbolFlags::default(),
            declarations,
            ty: None,
            aliased: None,
        }
    }

    /// Two declarations: node 0 (exported, references symbol 1) and node 2
    /// (private helper). Node 3 is unreferenced by anything.
    fn snapshot() -> SemanticSnapshot {
        let mut snapshot = SemanticSnapshot {
            schema_version: crate::SCHEMA_VERSION,
            nodes: vec![
                node(vec![NodeId(1)], None),
                node(vec![], Some(SymbolId(1))),
                node(vec![], None),
                node(vec![], None),
            ],
            symbols: vec![
                symbol("exported", vec![NodeId(0)]),
                symbol("helper", vec![NodeId(2)]),
                symbol("unused", vec![NodeId(3)]),
            ],
            types: vec![
                TypeRecord {
                    kind: TypeKind::Number,
                    symbol: None,
                },
                TypeRecord {
                    kind: TypeKind::String,
                    symbol: None,
                },
            ],
            modules: vec![ModuleRecord {
                file: SourceId(0),
                imports: Vec::new(),
                exports: vec![("exported".to_owned(), SymbolId(0))],
                root: NodeId(0),
            }],
            ..SemanticSnapshot::default()
        };
        snapshot.node_types.insert(NodeId(1), TypeId(0));
        snapshot.node_types.insert(NodeId(3), TypeId(1));
        snapshot
    }

    #[test]
    fn an_exported_declaration_is_reached() {
        let reached = from_exports(&snapshot());
        assert!(reached.contains(NodeId(0)));
    }

    #[test]
    fn a_reference_reaches_the_declaration_it_names() {
        // The edge that makes this a graph walk. Node 1 sits inside the export and
        // names `helper`; without following symbol references, node 2 — where
        // `helper` is actually declared — would never be reached, and a build
        // would decide the function it calls is dead.
        let reached = from_exports(&snapshot());
        assert!(
            reached.contains(NodeId(2)),
            "the referenced helper is reachable"
        );
    }

    #[test]
    fn an_unreferenced_declaration_is_not_reached() {
        let reached = from_exports(&snapshot());
        assert!(!reached.contains(NodeId(3)), "nothing names `unused`");
    }

    #[test]
    fn only_reachable_types_become_seeds() {
        // The whole point: TypeId(1) belongs to the unreachable node, so resolving
        // it in depth would be round trips spent on a type the build cannot use.
        let reached = from_exports(&snapshot());
        assert_eq!(reached.seeds(), vec![TypeId(0)]);
    }

    #[test]
    fn seeds_are_ordered_so_a_build_is_reproducible() {
        let mut snapshot = snapshot();
        snapshot.node_types.insert(NodeId(0), TypeId(1));
        let seeds = from_exports(&snapshot).seeds();
        let mut sorted = seeds.clone();
        sorted.sort_unstable();
        assert_eq!(
            seeds, sorted,
            "an unordered seed list would churn cache keys"
        );
    }

    #[test]
    fn a_cyclic_reference_graph_terminates() {
        // Mutual recursion is ordinary; a walk that revisits would not return.
        let mut snapshot = snapshot();
        snapshot.nodes[2].symbol = Some(SymbolId(0));
        let reached = from_exports(&snapshot);
        assert!(reached.contains(NodeId(2)));
    }

    #[test]
    fn a_symbol_declared_outside_the_decoded_set_is_skipped() {
        // An imported symbol has no declaration node here. Reaching for one would
        // be an index into another file's nodes.
        let mut snapshot = snapshot();
        snapshot.symbols[1].declarations.clear();
        let reached = from_exports(&snapshot);
        assert!(reached.symbols.contains(&SymbolId(1)));
        assert!(!reached.contains(NodeId(2)));
    }

    #[test]
    fn nothing_exported_reaches_nothing() {
        let mut snapshot = snapshot();
        snapshot.modules[0].exports.clear();
        assert!(from_exports(&snapshot).nodes.is_empty());
    }
}
