//! That frame placement **did something**.
//!
//! An object that outlives nothing can live in the caller's frame instead of the
//! heap. A compiler that stopped doing it emits a correct program that allocates
//! on every call, and every correctness test in this repository goes on passing
//! — the same shape that let the snapshot cache sit dead for six hours on
//! 2026-09-17 with its own test green beside it.
//!
//! Found by sweeping: with `place_allocations` skipped, **nothing in `nts-core`
//! failed**. `dce` was noticed by two tests that are about other things, and
//! `simplify` and `signatures` by one each; frame placement and
//! `dce::prune_parameters` were noticed by none.
//!
//! The second assertion is what makes the first mean anything. A pass that put
//! *everything* in the frame would be wrong — the object in `escapesToAGlobal`
//! outlives the call — and would satisfy an assertion that only looked at the
//! framed one.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::SemanticSource;

fn prepared(name: &str) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    // The options `nts hir --prepared` uses, which is the program a backend is
    // handed. `Options::default()` is a different pipeline and the placements
    // it produces are not the ones anything compiles.
    let options = hir::Options {
        provider: hir::Provider::NoGc,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    Some(hir::prepare_unverified(&snapshot, &options).program)
}

/// Where each `ObjectNew` a named function still emits was placed.
///
/// Through `block.ops` and not `func.values`: the second is the value arena,
/// which holds everything ever created including what later passes dropped, so
/// reading it reports allocations no backend is handed.
fn placements(program: &hir::Program, export: &str) -> Vec<bool> {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == export)
        .unwrap_or_else(|| panic!("`{export}` should be compiled"));
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|value| match func.values[value.0 as usize].kind {
            OpKind::ObjectNew { frame } => Some(frame),
            _ => None,
        })
        .collect()
}

#[test]
fn an_object_that_outlives_nothing_is_placed_in_the_frame() {
    let Some(program) = prepared("an-allocation-that-does-not-escape") else {
        return;
    };
    assert_eq!(
        placements(&program, "stays"),
        vec![true],
        "nothing outlives `stays`, so its `Point` belongs in the frame"
    );
}

/// The control: an allocation that *does* escape must not be framed, or the
/// assertion above is satisfied by a pass that frames everything.
#[test]
fn an_object_that_escapes_stays_on_the_heap() {
    let Some(program) = prepared("an-allocation-that-does-not-escape") else {
        return;
    };
    assert_eq!(
        placements(&program, "escapesToAGlobal"),
        vec![false],
        "it is stored in a module-level slot, so it outlives the call"
    );
}

/// Both kinds in one function, which is the arm a per-function decision would
/// get wrong while passing the two above.
#[test]
fn two_allocations_in_one_function_are_placed_separately() {
    let Some(program) = prepared("an-allocation-that-does-not-escape") else {
        return;
    };
    assert_eq!(
        placements(&program, "bothInOne"),
        vec![true, false],
        "the first stays and the second is kept, in that order"
    );
}
