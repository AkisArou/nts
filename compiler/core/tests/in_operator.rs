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

/// The candidate set is each arm *and everything below it*.
///
/// The first version of this lowering asked the arms alone, and folded
/// `"extra" in v` to `false` for a `v: Base | Unrelated` holding a `Derived`
/// that has one. Node said true on 20 of 29 cases. Inheritance is additive, so
/// the `true` direction is safe from the arms and the `false` direction is not.
///
/// Every test in this file passed before that fix, because every fixture used
/// interfaces with nothing below them — which is why the assertion here is
/// about a hierarchy specifically.
#[test]
fn the_candidates_include_the_subclasses_of_every_arm() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    // `Base | Unrelated`, and only `Derived` declares `extra`. Neither arm
    // does, so an arms-only lowering emits no test at all.
    let tests = class_tests(func(&lowered, "aSubclassHasMore"));
    assert!(
        tests.contains(&1),
        "`extra` is a test against `Derived` alone: {tests:?}",
    );
    // And `common`, which `Base` declares, is a test against `Base` and
    // `Derived` both -- two classes, because `Unrelated` does not have it.
    assert!(
        tests.contains(&2),
        "`common` is a test against `Base` and `Derived`: {tests:?}",
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

/// `"k" in value` where the value is `object` and nothing narrower.
///
/// The shape every duck-typing site is written in — `value !== null && typeof
/// value === "object" && "k" in value` — and 67 sites in `runtime/node`, the
/// most of any refusal there. The candidate set is every object type the
/// program has, which is the same closed-world argument the union arms get.
///
/// The `typeof` guard is what makes it sound: `"k" in 5` throws, and the value
/// has been proved an object by the *program* before the test runs. An
/// unguarded `unknown` is still refused, because the type says so.
#[test]
fn an_object_becomes_a_test_against_every_class_declaring_it() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    // The helpers are not exported, so they are found among all functions
    // rather than by an export's name.
    let sets: Vec<usize> = lowered
        .program
        .funcs
        .iter()
        .filter(|func| func.name == "hasLabel" || func.name == "hasMessage")
        .flat_map(class_tests)
        .collect();
    assert_eq!(sets.len(), 2, "one class test in each helper: {sets:?}");
    assert!(
        sets.iter().all(|len| *len > 0),
        "and each names the types declaring its key: {sets:?}",
    );
}

/// The candidate set is every object *type*, not every class.
///
/// An object literal typed by an interface has a layout and no entry in the
/// hierarchy. Asking the hierarchy answered `false` for `"label" in { label:
/// "l" }` — 20 of 29 cases against node, from a fixture written to check
/// exactly this and nothing else.
#[test]
fn an_object_literals_type_is_a_candidate() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    // `Labelled` is an interface: nothing constructs it with `new`, and the
    // only value of it in the program is a literal. So the class test in
    // `hasLabel` names a type the hierarchy does not have, and a set built from
    // the hierarchy would be empty.
    let sets: Vec<usize> = lowered
        .program
        .funcs
        .iter()
        .filter(|func| func.name == "hasLabel")
        .flat_map(class_tests)
        .collect();
    assert_eq!(sets.len(), 1, "one class test in `hasLabel`: {sets:?}");
    assert!(
        sets[0] > 0,
        "`label` is declared only by an interface and the literal that satisfies it, \
         neither of which is in the hierarchy -- a candidate set built from the \
         hierarchy is empty here, which is the wrong answer this test exists for: {sets:?}",
    );
    // More than one, and that is the type table rather than a mistake: a
    // structural type reaches the checker under several ids -- the interface's,
    // the literal's inferred type, the annotation's -- and every one of them
    // declares `label`. They resolve to the same layout, so the emitted test is
    // over descriptors and not over ids.
}

/// Narrowing to `{}` is declined.
///
/// The checker narrows `unknown` to the empty object type after `!== null`, and
/// unerasing to it is a claim that the value *is* one of those — about a type
/// no object belongs to. Unchecked and invisible on a lane with pointers; the
/// JVM says `ClassCastException: nts.gen.Messaged cannot be cast to
/// nts.gen.Type117`.
///
/// There is nothing to read through it either: it declares no member, so the
/// narrowing buys exactly nothing in exchange for the lie.
#[test]
fn an_unknown_is_not_narrowed_to_the_empty_object_type() {
    let Some(lowered) = lowered("in-operator") else {
        return;
    };
    for name in ["hasLabel", "hasMessage"] {
        let Some(helper) = lowered.program.funcs.iter().find(|func| func.name == name) else {
            continue;
        };
        let unerased: Vec<&hir::HirType> = helper
            .values
            .iter()
            .filter(|op| matches!(op.kind, OpKind::Unerase { .. }))
            .map(|op| &op.ty)
            .collect();
        assert!(
            unerased.is_empty(),
            "`{name}` reads the tag rather than claiming a shape: {unerased:?}",
        );
    }
}

/// A key a natively represented type answers for is refused, by name.
///
/// `object` includes an array, a `Map`, a `Set`, a `Promise` and a `Date`, and
/// none of them has a layout to find a name on — so a set built from the
/// layouts answers `false` for them, and for their own property names
/// JavaScript answers `true`.
///
/// `then` is the one that bites: four sites in `runtime/node` ask it, and it is
/// how a program tests for a thenable. Without this the compiled program tells
/// a `Promise` it is not one, and agrees with node on every case that does not
/// happen to pass a promise.
#[test]
fn a_key_a_native_type_answers_for_is_refused() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    let said: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|d| d.message.as_str())
        .filter(|message| message.contains("natively represented"))
        .collect();
    assert_eq!(
        said.len(),
        1,
        "`\"then\" in value` names the boundary rather than answering: {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
    );
}
