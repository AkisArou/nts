//! A module `const` is a borrow wherever it is read (`hir::own`).
//!
//! `tests/programs/a-module-constant-read-through-calls` compares with node,
//! which counting does not change. What it cannot say is where the counts
//! are: prepared for reference counting, the `const` handed to a call in a
//! loop is neither retained nor released, and the `let` written twice -- the
//! one-difference control -- still is.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Memory, OpKind, Options};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "a-module-constant-read-through-calls";

fn prepared() -> hir::Program {
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
        provider: Memory::ReferenceCounting,
        ..Options::default()
    };
    hir::prepare_with(&snapshot, &options)
        .expect("prepared HIR verifies")
        .program
}

/// How many retains and releases in `name` count a global's load.
fn global_counts(program: &hir::Program, name: &str) -> usize {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported"));
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|op| match func.values[op.0 as usize].kind {
            OpKind::Retain(of) | OpKind::Release(of) => {
                matches!(func.values[of.0 as usize].kind, OpKind::GlobalGet(_))
            }
            _ => false,
        })
        .count()
}

#[test]
fn a_module_constant_is_not_counted_where_it_is_read() {
    let program = prepared();
    assert_eq!(
        global_counts(&program, "readsConst"),
        0,
        "the `const` is counted around the call"
    );
    assert!(
        global_counts(&program, "readsLet") > 0,
        "a `let` a call might write keeps its count"
    );
}
