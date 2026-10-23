//! A string parameter appended onto is taken over (`own::appended_parameters`).
//!
//! `tests/programs/a-string-parameter-appended-onto-is-taken-over` compares
//! every function with node, which ownership does not change. What it cannot
//! say is which parameters are taken over. Here, on the program prepared
//! without counting (what reference counting summarizes before it inserts
//! anything): `add`, `addBoth`, `relay`, `either` and `joined` take their first
//! parameter over; `measured`, `twiceOnAPath`, `looped`, the exported
//! `addExported` and `addKept`, whose caller keeps its argument, do not.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Options, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const PROGRAM: &str = "a-string-parameter-appended-onto-is-taken-over";

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
        provider: Provider::NoGc,
        ..Options::default()
    };
    Some(
        hir::prepare_with(&snapshot, &options)
            .expect("prepared HIR verifies")
            .program,
    )
}

#[test]
fn a_string_parameter_appended_onto_is_taken_over() {
    let Some(program) = prepared() else {
        return;
    };
    let summaries = hir::own::summarize(&program, &program.layouts);
    let takes_first = |name: &str| {
        assert!(
            program.funcs.iter().any(|func| func.name == name),
            "`{name}` is still in the program"
        );
        summaries
            .consumes(name)
            .is_some_and(|slots| slots.contains(&0))
    };
    for name in ["add", "addBoth", "relay", "either", "joined"] {
        assert!(
            takes_first(name),
            "`{name}` gives its string away and takes it over"
        );
    }
    for name in [
        "measured",
        "twiceOnAPath",
        "looped",
        "addExported",
        "addKept",
    ] {
        assert!(!takes_first(name), "`{name}` keeps borrowing its string");
    }
}
