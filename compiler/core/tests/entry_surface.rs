//! What a single-entry artifact publishes.
//!
//! `Roots::EntrySurface` is `EveryExport` minus the `exported` flag, which is
//! the difference between "a TypeScript package a consumer can import any file
//! of" and "a `.so`, a `.node`, a jar or an `XCFramework`, where there is one
//! entry and its surface is the ABI".
//!
//! Nothing exercised this variant when it landed. What that cost: the methods
//! of an exported class are functions named `Counter#bump`, which match no
//! entry in `public_api`, and the `exported` flag had been the only thing
//! keeping them. A consumer got a class it could construct and could not call,
//! and `javap` on `examples/interop/ts-from-java`'s checked-in capture is what
//! caught it -- `- public double bump();` against a file that exists for
//! exactly that.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, reachable::Roots};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/entry-surface")
        .join("tsconfig.json")
        .canonicalize_utf8()
        .expect("tests/programs/entry-surface is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    Some(hir::lower::lower(&snapshot).program)
}

#[test]
fn a_published_class_keeps_its_members_and_a_hidden_one_does_not() {
    let Some(mut program) = lowered() else {
        eprintln!("SKIP entry surface: tsgo is required");
        return;
    };
    hir::reachable::prune(&mut program, Roots::EntrySurface);
    let names: Vec<&str> = program.funcs.iter().map(|f| f.name.as_str()).collect();

    // The entry publishes `Counter`, so a consumer can call either member.
    for kept in ["Counter#bump", "Counter#reset", "published"] {
        assert!(names.contains(&kept), "{kept} should survive: {names:?}");
    }

    // **The half that says the narrowing still narrows.** Without these the
    // test passes for a root set that keeps everything, which is the behaviour
    // `EntrySurface` exists to replace.
    for dropped in ["Hidden#secret", "unreachable"] {
        assert!(!names.contains(&dropped), "{dropped} should be pruned: {names:?}");
    }
}
