//! The overload sibling relation, indexed once for one immutable snapshot.

use std::ops::Deref;
use std::sync::OnceLock;

use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, SymbolId, TypeKind, syntax};
use rustc_hash::FxHashMap;

/// Analysis probes and body builders borrow the same snapshot and index.
/// Constructed after generic materialisation, so neither can name an earlier
/// AST while answering questions about the materialised one.
pub(super) struct LoweringSnapshot<'a> {
    semantic: &'a SemanticSnapshot,
    probe_context: std::cell::OnceCell<super::ProbeContext>,
    pub(super) scopes: super::scopes::Index,
    implementations: ImplementationIndex,
    /// Every node carrying a symbol, in snapshot order. Shared by probes and
    /// body builders so evolving declarations read only their own mentions.
    mentions: OnceLock<FxHashMap<SymbolId, Vec<NodeId>>>,
    /// Per symbol, its references that stand where a write lands. Built on
    /// the first question, in one pass over the nodes, by the classifier the
    /// asker supplies (`reassigned_anywhere`); every later question is a
    /// lookup rather than another pass.
    written: OnceLock<FxHashMap<SymbolId, Vec<NodeId>>>,
    /// Per symbol, the member names of the object types carrying it: what a
    /// generic dictionary's opaque nominal answers for its members
    /// (`dictionary_member_names`). Built in one pass over the types on the
    /// first question; reading them per question rescanned every type.
    dictionary_members: OnceLock<FxHashMap<SymbolId, Vec<String>>>,
}

impl<'a> LoweringSnapshot<'a> {
    pub(super) fn probe_context(&self) -> &super::ProbeContext {
        self.probe_context.get_or_init(super::ProbeContext::default)
    }

    pub(super) fn new(semantic: &'a SemanticSnapshot) -> Self {
        Self {
            semantic,
            probe_context: std::cell::OnceCell::new(),
            scopes: super::scopes::Index::new(semantic),
            implementations: ImplementationIndex::build(semantic),
            mentions: OnceLock::new(),
            written: OnceLock::new(),
            dictionary_members: OnceLock::new(),
        }
    }

    pub(super) fn implementation_of(&self, declaration: NodeId) -> NodeId {
        self.implementations.0[declaration.0 as usize]
    }

    pub(super) fn mentions_of(&self, symbol: SymbolId) -> &[NodeId] {
        self.mentions
            .get_or_init(|| {
                let mut by_symbol: FxHashMap<SymbolId, Vec<NodeId>> = FxHashMap::default();
                for (at, node) in (0..=u32::MAX).zip(&self.semantic.nodes) {
                    if let Some(symbol) = node.symbol {
                        by_symbol.entry(symbol).or_default().push(NodeId(at));
                    }
                }
                by_symbol
            })
            .get(&symbol)
            .map_or(&[], Vec::as_slice)
    }

    /// The written references of every symbol, built once by `index`.
    pub(super) fn written_references(
        &self,
        index: impl FnOnce() -> FxHashMap<SymbolId, Vec<NodeId>>,
    ) -> &FxHashMap<SymbolId, Vec<NodeId>> {
        self.written.get_or_init(index)
    }

    /// The members of the dictionary `symbol` declares, from the object
    /// types carrying it (its declaration and instantiations, whose members
    /// only the properties' types distinguish). `None` where no object type
    /// carries the symbol: no members in reach.
    pub(super) fn dictionary_members(&self, symbol: SymbolId) -> Option<&[String]> {
        self.dictionary_members
            .get_or_init(|| {
                let mut by_symbol: FxHashMap<SymbolId, Vec<String>> = FxHashMap::default();
                for record in &self.semantic.types {
                    let (Some(symbol), TypeKind::Object { properties }) =
                        (record.symbol, &record.kind)
                    else {
                        continue;
                    };
                    by_symbol.entry(symbol).or_default().extend(
                        properties
                            .iter()
                            .filter_map(|p| p.name.public_name())
                            .map(str::to_owned),
                    );
                }
                // Each instantiation repeats the declaration's names; the
                // index answers membership, so one copy of each is enough
                // and keeps those checks short.
                for names in by_symbol.values_mut() {
                    names.sort();
                    names.dedup();
                }
                by_symbol
            })
            .get(&symbol)
            .map(Vec::as_slice)
    }
}

impl Deref for LoweringSnapshot<'_> {
    type Target = SemanticSnapshot;

    fn deref(&self) -> &Self::Target {
        self.semantic
    }
}

/// An answer per node, including identity for native declarations with no body.
struct ImplementationIndex(Vec<NodeId>);

impl ImplementationIndex {
    fn build(snapshot: &SemanticSnapshot) -> Self {
        let ids: Vec<_> = (0..snapshot.nodes.len())
            .map(|at| NodeId(u32::try_from(at).unwrap_or(u32::MAX)))
            .collect();
        let has_body: Vec<_> = ids
            .iter()
            .map(|id| {
                children(snapshot, *id).any(|child| {
                    snapshot.nodes[child.0 as usize].kind == NodeKind::Syntax(syntax::BLOCK)
                })
            })
            .collect();
        let parents = syntactic_parents(snapshot);
        let mut first = FxHashMap::default();
        for parent in &ids {
            for child in children(snapshot, *parent) {
                if has_body[child.0 as usize]
                    && let Some(name) = named(snapshot, child)
                {
                    // The old scan's `find`: source order, and the first body
                    // with this key wins even if a later body has the same name.
                    first.entry((*parent, name)).or_insert(child);
                }
            }
        }
        Self(
            ids.into_iter()
                .map(|id| {
                    if has_body[id.0 as usize] {
                        return id;
                    }
                    let (Some(parent), Some(name)) = (parents[id.0 as usize], named(snapshot, id))
                    else {
                        return id;
                    };
                    first.get(&(parent, name)).copied().unwrap_or(id)
                })
                .collect(),
        )
    }
}

/// Exactly one level of List flattening, as `FuncBuilder::children` does.
fn children(snapshot: &SemanticSnapshot, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
    snapshot.nodes[id.0 as usize]
        .children
        .iter()
        .flat_map(|child| {
            let node = &snapshot.nodes[child.0 as usize];
            if node.kind == NodeKind::List {
                node.children.as_slice()
            } else {
                std::slice::from_ref(child)
            }
        })
        .copied()
}

fn named(snapshot: &SemanticSnapshot, id: NodeId) -> Option<&str> {
    if snapshot.nodes[id.0 as usize].kind == NodeKind::Syntax(syntax::CONSTRUCTOR) {
        return Some(super::CONSTRUCTOR_KEY);
    }
    children(snapshot, id)
        .find(|child| snapshot.nodes[child.0 as usize].kind == NodeKind::Syntax(syntax::IDENTIFIER))
        .and_then(|child| {
            snapshot.nodes[child.0 as usize]
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
        })
}

/// Memoise List ancestry too: a nested List chain must not become another
/// depth-times-node-count walk while constructing the index.
fn syntactic_parents(snapshot: &SemanticSnapshot) -> Vec<Option<NodeId>> {
    let mut parents = vec![None; snapshot.nodes.len()];
    let mut path = Vec::new();
    for start in 0..snapshot.nodes.len() {
        let mut at = start;
        let answer = loop {
            if let Some(answer) = parents[at] {
                break answer;
            }
            path.push(at);
            let parent = snapshot.nodes[at].parent;
            if let Some(parent) = parent
                && snapshot.nodes[parent.0 as usize].kind == NodeKind::List
            {
                at = parent.0 as usize;
            } else {
                break parent;
            }
        };
        for at in path.drain(..) {
            parents[at] = Some(answer);
        }
    }
    parents.into_iter().map(Option::flatten).collect()
}
