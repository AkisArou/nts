//! A `typeof` of an `@ntsAbi intrinsic` declaration is answered per backend
//! (`hir::features`).
//!
//! `tests/programs/an-intrinsic-guarded-by-its-typeof` compares the program
//! with node on four backends, which the two arms answer alike. What it cannot
//! say is which arm each backend keeps. Prepared for a backend that provides
//! `nts_str_concat_number`, the call to it is there; prepared for one that
//! provides nothing -- the default, always safe -- no call to it is left. The
//! control, `nts_no_such_helper`, is called by neither, and no `typeof` of an
//! intrinsic survives preparation in either.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind, Options, features::Provided};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "an-intrinsic-guarded-by-its-typeof";

fn prepared(provided: Provided) -> hir::Program {
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
    let options = Options {
        provided,
        ..Options::default()
    };
    hir::prepare_with(&snapshot, &options)
        .expect("prepared HIR verifies")
        .program
}

/// How many calls the program makes to the runtime helper `helper`.
fn calls(program: &hir::Program, helper: &str) -> usize {
    program
        .funcs
        .iter()
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .map(move |op| &func.values[op.0 as usize].kind)
        })
        .filter(|kind| {
            matches!(kind, OpKind::Call { callee: Callee::External(name), .. } if name == helper)
        })
        .count()
}

fn unanswered(program: &hir::Program) -> usize {
    program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter(|op| matches!(op.kind, OpKind::Provided(_)))
        .count()
}

#[test]
fn an_intrinsic_is_called_only_where_the_backend_provides_it() {
    let provides = prepared(Provided::By(|helper| helper == "nts_str_concat_number"));
    let lacks = prepared(Provided::Nothing);
    assert!(
        calls(&provides, "nts_str_concat_number") > 0,
        "the provided helper is not called"
    );
    assert_eq!(
        calls(&lacks, "nts_str_concat_number"),
        0,
        "a helper nothing provides is called"
    );
    for program in [&provides, &lacks] {
        assert_eq!(
            calls(program, "nts_no_such_helper"),
            0,
            "the control is called"
        );
        assert_eq!(
            unanswered(program),
            0,
            "a `typeof` of an intrinsic survived preparation"
        );
    }
}
