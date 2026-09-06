//! `"x".repeat(n)` throws a `RangeError` for a count the language refuses.
//!
//! `nts_str_repeat` clamped a negative count to zero and answered `""`. Node
//! throws, so this was a **wrong answer** rather than a missing feature — and
//! it was invisible for as long as it existed, because the differential's node
//! driver died on the first synchronous throw and every case after it went
//! unasked. The driver was fixed and `examples/strings` went red on five cases
//! the same day.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, OpKind};
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
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/strings"))
}

/// The count is tested before the helper is reached, and both halves are there.
///
/// `n < 0 || n === Infinity` — and each half is load-bearing: `-Infinity` is
/// caught by the first, `-0` is not negative and must not throw, and a `NaN`
/// fails both, which is right because `ToIntegerOrInfinity(NaN)` is `0`.
#[test]
fn a_repeat_count_is_tested_for_both_refusals() {
    let Some(lowered) = lowered("strings") else {
        return;
    };
    let repeated = func(&lowered, "repeated");

    let compared: Vec<BinOp> = repeated
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Binary { op, .. } => Some(*op),
            _ => None,
        })
        .collect();
    assert!(
        compared.contains(&BinOp::Lt),
        "`n < 0` catches a negative count and `-Infinity`: {compared:?}",
    );
    assert!(
        compared.contains(&BinOp::Eq),
        "`n === Infinity` catches the one the first misses: {compared:?}",
    );

    // And the infinity it compares against is a constant of this lowering's,
    // not something the source wrote — `repeated` passes its argument straight
    // through.
    assert!(
        repeated
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ConstFloat(value) if value.is_infinite())),
        "the guard supplies its own bound",
    );
}

/// A `RangeError` is built and thrown, in a program that never names one.
///
/// The checker interns only what the source mentions, so
/// `type_named("RangeError")` is `None` for most programs — `examples/strings`
/// has no `RangeError` in it. A class this compiler *provides* cannot depend on
/// that, so the type comes from a reserved band when the snapshot has none.
#[test]
fn the_thrown_class_does_not_need_the_program_to_name_it() {
    let Some(lowered) = lowered("strings") else {
        return;
    };
    let repeated = func(&lowered, "repeated");

    let built: Vec<&str> = lowered
        .program
        .layouts
        .iter()
        .filter(|layout| layout.name == "RangeError")
        .map(|layout| layout.name.as_str())
        .collect();
    assert_eq!(
        built.len(),
        1,
        "one `RangeError` layout, built for a name the source never wrote: {built:?}",
    );

    // The message is this compiler's, so there is no expression to lower and
    // the constant is the evidence the throw was synthesised here.
    assert!(
        repeated.values.iter().any(|op| matches!(
            &op.kind,
            OpKind::ConstString(text) if text == "Invalid count value"
        )),
        "the specification's message, written once",
    );
}
