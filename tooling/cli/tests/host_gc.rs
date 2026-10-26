//! Conflicting managed-backend memory requests fail before the frontend starts.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn jvm_declines_rc_before_frontend_acquisition() {
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/programs/objects");
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["emit-jvm", "--rc", "--no-acquire"])
        .arg(project)
        .output()
        .unwrap();
    assert!(!result.status.success());
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("jvm declines --rc"), "{stderr}");
}
