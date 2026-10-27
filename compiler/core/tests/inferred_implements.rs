//! A class with an interface's methods implements it without writing
//! `implements` (`infer_implements`, `docs/records/notebooks/interfaces-by-shape.md` Part 1),
//! where the methods' signatures are ones the interface's slot can carry. The
//! example `a-method-through-a-structural-interface` runs the dispatch; this
//! checks which edges are inferred.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

fn prepared() -> hir::Program {
    prepared_config("tests/programs/inferred-implements/tsconfig.json")
}

fn prepared_config(relative: &str) -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "the candidate relations typecheck");
    hir::prepare(&snapshot).expect("valid HIR").program
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
    let program = prepared();
    assert_eq!(implements(&program, "Square"), 1);
    // A member the interface does not have is no obstacle.
    assert_eq!(implements(&program, "Circle"), 1);
    // And the call through `Shape` is a dispatch with a declaration to name.
    assert!(program.funcs.iter().any(|func| func.name == "Shape#area"));
}

#[test]
fn incompatible_shapes_have_no_edge_and_do_not_block_other_candidates() {
    let program = prepared();
    // Another arity.
    assert_eq!(implements(&program, "Scaled"), 0);
    // A provably disjoint result is not a candidate for this face. It does
    // not prevent a compatible class from publishing its method row.
    assert_eq!(implements(&program, "Label"), 0);
    assert_eq!(implements(&program, "Box"), 1);
}

#[test]
fn a_bivariantly_narrowed_candidate_still_blocks_all_inferred_edges() {
    let root = "tests/programs/inferred-implements-narrowed-parameter";
    let positive = prepared_config(&format!("{root}/positive.tsconfig.json"));
    assert_eq!(implements(&positive, "Box"), 1);

    let negative = prepared_config(&format!("{root}/tsconfig.json"));
    assert_eq!(implements(&negative, "Narrowed"), 0);
    assert_eq!(
        implements(&negative, "Box"),
        0,
        "a candidate requiring an unchecked downcast keeps all-or-none in force"
    );
}
