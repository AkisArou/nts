//! A class with an interface's methods implements it without writing
//! `implements` (`infer_implements`, `docs/interfaces-by-shape.md` Part 1),
//! where the methods' signatures are ones the interface's slot can carry. The
//! example `a-method-through-a-structural-interface` runs the dispatch; this
//! checks which edges are inferred.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared() -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/inferred-implements/tsconfig.json")
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("valid HIR").program)
}

/// How many interfaces the class laid out as `name` implements.
fn implements(program: &hir::Program, name: &str) -> usize {
    program
        .layouts
        .iter()
        .find(|layout| layout.name == name)
        .unwrap_or_else(|| panic!("`{name}` is laid out"))
        .interfaces
        .len()
}

#[test]
fn a_class_with_the_methods_implements_the_interface() {
    let Some(program) = prepared() else {
        eprintln!("SKIP inferred_implements: tsgo is not built");
        return;
    };
    assert_eq!(implements(&program, "Square"), 1);
    // A member the interface does not have is no obstacle.
    assert_eq!(implements(&program, "Circle"), 1);
    // And the call through `Shape` is a dispatch with a declaration to name.
    assert!(program.funcs.iter().any(|func| func.name == "Shape#area"));
}

#[test]
fn a_method_of_another_signature_does_not_fit() {
    let Some(program) = prepared() else {
        eprintln!("SKIP inferred_implements: tsgo is not built");
        return;
    };
    // Another arity.
    assert_eq!(implements(&program, "Scaled"), 0);
    // Another result, and so the interface infers nothing: `Box` fits
    // `Sized` on its own, and a class with `Sized`'s members that does not fit
    // would have no entry in the slots an inferred edge gives it.
    assert_eq!(implements(&program, "Label"), 0);
    assert_eq!(implements(&program, "Box"), 0);
}
