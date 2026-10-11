//! The public command writes usable modules or refuses before writing bytes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn emit_wasm_writes_an_executable_artifact_and_declines_before_writing() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let scratch = std::env::temp_dir().join(format!("nts-wasm-cli-{}", std::process::id()));
    let supported = root.join("tooling/wasm/fixtures/scalars");
    let out = scratch.join("supported");
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["emit-wasm", "--no-acquire", "--out"])
        .arg(&out)
        .arg(&supported)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(out.join("program.wasm").is_file());
    let origins: serde_json::Value =
        serde_json::from_slice(&std::fs::read(out.join("program.origins.json")).unwrap()).unwrap();
    assert!(!origins["instructions"].as_array().unwrap().is_empty());
    let source = origins["instructions"][0]["origin"]["location"]["file"]
        .as_u64()
        .unwrap();
    assert!(origins["sources"][usize::try_from(source).unwrap()]["uri"].is_string());
    let result = Command::new("node")
        .arg(root.join("tooling/wasm/check-scalars.mjs"))
        .arg(&out)
        .arg(supported.join("src/main.ts"))
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let checked: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert!(checked["cases"].as_u64().unwrap() >= 150_000);
    for (label, flags, source, code, name) in [
        (
            "unsupported",
            vec![],
            root.join("tooling/wasm/fixtures/declines"),
            "NTS5001",
            "unsupportedMath",
        ),
        ("rc", vec!["--rc"], supported.clone(), "NTS2001", "--rc"),
    ] {
        let out = scratch.join(label);
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["emit-wasm", "--no-acquire", "--out"])
            .arg(&out)
            .args(flags)
            .arg(source)
            .output()
            .unwrap();
        assert!(!result.status.success());
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(stderr.contains(code) && stderr.contains(name), "{stderr}");
        assert!(!out.exists(), "a decline must precede any output mutation");
    }
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["emit-wasm", "--no-acquire"])
        .arg(&supported)
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("requires --out"));
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["check", "--no-acquire"])
        .arg(&supported)
        .env("NTS_BACKEND", "wasm")
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("NTS5001: wasm declines"));
    std::fs::remove_dir_all(scratch).unwrap();
}
