//! Which files a project compiles, and what that buys across module boundaries.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};
use nts_semantic_schema::SemanticSnapshot;

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/imports/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/imports fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .with_call_resolution(Budget::DEFAULT)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

fn callee_uri(snapshot: &SemanticSnapshot, name: &str) -> Option<String> {
    snapshot
        .call_targets
        .iter()
        .find(|(site, _)| {
            snapshot.nodes[site.0 as usize]
                .children
                .first()
                .and_then(|c| snapshot.nodes[c.0 as usize].text.as_deref())
                == Some(name)
        })
        .and_then(|(_, target)| target.callee)
        .map(|callee| {
            let file = snapshot.nodes[callee.0 as usize].origin.location.file;
            snapshot.sources[file.0 as usize].uri.clone()
        })
}

#[test]
fn a_file_imported_from_outside_the_include_set_is_compiled() {
    let Some(snapshot) = snapshot() else { return };
    // `root_files` is only what tsconfig `include` names. `vendor/helper.ts` is
    // reached by an import from a sibling directory, so compiling only the roots
    // left every symbol it declares with no node and no identity.
    let uris: Vec<&str> = snapshot.sources.iter().map(|s| s.uri.as_str()).collect();
    assert!(
        uris.iter().any(|u| u.ends_with("vendor/helper.ts")),
        "the imported file was not compiled: {uris:?}",
    );
    assert_eq!(snapshot.sources.len(), 3);
}

#[test]
fn a_call_across_a_module_boundary_names_its_callee() {
    let Some(snapshot) = snapshot() else { return };
    assert_eq!(
        callee_uri(&snapshot, "distance").as_deref(),
        Some("nts-workspace:///src/geometry.ts"),
    );
    assert_eq!(
        callee_uri(&snapshot, "scale").as_deref(),
        Some("nts-workspace:///vendor/helper.ts"),
    );
}

#[test]
fn the_default_library_is_not_compiled() {
    let Some(snapshot) = snapshot() else { return };
    // The program contains 63 `bundled:///libs/*.d.ts` files. Compiling them would
    // cost more round trips than the project and produce declarations this
    // compiler does not lower anyway — the same boundary decomposition stops at.
    assert!(
        !snapshot
            .sources
            .iter()
            .any(|s| s.display_path.as_str().starts_with("bundled:///")),
        "a bundled library file was compiled",
    );
}

#[test]
fn a_call_into_the_library_reports_no_callee() {
    let Some(snapshot) = snapshot() else { return };
    // `Math.sqrt` is declared in lib.es5.d.ts, which is deliberately not compiled.
    // The signature is still known, so the call is typed exactly; only the direct
    // symbol reference is unavailable, and saying so beats pointing somewhere.
    let unresolved = snapshot
        .call_targets
        .values()
        .filter(|target| target.callee.is_none())
        .count();
    assert!(unresolved >= 1, "the Math.sqrt call should have no callee");
}

#[test]
fn compiled_file_paths_are_still_remapped() {
    let Some(snapshot) = snapshot() else { return };
    for source in &snapshot.sources {
        assert!(
            source.uri.starts_with("nts-workspace:///"),
            "{}",
            source.uri
        );
        assert!(!source.uri.contains("/home/"), "{}", source.uri);
    }
}
