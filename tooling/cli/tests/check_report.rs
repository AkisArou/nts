//! The public JSON command accounts for source calls even without native bindings.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Project(PathBuf);

impl Project {
    fn new(source: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "nts-check-report-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        std::fs::write(
            path.join("tsconfig.json"),
            serde_json::json!({"extends": root.join("tsconfig.fixtures.json"), "files": ["main.ts"]})
                .to_string(),
        )
        .unwrap();
        std::fs::write(path.join("main.ts"), source).unwrap();
        Self(path)
    }

    fn check(&self) -> (bool, serde_json::Value) {
        let output = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["check", "--json", "--no-acquire"])
            .arg(self.0.join("tsconfig.json"))
            .env("NTS_BACKEND", "c")
            .env("NTS_CHECKERS", "1")
            .env_remove("NTS_RC")
            .env_remove("NTS_KEEP_TEMP")
            .output()
            .unwrap();
        let report = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
            panic!(
                "public command must emit exactly one JSON report: {error}\n{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        });
        (output.status.success(), report)
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// Eval is a permanent language boundary, not a feature awaiting implementation.
const REFUSED: &str =
    "export function refused(n: number): number { return eval('n + 1') as number; }";
const CONTROL: &str = "export function control(n: number): number { return n + 1; }";

#[test]
fn all_unavailable_has_a_complete_nonempty_node_population() {
    let (success, report) = Project::new(REFUSED).check();
    assert!(success, "{report}");
    assert_eq!(report["version"], 2);
    assert_eq!(report["status"], "all_unavailable");
    assert_eq!(report["counts"]["functions"], 1);
    assert_eq!(report["counts"]["expected"], 29);
    assert_eq!(report["counts"]["compared"], 0);
    assert_eq!(report["counts"]["unavailable"], 29);
    assert_eq!(report["counts"]["runtime_declined"], 0);
    assert_eq!(report["oracle"]["expected"], 29);
    assert_eq!(report["oracle"]["received"], 29);
    assert_eq!(report["oracle"]["complete"], true);
    assert_ne!(
        report["refusals"].as_array().unwrap().as_slice(),
        &[] as &[serde_json::Value]
    );
}

#[test]
fn the_one_difference_direct_expression_control_agrees() {
    let (success, report) = Project::new(CONTROL).check();
    assert!(success, "{report}");
    assert_eq!(report["status"], "agrees");
    assert_eq!(report["counts"]["expected"], 29);
    assert_eq!(report["counts"]["compared"], 29);
    assert_eq!(report["counts"]["unavailable"], 0);
    assert_eq!(report["oracle"]["received"], 29);
}

#[test]
fn mixed_availability_never_drops_the_refused_source_export() {
    let (success, report) = Project::new(&format!("{REFUSED}\n{CONTROL}")).check();
    assert!(success, "{report}");
    assert_eq!(report["status"], "partial");
    assert_eq!(report["counts"]["functions"], 2);
    assert_eq!(report["counts"]["expected"], 58);
    assert_eq!(report["counts"]["compared"], 29);
    assert_eq!(report["counts"]["unavailable"], 29);
    assert_eq!(report["counts"]["runtime_declined"], 0);
    assert_eq!(report["oracle"]["received"], 58);
    assert_eq!(report["oracle"]["complete"], true);
}

#[test]
fn a_checker_failure_has_a_structured_stage_and_nonzero_exit() {
    let (success, report) =
        Project::new("export function wrong(n: number): number { return 'wrong'; }").check();
    assert!(!success, "{report}");
    assert_eq!(report["status"], "error");
    assert_eq!(report["error"]["kind"], "typecheck");
    assert!(report["counts"].is_null());
    assert!(report["oracle"].is_null());
    assert!(
        report["refusals"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["stage"] == "typecheck" && row["code"] == "TS2322" })
    );
}
