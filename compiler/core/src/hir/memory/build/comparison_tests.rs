//! Lineage-engine controls; the integration test also exercises actual legacy
//! placement of the checked-in retaining/region caller pair.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::tests::function;
use super::*;
use crate::hir::Memory;

fn model(n: usize, recursive: bool) -> (Report, Program, rustc_hash::FxHashMap<String, String>) {
    let call = |name: &str| OpKind::Call {
        callee: Callee::Direct(name.to_owned()),
        args: Vec::new(),
        frame: None,
    };
    let init = function(
        "module#init".to_owned(),
        (0..n).map(|_| call("factory")).collect(),
    );
    let mut factory = function(
        "factory".to_owned(),
        vec![OpKind::ObjectNew { frame: false }],
    );
    factory.values[0].ty = HirType::Managed(ManagedType::Object(nts_semantic_schema::TypeId(1)));
    if recursive {
        factory.values.push(crate::hir::Op {
            kind: call("factory"),
            ty: HirType::Void,
            origin: super::tests::origin(),
        });
        factory.blocks[0].ops.push(ValueId(1));
    }
    let mut program = Program {
        funcs: vec![init, factory],
        layouts: vec![crate::hir::Layout {
            types: vec![nts_semantic_schema::TypeId(1)],
            name: "Cell".to_owned(),
            interfaces: Vec::new(),
            fields: Vec::new(),
            methods: Vec::new(),
            base: None,
        }],
        ..Program::default()
    };
    verify::verify(&program).expect("the source model's IDs, operands and layouts verify");
    let report = analyze(
        &program,
        Limits {
            contexts_per_function: 2,
            ..Limits::default()
        },
    );
    assert!(report.failure.is_none(), "{:?}", report.failure);
    let mut clone = program.funcs[1].clone();
    // This identity deliberately has no suffix that a reader can parse.
    clone.name = "observed-physical-body".to_owned();
    if recursive {
        let OpKind::Call { callee, .. } = &mut clone.values[1].kind else {
            unreachable!()
        };
        *callee = Callee::Direct(clone.name.clone());
    }
    program.funcs.push(clone);
    for (at, op) in program.funcs[0].values.iter_mut().enumerate() {
        if at % 2 == 0 {
            let OpKind::Call { callee, .. } = &mut op.kind else {
                unreachable!()
            };
            *callee = Callee::Direct("observed-physical-body".to_owned());
        }
    }
    verify::verify(&program).expect("the actual retargeted model verifies too");
    (
        report,
        program,
        [("observed-physical-body".to_owned(), "factory".to_owned())]
            .into_iter()
            .collect(),
    )
}

#[test]
fn merged_context_keeps_all_actual_variants() {
    let (mut report, program, clones) = model(4, false);
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones);
    let merged = report
        .sites
        .iter()
        .find(|site| site.obligations.contains(&Reason::ContextBudget))
        .expect("third/fourth arrivals merge");
    assert_eq!(merged.legacy, ["call-region", "heap"]);
    assert_eq!(merged.legacy_variants.len(), 2);
    assert!(merged.legacy_unknown.is_none());
    assert!(report.comparison_failure.is_none());
}

#[test]
fn missing_arrival_does_not_erase_a_known_variant() {
    let (mut report, mut program, clones) = model(4, false);
    let OpKind::Call { callee, .. } = &mut program.funcs[0].values[3].kind else {
        unreachable!()
    };
    *callee = Callee::Direct("unavailable-body".to_owned());
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones);
    let merged = report
        .sites
        .iter()
        .find(|site| site.obligations.contains(&Reason::ContextBudget))
        .expect("merged context");
    assert_eq!(merged.legacy_variants.len(), 1);
    assert_eq!(merged.legacy_variants[0].home, "call-region");
    assert!(
        merged
            .legacy_unknown
            .as_ref()
            .is_some_and(|reason| reason.contains("unavailable-body"))
    );
}

#[test]
fn recursive_arrivals_follow_the_actual_recursive_variant() {
    let (mut report, program, clones) = model(1, true);
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones);
    assert_eq!(report.sites.len(), 1);
    assert_eq!(report.sites[0].legacy, ["call-region"]);
    assert_eq!(
        report.sites[0].legacy_variants[0].function,
        "observed-physical-body"
    );
    assert!(report.sites[0].legacy_unknown.is_none());
}

#[test]
fn comparison_exhaustion_is_named_for_every_site() {
    let (mut report, program, clones) = model(4, false);
    report.work_limit = report.work;
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones);
    assert!(report.comparison_failure.is_some());
    assert!(
        report
            .sites
            .iter()
            .all(|site| site.legacy_unknown.as_deref() == Some("legacy comparison work budget"))
    );
}

#[test]
fn frame_storage_in_a_clone_keeps_its_physical_frame_home() {
    let (mut report, mut program, clones) = model(1, false);
    program.funcs[2].values[0].kind = OpKind::ObjectNew { frame: true };
    verify::verify(&program).expect("the framed actual clone verifies");
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones);
    assert_eq!(report.sites[0].legacy, ["frame"]);
}

#[test]
fn comparison_work_tracks_actual_sparse_arrivals() {
    for n in [16, 64, 256] {
        let (mut report, program, clones) = model(n, false);
        report.compare_legacy(&program, Memory::ReferenceCounting, &clones);
        assert!(report.comparison_failure.is_none());
        assert!(
            report.comparison_work <= 16 * n + 64,
            "{n}: {}",
            report.comparison_work
        );
        println!(
            "legacy-comparison-work\tn={n}\twork={}",
            report.comparison_work
        );
    }
}
