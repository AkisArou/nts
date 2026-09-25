//! Reading nts's snapshot of a program the way the React Compiler's frontend
//! needs to: a node's children by the property they fill.
//!
//! The snapshot keeps each node's children in tsgo's visitor order and a mask
//! of which optional properties are present (`NodeData::Children`). Which
//! property bit `i` is comes from tsgo's encoder, as the generated table in
//! [`children`]. Naming children by property is what lets the converter tell a
//! declaration's type from its initializer without guessing from their kinds.
//!
//! **A copy, until it moves.** [`kinds`] repeats, and extends, the syntax
//! kinds `nts_semantic_schema::syntax` names, and [`children`] describes
//! tsgo's encoding, which nts's lowering could read too. Both belong in
//! compiler/semantic-schema, and the move has been proposed to the compiler
//! lane. When it lands, this crate imports them from there and these files go.

pub mod children;
pub mod kinds;

use nts_semantic_schema::{NodeData, NodeId, NodeKind, SemanticSnapshot};

/// A program's nodes, read by property.
#[derive(Debug, Clone, Copy)]
pub struct Nodes<'a> {
    pub snapshot: &'a SemanticSnapshot,
}

impl<'a> Nodes<'a> {
    #[must_use]
    pub fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self { snapshot }
    }

    /// The node's syntax kind, or `None` for a list node.
    #[must_use]
    pub fn kind(self, id: NodeId) -> Option<u16> {
        match self.snapshot.nodes.get(id.0 as usize)?.kind {
            NodeKind::Syntax(kind) => Some(kind),
            NodeKind::List => None,
        }
    }

    /// The presence mask of a node's child properties, if it has any.
    fn present(self, id: NodeId) -> Option<u8> {
        match self.snapshot.nodes.get(id.0 as usize)?.data {
            NodeData::Children { present, .. } => Some(present),
            _ => None,
        }
    }

    /// The child filling `property`, if the node has that property and it is
    /// present. A list property answers the list node; see [`Self::items`].
    #[must_use]
    pub fn child(self, id: NodeId, property: &str) -> Option<NodeId> {
        let properties = children::properties(self.kind(id)?);
        let bit = properties.iter().position(|p| *p == property)?;
        let present = self.present(id)?;
        if present & (1 << bit) == 0 {
            return None;
        }
        // The children are the present properties, in bit order, once the
        // JSDoc nodes documenting this one are set aside.
        let index = (present & ((1u8 << bit) - 1)).count_ones() as usize;
        self.property_children(id).nth(index)
    }

    /// A node's children that fill its properties: all of them but its `JSDoc`.
    pub fn property_children(self, id: NodeId) -> impl Iterator<Item = NodeId> + 'a {
        let nodes = &self.snapshot.nodes;
        nodes[id.0 as usize]
            .children
            .iter()
            .copied()
            .filter(move |child| !matches!(nodes[child.0 as usize].kind, NodeKind::Syntax(kind) if children::is_jsdoc(kind)))
    }

    /// The elements of a list node.
    #[must_use]
    pub fn items(self, list: NodeId) -> &'a [NodeId] {
        match self.snapshot.nodes.get(list.0 as usize) {
            Some(node) if node.kind == NodeKind::List => &node.children,
            _ => &[],
        }
    }
}
