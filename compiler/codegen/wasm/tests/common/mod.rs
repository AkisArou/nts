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
    // NTS_WASM_BROWSER runs every check in headless Chromium, on browser glue.
    let browser = std::env::var_os("NTS_WASM_BROWSER").is_some();
    let host = if browser {
        nts_codegen_wasm::Host::Browser
    } else {
        nts_codegen_wasm::Host::Node
    };
    let glue = nts_codegen_wasm::glue(&emitted.manifest, host).unwrap();
    std::fs::write(artifact.join(nts_codegen_wasm::PROGRAM_FILE), glue.program).unwrap();
    std::fs::write(
        artifact.join(nts_codegen_wasm::INSTANCE_FILE),
        glue.instance,
    )
    .unwrap();
    let mut command = Command::new("node");
    if browser {
        // The runner strips TypeScript types itself, so node flags do not apply.
        command.arg(repository().join("tooling/wasm/browser/run.mjs"));
    } else {
        command.args(flags);
    }
    let result = command
        .arg(repository().join(script))
        .arg(&artifact)
        .args(args)
        .output()
        .expect("Node installed");
    if !result.status.success() {
        // The whole output goes to a file beside the kept artifact as well as
        // into the panic: a filter over test output once dropped the only
        // copy of a failure's text.
        let failure = artifact.join("failure.txt");
        let text = format!(
            "{script} {}\nstatus {}\n--- stdout\n{}\n--- stderr\n{}\n",
            artifact.display(),
            result.status,
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        std::fs::write(&failure, &text).unwrap();
        panic!("check failed; full output in {}\n{text}", failure.display());
    }
    let output = serde_json::from_slice(&result.stdout).unwrap();
    if retained.is_some() {
        std::fs::write(artifact.join("execution.json"), &result.stdout).unwrap();
    }
    if retained.is_none() {
        std::fs::remove_dir_all(artifact).unwrap();
    }
    output
}
