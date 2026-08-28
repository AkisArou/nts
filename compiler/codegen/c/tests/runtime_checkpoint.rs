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
    run_suite_with(name, provider, &["nts_test_host.c"], &[])
}

/// The same, with extra runtime sources and linker flags.
///
/// The libuv host needs both, and it is the only suite that does: everything
/// else links the runtime and the deterministic host and nothing else, which
/// is the point of the deterministic host.
fn run_suite_with(name: &str, provider: &[&str], sources: &[&str], link: &[&str]) -> String {
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
        .args(sources.iter().map(|source| runtime.join(source)))
        .arg(runtime.join("nts_runtime.c"))
        .arg("-lm")
        .args(link)
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

/// The libuv host, on a real loop.
///
/// Skipped rather than failed where libuv is not installed: it is a system
/// dependency of the *host*, not of the compiler, and a machine without it can
/// still build and test everything else.
#[test]
fn the_libuv_host_keeps_the_same_contract_as_the_deterministic_one() {
    if !std::path::Path::new("/usr/include/uv.h").exists()
        && !std::path::Path::new("/usr/local/include/uv.h").exists()
    {
        eprintln!("skipping: libuv headers are not installed");
        return;
    }
    let report = run_suite_with(
        "uv_host",
        &["-DNTS_PROVIDER_RC"],
        &["nts_uv_host.c"],
        &["-luv"],
    );
    assert!(
        checks(&report) >= 11,
        "expected at least 11 host checks, saw {}:\n{report}",
        checks(&report)
    );
}

#[test]
fn timers_behave_as_the_capability_says() {
    // Reference counting, because the check that matters is that an interval
    // keeps its callback alive between rounds — under NoGC nothing is ever
    // released, so the bug it catches could not happen.
    let report = run_suite("timers", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 5,
        "expected at least 5 timer checks, saw {}:\n{report}",
        checks(&report)
    );
}
