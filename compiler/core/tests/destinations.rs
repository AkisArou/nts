//! A string built only to be appended is built where it is appended
//! (`hir::destinations`).
//!
//! `tests/programs/a-string-built-where-it-is-appended` compares every shape
//! with node, which the variants do not change. What it cannot say is that
//! they exist and are called. Prepared for reference counting: `quote`,
//! `member`, `pick` and `tree` each have a variant; no call to `member` is
//! left, every one sent to `member#into`, and `member` itself is gone (C
//! refuses an uncalled static function under `-Werror`); and `tree#into`
//! appends its two
//! subtrees through `tree#into` itself, a recursion the pass reaches without
//! a depth bound.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind, Options, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const PROGRAM: &str = "a-string-built-where-it-is-appended";

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
    let options = Options {
        provider: Provider::ReferenceCounting,
        ..Options::default()
    };
    Some(
        hir::prepare_with(&snapshot, &options)
            .expect("prepared HIR verifies")
            .program,
    )
}

/// How many direct calls `func` makes to `callee`.
fn calls(func: &hir::Func, callee: &str) -> usize {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|op| {
            matches!(
                &func.values[op.0 as usize].kind,
                OpKind::Call { callee: Callee::Direct(name), .. } if name == callee
            )
        })
        .count()
}

#[test]
fn a_string_built_only_to_be_appended_is_built_where_it_is_appended() {
    let Some(program) = prepared() else {
        return;
    };
    let named = |name: &str| {
        program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .unwrap_or_else(|| panic!("`{name}` is in the prepared program"))
    };
    for variant in ["quote#into", "member#into", "pick#into", "tree#into"] {
        named(variant);
    }
    let everywhere = |callee: &str| {
        program
            .funcs
            .iter()
            .map(|func| calls(func, callee))
            .sum::<usize>()
    };
    assert_eq!(everywhere("member"), 0, "a call of `member` is left");
    assert!(
        program.funcs.iter().all(|func| func.name != "member"),
        "`member`, which nothing calls now, is still in the program"
    );
    assert!(everywhere("member#into") > 0, "nothing calls `member#into`");
    let tree = named("tree#into");
    assert_eq!(
        calls(tree, "tree#into"),
        2,
        "`tree#into` appends both subtrees itself"
    );
    assert_eq!(calls(tree, "tree"), 0, "`tree#into` calls the original");
}
