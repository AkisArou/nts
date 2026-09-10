//! Two classes declaring one private name are two slots, and one inheriting it
//! is one.
//!
//! `#count` is per class: `class Base { #count }` and `class Derived extends
//! Base { #count }` declare two fields, and both are in the derived layout. A
//! dedup matching on name collapsed them until 2026-09-10, so both classes read
//! and wrote the base's storage — node answered 2102 where this answered 102502.
//!
//! Keeping both unconditionally is the opposite defect and a quieter one. The
//! checker hands back a *flattened* member list, so a derived class that merely
//! inherits `#count` has it in that list too, and pushing every `#` field gave
//! that class a second slot nothing ever read. **The program's answers agreed
//! with node either way** — a phantom slot is wrong without being observable —
//! which is why this reads the layout rather than running the program.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::SemanticSource;

fn prepared() -> Option<hir::Prepared> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/two-private-names-that-collide")
        .join("tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/two-private-names-that-collide is checked in");
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("prepared HIR should verify"))
}

fn layout<'a>(prepared: &'a hir::Prepared, class: &str) -> &'a hir::Layout {
    prepared
        .program
        .layouts
        .iter()
        .find(|layout| layout.name == class)
        .unwrap_or_else(|| panic!("`{class}` is a class in the fixture"))
}

fn counts(layout: &hir::Layout) -> Vec<&hir::Field> {
    layout
        .fields
        .iter()
        .filter(|field| field.name == "#count")
        .collect()
}

#[test]
fn a_shadowed_private_name_is_two_slots() {
    let Some(prepared) = prepared() else {
        return;
    };
    let derived = counts(layout(&prepared, "Derived"));
    assert_eq!(
        derived.len(),
        2,
        "`Derived` declares `#count` and inherits one, which is two fields"
    );
    assert_ne!(
        derived[0].declared_by, derived[1].declared_by,
        "the two are told apart by the class that declared each"
    );
    assert_eq!(
        counts(layout(&prepared, "Deeper")).len(),
        3,
        "and a third layer is three"
    );
}

#[test]
fn the_bases_slot_leads() {
    let Some(prepared) = prepared() else {
        return;
    };
    let base = layout(&prepared, "Base").fields[0].declared_by;
    for class in ["Derived", "Deeper", "Separate", "Inheritor"] {
        assert_eq!(
            layout(&prepared, class).fields[0].declared_by,
            base,
            "`{class}` must open with the base's slot, or an upcast is not a cast"
        );
    }
}

#[test]
fn an_inherited_private_name_is_one_slot() {
    let Some(prepared) = prepared() else {
        return;
    };
    // The control. `Inheritor` does not write `#count`, so the flattened
    // property list is the only place a second one could come from.
    assert_eq!(
        counts(layout(&prepared, "Inheritor")).len(),
        1,
        "`Inheritor` inherits `#count` and declares none, which is one field"
    );
    assert_eq!(
        counts(layout(&prepared, "Separate")).len(),
        1,
        "and so does a class declaring a *different* private name"
    );
}
