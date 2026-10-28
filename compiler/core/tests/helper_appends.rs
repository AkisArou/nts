//! What a runtime helper answers only to be appended is written into the
//! string it extends (`hir::destinations`, `nts_str_append_number` and its
//! siblings).
//!
//! `tests/programs/a-string-appended-by-a-runtime-helper` compares every
//! shape with node, which the rewrite does not change. Here, prepared for
//! reference counting: no helper's answer is left only to be appended, each of
//! the five appenders is called, `numberText#into` writes its number with
//! `nts_str_append_number`, `addNumber` takes its string over through that
//! helper's slot, and `keeps`, which reads its string after the append, does
//! not.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, Memory, OpKind, Options};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "a-string-appended-by-a-runtime-helper";

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

#[test]
fn a_helper_answer_only_appended_is_written_where_it_is_appended() {
    let program = prepared();
    for func in &program.funcs {
        let left: Vec<String> = hir::appended_runtime_calls(func)
            .into_iter()
            .filter_map(|call| match &func.values[call.0 as usize].kind {
                OpKind::Call {
                    callee: Callee::External(name),
                    ..
                } if [
                    "nts_number_to_string",
                    "nts_str_at",
                    "nts_str_char_at",
                    "nts_string_from_char_code",
                    "nts_str_slice",
                ]
                .contains(&name.as_str()) =>
                {
                    Some(name.clone())
                }
                _ => None,
            })
            .collect();
        assert!(left.is_empty(), "`{}` still appends {left:?}", func.name);
    }
    let everywhere = |helper: &str| {
        program
            .funcs
            .iter()
            .map(|func| calls(func, helper))
            .sum::<usize>()
    };
    for appender in [
        "nts_str_append_number",
        "nts_str_append_at",
        "nts_str_append_char_at",
        "nts_str_append_char_code",
        "nts_str_append_slice",
    ] {
        assert!(everywhere(appender) > 0, "nothing calls `{appender}`");
    }
    let variant = program
        .funcs
        .iter()
        .find(|func| func.name == "numberText#into")
        .expect("`numberText` has a variant");
    assert!(calls(variant, "nts_str_append_number") > 0);
    let summaries = hir::own::summarize(&program, &program.layouts);
    let takes_first = |name: &str| {
        summaries
            .consumes(name)
            .is_some_and(|slots| slots.contains(&0))
    };
    assert!(
        takes_first("addNumber"),
        "`addNumber` gives its string to the helper"
    );
    assert!(
        !takes_first("keeps"),
        "`keeps` reads its string after the append"
    );
}
