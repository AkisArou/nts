//! Navigating a snapshot's nodes, written once.
//!
//! Pure queries over a [`SemanticSnapshot`], here for the reason
//! [`crate::reachability`] is here: they need nothing but the snapshot, and the
//! frontend, the lowering and every measurement pass want the same answers.
//!
//! **They were written twice before this module, and the second copy was the
//! hazard rather than the duplication.** `hir::lower`'s `FuncBuilder` carries
//! its own — it has to, since it also carries lowering state — and
//! `core::erasure`'s walker carried a second set. Two of them are one fact with
//! two owners, which is the shape this repository keeps paying for: the enum
//! bug fixed on 2026-09-23 was exactly `denoted` below, followed at two of four
//! sites in `lower.rs` and not at the other two, and the refusal it produced
//! described the wrong construct.
//!
//! Free functions rather than a struct: none of them holds state, so a struct
//! would only be somewhere to put the snapshot reference. `FuncBuilder` is
//! deliberately left alone — it is a different animal, and unifying it means
//! moving lowering state, which is not what this buys.

use crate::schema::{NodeId, NodeKind, SemanticSnapshot, SymbolId};

/// A node's syntax kind, or `None` for a list node.
#[must_use]
pub fn kind_of(snapshot: &SemanticSnapshot, id: NodeId) -> Option<u16> {
    match snapshot.nodes.get(id.0 as usize)?.kind {
        NodeKind::Syntax(kind) => Some(kind),
        NodeKind::List => None,
    }
}

/// A node's own text, where it has any.
#[must_use]
pub fn text_of(snapshot: &SemanticSnapshot, id: NodeId) -> Option<&str> {
    snapshot.nodes.get(id.0 as usize)?.text.as_deref()
}

/// Children with list nodes flattened away, the way lowering sees them.
#[must_use]
pub fn children(snapshot: &SemanticSnapshot, id: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let Some(node) = snapshot.nodes.get(id.0 as usize) else {
        return out;
    };
    for child in &node.children {
        match snapshot.nodes.get(child.0 as usize).map(|n| &n.kind) {
            Some(NodeKind::List) => out.extend(children(snapshot, *child)),
            _ => out.push(*child),
        }
    }
    out
}

/// The nearest enclosing *syntax* node.
///
/// A `NodeList` is an encoding artifact rather than a construct -- an argument
/// list, a statement list -- and stopping at one reports a use as unrecognised.
/// It was the single largest bucket in the first run of the erasure pass: 80 of
/// `console`'s 140 unclear sites.
#[must_use]
pub fn parent(snapshot: &SemanticSnapshot, id: NodeId) -> Option<NodeId> {
    let mut at = snapshot.nodes.get(id.0 as usize)?.parent;
    while let Some(node) = at {
        if snapshot.nodes.get(node.0 as usize)?.kind != NodeKind::List {
            return Some(node);
        }
        at = snapshot.nodes.get(node.0 as usize)?.parent;
    }
    None
}

/// The symbol a name denotes, following an import alias.
///
/// **An import names an alias at the use site**, and an alias carries none of
/// the flags or declarations of the thing it names -- so a pass that asks
/// `SymbolFlags` or walks `declarations` without coming through here answers
/// about the alias. The loop is a bound rather than an algorithm: the frontend
/// follows the whole chain, so this is one hop in every case it has produced,
/// and a self-referential chain would be a frontend bug rather than something
/// to hang on.
#[must_use]
pub fn denoted(snapshot: &SemanticSnapshot, symbol: SymbolId) -> SymbolId {
    let mut at = symbol;
    for _ in 0..8 {
        match snapshot
            .symbols
            .get(at.0 as usize)
            .and_then(|record| record.aliased)
        {
            Some(next) => at = next,
            None => return at,
        }
    }
    at
}
