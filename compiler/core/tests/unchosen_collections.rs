//! A `new Map()` or `new Set()` that names no type arguments is the library's
//! `Map<any, any>` or `Set<any>`, which says nothing about the contents, so
//! where the value goes chooses the table it builds -- one rule with
//! `new Array(n)`'s, `instead_of_an_unchosen_collection` in lowering. These
//! read each table allocated in
//! `tests/programs/an-unchosen-table-takes-its-type-from-where-it-goes`: the
//! destination's type where there is one, and still erased where there is not.
//!
//! The program compares answers with node, which an erased table gives on C,
//! LLVM and the JVM too, so the types are asserted here.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "an-unchosen-table-takes-its-type-from-where-it-goes";

fn lowered() -> hir::lower::Lowered {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(PROGRAM)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{PROGRAM} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::lower::lower(&snapshot)
}

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is declared in tests/programs/{PROGRAM}"))
}

/// The type of each table `func` allocates, in order.
fn tables(func: &hir::Func) -> Vec<HirType> {
    func.values
        .iter()
        .filter(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::External(helper), .. }
                    if helper == "nts_map_new" || helper == "nts_set_new"
            )
        })
        .map(|op| op.ty.clone())
        .collect()
}

fn map(key: HirType, value: HirType) -> HirType {
    HirType::Managed(ManagedType::Map(Box::new(key), Box::new(value)))
}

fn set(element: HirType) -> HirType {
    HirType::Managed(ManagedType::Set(Box::new(element)))
}

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}

#[test]
fn where_the_table_goes_chooses_what_it_holds() {
    let lowered = lowered();
    let counts = map(string(), HirType::NUMBER);
    for (name, wanted) in [
        ("returned", vec![counts.clone()]),
        ("declared", vec![counts.clone()]),
        ("argument", vec![counts.clone()]),
        ("make", vec![counts.clone()]),
        ("either", vec![counts.clone(), counts.clone()]),
        ("nullish", vec![counts.clone(), counts.clone()]),
        ("Counter#constructor", vec![counts.clone(), set(string())]),
        ("letters", vec![set(string())]),
        // Only the values chosen is still a choice.
        ("valuesChosen", vec![map(HirType::Erased, HirType::NUMBER)]),
    ] {
        assert_eq!(
            tables(func(&lowered, name)),
            wanted,
            "the tables `{name}` builds"
        );
    }
}

/// And the choice an allocation is an arm of is that table too, so no value in
/// these functions -- the merge's parameter, the `undefined` beside the arm --
/// is an erased table handed to a typed one.
#[test]
fn a_choice_over_the_allocation_is_the_same_table() {
    let lowered = lowered();
    let erased = map(HirType::Erased, HirType::Erased);
    for name in ["make", "either", "nullish"] {
        let function = func(&lowered, name);
        assert!(
            function.values.iter().all(|op| op.ty != erased),
            "`{name}` still has an erased table: {:#?}",
            function.values
        );
    }
}

/// With nowhere to go there is nothing to choose: `const m = new Map()` stays
/// the library's `Map<any, any>`, and holds the keys of several types it is
/// given by their tags.
#[test]
fn with_no_destination_the_table_stays_erased() {
    let lowered = lowered();
    assert_eq!(
        tables(func(&lowered, "noDestination")),
        vec![map(HirType::Erased, HirType::Erased)]
    );
}
