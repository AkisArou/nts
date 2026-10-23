//! A module `const` that asks whether the target provides a runtime helper is
//! the question wherever it is read (`ModuleScope::questions`).
//!
//! `tests/programs/a-module-const-that-asks-what-is-provided` compares it with
//! node on four backends, early reads in the dead zone included. Here, the
//! answer per backend: prepared for one that provides
//! `nts_str_concat_number`, `suffixed` calls it; for one that provides nothing,
//! no call is left. Either way `CONCATS` has no storage, no `typeof` of an
//! intrinsic survives, and the control `ORDINARY`, whose initializer is code,
//! keeps its global.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind, Options, features::Provided};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const PROGRAM: &str = "a-module-const-that-asks-what-is-provided";

fn prepared(provided: Provided) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(PROGRAM)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{PROGRAM} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = Options {
        provided,
        ..Options::default()
    };
    Some(
        hir::prepare_with(&snapshot, &options)
            .expect("prepared HIR verifies")
            .program,
    )
}

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

fn global(program: &hir::Program, name: &str) -> bool {
    program.globals.iter().any(|global| global.name == name)
}

#[test]
fn a_module_const_that_asks_is_answered_where_it_is_read() {
    let Some(provides) = prepared(Provided::By(|helper| helper == "nts_str_concat_number")) else {
        return;
    };
    let lacks = prepared(Provided::Nothing).expect("tsgo was found once");
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
        assert!(
            !global(program, "CONCATS"),
            "the question was given storage"
        );
        assert!(global(program, "ORDINARY"), "the control lost its storage");
        let unanswered = program
            .funcs
            .iter()
            .flat_map(|func| &func.values)
            .filter(|op| matches!(op.kind, OpKind::Provided(_)))
            .count();
        assert_eq!(
            unanswered, 0,
            "a `typeof` of an intrinsic survived preparation"
        );
    }
}
