//! Escaped typed allocations retain a runtime proof on their array wrapper.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
#[test]
fn escaped_prefixes_are_shared_by_aliases_and_never_count_unwritten_slots() {
    let output = run_fixture("array-written-prefix", "tooling/wasm/check-array-prefix.ts");
    assert_eq!(output["falseStops"], 58, "{output}");
    assert_eq!(output["falseStopShapes"], 2, "{output}");
    assert!(output["cases"].as_u64().unwrap() >= 290, "{output}");
    assert!(output["holes"].as_u64().unwrap() >= 116, "{output}");
}

#[test]
fn discarded_reads_keep_the_initialization_contract_through_parameters_and_fields() {
    let output = run_fixture(
        "array-prefix-indirect-observation",
        "tooling/wasm/check-array-indirect.ts",
    );
    assert_eq!(output["cases"], 87, "{output}");
    assert_eq!(output["holes"], 87, "{output}");
}

fn run_fixture(name: &str, driver: &str) -> serde_json::Value {
    let root = common::repository();
    let fixture = root.join("tests/wasm").join(name);
    let tsgo = std::env::var("NTS_TSGO").expect("NTS_TSGO required for prefix regression");
    let snapshot = TsgoApi::for_compilation(Utf8PathBuf::from(tsgo))
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
    common::run_with_node_flags(
        name,
        &emitted,
        driver,
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    )
}
