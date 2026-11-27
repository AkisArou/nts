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
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &[], &[]);
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
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &[], &[]);
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
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &[], &[]);
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
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &[], &[]);
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
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &[], &[]);
    assert_eq!(report.sites[0].legacy, ["frame"]);
}

#[test]
fn comparison_work_tracks_actual_sparse_arrivals() {
    for n in [16, 64, 256] {
        let (mut report, program, clones) = model(n, false);
        report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &[], &[]);
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

#[test]
fn a_consuming_entry_resolves_the_moved_body_without_region_ownership() {
    let (mut report, mut program, clones) = model(4, false);
    let mut body = program.funcs[1].clone();
    body.name = "@consuming:factory".to_owned();
    body.values[0].kind = OpKind::ObjectNew { frame: true };
    program.funcs[1] = function(
        "factory".to_owned(),
        vec![OpKind::Call {
            callee: Callee::Direct(body.name.clone()),
            args: Vec::new(),
            frame: None,
        }],
    );
    let entries = vec![crate::hir::own::EntryDecision {
        function: body.name.clone(),
        kind: crate::hir::own::EntryDecisionKind::Implementation,
        reason: "consuming implementation for direct callers",
    }];
    program.funcs.push(body);
    verify::verify(&program).expect("the borrowed adapter and its moved body verify");
    report.compare_legacy(&program, Memory::ReferenceCounting, &clones, &entries, &[]);
    let merged = report
        .sites
        .iter()
        .find(|site| site.obligations.contains(&Reason::ContextBudget))
        .unwrap();
    assert_eq!(merged.legacy, ["call-region", "frame"]);
    assert!(
        merged
            .legacy_variants
            .iter()
            .any(|variant| variant.function == "factory" && variant.home == "frame")
    );
    assert!(merged.legacy_unknown.is_none());
    assert!(
        report
            .legacy_clones
            .iter()
            .all(|(variant, _)| variant != "@consuming:factory")
    );
    assert!(report.comparison_failure.is_none());
}

#[test]
fn slot_entry_lineage_keeps_heap_and_frame_without_region_authority() {
    use crate::hir::contents::slots::versioning::Lineage;
    for frame in [false, true] {
        let (mut report, mut program, _) = model(4, false);
        program.funcs[2].values[0].kind = OpKind::ObjectNew { frame };
        let slots = [Lineage {
            function: program.funcs[2].name.clone(),
            source: "factory".into(),
            operations: rustc_hash::FxHashMap::default(),
        }];
        report.compare_legacy(
            &program,
            Memory::ReferenceCounting,
            &rustc_hash::FxHashMap::default(),
            &[],
            &slots,
        );
        assert!(
            report
                .sites
                .iter()
                .all(|site| site.legacy_unknown.is_none())
        );
        assert!(
            report
                .sites
                .iter()
                .flat_map(|site| &site.legacy_variants)
                .all(|variant| variant.home != "call-region")
        );
        assert_eq!(report.legacy_clones, []);
        let merged = report
            .sites
            .iter()
            .find(|site| site.obligations.contains(&Reason::ContextBudget))
            .unwrap();
        assert_eq!(
            merged.legacy,
            if frame {
                vec!["frame", "heap"]
            } else {
                vec!["heap"]
            }
        );
    }
}

#[test]
fn copied_calls_and_allocations_keep_their_source_operation_identity() {
    use crate::hir::contents::slots::versioning::Lineage;
    for keep_original in [false, true] {
        let (mut report, mut program, _) = model(1, false);
        let inventory = format!("{:?}", report.comparison_inputs);
        let solver_work = report.work;
        let call = program.funcs[0].values[0].clone();
        program.funcs[0].values.push(call);
        if let OpKind::Call { callee, .. } = &mut program.funcs[0].values[0].kind {
            *callee = Callee::Direct("factory".into());
        }
        program.funcs[0].blocks[0].ops = if keep_original {
            vec![ValueId(0), ValueId(1)]
        } else {
            vec![ValueId(1)]
        };
        let mut allocation = program.funcs[2].values[0].clone();
        allocation.kind = OpKind::ObjectNew { frame: true };
        program.funcs[2].values.push(allocation);
        program.funcs[2].blocks[0].ops = vec![ValueId(1)];
        let slots = [
            Lineage {
                function: "module#init".into(),
                source: "module#init".into(),
                operations: [(ValueId(1), ValueId(0))].into_iter().collect(),
            },
            Lineage {
                function: program.funcs[2].name.clone(),
                source: "factory".into(),
                operations: [(ValueId(1), ValueId(0))].into_iter().collect(),
            },
        ];
        verify::verify(&program).expect("the physical copies verify");
        report.compare_legacy(
            &program,
            Memory::ReferenceCounting,
            &rustc_hash::FxHashMap::default(),
            &[],
            &slots,
        );
        assert_eq!(format!("{:?}", report.comparison_inputs), inventory);
        assert_eq!(report.work, solver_work);
        assert!(report.sites[0].legacy_unknown.is_none());
        assert_eq!(
            report.sites[0].legacy,
            if keep_original {
                vec!["frame", "heap"]
            } else {
                vec!["frame"]
            }
        );
        assert_eq!(report.legacy_clones, []);
        // The live copied allocation has a different ValueId. Dropping its
        // writer-supplied map must not silently read the dead original op.
        let mut missing = slots.clone();
        missing[1].operations.clear();
        report.compare_legacy(
            &program,
            Memory::ReferenceCounting,
            &rustc_hash::FxHashMap::default(),
            &[],
            &missing,
        );
        assert!(
            report.sites[0]
                .legacy_unknown
                .as_deref()
                .is_some_and(|reason| reason.contains("allocation is no longer placed"))
        );
    }
}

#[test]
fn a_slot_entry_keeps_consuming_source_identity_after_the_original_body_is_pruned() {
    use crate::hir::contents::slots::versioning::Lineage;
    let (mut report, program, _) = model(1, false);
    let entries = [crate::hir::own::EntryDecision {
        function: "@consuming:factory".into(),
        kind: crate::hir::own::EntryDecisionKind::Implementation,
        reason: "consuming implementation for direct callers",
    }];
    let slots = [Lineage {
        function: program.funcs[2].name.clone(),
        source: "@consuming:factory".into(),
        operations: rustc_hash::FxHashMap::default(),
    }];
    report.compare_legacy(
        &program,
        Memory::ReferenceCounting,
        &rustc_hash::FxHashMap::default(),
        &entries,
        &slots,
    );
    assert_eq!(report.sites[0].legacy, ["heap"]);
    assert!(report.sites[0].legacy_unknown.is_none());
    assert_eq!(report.legacy_clones, []);
}
