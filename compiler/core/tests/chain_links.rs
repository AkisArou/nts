//! The first link of a string chain, read only by an append that takes it
//! over, is made with room (`appended_results::consumed_left_sides`, `rc`,
//! `nts_str_concat_grown`).
//!
//! `tests/programs/a-string-chain-made-with-room` compares every function
//! with node, which the room does not change. Here, prepared for reference
//! counting: `templates` and `joined` make their first link with room;
//! `kept`, which keeps its `name + ":"`, makes it to fit (`nts_concat`); and
//! `moved`, whose first link's left side is a string it made and gives away,
//! appends to it in place (`nts_str_append`) and makes nothing with room.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, Callee, OpKind, Options, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const PROGRAM: &str = "a-string-chain-made-with-room";

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

/// The live operations of the functions named `name`, or a clone of it.
fn kinds<'a>(program: &'a hir::Program, name: &'a str) -> impl Iterator<Item = &'a OpKind> {
    program
        .funcs
        .iter()
        .filter(move |func| func.name == name || func.name.starts_with(&format!("{name}#")))
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .map(move |op| &func.values[op.0 as usize].kind)
        })
}

fn calls(program: &hir::Program, name: &str, helper: &str) -> usize {
    kinds(program, name)
        .filter(|kind| {
            matches!(kind, OpKind::Call { callee: Callee::External(called), .. } if called == helper)
        })
        .count()
}

fn concatenations(program: &hir::Program, name: &str) -> usize {
    kinds(program, name)
        .filter(|kind| {
            matches!(
                kind,
                OpKind::Binary {
                    op: BinOp::Concat,
                    ..
                }
            )
        })
        .count()
}

#[test]
fn a_chain_s_first_link_is_made_with_room_only_where_an_append_takes_it_over() {
    let Some(program) = prepared() else {
        return;
    };
    for name in ["templates", "joined"] {
        assert!(
            calls(&program, name, "nts_str_concat_grown") > 0,
            "`{name}`'s first link is not made with room"
        );
    }
    assert_eq!(
        calls(&program, "kept", "nts_str_concat_grown"),
        0,
        "`kept` keeps its link, so the room would be kept too"
    );
    assert!(
        concatenations(&program, "kept") > 0,
        "`kept` still concatenates"
    );
    assert_eq!(
        calls(&program, "moved", "nts_str_concat_grown"),
        0,
        "`moved` gives its left side away, which is appended to in place"
    );
    assert!(
        calls(&program, "moved", "nts_str_append") > 0,
        "`moved` appends to the string it made"
    );
}
