//! Escaped typed allocations retain a runtime proof on their array wrapper.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
#[test]
fn escaped_prefixes_are_shared_by_aliases_and_never_count_unwritten_slots() {
    let root = common::repository();
    let fixture = root.join("tests/wasm/array-written-prefix");
    let tsgo = std::env::var("NTS_TSGO").expect("NTS_TSGO required for prefix regression");
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
    let output = common::run_with_node_flags(
        "array-written-prefix",
        &emitted,
        "tooling/wasm/check-array-prefix.ts",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["falseStops"], 58, "{output}");
    assert_eq!(output["falseStopShapes"], 2, "{output}");
    assert!(output["cases"].as_u64().unwrap() >= 290, "{output}");
    assert!(output["holes"].as_u64().unwrap() >= 116, "{output}");
}
