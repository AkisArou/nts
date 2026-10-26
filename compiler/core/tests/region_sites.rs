//! Which calls a region could serve (`hir::regions`), on
//! `tests/programs/calls-a-region-could-serve`: each site beside a control
//! that differs from it in one thing, and the fact the control breaks.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;

fn report(name: &str) -> hir::regions::Report {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{name} is checked in"));
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = hir::Options {
        provider: hir::Provider::ReferenceCounting,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    hir::prepare_unverified(&snapshot, &options).regions
}

fn prepared(name: &str) -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{name} is checked in"));
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = hir::Options {
        provider: hir::Provider::ReferenceCounting,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    hir::prepare_unverified(&snapshot, &options).program
}

/// The verdict of the one candidate from `from` to `to`.
fn verdict(report: &hir::regions::Report, from: &str, to: &str) -> Result<(), String> {
    let found: Vec<_> = report
        .calls
        .iter()
        .filter(|call| call.caller == from && call.callee == to)
        .collect();
    assert_eq!(
        found.len(),
        1,
        "one candidate {from} -> {to}, among {:#?}",
        report.calls
    );
    found[0].verdict.clone().map_err(|refusal| refusal.reason)
}

#[test]
fn a_call_whose_result_is_read_and_dropped_is_a_site() {
    let report = report("calls-a-region-could-serve");
    assert_eq!(verdict(&report, "readsAList", "build"), Ok(()));
    // A temporary it only reads, dying at the call.
    assert_eq!(
        verdict(&report, "buildsFromATemporary", "fromValues"),
        Ok(())
    );
    // A function that calls itself is judged by what its body does.
    assert_eq!(verdict(&report, "readsARecursiveList", "buildDown"), Ok(()));
}

#[test]
fn a_result_kept_past_the_call_is_not() {
    let report = report("calls-a-region-could-serve");
    assert_eq!(
        verdict(&report, "keepsAList", "build"),
        Err("stores part of the result".to_owned())
    );
    assert_eq!(
        verdict(&report, "handsAListOn", "build"),
        Err("hands part of the result to a call that keeps it".to_owned())
    );
}

#[test]
fn a_callee_that_writes_outside_what_it_made_is_not() {
    let report = report("calls-a-region-could-serve");
    assert_eq!(
        verdict(&report, "countsWhileBuilding", "buildCounting"),
        Err("writes a global".to_owned())
    );
    // The caller made the array it passes, which is no help: the caller's
    // allocation is on the heap, not in the region.
    assert_eq!(
        verdict(&report, "appendsToAnArgument", "appendTo"),
        Err("stores into an argument".to_owned())
    );
}

#[test]
fn an_argument_may_be_kept_and_a_field_of_one_may_not() {
    let report = report("calls-a-region-could-serve");
    assert_eq!(verdict(&report, "prependsToAnArgument", "prepend"), Ok(()));
    // Stored straight into a field: what ownership calls taking it over.
    assert_eq!(verdict(&report, "wrapsAnArgument", "wrap"), Ok(()));
    assert_eq!(
        verdict(&report, "prependsToAField", "prependField"),
        Err("passes a value read from outside the call to be kept".to_owned())
    );
}

#[test]
fn a_call_that_allocates_once_is_not_worth_a_region() {
    let report = report("calls-a-region-could-serve");
    assert_eq!(
        verdict(&report, "readsOneCell", "single"),
        Err("allocates too little for a region to pay for itself".to_owned())
    );
}

/// A function whose every call a region serves is called only as its clone,
/// and is gone: a function nothing calls is a C `static` its compiler warns
/// about, and `-Werror` refused three JSON rows for it.
#[test]
fn a_function_only_regions_call_is_left_as_its_clone() {
    let program = prepared("calls-a-region-could-serve");
    let names: Vec<&str> = program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect();
    assert!(names.contains(&"fromValues#region"), "{names:?}");
    assert!(!names.contains(&"fromValues"), "{names:?}");
    // Called unserved elsewhere, so both stay.
    assert!(
        names.contains(&"build") && names.contains(&"build#region"),
        "{names:?}"
    );
}

#[test]
fn the_counts_add_up() {
    let report = report("calls-a-region-could-serve");
    let refused: usize = report.refused.values().sum();
    assert_eq!(report.sites + refused, report.candidates);
    assert_eq!(report.calls.len(), report.candidates);
}
