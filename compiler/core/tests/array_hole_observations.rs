//! A bounds proof does not make an unwritten array slot an element.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn a_folded_typeof_keeps_its_hole_observation_after_bounds_proof() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP: set NTS_TSGO to run the hole-observation guard");
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join(
        "../../tests/outcomes/typeof-an-unwritten-slot-survives-a-bounds-proof/tsconfig.json",
    );
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("prepared HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:#?}",
        prepared.diagnostics
    );
    let mut subjects = 0;
    for func in &prepared.program.funcs {
        if !func.name.starts_with("boundedTypeOfHole") {
            continue;
        }
        subjects += 1;
        assert!(
            func.blocks.iter().flat_map(|block| &block.ops).any(|id| {
                matches!(
                    func.value(*id).kind,
                    OpKind::ArrayGet { checked: false, .. }
                )
            }),
            "{}: the in-bounds read must reach the backend's initialization check",
            func.name
        );
    }
    assert!(subjects > 0, "the subject must compile");
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "boundedTypeOfControl")
    );
}
