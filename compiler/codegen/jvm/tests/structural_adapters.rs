//! Distinct interface slots can require different bodies for one JVM member.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn conflicting_absence_adapters_decline_the_class_by_name() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP structural_adapters: NTS_TSGO is not set");
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

#[test]
fn a_new_slot_cannot_replace_an_inherited_slots_absence_conversion() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP structural_adapters: NTS_TSGO is not set");
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../core/tests/programs/structural-inherited-absence/tsconfig.json")
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
            && diagnostic.message.contains("`Child`")
            && diagnostic
                .message
                .contains("needs distinct dispatch bodies")
    }));
    assert!(
        !emitted
            .classes
            .iter()
            .any(|written| written.binary_name.ends_with("Child"))
    );
}

#[test]
fn a_covariant_bridge_shares_a_slot_only_with_a_proven_identity() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP structural_adapters: NTS_TSGO is not set");
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/programs/a-method-adapted-to-a-structural-interface/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let mut prepared = nts_core::hir::prepare(&snapshot).expect("valid prepared HIR");
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    for class in ["ChildMaker", "GrandchildMaker", "ChildReader"] {
        assert!(
            emitted
                .classes
                .iter()
                .any(|written| written.binary_name.ends_with(class))
        );
    }
    prepared
        .program
        .identity_projections
        .retain(|adapter, _| !adapter.starts_with("ChildMaker#make@"));
    let missing_proof = nts_codegen_jvm::emit(&prepared.program);
    assert!(missing_proof.diagnostics.iter().any(
        |diagnostic| diagnostic.code == "NTS4001" && diagnostic.message.contains("ChildMaker")
    ));
    assert!(
        !missing_proof
            .classes
            .iter()
            .any(|written| written.binary_name.ends_with("ChildMaker"))
    );
}
