//! Which layouts a value of a face holds as a prefix.
//!
//! `interface_access::Plan::prefix_receivers` is what a backend with nominal
//! struct types (Wasm GC) declares beneath a face so that a positional read
//! through it, and a family default, is valid for every receiver with no row.
//! Each arm here differs from a listed one in one thing: `Shifted` reaches the
//! face with its fields behind a base's, and `Unrelated` begins with them but
//! never reaches it. Behind a base and not merely declared in another order,
//! because layout may reorder a class's own fields to match a face it meets.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::SemanticSource;
use nts_semantic_schema::TypeId;

#[test]
fn a_face_lists_the_owners_that_reach_it_as_a_prefix() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/prefix-receivers/tsconfig.json")
        .canonicalize_utf8()
        .expect("the fixture is checked in");
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = hir::Options {
        provider: hir::Provider::NoGc,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    let program = match hir::prepare_with(&snapshot, &options) {
        Ok(prepared) => prepared.program,
        Err(unprepared) => panic!("the fixture should prepare: {unprepared:?}"),
    };
    let layout = |name: &str| {
        program
            .layouts
            .iter()
            .find(|layout| layout.name == name)
            .unwrap_or_else(|| panic!("no layout named {name}"))
    };
    let names_of = |face: TypeId| {
        let mut names: Vec<&str> = program
            .interface_access
            .prefix_receivers(face)
            .unwrap_or_else(|| panic!("{face:?} has a layout and is answered"))
            .iter()
            .map(|owner| {
                program
                    .layouts
                    .iter()
                    .find(|layout| layout.types.contains(owner))
                    .map_or("?", |layout| layout.name.as_str())
            })
            .collect();
        names.sort_unstable();
        names
    };
    assert_eq!(names_of(layout("Face").types[0]), ["Derived", "Prefix"]);
    // A receiver that reaches its face only as `this`, directly and through an
    // inherited method, beside one pushed from outside.
    let registered = names_of(layout("Registered").types[0]);
    for owner in ["SelfRegistering", "SubRegistering", "Outside"] {
        assert!(
            registered.contains(&owner),
            "{owner} reaches `Registered`: {registered:?}"
        );
    }
    // And the other half: `Shifted` reaches `Face` and is not a prefix.
    let other: Vec<&str> = program
        .interface_access
        .other_receivers(layout("Face").types[0])
        .expect("`Face` has a layout")
        .iter()
        .map(|owner| {
            program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(owner))
                .map_or("?", |layout| layout.name.as_str())
        })
        .collect();
    assert_eq!(other, ["Shifted"]);
    // An instantiation answers for itself: a `Box<number>` value is typed by
    // it, not by the declaration.
    let instantiation = program
        .layouts
        .iter()
        .find(|layout| layout.name.starts_with("Box<"))
        .expect("`Box<number>` has a layout");
    assert_eq!(names_of(instantiation.types[0]), ["NumberBox"]);
    // An interface with storage that no family reads through is answered,
    // and empty: only its own literals reach it.
    assert_eq!(
        program
            .interface_access
            .prefix_receivers(layout("Settings").types[0]),
        Some(&[][..])
    );
    // A class is answered like any type with a layout, and nothing else
    // reaches `Unrelated`.
    assert_eq!(names_of(layout("Unrelated").types[0]), Vec::<&str>::new());
    // A type with no layout is not: the plan says nothing about it.
    let unlaid = (0..u32::MAX)
        .map(TypeId)
        .find(|ty| {
            !program
                .layouts
                .iter()
                .any(|layout| layout.types.contains(ty))
        })
        .expect("some type has no layout");
    assert!(program.interface_access.prefix_receivers(unlaid).is_none());
}
