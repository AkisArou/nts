//! Prepared TypeScript → bytes → validator → Node loader → same-source answers.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::Path;

fn emit_project(fixture: &Path) -> nts_codegen_wasm::Emitted {
    let tsgo = std::env::var("NTS_TSGO")
        .expect("NTS_TSGO required: wasm execution tests must not silently skip");
    let tsconfig = Utf8PathBuf::from_path_buf(fixture.join("tsconfig.json")).unwrap();
    let snapshot = TsgoApi::for_compilation(Utf8PathBuf::from(tsgo))
        .snapshot(&tsconfig)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::HostGc,
            ..hir::Options::default()
        },
    )
    .expect("prepared HIR verifies");
    nts_codegen_wasm::emit(&prepared.program).expect("scalar fixture supported")
}

#[test]
fn scalar_typescript_agrees_with_node_exactly() {
    let fixture = common::repository().join("tooling/wasm/fixtures/scalars");
    let emitted = emit_project(&fixture);
    let output = common::run(
        "scalars",
        &emitted,
        "tooling/wasm/check-scalars.mjs",
        &[&fixture.join("src/main.ts")],
    );
    assert!(output["cases"].as_u64().unwrap() >= 150_000, "{output}");
    println!("{output}");
    assert!(
        !emitted.origins.is_empty(),
        "instructions preserve HIR Origins"
    );
}

#[test]
fn existing_loops_and_bitwise_examples_agree_with_node() {
    for (name, expected) in [("loops", 102), ("bitwise", 136)] {
        let fixture = common::repository().join("examples").join(name);
        let emitted = emit_project(&fixture);
        let output = common::run(
            name,
            &emitted,
            "tooling/wasm/check-example.mjs",
            &[&fixture.join("src/main.ts")],
        );
        assert_eq!(output["cases"], expected, "{output}");
        assert_eq!(output["declined"], 0);
        println!("{name}: {output}");
    }
}
