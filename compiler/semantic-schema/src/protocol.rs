//! The iteration protocol's interfaces, named in one place.
//!
//! `Iterable<T>` and its five relatives are declared in `lib.es2015.iterable.
//! d.ts` and nowhere in any program this compiler reads. That makes them the
//! one family two passes in two crates have to agree about by *name*:
//!
//! - the frontend decides whether to decompose a library type at all
//!   (`decompose::Decomposer::is_carried`), and without that decision there is
//!   no layout and no members;
//! - the lowering decides whether a type with no declaration node still
//!   declares members for dispatch (`hir::lower::collect_interfaces`), and
//!   without that the members exist and nothing can call them.
//!
//! Written twice the two lists would drift, and the failure is silent in the
//! worst direction: a name carried by one and not the other is a type with
//! members that nothing dispatches, which reads as `a method ... with no
//! declaration in the hierarchy` — a sentence about the hierarchy, pointing
//! away from the list that caused it.
//!
//! Matched by name rather than by shape, for the reason `is_carried` gives:
//! "carry any library interface whose members are representable" is the rule
//! that sounds principled and pulls the whole graph in through the first type
//! that happens to qualify. A name is a decision a reader can check.

use crate::schema::{SemanticSnapshot, TypeId};

/// The six interfaces the iteration protocol is written in terms of.
///
/// `IteratorResult` and its two arms are **not** here: they are data rather
/// than protocol, this compiler *provides* their layout (see
/// `hir::builtin::iterator_result_fields`), and they declare no method to
/// dispatch.
pub const ITERATION: [&str; 6] = [
    "Iterable",
    "Iterator",
    "IterableIterator",
    "AsyncIterable",
    "AsyncIterator",
    "AsyncIterableIterator",
];

/// Whether a declared name is one of them.
#[must_use]
pub fn is_an_iteration_protocol(name: &str) -> bool {
    ITERATION.contains(&name)
}

/// The protocol a type *is* an instantiation of, by the symbol it carries.
///
/// `Iterable<number>` answers `"Iterable"`; a class that merely satisfies the
/// protocol answers `None`, because the question here is which library type
/// this is rather than which shape it has.
#[must_use]
pub fn iteration_protocol_of(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    let name = snapshot
        .types
        .get(ty.0 as usize)?
        .symbol
        .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
        .map(|symbol| symbol.name.as_str())?;
    is_an_iteration_protocol(name).then_some(name)
}
