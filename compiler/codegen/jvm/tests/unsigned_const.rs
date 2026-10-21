//! An unsigned literal at or above 2^31 is its raw bits in its slot, not a
//! decline: `4294967295` written as a `Uint32` was refused as wider than
//! its slot, where C writes the same bits. Int32's minimum in the same
//! program is the control.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi};

mod common;

#[test]
fn an_unsigned_literal_at_its_maximum_emits() {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/unsigned-const/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    let program = common::prepare(&snapshot).expect("valid HIR").program;
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted.diagnostics.is_empty(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect::<Vec<_>>()
    );
    assert!(!emitted.classes.is_empty());
}
