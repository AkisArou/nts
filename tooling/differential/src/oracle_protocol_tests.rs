//! The protocol exit follows completed/awaited cases; it cannot create them.
#![allow(clippy::unwrap_used)]
use super::*;
use std::time::Duration;

fn directory(label: &str) -> Scratch {
    let path = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "nts-oracle-protocol-{label}-{}",
            std::process::id()
        ));
    std::fs::create_dir_all(&path).unwrap();
    Scratch::holding(path)
}

fn case(name: &str, asynchronous: bool) -> Testable {
    Testable {
        name: name.to_owned(),
        binding: None,
        returns: if asynchronous {
            HirType::Managed(hir::ManagedType::Promise(Box::new(HirType::NUMBER)))
        } else {
            HirType::NUMBER
        },
        result_absent: hir::Absent::Impossible,
        params: Vec::new(),
        input_pools: None,
        excluded_tuples: Vec::new(),
    }
}

fn execute(dir: &Utf8Path, module: &str, cases: &[Testable]) -> oracle_run::Finished {
    let source = dir.join("module.mjs");
    std::fs::write(&source, module).unwrap();
    let script = dir.join("driver.mjs");
    std::fs::write(
        &script,
        driver(&format!("file://{source}"), cases, Engine::Node),
    )
    .unwrap();
    let mut command = std::process::Command::new("prlimit");
    command
        .args(["--core=0", "--cpu=2:3", "node"])
        .arg(script)
        .env("NTS_DIFF_RESULTS", dir.join("results.txt"));
    oracle_run::run(command, Duration::from_secs(120)).unwrap()
}

#[test]
fn ready_results_are_counted_before_protocol_completion() {
    let scratch = directory("ready");
    let dir = &scratch.path;
    let finished = execute(
        dir,
        r#"
export function micro() { return new Promise(resolve => queueMicrotask(() => resolve(7))); }
export function immediate() { return new Promise(resolve => setImmediate(() => resolve(9))); }
export function lingering() { setTimeout(() => { throw new Error("outside protocol"); },60000); return 5; }
"#,
        &[
            case("micro", true),
            case("immediate", true),
            case("lingering", false),
        ],
    );
    assert!(finished.output.status.success(), "{:?}", finished.output);
    assert!(finished.status["stop"].is_null());
    let rows = std::fs::read_to_string(dir.join("results.txt")).unwrap();
    assert!(rows.contains("micro 0 401c000000000000"));
    assert!(rows.contains("immediate 0 4022000000000000"));
    assert!(rows.ends_with("done 3\n"));
}

#[test]
fn protocol_exit_flushes_buffered_program_output() {
    let scratch = directory("output");
    let finished = execute(
        &scratch.path,
        r#"
export function output() {
  process.stdout.write("x".repeat(2 * 1024 * 1024));
  process.stderr.write("y".repeat(2 * 1024 * 1024));
  setTimeout(() => {}, 60000);
  return 7;
}
"#,
        &[case("output", false)],
    );
    assert!(finished.output.status.success());
    assert_eq!(finished.output.stdout, vec![b'x'; 2 * 1024 * 1024]);
    assert_eq!(finished.output.stderr, vec![b'y'; 2 * 1024 * 1024]);
    let rows = std::fs::read_to_string(scratch.path.join("results.txt")).unwrap();
    assert!(rows.ends_with("done 1\n"));
}

#[test]
fn work_that_never_settles_cannot_reach_done_or_pass_as_a_prefix() {
    let scratch = directory("pending");
    let dir = &scratch.path;
    let finished = execute(
        dir,
        r#"
export function ready() { return Promise.resolve(7); }
export function pending() { queueMicrotask(() => console.log("scheduled")); return new Promise(() => {}); }
"#,
        &[case("ready", true), case("pending", true)],
    );
    assert!(!finished.output.status.success());
    assert!(finished.status["stop"].is_null());
    assert_eq!(finished.output.stdout, b"scheduled\n");
    let rows = std::fs::read_to_string(dir.join("results.txt")).unwrap();
    assert_eq!(rows, "ready 0 401c000000000000\n");
    let coverage = oracle_coverage::Coverage {
        count: 2,
        key: "test".into(),
    };
    let result =
        oracle_coverage::measured_rows(lines(rows.as_bytes()), None, &finished.status, &coverage);
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("oracle not measured")
    );
}
