//! The runtime's own ordering suites, compiled and run.
//!
//! # Why it lives here
//!
//! `runtime/c/tests/checkpoint.c` is a C program, and it needs a cargo test to
//! run in the workspace gate. This crate already owns the C toolchain plumbing
//! and the runtime source constant, so it is the cheapest home rather than the
//! most obvious one. A `runtime` crate of its own would be tidier and would
//! mean editing the workspace manifest, which another session owns.
//!
//! # What it checks
//!
//! Ordering, which is the one part of the async stack where a wrong answer
//! looks exactly like a right one. Every expected sequence in the C file is
//! transcribed from node — the program that produced it is in the comment
//! beside it — so this is a differential with the oracle's answers written
//! down, not a test of what the implementation happens to do.

use std::path::{Path, PathBuf};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Compile one of the C suites and run it, returning what it printed.
///
/// `provider` is the memory provider to build against: the promise suite
/// measures live bytes, which only reference counting keeps.
fn run_suite(name: &str, provider: &[&str]) -> String {
    let root = repository();
    let runtime = root.join("runtime/c");
    let out = std::env::temp_dir().join(format!("nts-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&out).expect("a build directory");
    let binary = out.join(name);

    let compile = std::process::Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-O1"])
        .args(provider)
        .arg("-I")
        .arg(&runtime)
        .arg("-o")
        .arg(&binary)
        .arg(runtime.join(format!("tests/{name}.c")))
        .arg(runtime.join("nts_test_host.c"))
        .arg(runtime.join("nts_runtime.c"))
        .arg("-lm")
        .output()
        .expect("clang should run");
    assert!(
        compile.status.success(),
        "the {name} suite did not compile:\n{}",
        String::from_utf8_lossy(&compile.stderr)
    );

    let run = std::process::Command::new(&binary)
        .output()
        .expect("the suite should run");
    let report = String::from_utf8_lossy(&run.stdout).into_owned();
    assert!(
        run.status.success(),
        "the {name} suite disagrees with node:\n{report}"
    );
    report
}

/// How many checks a report says it ran.
///
/// Asserted against a floor, because a suite that stopped running its checks
/// would otherwise pass on an empty report -- which is the failure this whole
/// file exists to make impossible for the thing it tests.
fn checks(report: &str) -> usize {
    report
        .lines()
        .filter(|line| line.starts_with("ok "))
        .count()
}

#[test]
fn the_checkpoint_orders_ticks_microtasks_and_macrotasks_as_node_does() {
    let report = run_suite("checkpoint", &[]);
    assert!(
        checks(&report) >= 8,
        "expected at least 8 ordering checks, saw {}:\n{report}",
        checks(&report)
    );
}

#[test]
fn promises_resolve_in_the_order_node_resolves_them() {
    // Reference counting, because one of the checks is that the reaction chain
    // gives its memory back, and under NoGC nothing does.
    let report = run_suite("promises", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 10,
        "expected at least 10 promise checks, saw {}:\n{report}",
        checks(&report)
    );
}

#[test]
fn combinators_settle_in_the_order_node_settles_them() {
    // Reference counting, and the suite collects cycles before it measures:
    // a combinator, its slots and its result promise form one.
    let report = run_suite("combinators", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 7,
        "expected at least 7 combinator checks, saw {}:\n{report}",
        checks(&report)
    );
}
