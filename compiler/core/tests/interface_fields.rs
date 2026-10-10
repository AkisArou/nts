//! An access through an interface to a field some class implementing it holds
//! elsewhere tests the object's class first (`hir::interface_fields`,
//! `docs/interfaces-by-shape.md` Part 0). The outcomes fixtures run the stop;
//! this checks which accesses are tested, and against which classes.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared() -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-fields/tsconfig.json")
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("valid HIR").program)
}

/// The classes each class test in `func` names, by layout name and sorted.
fn tested(program: &hir::Program, func: &str) -> Vec<Vec<String>> {
    let func = program
        .funcs
        .iter()
        .find(|candidate| candidate.name == func)
        .unwrap_or_else(|| panic!("`{func}` is kept"));
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::InstanceOf { classes, .. } => Some(classes),
            _ => None,
        })
        .map(|classes| {
            let mut names: Vec<String> = classes
                .iter()
                .filter_map(|class| {
                    program
                        .layouts
                        .iter()
                        .find(|layout| layout.types.contains(class))
                })
                .map(|layout| layout.name.clone())
                .collect();
            names.sort();
            names.dedup();
            names
        })
        .collect()
}

#[test]
fn an_access_is_tested_against_the_classes_holding_its_field_elsewhere() {
    let Some(program) = prepared() else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    // `Lime` by its base, and not `Red` or `Teal`, which hold `level` where
    // `Channel` does.
    assert_eq!(tested(&program, "levelOf"), [["Green", "Lime"]]);
    assert_eq!(tested(&program, "setLevel"), [["Green", "Lime"]]);
    // `Teal` holds `name` after a field `Channel` does not have.
    assert_eq!(tested(&program, "nameOf"), [["Green", "Lime", "Teal"]]);
}

#[test]
fn an_access_through_the_class_is_not_tested() {
    let Some(program) = prepared() else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    assert!(tested(&program, "levelOfGreen").is_empty());
}
