//! Migration facts must be deterministic, conservative and observational.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{
    self, Memory,
    memory::{Analysis, Home, Limits, Reason},
};
use nts_frontend_ts::Frontend;

fn snapshot(case: &str) -> nts_semantic_schema::SemanticSnapshot {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../tests/memory/{case}/tsconfig.json"))
        .canonicalize_utf8()
        .expect("the control is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the control captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    snapshot
}

#[test]
fn three_preparations_have_byte_identical_reports_and_hir() {
    for case in ["traversal", "shared-tail"] {
        let snapshot = snapshot(case);
        let options = hir::Options {
            provider: Memory::ReferenceCounting,
            ..hir::Options::default()
        };
        let normal = hir::prepare_unverified(&snapshot, &options);
        assert!(
            normal.memory.is_none(),
            "normal preparation requests no report"
        );
        let prepare = || {
            hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
                .into_unverified_with_memory(&hir::PreparationOptions::from(&options))
        };
        let baseline = prepare();
        assert_eq!(
            format!("{:?}", normal.program),
            format!("{:?}", baseline.program)
        );
        let memory = baseline
            .memory
            .as_ref()
            .expect("diagnostics were requested");
        assert!(!memory.sites.is_empty(), "{case} must exercise allocation");
        assert!(memory.failure.is_none(), "{case}: {:?}", memory.failure);
        assert!(
            memory.sites.iter().all(|site| !site.legacy.is_empty()),
            "every source allocation must map to its emitted original or region clone"
        );
        for _ in 0..2 {
            let repeated = prepare();
            assert_eq!(
                memory.render(),
                repeated.memory.as_ref().expect("requested report").render(),
                "{case}"
            );
            assert_eq!(
                format!("{:?}", baseline.program),
                format!("{:?}", repeated.program),
                "{case}"
            );
        }
        let before = format!("{:?}", baseline.program);
        let observed = Analysis::of(&baseline.program);
        assert!(std::ptr::eq(
            observed.program(),
            &raw const baseline.program
        ));
        drop(observed);
        assert_eq!(
            before,
            format!("{:?}", baseline.program),
            "analysis changes no operation"
        );
    }
}

#[test]
fn exhausted_budget_has_no_partial_alias_payload_effect_or_home_permission() {
    let prepared = hir::prepare_unverified(
        &snapshot("shared-tail"),
        &hir::Options {
            provider: Memory::NoGc,
            ..hir::Options::default()
        },
    );
    let report = Analysis::with_limits(
        &prepared.program,
        Limits {
            work_per_operation: 0,
            ..Limits::default()
        },
    )
    .into_report();
    assert!(
        !report.sites.is_empty(),
        "exhaustion must still inventory candidates"
    );
    assert_eq!(report.failure, Some(Reason::WorkBudget));
    assert!(
        report
            .sites
            .iter()
            .all(|site| site.home == Home::Heap(Reason::WorkBudget))
    );
    assert!(
        report
            .values
            .iter()
            .all(|value| value.aliases == ["unknown:budget"])
    );
    assert!(
        report
            .functions
            .iter()
            .all(|function| function.unknown_effects
                && function.may_change_length
                && function.may_suspend
                && function.may_reenter)
    );
}

#[test]
fn host_gc_never_publishes_native_placement_facts() {
    let snapshot = snapshot("no-escape");
    let options = hir::Options {
        provider: Memory::HostGc,
        ..hir::Options::default()
    };
    let prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    assert!(prepared.memory.is_none());
}
