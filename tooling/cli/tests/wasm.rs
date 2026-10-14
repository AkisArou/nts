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
    let supported = root.join("tests/wasm/scalars");
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
            root.join("tests/wasm/declines"),
            "NTS5001",
            "unsupportedBigInt",
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
    // `check` drives the module as it drives every backend's program.
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["check", "--no-acquire"])
        .arg(&supported)
        .env("NTS_BACKEND", "wasm")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&result.stdout);
    assert!(
        result.status.success() && said.contains("agreed on every case"),
        "{said}{}",
        String::from_utf8_lossy(&result.stderr)
    );
    // It publishes only what it calls and compiles every body, so a body Wasm
    // declines in an export it never calls still fails the check, by name.
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["check", "--no-acquire"])
        .arg(root.join("tests/wasm/check-compiles-every-body"))
        .env("NTS_BACKEND", "wasm")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&result.stderr);
    assert!(
        !result.status.success() && said.contains("NTS5001 wasm declines `keyed`"),
        "{said}"
    );
    std::fs::remove_dir_all(scratch).unwrap();
}

/// `--host` is read in either spelling and in any position, and a missing,
/// unknown or repeated value is an error rather than a silent default.
#[test]
fn emit_wasm_reads_every_host_spelling_and_refuses_a_wrong_one() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let scratch = std::env::temp_dir().join(format!("nts-wasm-host-{}", std::process::id()));
    let project = root.join("tests/wasm/scalars");
    let project = project.to_str().unwrap();
    let emit = |label: &str, args: &[&str]| {
        let out = scratch.join(label);
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["emit-wasm", "--no-acquire", "--out"])
            .arg(&out)
            .args(args)
            .output()
            .unwrap();
        (out, result)
    };
    for (label, args, browser) in [
        ("before", vec!["--host", "browser", project], true),
        ("joined", vec![project, "--host=browser"], true),
        ("node", vec![project, "--host=node"], false),
        ("default", vec![project], false),
    ] {
        let (out, result) = emit(label, &args);
        assert!(
            result.status.success(),
            "{label}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let instance = std::fs::read_to_string(out.join("program.instance.mjs")).unwrap();
        assert_eq!(instance.contains("compileStreaming"), browser, "{label}");
        assert_eq!(instance.contains("readFileSync"), !browser, "{label}");
    }
    for (label, args, message) in [
        ("missing", vec![project, "--host"], "needs a value"),
        ("unknown", vec![project, "--host=deno"], "not `deno`"),
        (
            "repeated",
            vec!["--host", "node", "--host", "browser", project],
            "more than once",
        ),
    ] {
        let (out, result) = emit(label, &args);
        assert!(!result.status.success(), "{label}");
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(stderr.contains(message), "{label}: {stderr}");
        assert!(!out.exists(), "{label}: refused before writing");
    }
    std::fs::remove_dir_all(&scratch).ok();
}
