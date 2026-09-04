//! The four provided error classes, and the base they now name.
//!
//! `TypeError extends Error` is a fact this compiler knows and used to discard.
//! The hierarchy has never heard of these four — they are not declarations in
//! the program — so the relation is spelled where the layout is built, the same
//! way `lower_instanceof` spells it through `provided_errors_under`.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Layout};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn error_layouts(lowered: &hir::lower::Lowered) -> Vec<&Layout> {
    lowered
        .program
        .layouts
        .iter()
        .filter(|layout| {
            matches!(
                layout.name.as_str(),
                "Error" | "TypeError" | "RangeError" | "SyntaxError"
            )
        })
        .collect()
}

/// A derived error names `Error` as its base, and `Error` names nothing.
#[test]
fn a_provided_error_extends_error() {
    let Some(lowered) = lowered("errors") else {
        return;
    };
    let layouts = error_layouts(&lowered);
    assert!(layouts.len() >= 2, "at least two of the four are used here");

    let root = layouts
        .iter()
        .find(|layout| layout.name == "Error")
        .expect("`Error` itself is one of them");
    assert_eq!(root.base, None, "`Error` extends nothing");

    let derived: Vec<&&Layout> = layouts
        .iter()
        .filter(|layout| layout.name != "Error")
        .collect();
    assert!(!derived.is_empty(), "and at least one derives from it");
    for layout in derived {
        let base = layout
            .base
            .unwrap_or_else(|| panic!("`{}` extends `Error`", layout.name));
        assert!(
            root.types.contains(&base),
            "`{}`'s base is `Error`'s type, not something else",
            layout.name,
        );
    }
}

/// The four are still four layouts.
///
/// This is the assertion the base could break and the reason the test exists.
/// Record 0074: all four hold a `message` and a `name` and nothing else, so
/// shape merged them into one layout with one descriptor and `e instanceof
/// TypeError` was true of a `RangeError`. A base is a *fourth* identical thing,
/// so what keeps them apart has to be nominal — and `collect_layouts` says so.
#[test]
fn the_four_do_not_merge() {
    let Some(lowered) = lowered("errors") else {
        return;
    };
    let mut names: Vec<&str> = error_layouts(&lowered)
        .iter()
        .map(|layout| layout.name.as_str())
        .collect();
    names.sort_unstable();
    let before = names.len();
    names.dedup();
    assert_eq!(before, names.len(), "one layout each: {names:?}");

    // And no two of them share a type id, which is what a merge looks like from
    // the other side.
    //
    // Not "each has one type id" — that was the first version and it failed on
    // `TypeError`, which legitimately carries two: `collect_layouts` unifies
    // layouts that name the same type however they were built, and one class
    // reached twice is one layout with two ids. A merge of two *classes* is a
    // different thing, and this is it.
    let layouts = error_layouts(&lowered);
    for (at, layout) in layouts.iter().enumerate() {
        for other in &layouts[at + 1..] {
            for ty in &layout.types {
                assert!(
                    !other.types.contains(ty),
                    "`{}` and `{}` share type {ty:?}",
                    layout.name,
                    other.name,
                );
            }
        }
    }
}
