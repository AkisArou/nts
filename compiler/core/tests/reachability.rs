//! What survives a walk from the exports.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared(fixture: &str) -> Option<hir::Prepared> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("prepared HIR should verify"))
}

#[test]
fn a_function_no_export_reaches_is_dropped() {
    let Some(prepared) = prepared("interprocedural") else {
        return;
    };
    let names: Vec<&str> = prepared
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect();

    // Reachable: `pipeline` and `exposed` are exported, and they call these.
    for kept in ["pipeline", "exposed", "clamp", "twice"] {
        assert!(names.contains(&kept), "{kept} should survive: {names:?}");
    }

    // `neverCalled` is called only by `onlyCalledByTheUnreachable`, which
    // nothing calls at all. Reachability is from the exports, not from "is
    // called by something" — otherwise a cycle of dead functions keeps itself
    // alive.
    for dropped in ["neverCalled", "onlyCalledByTheUnreachable"] {
        assert!(!names.contains(&dropped), "{dropped} should be dropped");
    }
    assert_eq!(prepared.pruned, 2);
}

#[test]
fn pruning_happens_before_the_analysis_pays_for_it() {
    let Some(prepared) = prepared("interprocedural") else {
        return;
    };
    // The point is not only a smaller output. Everything that survives is
    // analyzed interprocedurally, specialized, proven and emitted -- so a
    // function nothing can call must be gone before any of that, not after.
    // A dropped function contributes no bounds checks either way, so the
    // observable claim is simply that it is not in the program the later passes
    // were handed.
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .all(|func| func.name != "neverCalled"),
        "the analysis should never have seen it",
    );
}

#[test]
fn an_executable_keeps_less_than_a_library() {
    let Some(prepared) = prepared("interprocedural") else {
        return;
    };
    // The default is the library answer: every export is a root, because a
    // caller this compilation cannot see may call any of them.
    let library: Vec<&str> = prepared
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect();
    assert!(library.contains(&"exposed"));

    // An executable has no outside. `export` means only "visible to another
    // module of this program", so an exported function nothing calls is as dead
    // as a private one -- and keeping it is the difference between shipping a
    // program and shipping every module it happens to contain.
    let mut program = prepared.program.clone();
    let entry = vec!["pipeline".to_owned()];
    let dropped = hir::reachable::prune(&mut program, hir::reachable::Roots::Entry(&entry));
    let names: Vec<&str> = program.funcs.iter().map(|f| f.name.as_str()).collect();

    assert!(names.contains(&"pipeline"));
    // Still reachable: `pipeline` calls them.
    assert!(names.contains(&"clamp") && names.contains(&"twice"));
    // Exported, but nothing in the program calls it.
    assert!(
        !names.contains(&"exposed"),
        "an executable keeps only what its entry point reaches: {names:?}",
    );
    assert_eq!(dropped, 1);
}

#[test]
fn a_declared_surface_is_checked_against_the_source() {
    let Some(prepared) = prepared("interprocedural") else {
        return;
    };
    // This is what `exports: [...]` in nts.config.ts is for: naming fewer than
    // the source exports shrinks the ABI *and* the binary. Naming something the
    // source does not export is a mistake in the manifest, and the worst way to
    // find out is a library that silently exports nothing.
    let declared = vec!["pipeline".to_owned(), "notAThing".to_owned()];
    assert_eq!(
        hir::reachable::undeclared(&prepared.program, &declared),
        vec!["notAThing"],
    );

    let good = vec!["pipeline".to_owned()];
    assert!(hir::reachable::undeclared(&prepared.program, &good).is_empty());
}
