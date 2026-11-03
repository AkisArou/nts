//! Migration facts must be deterministic, conservative and observational.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{
    self, Memory,
    memory::{Analysis, ContextArrival, Home, LegacyVariant, Limits, Reason, Report},
};
use nts_frontend_ts::Frontend;

fn snapshot(case: &str) -> nts_semantic_schema::SemanticSnapshot {
    snapshot_at(&format!("tests/memory/{case}"))
}

fn snapshot_at(case: &str) -> nts_semantic_schema::SemanticSnapshot {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../{case}/tsconfig.json"))
        .canonicalize_utf8()
        .expect("the control is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the control captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    snapshot
}

fn assert_actual_arrival(
    program: &hir::Program,
    report: &Report,
    entry: &str,
    callee: &str,
    home: &str,
) -> (ContextArrival, String) {
    let context = report
        .context_views()
        .find(|context| context.root && context.function == entry)
        .expect("actual entry entry context");
    let arrivals = report
        .context_arrivals()
        .filter(|arrival| {
            arrival.parent == context.id
                && report
                    .context(arrival.child)
                    .is_some_and(|child| child.function == callee)
        })
        .collect::<Vec<_>>();
    assert_eq!(arrivals.len(), 1, "one actual {entry} -> {callee} arrival");
    let arrival = arrivals[0];
    let entry_body = program
        .funcs
        .iter()
        .find(|function| function.name == entry)
        .expect("actual surviving entry body");
    let hir::OpKind::Call {
        callee: hir::Callee::Direct(target),
        ..
    } = &entry_body.value(arrival.operation).kind
    else {
        panic!("the actual stable call operation must name its physical target");
    };
    if home == "call-region" {
        assert!(
            report
                .legacy_clones
                .iter()
                .any(|(variant, original)| variant == target && original == callee)
        );
    } else {
        assert_eq!(target, callee, "the retained entry keeps the original body");
    }
    let sites = report
        .sites
        .iter()
        .filter(|site| site.context_id == arrival.child && site.id.function == callee)
        .collect::<Vec<_>>();
    assert_eq!(sites.len(), 1, "the actual arriving allocation context");
    assert_eq!(sites[0].legacy, [home]);
    assert_eq!(
        sites[0].legacy_variants,
        [LegacyVariant {
            function: target.clone(),
            home: home.to_owned()
        }]
    );
    assert!(sites[0].legacy_unknown.is_none());
    (arrival, target.clone())
}

#[test]
fn legacy_homes_belong_to_the_actual_caller_context() {
    let snapshot = snapshot_at("tests/programs/calls-a-region-could-serve");
    let names = ["readsAList".to_owned(), "keepsAList".to_owned()];
    let options = hir::Options {
        provider: Memory::ReferenceCounting,
        roots: hir::reachable::Roots::Declared(&names),
        ..hir::Options::default()
    };
    let mut prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    prepared
        .check()
        .expect("the actual legacy program verifies");
    let mut report = prepared.memory.take().expect("requested comparison");
    assert!(report.failure.is_none(), "{:?}", report.failure);
    let sites = report
        .sites
        .iter()
        .filter(|site| site.id.function == "build")
        .collect::<Vec<_>>();
    assert_eq!(
        sites.len(),
        2,
        "one allocation in each actual caller context"
    );
    for site in &sites {
        assert_eq!(
            site.legacy.len(),
            1,
            "another caller's clone/home contaminated this context: {site:?}"
        );
    }
    let homes = sites
        .iter()
        .flat_map(|site| site.legacy.iter().map(String::as_str))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(homes, ["call-region", "heap"].into_iter().collect());
    assert_actual_arrival(
        &prepared.program,
        &report,
        "readsAList",
        "build",
        "call-region",
    );
    assert_actual_arrival(&prepared.program, &report, "keepsAList", "build", "heap");
    // Swapping the callers used to satisfy the aggregate above. Prove that the
    // producer-owned arrival/actual-callee assertions reject that bad answer.
    let original = report
        .sites
        .iter()
        .filter(|site| site.id.function == "build")
        .map(|site| (site.legacy.clone(), site.legacy_variants.clone()))
        .collect::<Vec<_>>();
    for (site, (homes, variants)) in report
        .sites
        .iter_mut()
        .filter(|site| site.id.function == "build")
        .zip(original.into_iter().rev())
    {
        site.legacy = homes;
        site.legacy_variants = variants;
    }
    assert!(
        std::panic::catch_unwind(|| assert_actual_arrival(
            &prepared.program,
            &report,
            "readsAList",
            "build",
            "call-region"
        ))
        .is_err()
    );
}

#[test]
fn actual_recursive_region_arrivals_keep_their_physical_body() {
    let snapshot = snapshot_at("tests/programs/calls-a-region-could-serve");
    let names = ["readsARecursiveList".to_owned()];
    let options = hir::Options {
        provider: Memory::ReferenceCounting,
        roots: hir::reachable::Roots::Declared(&names),
        ..hir::Options::default()
    };
    let prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    prepared
        .check()
        .expect("the actual recursive region program verifies");
    let report = prepared.memory.as_ref().expect("requested comparison");
    assert!(report.failure.is_none());
    let (entry, target) = assert_actual_arrival(
        &prepared.program,
        report,
        "readsARecursiveList",
        "buildDown",
        "call-region",
    );
    let recursive = report
        .context_arrivals()
        .filter(|arrival| arrival.parent == entry.child && arrival.child == entry.child)
        .collect::<Vec<_>>();
    assert_eq!(
        recursive.len(),
        1,
        "the actual recursive arrival is retained"
    );
    let body = prepared
        .program
        .funcs
        .iter()
        .find(|function| function.name == target)
        .expect("actual recursive physical body");
    assert!(
        matches!(&body.value(recursive[0].operation).kind, hir::OpKind::Call { callee: hir::Callee::Direct(next), .. } if next == &target)
    );
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
