//! A one-unit string compared is a unit read compared (`hir::simplify`).
//!
//! `tests/programs/a-one-unit-string-compared-as-a-unit-read` compares every
//! shape with node, which the one-character strings answer as well; what it
//! cannot say is whether they are still made. Here: `s[i] === "x"`,
//! `"o" !== s[i]`, `s.charAt(i) === "o"` and the out-of-range reads leave no
//! call to `nts_str_at` or `nts_str_char_at`, and the two-unit control does.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const PROGRAM: &str = "a-one-unit-string-compared-as-a-unit-read";

fn prepared() -> Option<hir::Program> {
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
    Some(
        hir::prepare(&snapshot)
            .expect("prepared HIR verifies")
            .program,
    )
}

/// How many calls `name` makes to a one-unit string helper.
fn string_reads(program: &hir::Program, name: &str) -> usize {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported"));
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|op| {
            matches!(
                &func.values[op.0 as usize].kind,
                OpKind::Call { callee: Callee::External(helper), .. }
                    if helper == "nts_str_at" || helper == "nts_str_char_at"
            )
        })
        .count()
}

#[test]
fn a_one_unit_comparison_makes_no_string() {
    let Some(program) = prepared() else {
        return;
    };
    for name in ["countX", "notO", "charAtO", "anywhere"] {
        assert_eq!(
            string_reads(&program, name),
            0,
            "`{name}` still makes a string"
        );
    }
    assert!(
        string_reads(&program, "twoUnits") > 0,
        "a two-unit literal is still compared as a string"
    );
}
