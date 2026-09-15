//! A refused constructor must say why it was refused, under the name a reader
//! asks with.
//!
//! The napi wrapper looks up `Owner#constructor` in `Program::uncompiled` and
//! prints `is a class whose constructor was not compiled` when it finds
//! nothing -- the effect, with the cause left unsaid. On 2026-09-15 that was
//! seven declines in `stream` alone, including `Readable`, whose export is the
//! single most-named thing in that module's failing tests.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, lower::Lowered};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lower_at(relative: &str) -> Option<Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    Some(hir::lower::lower(&snapshot))
}

#[test]
fn a_refused_constructor_is_recorded_under_the_name_a_wrapper_asks_with() {
    let Some(lowered) = lower_at("tests/programs/constructor-refusal") else {
        eprintln!("SKIP constructor refusal: tsgo is required");
        return;
    };

    // The control: the refusal happened at all, and named the cause. Without
    // this the assertion below could pass on a program that compiled cleanly.
    assert!(
        lowered
            .diagnostics
            .iter()
            .any(|d| d.message.contains("`_read`") && d.message.contains("no representation")),
        "the fixture must refuse `_read`; got {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>()
    );

    // The second control: the class that does compile has its constructor, so
    // a missing `Refused#constructor` is the refusal and not the fixture.
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|f| f.name == "Fine#constructor"),
        "the unrefused class must keep its constructor"
    );
    assert!(
        !lowered
            .program
            .funcs
            .iter()
            .any(|f| f.name == "Refused#constructor"),
        "the refused class must not have one"
    );

    for class in ["Refused", "AlsoRefused"] {
        assert!(
            lowered
                .program
                .uncompiled
                .iter()
                .any(|(at, _)| *at == format!("{class}#constructor")),
            "`{class}#constructor` was refused with a cause and recorded under \
             no name a reader asks with; `uncompiled` holds {:?}",
            lowered
                .program
                .uncompiled
                .iter()
                .map(|(at, _)| at.as_str())
                .collect::<Vec<_>>()
        );
    }
    assert!(
        lowered
            .program
            .uncompiled
            .iter()
            .any(|(at, _)| at == "Refused#constructor"),
        "`Refused#constructor` was refused with a cause and recorded under no \
         name a reader asks with; `uncompiled` holds {:?}",
        lowered
            .program
            .uncompiled
            .iter()
            .map(|(at, _)| at.as_str())
            .collect::<Vec<_>>()
    );
}
