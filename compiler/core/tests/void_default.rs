//! The default slot receives its representation, never a void argument value.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

#[test]
fn void_arguments_preserve_default_roots_and_verify() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-void-argument-takes-its-default/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("valid HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in [
        "explicitUndefined",
        "allArgumentsBeforeDefaults",
        "defaultsReadPreviousParameters",
        "aShadowedUndefinedIsAValue",
        "anArgumentThrowSkipsTheDefault",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == name && func.exported),
            "missing {name}"
        );
    }
}
