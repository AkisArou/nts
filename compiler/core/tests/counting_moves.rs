//! Where reference counting hands a reference on instead of copying it, read
//! off two `tests/memory` cases as the counting operations each function keeps.
//!
//! The memory step measures the same programs at run time, but it is a wide
//! step and runs only in the full run, so a regression there surfaces days
//! after the landing that caused it. These are the same facts, static, in the
//! core gate.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn counted(case: &str) -> Option<hir::Prepared> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/memory")
        .join(case)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/memory/{case} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(
        hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider: hir::Provider::ReferenceCounting,
                ..hir::Options::default()
            },
        )
        .expect("prepared HIR should verify"),
    )
}

/// The retains and releases left in the function named `name`, none if it is
/// gone.
fn counting_in(prepared: &hir::Prepared, name: &str) -> usize {
    prepared
        .program
        .funcs
        .iter()
        .filter(|func| func.name == name)
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| block.ops.iter())
                .map(|value| &func.values[value.0 as usize].kind)
        })
        .filter(|kind| matches!(kind, OpKind::Retain(_) | OpKind::Release(_)))
        .count()
}

/// A block parameter is forwarded only for an object scalarize then takes
/// apart. `chain`'s `Link` escapes through `tail.next = made`, and forwarded
/// anyway, it was used across the loop's join where its parameter used to
/// carry it, with a retain before the join and a release after it every
/// iteration: 33 counting operations at run time became 97.
#[test]
fn a_forwarding_that_takes_nothing_apart_is_not_made() {
    let Some(prepared) = counted("borrowed-call") else {
        return;
    };
    assert_eq!(counting_in(&prepared, "chain"), 0);
}

/// An erasure of a reference that dies at it takes the reference: each
/// element stored into a tuple of unlike references, an array of erased
/// values, paid a retain of the erased value and a release of the original,
/// 40 operations at run time for an ideal of 20.
#[test]
fn an_erasure_of_a_dying_reference_is_a_move() {
    let Some(prepared) = counted("tuple-cycle") else {
        return;
    };
    assert_eq!(counting_in(&prepared, "Node#constructor"), 0);
    // What is left is the store over `pair`, giving back the tuple it held,
    // and `n` erased into the new one while `link`'s caller still holds it.
    assert_eq!(counting_in(&prepared, "link"), 2);
}
