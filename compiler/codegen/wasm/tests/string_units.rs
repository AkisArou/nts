//! A core-proven string index goes directly to the engine's code-unit read.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{self, Func, HirType, ManagedType, OpKind, Terminator};

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}

#[test]
fn lone_literal_imports_are_lossless_interned_and_deterministic() {
    use nts_semantic_schema::JsText;
    let functions = [
        JsText::from_utf16(vec![0xd800]),
        JsText::from_utf16(vec![0xdc00]),
        JsText::from_utf16(vec![0xd800]),
        JsText::from("ordinary"),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, text)| {
        let mut f = function(&format!("literal{index}"), &[], string());
        let out = value(&mut f, OpKind::ConstString(text), string());
        f.blocks
            .push(block(&[], &[out], Terminator::Return(Some(out))));
        f
    })
    .collect();
    let program = program(functions);
    let emitted = nts_codegen_wasm::emit(&program).unwrap();
    let again = nts_codegen_wasm::emit(&program).unwrap();
    assert_eq!(emitted.bytes, again.bytes);
    assert_eq!(
        serde_json::to_value(&emitted.manifest).unwrap(),
        serde_json::to_value(&again.manifest).unwrap()
    );
    let constants = &emitted.manifest.literal_constants;
    assert_eq!(constants.len(), 2);
    assert_eq!(constants[&0].utf16().as_ref(), &[0xd800]);
    assert_eq!(constants[&1].utf16().as_ref(), &[0xdc00]);
    // Engine string globals are intentionally absent from both host import
    // lists. Inspect the actual module, rather than the function-only catalog.
    let mut ordinary = false;
    for payload in wasmparser::Parser::new(0).parse_all(&emitted.bytes) {
        if let wasmparser::Payload::ImportSection(imports) = payload.unwrap() {
            for import in imports.into_imports() {
                let import = import.unwrap();
                ordinary |= import.module == "'"
                    && import.name == "ordinary"
                    && matches!(import.ty, wasmparser::TypeRef::Global(_));
            }
        }
    }
    assert!(
        ordinary,
        "ordinary constants retain importedStringConstants"
    );
    let host = nts_codegen_wasm::glue(&emitted.manifest, nts_codegen_wasm::Host::Node).unwrap();
    assert!(host.instance.contains("\\ud800"));
    assert!(host.instance.contains("\\udc00"));
    let mut missing = emitted.manifest.clone();
    missing.literal_constants.remove(&0);
    assert!(
        nts_codegen_wasm::glue(&missing, nts_codegen_wasm::Host::Node)
            .unwrap_err()
            .contains("no matching immutable UTF-16 constant")
    );
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
fn an_unchecked_read_has_no_length_import_and_a_false_bound_traps() {
    let unchecked = nts_codegen_wasm::emit(&program(vec![read(false), null_read()])).unwrap();
    // Builtins are listed apart from ordinary imports (`Manifest::builtins`);
    // this read `imports`, where `length` never is, until 2026-10-20.
    let imports_length = |emitted: &nts_codegen_wasm::Emitted| {
        emitted.manifest.builtins.iter().any(|i| i.name == "length")
    };
    assert!(!imports_length(&unchecked));
    let checked = nts_codegen_wasm::emit(&program(vec![read(true)])).unwrap();
    // The control: the checked read tests its index against the length.
    assert!(imports_length(&checked));
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
    assert_eq!(report["ranges"], 133, "{report}");
    assert_eq!(report["nullFloor"], true, "{report}");
    if common::retained().is_none() {
        std::fs::remove_dir_all(checked_path).unwrap();
    }
}

#[test]
fn prepared_unicode_scans_keep_the_core_proof() {
    use camino::Utf8PathBuf;
    use nts_frontend_ts::Frontend;
    let root = common::repository();
    let fixture = root.join("tests/wasm/proven-string-units");

    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&Utf8PathBuf::from_path_buf(fixture.join("tsconfig.json")).unwrap())
        .unwrap();
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::HostGc,
            table_entries: nts_codegen_common::Backend::Wasm.table_entries(),
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
