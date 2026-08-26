//! The correctness gate: a program that does not typecheck is not compilable.
//!
//! Skips without `NTS_TSGO`; see `tsgo_transport.rs` for how to build the pinned
//! binary.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_diagnostics::Severity;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::SemanticSnapshot;

fn snapshot_of(fixture: &str) -> Option<SemanticSnapshot> {
    let tsgo = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    Some(
        TsgoApi::new(tsgo)
            .snapshot(&tsconfig)
            .expect("a snapshot is produced even for a broken program"),
    )
}

#[test]
fn a_program_with_type_errors_is_reported_as_having_errors() {
    let Some(snapshot) = snapshot_of("invalid") else {
        return;
    };
    assert!(
        snapshot.has_errors(),
        "the invalid fixture must not be reported as compilable",
    );
    let errors: Vec<_> = snapshot
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert_eq!(errors.len(), 2, "the fixture has exactly two type errors");
}

#[test]
fn diagnostics_keep_typescripts_own_codes() {
    let Some(snapshot) = snapshot_of("invalid") else {
        return;
    };
    // `TS2322` stays greppable against TypeScript's own documentation. Renumbering
    // into a private scheme would make every error harder to look up.
    assert!(
        snapshot
            .diagnostics
            .iter()
            .all(|d| d.code.starts_with("TS")),
        "diagnostics should carry TypeScript codes",
    );
    assert!(
        snapshot.diagnostics.iter().any(|d| d.code == "TS2322"),
        "assignability errors are TS2322",
    );
}

#[test]
fn a_diagnostic_points_at_a_real_source_and_span() {
    let Some(snapshot) = snapshot_of("invalid") else {
        return;
    };
    for diagnostic in &snapshot.diagnostics {
        let source = snapshot
            .sources
            .get(diagnostic.primary.file.0 as usize)
            .expect("diagnostic names a decoded source");
        // A location pointing at the wrong file is worse than none, because it
        // sends a reader somewhere real.
        assert!(source.uri.ends_with("main.ts"));
        assert!(diagnostic.primary.span.start < diagnostic.primary.span.end);
    }
}

#[test]
fn a_clean_program_reports_no_errors() {
    let Some(snapshot) = snapshot_of("types") else {
        return;
    };
    assert!(
        !snapshot.has_errors(),
        "clean fixture reported errors: {:?}",
        snapshot.diagnostics,
    );
}

#[test]
fn the_gate_costs_a_constant_not_a_per_file_charge() {
    let Some(tsgo) = std::env::var("NTS_TSGO")
        .ok()
        .map(Utf8PathBuf::from)
        .filter(|path| path.exists())
    else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/types/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let mut source = TsgoApi::new(tsgo);
    source.snapshot(&tsconfig).unwrap();
    let stats = source.stats();

    // Two fixed exchanges for the session, four per file, and two more fixed for
    // syntactic and semantic diagnostics over the whole program. Asking per file
    // would have made the gate scale with the thing it is guarding.
    assert_eq!(stats.round_trips, 2 + 4 * u64::from(stats.files) + 2);
}
