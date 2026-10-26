//! Placement facts are an inventory until a lifetime proof is implemented.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, regions::placement};
use nts_frontend_ts::Frontend;

fn prepared(provider: hir::Provider) -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/calls-a-region-could-serve/tsconfig.json")
        .canonicalize_utf8()
        .expect("the region fixture is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the fixture typechecks");
    hir::prepare_unverified(
        &snapshot,
        &hir::Options {
            provider,
            roots: hir::reachable::Roots::EveryExport,
            ..hir::Options::default()
        },
    )
}

#[test]
fn live_sites_are_reported_without_licensing_any_allocation() {
    let mut prepared = prepared(hir::Provider::ReferenceCounting);
    let report = &prepared.regions.placement;
    assert_ne!(report.sites, []);
    assert!(
        report
            .sites
            .iter()
            .any(|site| site.storage == placement::Storage::Object)
    );
    assert!(
        report
            .sites
            .iter()
            .any(|site| site.storage == placement::Storage::CallStorage)
    );
    assert!(report.sites.iter().all(
        |site| site.placement == placement::Placement::Unknown(placement::Unknown::NotAnalysed)
    ));
    assert_eq!(report, &placement::inventory(&prepared.program));

    // Dead entries remain in Func.values after a pass. They are not allocation
    // sites that an emitter runs, and must not acquire placement facts.
    let function = report
        .sites
        .iter()
        .find(|site| site.storage == placement::Storage::Object)
        .unwrap()
        .at
        .function;
    let object = report
        .sites
        .iter()
        .find(|site| site.storage == placement::Storage::Object)
        .unwrap()
        .at
        .value;
    let dead = prepared.program.funcs[function].values[object.0 as usize].clone();
    prepared.program.funcs[function].values.push(dead);
    assert_eq!(report, &placement::inventory(&prepared.program));
}

#[test]
fn host_gc_has_no_native_placement_facts() {
    let prepared = prepared(hir::Provider::HostGc);
    assert_eq!(prepared.regions.placement, placement::Report::default());
}
