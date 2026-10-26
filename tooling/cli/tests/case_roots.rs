//! The gate's cargo tests also execute the conformance input-root contracts.

use std::path::Path;
use std::process::Command;

fn repository() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repository")
}

#[test]
fn content_addressed_case_roots_obey_their_contracts() {
    let repo = repository();
    let output = Command::new("node")
        .args(["--test", "tooling/census/project.test.ts"])
        .current_dir(repo)
        .output()
        .expect("node must be installed for the conformance runner");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_materialised_case_has_identical_native_captures_at_one_and_four_checkers() {
    assert_frontend_capture("assert.sameValue(1, 1);", 0);
}

#[test]
fn native_checker_errors_keep_their_count_diagnostics_and_exit() {
    // Plain-JS mode filters type-only errors; TS1189 is a real early error.
    assert_frontend_capture(
        "for (const key = 0 in {}) {} for (const other = 0 in {}) {}",
        2,
    );
}

#[test]
fn frontend_load_failure_is_distinct_from_completed_diagnostics() {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("frontend")
        .arg(repository().join(format!(
            "target/missing-frontend-status-config-{}.json",
            std::process::id()
        )))
        .arg("--no-acquire")
        .output()
        .expect("frontend load failure");
    assert_eq!(output.status.code(), Some(1));
}

fn assert_frontend_capture(text: &str, errors: usize) {
    let repo = repository();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let base = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("live-case-root-{}-{unique}", std::process::id()));
    let roots = base.join("inputs");
    let script = "import {caseRoot,workspace,materialise} from './tooling/census/project.ts';\n\
                  const result=caseRoot(d=>{workspace(d);materialise(d,process.argv[2]);},{base:process.argv[1]});\n\
                  process.stdout.write(JSON.stringify(result));";
    let output = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .arg(&roots)
        .arg(text)
        .current_dir(&repo)
        .output()
        .expect("materialise");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let case: serde_json::Value = serde_json::from_slice(&output.stdout).expect("case root");
    let config = Path::new(case["root"].as_str().expect("root")).join("tsconfig.json");
    let run = |checkers: u16| {
        let output = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("frontend")
            .arg(&config)
            .env("NTS_CHECKERS", checkers.to_string())
            .current_dir(&repo)
            .output()
            .expect("frontend");
        assert_eq!(
            output.status.code(),
            Some(if errors == 0 { 0 } else { 2 }),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let text = String::from_utf8(output.stdout).expect("frontend text");
        let field = |name: &str| {
            text.lines()
                .find_map(|line| line.strip_prefix(name))
                .expect("frontend field")
                .trim()
                .to_owned()
        };
        let nodes = field("nodes captured")
            .parse::<u64>()
            .expect("captured node count");
        let diagnostics = text
            .lines()
            .filter(|line| line.starts_with("  Error TS"))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(diagnostics.len(), errors, "all subject errors are reached");
        let stderr = String::from_utf8(output.stderr).expect("stderr");
        if errors > 0 {
            assert_eq!(
                stderr,
                format!("Error: {errors} type error(s); refusing to proceed\n")
            );
        }
        (
            nodes,
            field("snapshot digest"),
            output.status.code(),
            diagnostics,
            stderr,
        )
    };
    let first = run(1);
    let repeated = run(1);
    let four = run(4);
    assert!(
        first.0 > 0,
        "each request must capture the materialized program"
    );
    assert_eq!(
        first, repeated,
        "repeating a native capture changes no facts"
    );
    assert_eq!(first, four, "checker count changes no facts or diagnostics");
    let cleanup = "import {collectCaseRoots} from './tooling/census/project.ts'; collectCaseRoots({base:process.argv[1],now:Date.now()+60000,maxAge:0});";
    let status = Command::new("node")
        .args(["--input-type=module", "-e", cleanup])
        .arg(&roots)
        .current_dir(&repo)
        .status()
        .expect("collect readonly root");
    assert!(status.success());
    std::fs::remove_dir_all(base).expect("remove scratch");
}
