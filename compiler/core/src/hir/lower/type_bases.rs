//! Complete traversal of the snapshot's finite base graph.

use super::{SemanticSnapshot, TypeId};
use rustc_hash::FxHashSet;

#[derive(Clone, Copy)]
pub(super) enum Order {
    Written,
    Reversed,
}

/// Strict bases in the query's existing depth-first edge order. Shared
/// ancestors and malformed cycles are visited once; the subject is excluded.
pub(super) fn walk(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    order: Order,
) -> impl Iterator<Item = TypeId> + '_ {
    let mut pending = Vec::new();
    let mut seen = FxHashSet::default();
    let add = move |pending: &mut Vec<TypeId>, at| {
        let bases = snapshot.base_types.get(&at).into_iter().flatten().copied();
        match order {
            Order::Written => pending.extend(bases.rev()),
            Order::Reversed => pending.extend(bases),
        }
    };
    seen.insert(ty);
    add(&mut pending, ty);
    std::iter::from_fn(move || {
        while let Some(at) = pending.pop() {
            if seen.insert(at) {
                add(&mut pending, at);
                return Some(at);
            }
        }
        None
    })
}
