//! Behavioral examples must retain every intended root: a differential can
//! agree on the surviving control functions while the generic subjects refuse.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn every_generic_exception_subject_is_compiled_and_verified() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-specialized-function-carrying-a-throw/tsconfig.json")
        .canonicalize_utf8()
        .expect("the regression example exists");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("the snapshot succeeds");
    let prepared = hir::prepare(&snapshot).expect("the prepared HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "every subject must compile: {:?}",
        prepared.diagnostics
    );
    for name in [
        "aNumber",
        "aReference",
        "aClosure",
        "aCapturedNumber",
        "aCapturedReference",
        "anImportedCall",
        "anOrdinaryCall",
        "thePlainControl",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == name && func.exported),
            "the differential must reach {name}"
        );
    }
}
