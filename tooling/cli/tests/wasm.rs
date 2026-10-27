//! Retired entry points fail before acquiring sources or creating output.
#![allow(clippy::unwrap_used)]
use std::process::Command;

const NOTICE: &str = "the Wasm backend is being rebuilt on Binaryen; see docs/targets/wasm.md";

#[test]
fn retired_requests_fail_explicitly_without_a_native_fallback() {
    let out = std::env::temp_dir().join(format!("nts-retired-backend-{}", std::process::id()));
    assert!(!out.exists());
    for arguments in [
        vec!["emit-wasm"],
        vec!["emit-wasm", "--help"],
        vec![
            "emit-wasm",
            "__missing_project__",
            "--out",
            out.to_str().unwrap(),
        ],
        vec!["build", "--target", "wasm"],
        vec!["build", "__missing_project__", "--target=wasm"],
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(&arguments)
            .output()
            .unwrap();
        assert!(!result.status.success(), "{arguments:?}");
        assert!(result.stdout.is_empty(), "{arguments:?}");
        assert_eq!(
            String::from_utf8(result.stderr).unwrap(),
            format!("{NOTICE}\n"),
            "{arguments:?}"
        );
        assert!(!out.exists(), "a retired backend must write no output");
    }
    let mixed = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["emit", "--backends", "c,wasm", "--out"])
        .arg(&out)
        .arg("__missing_project__")
        .output()
        .unwrap();
    assert!(!mixed.status.success());
    assert!(
        String::from_utf8(mixed.stderr)
            .unwrap()
            .contains("unknown backend `wasm`")
    );
    assert!(!out.exists(), "a mixed request must not silently emit C");
    let control = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["emit-c", "--help"])
        .output()
        .unwrap();
    assert!(control.status.success());
    assert!(!String::from_utf8(control.stdout).unwrap().contains(NOTICE));
}
