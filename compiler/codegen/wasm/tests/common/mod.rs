#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

mod hir;
pub(crate) use hir::*;

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
    let artifact = std::env::temp_dir().join(format!("nts-wasm-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&artifact).unwrap();
    std::fs::write(artifact.join("program.wasm"), &emitted.bytes).unwrap();
    std::fs::write(
        artifact.join("program.json"),
        serde_json::to_vec_pretty(&emitted.manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(artifact.join("node.mjs"), nts_codegen_wasm::NODE_LOADER).unwrap();
    let result = Command::new("node")
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
    std::fs::remove_dir_all(artifact).unwrap();
    output
}
