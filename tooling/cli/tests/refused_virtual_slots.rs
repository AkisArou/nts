//! A missing override stops by name while all remaining inputs still run.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn refused_virtual_receivers_stop_on_every_backend_and_controls_finish() {
    nts_frontend_ts::tsgo::locate().expect("set NTS_TSGO; this guard must run the frontend");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/tests/programs/refused-virtual-slots/runtime.json");
    for backend in ["c", "llvm", "jvm", "wasm"] {
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("check")
            .arg(&fixture)
            .env("NTS_BACKEND", backend)
            .env_remove("NTS_RC")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&result.stdout);
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(result.status.success(), "{backend}: {stdout}\n{stderr}");
        assert!(
            stdout.contains("3 case(s) the compiled program declined"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert!(
            stdout.contains("checked 116 cases across 4 function(s)"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert!(
            stdout.contains("agreed on every case"),
            "{backend}: {stdout}\n{stderr}"
        );
    }
}
