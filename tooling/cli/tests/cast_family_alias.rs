//! A guarded cast result must compare both exports, including the cast arm.

#![allow(clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn a_cast_result_alias_compares_both_exports_and_every_case() {
    check_every_case("a-cast-reads-a-field-another-layout-holds", 87, 3);
    check_every_case("a-cast-result-alias-keeps-its-tag", 87, 3);
}

#[test]
fn a_cast_record_membership_compares_present_and_absent_keys() {
    check_every_case("a-record-membership-test-through-an-erased-cast", 58, 2);
}

fn check_every_case(fixture: &str, cases: usize, functions: usize) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .current_dir(root)
        .args(["check", &format!("tests/programs/{fixture}"), "--json"])
        .env("NTS_BACKEND", "c")
        .env("NTS_RC", "0")
        .output()
        .expect("run the cast-family alias fixture");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stdout}\n{stderr}");
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("versioned check report");
    assert_eq!(report["version"], 2);
    assert_eq!(report["status"], "agrees", "{stdout}\n{stderr}");
    assert_eq!(report["counts"]["compared"], serde_json::json!(cases));
    assert_eq!(report["counts"]["expected"], serde_json::json!(cases));
    assert_eq!(report["counts"]["functions"], serde_json::json!(functions));
    assert!(
        !stderr.contains("NTS1001") && !stderr.contains("NTS1003"),
        "the declared interface's original body must compile too: {stderr}"
    );
}
