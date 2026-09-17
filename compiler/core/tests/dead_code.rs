//! That dead code elimination **did something**.
//!
//! Every other test around the optimiser asks whether the program is still
//! *correct*, and a program that computes everything and throws the results away
//! is a correct program. So a pass that stopped running entirely would be
//! invisible to all of them.
//!
//! That is not hypothetical. On 2026-09-17 the snapshot cache in this repository
//! was dead for six hours with its own test passing beside it, because the test
//! asserted correctness and invalidation and never that a second run did less
//! work; the object cache was found to have the same hole the same day, and
//! survived by luck rather than by being tested. An optimiser has the identical
//! shape: right, and possibly absent.
//!
//! Sabotage-checked rather than asserted — with `dce::eliminate` returning early,
//! this test fails and the rest of `nts-core` loses two tests that notice
//! *incidentally*, neither of which is about dead code.
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
    // **Exactly what `nts hir --prepared` builds**, options and all, because
    // that is the program a backend is handed and its own comment says so.
    //
    // The options are not a detail: with `Options::default()` both dead
    // constants survive, and I wrote the test that way first and watched it
    // fail against a compiler that was optimising correctly. A test that
    // prepares the program differently from every consumer of it is measuring
    // its own configuration.
    let options = hir::Options {
        provider: hir::Provider::NoGc,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    Some(hir::prepare_unverified(&snapshot, &options).program)
}

/// Every float constant the prepared program still **emits**.
///
/// Through `block.ops` and not `func.values`. The second is the value *arena* —
/// every value ever created, including the ones `dce::eliminate` has dropped
/// from the blocks — so a test reading it sees dead code that no backend will
/// ever be handed, and fails against a compiler that is optimising correctly.
/// `print_program` walks the blocks, which is why `nts hir --prepared` shows the
/// multiplication gone while the arena still holds it.
fn constants(program: &hir::Program) -> Vec<f64> {
    program
        .funcs
        .iter()
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .filter_map(|value| match func.values[value.0 as usize].kind {
                    OpKind::ConstFloat(held) => Some(held),
                    _ => None,
                })
        })
        .collect()
}

/// The fixture's dead constants are distinctive, so this names them rather than
/// counting operations — a count would move whenever anything else in the
/// pipeline changed, and a test nobody can read the failure of gets deleted.
#[test]
fn a_value_nothing_reads_does_not_reach_the_backend() {
    let Some(program) = prepared("dead-code-is-removed") else {
        return;
    };
    let held = constants(&program);
    assert!(
        !held.iter().any(|value| (*value - 77777.0).abs() < f64::EPSILON),
        "the multiplication by 77777 is dead and reached the backend: {held:?}"
    );
    assert!(
        !held.iter().any(|value| (*value - 88888.0).abs() < f64::EPSILON),
        "88888 is dead through two levels and reached the backend: {held:?}"
    );
}

/// And the fixture is not passing by being empty, which is the way this kind of
/// assertion usually stops meaning anything.
#[test]
fn the_live_half_of_the_fixture_survives() {
    let Some(program) = prepared("dead-code-is-removed") else {
        return;
    };
    let held = constants(&program);
    assert!(
        held.iter().any(|value| (*value - 3.0).abs() < f64::EPSILON),
        "`live` multiplies by 3 and that must survive: {held:?}"
    );
}
