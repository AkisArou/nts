//! Assertion effects must survive lowering and be handled through ordinary
//! exception machinery. The backend witness supplies a Node oracle explicitly.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn snapshot() -> Option<nts_semantic_schema::SemanticSnapshot> {
    let frontend = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-native-assertion-checks-its-representation/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some(snapshot)
}

#[test]
fn every_assertion_witness_root_survives_preparation() {
    let Some(snapshot) = snapshot() else { return };
    let prepared = hir::prepare(&snapshot).expect("valid assertion HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in [
        "checkedNumber",
        "checkedString",
        "checkedBoolean",
        "checkedClass",
        "subclassControl",
        "identityControl",
        "checkedPresence",
        "nestedAssertion",
        "typeofKeepsAssertion",
        "satisfiesControl",
        "checkedNullableString",
        "checkedUndefinedString",
        "checkedNullableClass",
        "checkedWidenedNullable",
        "nullableTarget",
        "nullableClassTarget",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == name && func.exported),
            "missing root {name}"
        );
    }
}

#[test]
fn synthesized_assertion_errors_reach_the_callers_handler() {
    let Some(snapshot) = snapshot() else { return };
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    for (caller, callee) in [
        ("checkedNumber", "numberValue"),
        ("checkedString", "stringValue"),
        ("checkedBoolean", "booleanValue"),
        ("checkedClass", "classValue"),
        ("checkedPresence", "presentValue"),
        ("checkedNullableString", "nullableString"),
        ("checkedUndefinedString", "undefinedString"),
        ("checkedNullableClass", "nullableClass"),
        ("checkedWidenedNullable", "widenedNullable"),
        ("nullableTarget", "admittedNullable"),
        ("nullableClassTarget", "admittedNullableClass"),
    ] {
        let func = lowered
            .program
            .funcs
            .iter()
            .find(|func| func.name == caller)
            .expect(caller);
        assert!(func.values.iter().any(|op| matches!(&op.kind,
            OpKind::Call { callee: Callee::Direct(name), .. } if name == &format!("{callee}@raises")
        )), "{caller} must select the checked callee's raising entry");
        assert!(
            func.values.iter().any(|op| matches!(&op.kind,
                OpKind::Call { callee: Callee::External(name), .. } if name == "nts_raising"
            )),
            "{caller} must observe the raised flag"
        );
    }
}

#[test]
fn proven_identity_and_satisfies_controls_have_no_assertion_cost() {
    let Some(snapshot) = snapshot() else { return };
    let prepared = hir::prepare(&snapshot).expect("valid assertion HIR");
    for name in ["identityControl", "satisfiesControl"] {
        let func = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .expect(name);
        assert!(!func.values.iter().any(|op| matches!(&op.kind,
            OpKind::Call { callee: Callee::External(name), .. } if name == "nts_raise" || name == "nts_uncaught"
        )), "{name} must not retain a runtime assertion guard");
        // The arena retains dead values for stable IDs. Only scheduled block
        // operations reach a backend and constitute an erasure cost.
        assert!(
            !func
                .blocks
                .iter()
                .flat_map(|block| &block.ops)
                .any(|value| matches!(
                    func.values[value.0 as usize].kind,
                    OpKind::Erase { .. } | OpKind::Unerase { .. }
                )),
            "{name} must not retain an erasure roundtrip"
        );
    }
}

#[test]
fn a_provided_error_upcast_keeps_the_existing_representation() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-native-error-assertion-keeps-provided-ancestry/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("valid error assertion HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let root = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "provedUpcast")
        .expect("retained upcast root");
    assert!(
        !root
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .any(|value| {
                matches!(
                    &root.values[value.0 as usize].kind,
                    OpKind::InstanceOf { .. } | OpKind::Erase { .. } | OpKind::Unerase { .. }
                )
            }),
        "a known subclass upcast must have no assertion or erasure cost"
    );
}
