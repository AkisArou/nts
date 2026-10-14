//! The overload sibling relation, indexed once for one immutable snapshot.

use std::ops::Deref;

use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, syntax};
use rustc_hash::FxHashMap;

/// Analysis probes and body builders borrow the same snapshot and index.
/// Constructed after generic materialisation, so neither can name an earlier
/// AST while answering questions about the materialised one.
pub(super) struct LoweringSnapshot<'a> {
    semantic: &'a SemanticSnapshot,
    implementations: ImplementationIndex,
}

impl<'a> LoweringSnapshot<'a> {
    pub(super) fn new(semantic: &'a SemanticSnapshot) -> Self {
        Self {
            semantic,
            implementations: ImplementationIndex::build(semantic),
        }
    }

    pub(super) fn implementation_of(&self, declaration: NodeId) -> NodeId {
        self.implementations.0[declaration.0 as usize]
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
        .and_then(|child| snapshot.nodes[child.0 as usize].text.as_deref())
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
