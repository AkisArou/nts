//! A string's quoted form, only appended, is written into the string it
//! extends (`hir::destinations`, `nts_str_append_json_quoted`).
//!
//! `tests/programs/a-json-string-quoted-onto-a-string` compares both shapes
//! with node, which the rewrite does not change. Here, prepared for reference
//! counting on a backend that provides the escape kernel: `members`, which
//! only appends each quoted key, calls `quoteJSONString#into`, whose return of
//! `nts_json_quote(value)` became `nts_str_append_json_quoted(into, value)`,
//! and no quoted string is made only to be appended; `keeps`, which reads its
//! quoted key again, still makes it. Prepared for a backend without the
//! kernel, none of the kernel's helpers is called.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind, Options, Provider, features::Provided};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "a-json-string-quoted-onto-a-string";

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
        provider: Provider::ReferenceCounting,
        provided,
        ..Options::default()
    };
    hir::prepare_with(&snapshot, &options)
        .expect("prepared HIR verifies")
        .program
}

/// How many calls `func` makes to the runtime helper `helper`.
fn calls(func: &hir::Func, helper: &str) -> usize {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|op| {
            matches!(
                &func.values[op.0 as usize].kind,
                OpKind::Call { callee: Callee::External(name), .. } if name == helper
            )
        })
        .count()
}

/// Calls to `helper` anywhere in the program.
fn anywhere(program: &hir::Program, helper: &str) -> usize {
    program.funcs.iter().map(|func| calls(func, helper)).sum()
}

#[test]
fn a_quoted_string_only_appended_is_written_where_it_is_appended() {
    let kernel = |helper: &str| helper == "nts_json_quote" || helper == "nts_json_first_escape";
    let program = prepared(Provided::By(kernel));
    assert!(
        anywhere(&program, "nts_str_append_json_quoted") > 0,
        "nothing appends a quoted string in place"
    );
    for func in &program.funcs {
        let left = hir::appended_runtime_calls(func)
            .into_iter()
            .filter(|call| {
                matches!(&func.values[call.0 as usize].kind,
                    OpKind::Call { callee: Callee::External(name), .. } if name == "nts_json_quote")
            })
            .count();
        assert_eq!(
            left, 0,
            "`{}` still makes a quoted string only to append it",
            func.name
        );
    }
    let direct = |name: &str, callee: &str| {
        program
            .funcs
            .iter()
            .filter(|func| func.name == name || func.name.starts_with(&format!("{name}#")))
            .flat_map(|func| func.values.iter())
            .filter(|op| {
                matches!(&op.kind, OpKind::Call { callee: Callee::Direct(called), .. } if called == callee)
            })
            .count()
    };
    assert!(
        direct("members", "quoteJSONString#into") > 0,
        "`members` appends each quoted key through the variant"
    );
    assert!(
        direct("keeps", "quoteJSONString") > 0 && direct("keeps", "quoteJSONString#into") == 0,
        "`keeps` reads its quoted key again, so it makes it"
    );
    let without = prepared(Provided::Nothing);
    for helper in [
        "nts_json_quote",
        "nts_str_append_json_quoted",
        "nts_str_concat_json_quoted",
    ] {
        assert_eq!(
            anywhere(&without, helper),
            0,
            "`{helper}` called where nothing provides it"
        );
    }
}
