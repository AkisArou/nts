//! Preserve the behavioral roots of a missing-reference destructuring witness.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

#[test]
fn missing_and_present_reference_elements_retain_their_subjects() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-nested-pattern-missing-a-reference-element/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    let prepared = hir::prepare(&snapshot).expect("valid HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in [
        "missingObject",
        "missingArray",
        "presentObject",
        "presentArray",
        "defaultedObject",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|f| f.name == name && f.exported),
            "missing {name}"
        );
    }
}
