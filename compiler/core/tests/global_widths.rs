//! What a module-scope number is held as, and what it must not be held as.
//!
//! `hir::globals` narrows a global whose every store is a small whole number,
//! and the narrowing is the cheap half. The half worth testing is the refusals:
//! a `-0` in an integer slot is a wrong answer that only `1 / x` can see, and a
//! fraction rounded into one is a wrong answer nothing announces at all.
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

/// The declared storage of a global, by the name it was written with.
fn storage(prepared: &hir::Prepared, name: &str) -> HirType {
    prepared
        .program
        .globals
        .iter()
        .find(|global| global.name == name)
        .unwrap_or_else(|| panic!("`{name}` is a global in examples/module-numbers"))
        .ty
        .clone()
}

fn is_int(ty: &HirType) -> bool {
    matches!(ty, HirType::Int { .. })
}

/// A global every store puts a small whole number into is held as an integer.
#[test]
fn a_module_scope_number_is_held_as_an_integer() {
    let Some(prepared) = prepared("module-numbers") else {
        return;
    };
    // `step` is written `n | 0` and read inside a loop, which is the case the
    // pass exists for: without facts the read is TOP and every operation after
    // it is floating point however narrow the slot is.
    assert!(
        is_int(&storage(&prepared, "step")),
        "step: {:?}",
        storage(&prepared, "step"),
    );
    // Read before anything stores into it. The declaration's starting value is
    // part of the join, so zero does not make this unknowable.
    assert!(is_int(&storage(&prepared, "first")), "first");
    assert!(is_int(&storage(&prepared, "second")), "second");
}

/// Every read of a narrowed global produces the narrowed type.
///
/// Separately from the declaration, because they are two edits and the failure
/// when only one lands is a `static int32_t` assigned to a `double` local —
/// which compiles, and is what `hir::fields` records having done.
#[test]
fn a_read_of_a_narrowed_global_carries_the_narrowed_type() {
    let Some(prepared) = prepared("module-numbers") else {
        return;
    };
    let narrowed: Vec<u32> = prepared
        .program
        .globals
        .iter()
        .enumerate()
        .filter(|(_, global)| is_int(&global.ty))
        .map(|(at, _)| u32::try_from(at).unwrap_or(u32::MAX))
        .collect();
    assert!(!narrowed.is_empty(), "something narrowed");

    let mut seen = 0;
    for func in &prepared.program.funcs {
        for op in &func.values {
            let hir::OpKind::GlobalGet(global) = op.kind else {
                continue;
            };
            if narrowed.contains(&global) {
                assert!(
                    is_int(&op.ty),
                    "a read of global {global} in `{}` produces {:?}",
                    func.name,
                    op.ty,
                );
                seen += 1;
            }
        }
    }
    assert!(seen > 0, "the narrowed globals are read somewhere");
}

/// The five values an integer slot cannot hold, each keeping its double.
///
/// Written as one test over a named list rather than five tests, because the
/// point is the *set*: a pass that got four of them right and one wrong would
/// still be wrong, and a missing case here should read as a missing row rather
/// than as a missing function.
#[test]
fn a_global_that_can_hold_what_an_integer_cannot_keeps_its_double() {
    let Some(prepared) = prepared("module-numbers") else {
        return;
    };
    for (name, why) in [
        ("ratio", "a fraction, which an integer slot would round"),
        ("maybeNan", "NaN, which is not any integer"),
        (
            "signedZero",
            "negative zero, which only `1 / x` can tell from zero",
        ),
        ("wide", "past what an int32 holds"),
        (
            "huge",
            "past what a double can tell adjacent integers apart at",
        ),
        ("unbounded", "Infinity, which is in no integer range"),
    ] {
        let ty = storage(&prepared, name);
        assert!(
            matches!(ty, HirType::Float { .. }),
            "`{name}` holds {why}, so it must keep its double -- got {ty:?}",
        );
    }
}

/// `export let` is not a boundary here, and the guard that assumes it might be
/// is inert — deliberately, and this test is what says so out loud.
///
/// `hir::globals` declines to narrow a global whose `exported` flag is set,
/// because a reader outside the compiled set would hold the declared type and
/// there is no layout to carry a new width across that boundary the way a
/// field's would. The flag is **never set**. Every construction site in
/// `hir::lower` writes `exported: false`, nothing later assigns it, and the
/// result is visible in the emitted C: `export let visible = 0` becomes
/// `static int32_t visible`, which no other translation unit can name.
///
/// So `visible` narrows, and that is correct for how this compiler builds —
/// the whole module set is one program and every export is resolved inside it.
/// What is not correct is that three backends branch on the flag: C chooses
/// `static`, LLVM chooses `internal`, the JVM chooses `PRIVATE`, and all three
/// branches have gone one way since they were written.
///
/// The assertion below is therefore about the *flag*, not about the width. The
/// day someone gives a global an external reader and sets it, this fails and
/// points at the guard that is already waiting for it.
#[test]
fn no_global_is_exported_and_the_narrowing_guard_is_waiting_for_one() {
    let Some(prepared) = prepared("module-numbers") else {
        return;
    };
    let exported: Vec<&str> = prepared
        .program
        .globals
        .iter()
        .filter(|global| global.exported)
        .map(|global| global.name.as_str())
        .collect();
    assert!(
        exported.is_empty(),
        "a global is marked exported: {exported:?}. `hir::globals` declines to \
         narrow one, so check that guard still says what you want before \
         deleting this test",
    );

    // And what that means for `export let visible = 0`, whose stores are all
    // `n | 0`: it narrows like any other private global, because it is one.
    assert!(
        is_int(&storage(&prepared, "visible")),
        "an `export let` is not a boundary here -- got {:?}",
        storage(&prepared, "visible"),
    );
}

/// Arithmetic on a global read is integer arithmetic.
///
/// This is the assertion the others do not make, and it is the one the whole
/// pass exists for. Narrowing the *storage* is nearly free of benefit on its
/// own: measured, it moved `benches/cases/module-closures` from 17.84us to
/// 16.05us against C++'s 2.30us. What moved it to 2.42us was giving a
/// `GlobalGet` its facts, so that `(... + step) | 0` is provably whole and the
/// operations after the read stay in a register.
///
/// So a test on the width alone would pass with the expensive half deleted.
#[test]
fn arithmetic_on_a_global_read_stays_integer() {
    let Some(prepared) = prepared("module-numbers") else {
        return;
    };
    let func = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "reads")
        .expect("`reads` is exported from examples/module-numbers");

    // The reads of a global inside that function...
    let reads: Vec<u32> = func
        .values
        .iter()
        .enumerate()
        .filter(|(_, op)| matches!(op.kind, hir::OpKind::GlobalGet(_)))
        .map(|(at, _)| u32::try_from(at).unwrap_or(u32::MAX))
        .collect();
    assert!(!reads.is_empty(), "`reads` reads a global");

    // ...and what consumes them. `Binary` is the shape `step + something` has.
    let mut consumers = 0;
    for op in &func.values {
        let hir::OpKind::Binary { lhs, rhs, .. } = &op.kind else {
            continue;
        };
        if !reads.contains(&lhs.0) && !reads.contains(&rhs.0) {
            continue;
        }
        consumers += 1;
        assert!(
            is_int(&op.ty),
            "arithmetic on a global read produced {:?}, so the read was TOP",
            op.ty,
        );
    }
    assert!(consumers > 0, "something does arithmetic on the read");
}

/// A program records which memory discipline it was lowered under.
///
/// Not about globals, and here because this file already prepares a program
/// twice. A backend is handed a `Program` and never the `Options` behind it, so
/// until this field existed a decision made in `prepare_with` was invisible
/// downstream — and the JVM lane has to act on it, because it refuses a
/// function containing `Retain` or `Release` and `hir::suspend` emits one
/// regardless of provider.
///
/// Asserted both ways. A field that is always `NoGc` would pass a test that
/// only checked the default, which is how `Global::exported` came to have three
/// consumers and one value.
#[test]
fn a_program_records_the_provider_it_was_lowered_under() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/module-numbers/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/module-numbers is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");

    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let options = hir::Options {
            provider,
            ..hir::Options::default()
        };
        let prepared = hir::prepare_with(&snapshot, &options).expect("valid HIR");
        assert_eq!(
            prepared.program.provider, provider,
            "the program should say which provider produced it",
        );
    }
}
