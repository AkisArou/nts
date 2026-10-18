//! A missing override stops by name while all remaining inputs still run.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn a_refused_fewer_parameter_override_keeps_its_jvm_dispatch_abi() {
    nts_frontend_ts::tsgo::locate().expect("set NTS_TSGO; this guard must run the frontend");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/tests/programs/refused-virtual-slot-arity/tsconfig.json");
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("check")
        .arg(fixture)
        .env("NTS_BACKEND", "jvm")
        .env_remove("NTS_RC")
        .env_remove("NTS_KEEP_TEMP")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(!result.status.success(), "a refused input must stop");
    assert!(
        stdout.contains("checked 57 of 58 cases"),
        "{stdout}\n{stderr}"
    );
    assert!(
        stdout.contains("`RefusedNarrow#read` was refused:"),
        "{stdout}\n{stderr}"
    );
    assert!(stderr.contains("aborted 1 time(s)"), "{stdout}\n{stderr}");
    assert!(
        !stdout.contains("  nts  ") && !stdout.contains("  node "),
        "{stdout}\n{stderr}"
    );
}

#[test]
fn refused_virtual_receivers_stop_on_every_backend_and_controls_finish() {
    nts_frontend_ts::tsgo::locate().expect("set NTS_TSGO; this guard must run the frontend");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/tests/programs/refused-virtual-slots/runtime.json");
    let scratch = std::env::temp_dir().join(format!("nts-refused-slot-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).unwrap();
    for backend in ["c", "llvm", "jvm", "wasm"] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nts"));
        command
            .arg("check")
            .arg(&fixture)
            .env("NTS_BACKEND", backend)
            .env_remove("NTS_RC")
            .env_remove("NTS_KEEP_TEMP");
        if backend == "wasm" {
            command.env("TMPDIR", &scratch).env("NTS_KEEP_TEMP", "1");
        }
        let result = command.output().unwrap();
        let stdout = String::from_utf8_lossy(&result.stdout);
        let stderr = String::from_utf8_lossy(&result.stderr);
        if backend == "wasm" {
            // Use check to retain the emitted module, then ask it directly.
            // The differential's NTS5001 classification has its own guard;
            // this test asserts dispatch and the original refusal message.
            assert_wasm_stops(&scratch);
            continue;
        }
        assert!(
            stdout.contains("3 case(s) the compiled program declined"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert!(
            stdout.contains("checked 113 of 116 cases"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert!(
            !stdout.contains("  nts  ") && !stdout.contains("  node "),
            "{backend}: controls must agree: {stdout}\n{stderr}"
        );
        assert!(
            !result.status.success(),
            "{backend}: a missing feature must stop: {stdout}\n{stderr}"
        );
        assert!(
            stderr.contains("aborted 3 time(s)"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert_eq!(stdout.matches("the compiled program aborted: nts: refused at run time: `Refused#value` was refused: `eval`, a builtin this compiler does not provide is not supported by this lowering yet").count(), 3, "{backend}: {stdout}\n{stderr}");
    }
    std::fs::remove_dir_all(scratch).unwrap();
}

fn assert_wasm_stops(scratch: &Path) {
    let artifact = std::fs::read_dir(scratch)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let script = r"
        import assert from 'node:assert/strict';
        import {pathToFileURL} from 'node:url';
        const {instantiate} = await import(pathToFileURL(process.argv[1] + '/wasm/program.instance.mjs'));
        const m = instantiate();
        const reason = '`eval`, a builtin this compiler does not provide is not supported by this lowering yet';
        for (const name of ['oneRefused', 'oneInherited', 'oneMixed']) {
            assert.throws(() => m[name](1), error => error.code === 'NTS5001'
                && error.message.includes('Refused#value') && error.message.includes(reason));
        }
        assert.equal(m.oneRefused(2), 9);
        assert.equal(m.oneInherited(2), 9);
        assert.equal(m.oneMixed(2), 6);
        assert.equal(m.validDispatch(2), 30);
    ";
    let result = Command::new("node")
        .args(["--input-type=module", "--eval", script])
        .arg(artifact)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
