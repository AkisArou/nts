//! A core-proven string index goes directly to the engine's code-unit read.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{self, Func, HirType, ManagedType, OpKind, Terminator};

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}

fn read(checked: bool) -> Func {
    let (name, index_type, result) = if checked {
        ("checked", F64, F64)
    } else {
        ("unit", U32, U32)
    };
    let mut f = function(name, &[string(), index_type.clone()], result.clone());
    let text = value(&mut f, OpKind::Param(0), string());
    let at = value(&mut f, OpKind::Param(1), index_type);
    let out = value(
        &mut f,
        OpKind::StringUnitAt {
            string: text,
            index: at,
            checked,
        },
        result,
    );
    f.blocks
        .push(block(&[], &[text, at, out], Terminator::Return(Some(out))));
    f
}

fn null_read() -> Func {
    let mut f = function("nullUnit", &[], U32);
    let text = value(&mut f, OpKind::ConstNull, string());
    let at = value(&mut f, OpKind::ConstInt(0), U32);
    let out = value(
        &mut f,
        OpKind::StringUnitAt {
            string: text,
            index: at,
            checked: false,
        },
        U32,
    );
    f.blocks
        .push(block(&[], &[text, at, out], Terminator::Return(Some(out))));
    f
}

#[test]
fn an_unchecked_read_has_no_length_import_and_a_false_proof_traps() {
    let unchecked = nts_codegen_wasm::emit(&program(vec![read(false), null_read()])).unwrap();
    assert!(
        !unchecked
            .manifest
            .imports
            .iter()
            .any(|i| { i.module == "wasm:js-string" && i.name == "length" })
    );
    let checked = nts_codegen_wasm::emit(&program(vec![read(true)])).unwrap();
    let checked_path = common::write_artifact(
        "checked-string-unit",
        &checked,
        nts_codegen_wasm::Host::Node,
    );
    let report = common::run(
        "unchecked-string-unit",
        &unchecked,
        "tooling/wasm/check-string-unit-contracts.ts",
        &[&checked_path],
    );
    assert_eq!(report["badProofTraps"], 7, "{report}");
    assert_eq!(report["ranges"], 126, "{report}");
    assert_eq!(report["nullFloor"], true, "{report}");
    if common::retained().is_none() {
        std::fs::remove_dir_all(checked_path).unwrap();
    }
}

#[test]
fn prepared_unicode_scans_keep_the_core_proof() {
    use camino::Utf8PathBuf;
    use nts_frontend_ts::{SemanticSource, TsgoApi};
    let root = common::repository();
    let fixture = root.join("tests/wasm/proven-string-units");
    let tsgo = std::env::var("NTS_TSGO").expect("NTS_TSGO required for proven string regression");
    let snapshot = TsgoApi::for_compilation(Utf8PathBuf::from(tsgo))
        .snapshot(&Utf8PathBuf::from_path_buf(fixture.join("tsconfig.json")).unwrap())
        .unwrap();
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::HostGc,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:#?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_wasm::emit(&prepared.program).unwrap();
    let report = common::run_with_node_flags(
        "proven-string-units",
        &emitted,
        "tooling/wasm/check-proven-string-units.ts",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(report["cases"], 87, "{report}");
    assert_eq!(report["lengthBuiltins"], 0, "{report}");
}
