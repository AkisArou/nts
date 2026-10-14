//! Stored literal dispatch keeps full contracts after preparation.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir::{self, Absent, Callee, HirType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn snapshot(fixture: &str) -> Option<nts_semantic_schema::SemanticSnapshot> {
    let frontend = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(fixture)
        .join("tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some(snapshot)
}

#[test]
fn a_field_adapter_survives_preparation_and_cannot_be_omitted_as_identity() {
    let Some(snapshot) =
        snapshot("tests/programs/a-capturing-literal-dispatched-through-another-interface")
    else {
        return;
    };
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::new(hir::InterfaceAccess::Materialize)
            },
        )
        .unwrap();
        let program = &prepared.program;
        let body = program
            .funcs
            .iter()
            .find(|f| f.name.contains("#take@field$"))
            .expect("field adapter");
        assert!(
            body.values
                .iter()
                .any(|op| matches!(op.kind, OpKind::FieldGet { .. }))
        );
        assert!(body.values.iter().any(|op| matches!(&op.kind, OpKind::Call { callee: Callee::Closure { slot, .. }, .. } if Some(*slot) == program.erased_call_slot)));
        assert!(!program.identity_projections.contains_key(&body.name));
        assert!(program.layouts.iter().any(|layout| {
            layout
                .methods
                .iter()
                .flatten()
                .any(|entry| entry == &body.name)
        }));
    }
}

#[test]
fn identical_storage_with_different_input_absence_keeps_two_field_bodies() {
    let Some(snapshot) =
        snapshot("tests/refusals/a-literal-method-call-through-two-faces-loses-absence")
    else {
        return;
    };
    let prepared = hir::prepare(&snapshot).unwrap();
    let bodies: Vec<_> = prepared
        .program
        .funcs
        .iter()
        .filter(|f| f.name.contains("#read@field$") && !f.name.ends_with("@raises"))
        .collect();
    assert_eq!(bodies.len(), 2, "the storage ABI alone cannot key adapters");
    assert_eq!(
        bodies[0].params.iter().map(|p| &p.ty).collect::<Vec<_>>(),
        bodies[1].params.iter().map(|p| &p.ty).collect::<Vec<_>>()
    );
    assert_eq!(
        bodies[0].return_type,
        HirType::Managed(hir::ManagedType::String)
    );
    let carries = |absent| {
        bodies.iter().any(|body| {
            body.values
                .iter()
                .any(|op| matches!(op.kind, OpKind::Erase { absent: found, .. } if found == absent))
        })
    };
    assert!(carries(Absent::Null));
    assert!(carries(Absent::Undefined));
}

#[test]
fn an_erased_alias_to_the_literal_blocks_its_method_edge() {
    let Some(snapshot) = snapshot("tests/refusals/an-erased-alias-can-write-a-literal-method")
    else {
        return;
    };
    let lowered = hir::lower::lower(&snapshot);
    assert!(
        !lowered
            .program
            .funcs
            .iter()
            .any(|f| f.name.contains("#read@field$"))
    );
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(!prepared.program.funcs.iter().any(|f| f.name == "call"));
    assert!(prepared.program.uncompiled.iter().any(
        |(name, why)| name == "call" && why.contains("no class in this program implements it")
    ));
}

#[test]
fn a_private_helper_proves_every_incoming_replacement() {
    let Some(snapshot) =
        snapshot("tests/programs/a-literal-method-replacement-proved-through-a-private-helper")
    else {
        return;
    };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name == "result")
    );
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name.contains("#take@field$"))
    );
    assert!(
        !prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name.starts_with("use@"))
    );
}

#[test]
fn one_narrowing_caller_invalidates_a_private_helpers_supply_proof() {
    let Some(snapshot) = snapshot("tests/refusals/a-literal-method-helper-has-a-narrowing-caller")
    else {
        return;
    };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(
        !prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name == "result")
    );
    assert!(
        !prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name.contains("#take@field$"))
    );
    assert!(
        prepared.program.uncompiled.iter().any(
            |(name, why)| name == "result" && why.contains("without a complete dispatch table")
        )
    );
}

#[test]
fn method_identity_copies_cover_aliases_and_downstream_helpers() {
    let Some(snapshot) =
        snapshot("tests/programs/a-literal-method-identity-preserved-through-another-interface")
    else {
        return;
    };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.program.uncompiled.is_empty());
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name == "result")
    );
    assert!(prepared.program.funcs.iter().any(|body| {
        body.name.starts_with("same@")
            && body
                .values
                .iter()
                .any(|op| matches!(op.kind, OpKind::FieldGet { .. }))
    }));
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name.starts_with("forward@"))
    );
}

#[test]
fn mixed_comparison_and_invocation_preserves_the_legacy_face_globally() {
    let Some(snapshot) =
        snapshot("tests/programs/a-literal-interface-comparison-and-call-keeps-its-source-path")
    else {
        return;
    };
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(prepared.program.uncompiled.is_empty());
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name == "result")
    );
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name.starts_with("same@"))
    );
    assert!(
        !prepared
            .program
            .funcs
            .iter()
            .any(|body| body.name.contains("#take@field$"))
    );
}
