//! Which bounds checks survive, and which the range analysis removes.
//!
//! A missing check is not a crash. The allocator hands out large chunks, so
//! memory past the end of an array is mapped and a read returns whatever
//! happened to be there — a wrong answer, silently. Removing one is therefore a
//! claim, and this is where the claim is tested.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Func, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared(fixture: &str) -> Option<hir::Prepared> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("prepared HIR should verify"))
}

/// Whether every element access in a function is unchecked.
fn all_unchecked(func: &Func) -> bool {
    func.values.iter().all(|op| {
        !matches!(
            op.kind,
            OpKind::ArrayGet { checked: true, .. } | OpKind::ArraySet { checked: true, .. }
        )
    })
}

fn checked_accesses(func: &Func) -> usize {
    func.values
        .iter()
        .filter(|op| {
            matches!(
                op.kind,
                OpKind::ArrayGet { checked: true, .. } | OpKind::ArraySet { checked: true, .. }
            )
        })
        .count()
}

fn func<'a>(prepared: &'a hir::Prepared, name: &str) -> &'a Func {
    prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("{name} should have lowered"))
}

#[test]
fn a_loop_over_a_known_length_needs_no_checks() {
    let Some(prepared) = prepared("arrays") else {
        return;
    };
    // `const xs = [1, 2, 3, 4, 5]` then `for (i = 0; i < xs.length; i++)`. The
    // array was allocated here, so its length is a constant, the guard bounds
    // the counter to a constant range, and the interval settles it. The literal
    // stores are proven the same way: constant index, constant length.
    assert!(
        all_unchecked(func(&prepared, "total")),
        "a loop over an array allocated here should need no checks",
    );
    assert!(all_unchecked(func(&prepared, "squares")));
}

#[test]
fn a_loop_over_an_unknown_length_needs_no_checks_either() {
    let Some(prepared) = prepared("arrays") else {
        return;
    };
    // `sum(xs: number[])` — the array arrives from outside, so no interval
    // bounds its length and nothing about `i`'s *range* proves anything. What
    // proves it is that the loop is guarded by that same array's length, which
    // is a relation between two unknown numbers rather than a fact about
    // either. This is the case the relational sliver in `flow` exists for.
    assert!(
        all_unchecked(func(&prepared, "sum")),
        "a loop guarded by the array's own length should need no checks",
    );
}

#[test]
fn an_arbitrary_index_keeps_its_check() {
    let Some(prepared) = prepared("arrays") else {
        return;
    };
    // `at(xs, i)` and `readAt(i)` index with a number nothing constrains. There
    // is no proof to be had, and inventing one would turn a stopped program
    // into a wrong answer.
    assert_eq!(
        checked_accesses(func(&prepared, "at")),
        1,
        "an unconstrained index must keep its check",
    );
    assert_eq!(checked_accesses(func(&prepared, "readAt")), 1);
}

#[test]
fn the_report_counts_what_was_removed_and_what_remains() {
    let Some(prepared) = prepared("arrays") else {
        return;
    };
    // Four checks remain across the fixture, and each is a place there is no
    // proof to be had:
    //
    // - `at` and `readAt` index with a number nothing constrains.
    // - `filledWith` and `reversedHead` index the *result of a method*, and the
    //   analysis knows nothing about what a runtime call returns -- `fill` and
    //   `reverse` hand back the array they were given, but saying so needs a
    //   summary for each of them rather than a rule.
    //
    // The last two are the honest cost of adding array methods as opaque calls,
    // and are what a `[0]` on a returned array costs until they are not opaque.
    assert_eq!(prepared.checks_kept, 4, "only the unprovable ones remain");
    assert!(
        prepared.checks_removed >= 15,
        "the literal stores and both loops should all be proven, got {}",
        prepared.checks_removed,
    );
}
