//! A written field or global is held at its kind's width (`hir::written_storage`,
//! `docs/scalar-numbers.md` step 2f). The examples check the answers against
//! node, which holds every one as a double and so cannot see a width; this
//! checks the width itself.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared() -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/written-storage/tsconfig.json")
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("valid HIR").program)
}

fn field<'p>(program: &'p hir::Program, layout: &str, name: &str) -> &'p HirType {
    let layout = program
        .layouts
        .iter()
        .find(|candidate| candidate.name == layout)
        .unwrap_or_else(|| panic!("`{layout}` is laid out"));
    &layout
        .fields
        .iter()
        .find(|field| field.name == name)
        .unwrap_or_else(|| panic!("`{}` has `{name}`", layout.name))
        .ty
}

#[test]
fn a_written_slot_is_held_at_its_kinds_width() {
    let Some(program) = prepared() else {
        eprintln!("SKIP written_storage: tsgo is not built");
        return;
    };
    let int = |bits, signed| HirType::Int { bits, signed };
    assert_eq!(field(&program, "Pixel", "r"), &int(8, false));
    assert_eq!(field(&program, "Pixel", "big"), &int(32, false));
    assert_eq!(field(&program, "Pixel", "low"), &int(16, true));
    // A float kind keeps its float, though every value it holds is whole and
    // the facts alone would make it an integer.
    assert_eq!(
        field(&program, "Pixel", "whole"),
        &HirType::Float { bits: 32 }
    );
    let global = program
        .globals
        .iter()
        .find(|global| global.name.ends_with("written"))
        .expect("the global is kept");
    assert_eq!(global.ty, int(8, false));
}

#[test]
fn a_field_whose_storage_is_shared_has_one_width() {
    let Some(program) = prepared() else {
        eprintln!("SKIP written_storage: tsgo is not built");
        return;
    };
    // `Written` writes `level: Uint8` and `Plain` writes `level: number`, and a
    // store through `Channel` reaches either at one place. So the written byte
    // is dropped, and the field is whatever the facts make of the group -- the
    // same in both, or a byte store would land in a wider field. `Written`
    // shares `Channel`'s layout.
    let written = field(&program, "Channel", "level");
    assert_eq!(written, field(&program, "Plain", "level"));
    assert_ne!(
        written,
        &HirType::Int {
            bits: 8,
            signed: false
        }
    );
}
