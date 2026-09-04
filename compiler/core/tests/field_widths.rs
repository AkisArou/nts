//! A field that depends on its own value.
//!
//! `hir::fields` narrows a field every store puts a small whole number into,
//! and could not narrow one whose stores read the field: the interprocedural
//! fixpoint started with no facts, an absent entry reads as TOP at the use, and
//! `this.x += this.step` therefore settled at TOP in round one.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType};
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

/// The declared width of one field, by class and member name.
fn width(prepared: &hir::Prepared, class: &str, field: &str) -> HirType {
    prepared
        .program
        .layouts
        .iter()
        .find(|layout| layout.name == class)
        .unwrap_or_else(|| panic!("`{class}` is a class in examples/field-widths"))
        .fields
        .iter()
        .find(|slot| slot.name == field)
        .unwrap_or_else(|| panic!("`{class}.{field}` is a field"))
        .ty
        .clone()
}

/// A field whose own value is one of its stores narrows.
///
/// `this.total = this.total + this.step` is the shape, and it was the shape the
/// fixpoint could not answer: `total` read TOP because nothing had published a
/// fact for it yet, so the sum was TOP, so `total` published TOP.
#[test]
fn a_self_referential_field_narrows() {
    let Some(prepared) = prepared("field-widths") else {
        return;
    };
    let total = width(&prepared, "Counter", "total");
    assert!(
        matches!(total, HirType::Int { .. }),
        "`Counter.total` reads itself and still narrows: {total:?}",
    );
    // And the field it reads *from* narrows too, which is the easy half and is
    // here so a regression in one is not hidden by the other.
    assert!(
        matches!(width(&prepared, "Counter", "step"), HirType::Int { .. }),
        "`Counter.step` narrows",
    );
}

/// A field that can hold what an integer slot cannot keeps its double.
///
/// This is the half a fixpoint seeded too low would break, and break quietly:
/// the answers change rather than the program failing. Each of these reaches
/// its value *through the field itself*, so a seed that concluded "whole" from
/// the allocator's zero and never revisited would narrow every one of them.
#[test]
fn a_field_that_can_hold_a_fraction_keeps_its_double() {
    let Some(prepared) = prepared("field-widths") else {
        return;
    };
    for (class, field, why) in [
        ("Halving", "value", "halves itself, so it is a fraction"),
        ("Poisoned", "value", "can divide by zero and reach NaN"),
        ("Signed", "value", "can be negative zero"),
        ("Doubling", "value", "doubles itself past what an int32 holds"),
        ("Derived", "slot", "is divided through a shared prefix"),
    ] {
        let ty = width(&prepared, class, field);
        assert!(
            matches!(ty, HirType::Float { .. }),
            "`{class}.{field}` {why}, so it keeps its double -- got {ty:?}",
        );
    }
}
