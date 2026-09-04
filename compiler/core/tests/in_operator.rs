//! What `"k" in value` lowers to, and what it declines to lower.
//!
//! The interesting assertion is not that it works — the differential says that
//! against node on 232 cases. It is *which* of three shapes each site takes:
//! a constant `true`, a constant `false`, or a class test against exactly the
//! arms that declare the property. A lowering that emitted the test in all three
//! cases would agree with node and be slower for no reason; one that folded the
//! mixed case to a constant would be silently wrong.
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

/// The ops of one exported function, by name.
fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/in-operator"))
}

fn class_tests(func: &hir::Func) -> Vec<usize> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::InstanceOf { classes, .. } => Some(classes.len()),
            _ => None,
        })
        .collect()
}

fn constants(func: &hir::Func) -> Vec<bool> {
    func.values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::ConstBool(value) => Some(value),
            _ => None,
        })
        .collect()
}

/// A union where some arms declare the property becomes a class test naming
/// exactly those arms.
#[test]
fn a_mixed_union_becomes_a_test_against_the_arms_that_declare_it() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    // `Circle | Square`, and only `Circle` has `radius`.
    let tests = class_tests(func(&lowered, "narrows"));
    assert_eq!(tests, vec![1], "one test against one arm: {tests:?}");

    // Three arms, and both tests name exactly one — which is not what I
    // expected and is the better answer. `read` is declared by two of the three
    // arms, but the second test is reached only after `"duplex" in s` was false,
    // so TypeScript has already narrowed `s` to `Reader | Writer` and only
    // `Reader` declares `read`. The set comes from the *narrowed* static type,
    // so an earlier test makes a later one cheaper.
    //
    // This assertion was written as `[1, 2]` from the un-narrowed union and
    // failed, which is the only reason the narrowing is recorded here at all.
    let chained = class_tests(func(&lowered, "chained"));
    assert_eq!(
        chained,
        vec![1, 1],
        "each test names one arm of the union it can still be: {chained:?}",
    );
}

/// When every arm declares it, or none does, the answer is a constant and no
/// test is emitted.
#[test]
fn a_decided_answer_is_a_constant_and_not_a_test() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    for (name, want) in [("everyArmHasIt", true), ("noArmHasIt", false)] {
        let function = func(&lowered, name);
        assert!(
            class_tests(function).is_empty(),
            "`{name}` needs no class test: {:?}",
            class_tests(function),
        );
        assert!(
            constants(function).contains(&want),
            "`{name}` should fold to {want}: {:?}",
            constants(function),
        );
    }
}

/// The operand is evaluated even where the answer is a constant.
///
/// `in` has no short circuit. `"nope" in look(n)` is false whatever `look`
/// returns, and `look` still has to run — it increments a module-scope counter
/// here, and `examples/in-operator` compares the count against node.
#[test]
fn a_constant_answer_still_evaluates_its_operand() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    let function = func(&lowered, "evaluatesItsOperand");
    let calls = function
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::Call { .. }))
        .count();
    // Two calls to `look`, one of which is behind a constant-folded `in`.
    assert!(
        calls >= 2,
        "both operands are evaluated, so both calls survive: {calls}",
    );
}

/// `in` naming an optional property is refused, and the refusal names the
/// property rather than the feature.
///
/// The distinction is the whole point: `"label" in o` on the same object is
/// supported and `examples/in-operator` has it. A refusal reading "`in` is not
/// supported" would say the feature is absent when one property of one type is.
#[test]
fn in_on_an_optional_property_is_refused_by_name() {
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
            reason.contains("an `in` naming `limit`")
                && reason.contains("optional")
                && reason.contains("undefined")
        }),
        "the refusal names the property and why the slot cannot answer: {reasons:?}",
    );
    assert!(
        reasons
            .iter()
            .any(|reason| reason.contains("an `in` whose key is not a literal")),
        "a computed key is refused separately: {reasons:?}",
    );
}
