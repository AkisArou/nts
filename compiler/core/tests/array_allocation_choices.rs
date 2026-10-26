//! Context may type an allocation through a choice, but cannot reinterpret an
//! existing erased array or turn a hole into a stored null.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

fn prepared(fixture: &str) -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(fixture)
        .join("tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    hir::prepare(&snapshot).expect("prepared HIR verifies")
}

#[test]
fn allocating_through_a_choice_compiles_every_subject_and_control() {
    let prepared = prepared("tests/programs/an-array-allocation-keeps-its-type-past-a-choice");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:#?}",
        prepared.diagnostics
    );
    for name in [
        "conditional",
        "ifElseControl",
        "strings",
        "stringsControl",
        "parenthesized",
        "nested",
        "nullish",
        "disjunction",
        "conjunction",
    ] {
        assert!(
            prepared.program.funcs.iter().any(|func| func.name == name),
            "{name} must reach preparation"
        );
    }
}

#[test]
fn a_choice_keeps_the_erased_width_and_nullable_holes_refusals() {
    for (fixture, message, control) in [
        (
            "tests/refusals/a-choice-does-not-reinterpret-an-erased-array",
            "the two hold different widths",
            "typedControl",
        ),
        (
            "tests/refusals/a-choice-keeps-the-holes-check-through-a-generic",
            "whose holes read as `undefined` where a null slot of it reads as `null`",
            "filledControl",
        ),
    ] {
        let prepared = prepared(fixture);
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains(message)),
            "{fixture} must retain its specific refusal: {:#?}",
            prepared.diagnostics
        );
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == control),
            "{fixture}'s {control} must compile"
        );
    }
}
