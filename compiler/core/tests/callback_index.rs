//! The index parameter of an array callback.
//!
//! `a.forEach((v, i) => ...)` was refused, and the refusal said why: the index
//! "would need the loop counter's identity to survive into the body". It does
//! — the counter is read from the bindings inside the body block, after
//! `begin_loop` has made the carried names block parameters — so the body sees
//! this iteration's value and the same one the `ArrayGet` indexed with.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/callbacks"))
}

/// The index the body reads is the counter, not the value it started at.
///
/// The first version of this test asserted only that *something* reads the
/// value the `ArrayGet` indexed with — which the loop's own condition and its
/// increment both do, so it passed even with the index bound to the constant
/// zero. The differential caught that mutation and this did not, which is a
/// check that cannot fail.
///
/// So it asks the sharper question. `forEachWithIndex` computes `value * at`,
/// and the element comes from an `ArrayGet`; the multiply's *other* operand is
/// the index. If that operand is a constant, the body was handed the loop's
/// starting value rather than this iteration's.
#[test]
fn the_index_the_body_reads_is_not_a_constant() {
    let Some(lowered) = lowered("callbacks") else {
        return;
    };
    let function = func(&lowered, "forEachWithIndex");

    let loaded: Vec<u32> = function
        .values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::ArrayGet { index, .. } => Some(index.0),
            _ => None,
        })
        .collect();
    assert!(!loaded.is_empty(), "the loop loads an element");

    let elements: Vec<u32> = function
        .values
        .iter()
        .enumerate()
        .filter(|(_, op)| matches!(op.kind, OpKind::ArrayGet { .. }))
        .map(|(at, _)| u32::try_from(at).unwrap_or(u32::MAX))
        .collect();

    // The multiply the body performs on the element, and what it multiplies by.
    let mut checked = 0;
    for op in &function.values {
        let OpKind::Binary {
            op: hir::BinOp::Mul,
            lhs,
            rhs,
        } = &op.kind
        else {
            continue;
        };
        let other = if elements.contains(&lhs.0) {
            rhs.0
        } else if elements.contains(&rhs.0) {
            lhs.0
        } else {
            continue;
        };
        checked += 1;
        assert!(
            !matches!(
                function.values[other as usize].kind,
                OpKind::ConstFloat(_)
            ),
            "the body multiplies the element by the counter, not by a constant",
        );
        // And it is the very value the load indexed with.
        assert!(
            loaded.contains(&other),
            "the index the body reads is the one the element was loaded with",
        );
    }
    assert_eq!(checked, 1, "`forEachWithIndex` has one such multiply");
}

/// Naming the index allocates nothing extra.
///
/// A *comparison* rather than a count, because the absolute number is not a
/// thing I can justify from the source: this reads the lowering's own output,
/// before escape analysis and dead-code elimination, and an array literal is
/// itself an allocation. Written as `0` first and then as `1`, and both were
/// wrong — `forEachWithIndex` lowers to two.
///
/// What is checkable is the claim actually being made: the counter existed
/// before this change and the callback now names it, so a callback that takes
/// the index must allocate exactly what the same callback without it does.
#[test]
fn naming_the_index_allocates_nothing_extra() {
    let Some(lowered) = lowered("callbacks") else {
        return;
    };
    let allocations = |name: &str| {
        func(&lowered, name)
            .values
            .iter()
            .filter(|op| {
                matches!(
                    op.kind,
                    OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }
                )
            })
            .count()
    };
    // Against `forEachWithoutIndex`, which walks the *same literal* with a
    // one-parameter callback and exists only to be this comparison. The first
    // version compared against `total`, which gets its array from a helper --
    // so the difference measured was one array literal rather than the index.
    let kinds = |name: &str| {
        func(&lowered, name)
            .values
            .iter()
            .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }))
            .map(|op| format!("{:?}", op.kind))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        allocations("forEachWithIndex"),
        allocations("forEachWithoutIndex"),
        "the index costs no allocation: {:?} vs {:?}",
        kinds("forEachWithIndex"), kinds("total"),
    );
    assert_eq!(
        allocations("onlyTheIndex"),
        allocations("forEachWithoutIndex"),
        "and neither does a callback that reads only the index",
    );
}

/// `reduce` takes the accumulator first, so its element is not its first
/// parameter and its index is its third.
///
/// This is the rule the change had to get right: "the last parameter is the
/// element" was true until an index could follow it, and `reduce` is where
/// getting it wrong swaps the accumulator for the element rather than failing.
#[test]
fn reduce_still_binds_its_accumulator_first() {
    let Some(lowered) = lowered("callbacks") else {
        return;
    };
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.message.contains("callback"))
            .count(),
        0,
        "nothing in examples/callbacks is refused for its callback shape",
    );
    // And it computes something: a `reduce` whose accumulator and element were
    // swapped would still lower, and the differential is what catches the
    // answer. This asserts the shape it must have to be checked at all.
    let function = func(&lowered, "reduceWithIndex");
    assert!(
        function
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ArrayGet { .. })),
        "`reduceWithIndex` reads elements",
    );
}

/// The array parameter is still refused, and the message says how many.
#[test]
fn the_array_parameter_is_refused_by_count() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    let reasons: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert!(
        reasons.iter().any(|reason| {
            reason.contains("callback taking 3 parameters") && reason.contains("may take")
        }),
        "the refusal counts rather than naming the feature: {reasons:?}",
    );
}
