#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

pub(crate) mod hir;

use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

pub(crate) fn run(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
) -> serde_json::Value {
    run_with_node_flags(label, emitted, script, args, &[])
}

pub(crate) fn run_with_node_flags(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
    flags: &[&str],
) -> serde_json::Value {
    let retained = std::env::var_os("NTS_WASM_TEST_ARTIFACTS").map(PathBuf::from);
    let artifact = retained.as_ref().map_or_else(
        || std::env::temp_dir().join(format!("nts-wasm-{label}-{}", std::process::id())),
        |root| root.join(label),
    );
    std::fs::create_dir_all(&artifact).unwrap();
    std::fs::write(artifact.join("program.wasm"), &emitted.bytes).unwrap();
    std::fs::write(
        artifact.join("program.wasm.json"),
        serde_json::to_vec_pretty(&emitted.manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(
        artifact.join("program.mjs"),
        nts_codegen_wasm::glue(&emitted.manifest, nts_codegen_wasm::Host::Node).unwrap(),
    )
    .unwrap();
    let result = Command::new("node")
        .args(flags)
        .arg(repository().join(script))
        .arg(&artifact)
        .args(args)
        .output()
        .expect("Node installed");
    assert!(
        result.status.success(),
        "artifact {}\n{}\n{}",
        artifact.display(),
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    let output = serde_json::from_slice(&result.stdout).unwrap();
    if retained.is_some() {
        std::fs::write(artifact.join("execution.json"), &result.stdout).unwrap();
    }
    if retained.is_none() {
        std::fs::remove_dir_all(artifact).unwrap();
    }
    output
}
