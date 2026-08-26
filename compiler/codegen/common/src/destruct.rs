//! Turning block parameters back into assignments.
//!
//! # The problem
//!
//! A jump `b1(%6, %8)` into `b1(%3, %4)` means "%3 becomes %6 and %4 becomes %8",
//! and both happen **at once**. C and the JVM have no such construct, so the
//! copies have to be sequenced — and sequencing them naively is wrong.
//!
//! ```text
//! jump b(%y, %x)   into   b(%x, %y)     a swap
//!
//! naive:   x = y;  y = x;    both end up holding the old y
//! ```
//!
//! The copies form a graph: an edge from each destination to the source it reads.
//! Any copy whose destination nothing else still needs to read can go first. What
//! remains when none qualifies is a cycle, and a cycle is broken by saving one
//! value aside.
//!
//! This is decided once, here, because two backends sequencing it independently
//! is exactly the shape of drift record 0004 measured — and a backend that gets
//! it subtly wrong produces a program that runs and computes the wrong thing.

use nts_core::hir::{Func, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};

/// One step of a sequenced parallel copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Copy {
    /// `to = from`
    Move { to: ValueId, from: ValueId },
    /// `tmp = from`, saving a value a cycle is about to overwrite.
    Save { temp: u32, from: ValueId },
    /// `to = tmp`
    Restore { to: ValueId, temp: u32 },
}

/// Sequence the copies an edge performs, in an order that preserves their
/// simultaneous meaning.
///
/// `params` are the target block's parameters and `args` the values the edge
/// supplies, positionally. A copy of a value to itself is dropped rather than
/// emitted.
///
/// # Panics
///
/// Never; a mismatched length yields the copies for the shorter of the two, which
/// the verifier rejects upstream.
#[must_use]
pub fn edge_copies(params: &[ValueId], args: &[ValueId]) -> Vec<Copy> {
    /// Where a pending copy reads from: still a value, or a temporary it was
    /// redirected to when a cycle was broken.
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Source {
        Value(ValueId),
        Temp(u32),
    }

    let mut pending: FxHashMap<ValueId, Source> = FxHashMap::default();
    for (to, from) in params.iter().zip(args) {
        if to != from {
            pending.insert(*to, Source::Value(*from));
        }
    }

    let mut sequence = Vec::new();
    let mut temps = 0;

    while !pending.is_empty() {
        // A destination no remaining copy still reads is safe to overwrite.
        let still_read: FxHashSet<ValueId> = pending
            .values()
            .filter_map(|source| match source {
                Source::Value(value) => Some(*value),
                Source::Temp(_) => None,
            })
            .collect();
        let mut ready: Vec<ValueId> = pending
            .keys()
            .copied()
            .filter(|to| !still_read.contains(to))
            .collect();

        if ready.is_empty() {
            // Everything left is in a cycle. Save one destination's current value
            // and point whoever reads it at the copy instead. That destination is
            // then unread, so the ordinary rule takes over — no copy is emitted
            // here, because emitting one now would clobber a value another pending
            // copy still needs.
            let victim = pending
                .keys()
                .copied()
                .min_by_key(|to| to.0)
                .expect("pending is non-empty");
            let temp = temps;
            temps += 1;
            sequence.push(Copy::Save { temp, from: victim });
            for source in pending.values_mut() {
                if *source == Source::Value(victim) {
                    *source = Source::Temp(temp);
                }
            }
            continue;
        }

        // Deterministic order, so one program always emits one sequence.
        ready.sort_unstable_by_key(|to| to.0);
        for to in ready {
            match pending.remove(&to) {
                Some(Source::Value(from)) => sequence.push(Copy::Move { to, from }),
                Some(Source::Temp(temp)) => sequence.push(Copy::Restore { to, temp }),
                None => {}
            }
        }
    }

    sequence
}

/// How many temporaries the copies on any edge of this function need.
///
/// A backend declares this many scratch slots once per function rather than
/// inventing names as it goes.
#[must_use]
pub fn temp_count(func: &Func) -> u32 {
    let mut most = 0;
    for block in &func.blocks {
        for (target, args) in outgoing(&block.terminator) {
            let params = &func.blocks[target.0 as usize].params;
            let used = edge_copies(params, &args)
                .iter()
                .filter_map(|copy| match copy {
                    Copy::Save { temp, .. } => Some(*temp + 1),
                    _ => None,
                })
                .max()
                .unwrap_or(0);
            most = most.max(used);
        }
    }
    most
}

/// Edges leaving a terminator, with the arguments each supplies.
#[must_use]
pub fn outgoing(
    terminator: &nts_core::hir::Terminator,
) -> Vec<(nts_core::hir::BlockId, Vec<ValueId>)> {
    use nts_core::hir::Terminator;
    match terminator {
        Terminator::Return(_) | Terminator::Unreachable => Vec::new(),
        Terminator::Jump { target, args } => vec![(*target, args.clone())],
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (*then_target, then_args.clone()),
            (*else_target, else_args.clone()),
        ],
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    fn v(n: u32) -> ValueId {
        ValueId(n)
    }

    /// Execute the sequence against a starting state, to check what it computes.
    fn run(copies: &[Copy], initial: &[(ValueId, i64)]) -> FxHashMap<ValueId, i64> {
        let mut state: FxHashMap<ValueId, i64> = initial.iter().copied().collect();
        let mut temps: FxHashMap<u32, i64> = FxHashMap::default();
        for copy in copies {
            match copy {
                Copy::Move { to, from } => {
                    let value = state[from];
                    state.insert(*to, value);
                }
                Copy::Save { temp, from } => {
                    temps.insert(*temp, state[from]);
                }
                Copy::Restore { to, temp } => {
                    state.insert(*to, temps[temp]);
                }
            }
        }
        state
    }

    #[test]
    fn independent_copies_need_no_temporary() {
        let copies = edge_copies(&[v(1), v(2)], &[v(10), v(20)]);
        assert_eq!(copies.len(), 2);
        assert!(!copies.iter().any(|c| matches!(c, Copy::Save { .. })));
    }

    #[test]
    fn a_copy_to_itself_is_dropped() {
        // `jump b(%3)` into `b(%3)` is the common case for a loop-carried value
        // that the body did not change. Emitting `x = x` costs a line per edge.
        assert!(edge_copies(&[v(3)], &[v(3)]).is_empty());
    }

    #[test]
    fn a_chain_is_ordered_so_nothing_is_clobbered() {
        // x = y; y = z. Doing them in the wrong order loses the old y.
        let copies = edge_copies(&[v(1), v(2)], &[v(2), v(3)]);
        let state = run(&copies, &[(v(1), 100), (v(2), 200), (v(3), 300)]);
        assert_eq!(state[&v(1)], 200, "x took the old y");
        assert_eq!(state[&v(2)], 300);
    }

    #[test]
    fn a_swap_is_performed_through_a_temporary() {
        // The case naive sequencing gets wrong: both would end up holding old y.
        let copies = edge_copies(&[v(1), v(2)], &[v(2), v(1)]);
        assert!(
            copies.iter().any(|c| matches!(c, Copy::Save { .. })),
            "a cycle needs a temporary: {copies:?}",
        );

        let state = run(&copies, &[(v(1), 100), (v(2), 200)]);
        assert_eq!(state[&v(1)], 200);
        assert_eq!(
            state[&v(2)],
            100,
            "the values were swapped, not both set to one"
        );
    }

    #[test]
    fn a_three_way_rotation_is_performed_correctly() {
        // x,y,z = y,z,x — one cycle, one temporary.
        let copies = edge_copies(&[v(1), v(2), v(3)], &[v(2), v(3), v(1)]);
        let state = run(&copies, &[(v(1), 1), (v(2), 2), (v(3), 3)]);
        assert_eq!(state[&v(1)], 2);
        assert_eq!(state[&v(2)], 3);
        assert_eq!(state[&v(3)], 1);
    }

    #[test]
    fn a_cycle_beside_an_independent_copy_resolves_both() {
        let copies = edge_copies(&[v(1), v(2), v(4)], &[v(2), v(1), v(5)]);
        let state = run(&copies, &[(v(1), 1), (v(2), 2), (v(4), 4), (v(5), 5)]);
        assert_eq!(state[&v(1)], 2);
        assert_eq!(state[&v(2)], 1);
        assert_eq!(state[&v(4)], 5);
    }

    #[test]
    fn several_destinations_reading_one_source_all_get_it() {
        let copies = edge_copies(&[v(1), v(2)], &[v(3), v(3)]);
        let state = run(&copies, &[(v(1), 1), (v(2), 2), (v(3), 42)]);
        assert_eq!(state[&v(1)], 42);
        assert_eq!(state[&v(2)], 42);
    }
}
