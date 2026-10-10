//! Distinct interface slots can require different bodies for one JVM member.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn conflicting_absence_adapters_decline_the_class_by_name() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../core/tests/programs/structural-absence/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let prepared = nts_core::hir::prepare(&snapshot).expect("valid prepared HIR");
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(emitted.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "NTS4001"
            && diagnostic.message.contains("EchoInput")
            && diagnostic
                .message
                .contains("needs distinct dispatch bodies")
            && diagnostic
                .message
                .contains("one member name and descriptor")
    }));
    assert!(
        !emitted
            .classes
            .iter()
            .any(|class| class.binary_name.ends_with("EchoInput"))
    );
}
