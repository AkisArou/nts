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

    // Bounded, because a suite can fail by *hanging*. Sabotaging the erased
    // retain into a no-op frees a payload something still points at, and the
    // allocator then loops rather than crashing -- so the strongest sabotage of
    // the three produced no output, no failing exit, and no end. A harness that
    // waits forever cannot report that.
    let run = std::process::Command::new("timeout")
        .arg("120")
        .arg(&binary)
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
        checks(&report) >= 10,
        "expected at least 10 ordering checks, saw {}:\n{report}",
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
fn an_erased_value_keeps_its_tag_across_a_promise() {
    // Reference counting, because half the suite is about what a promise
    // retains: under NoGC nothing is ever released and the counts it compares
    // would all be trivially equal.
    //
    // What it is really checking is that the tag survives. Five tags share two
    // payload slots, so a boolean and a number are both a double and a string
    // and an object are both a pointer -- and `typeof` on the far side of an
    // `await` is only right because the tag is recorded beside them.
    let report = run_suite("erased", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 20,
        "expected at least 20 erased-value checks, saw {}:\n{report}",
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
        checks(&report) >= 13,
        "expected at least 13 host checks, saw {}:\n{report}",
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
        checks(&report) >= 8,
        "expected at least 8 timer checks, saw {}:\n{report}",
        checks(&report)
    );
}

/// An erased value holding a reference, counted and traced.
///
/// Reference counting, because that is the whole subject: under `NoGC` nothing is
/// ever released, so every check here would pass against a runtime that had
/// never learned any of it. The differential harness runs `NoGC`, which is why
/// this cannot be an example.
#[test]
fn an_erased_reference_is_counted_and_traced() {
    let report = run_suite("erased_refs", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 10,
        "expected at least 10 erased-reference checks, saw {}:\n{report}",
        checks(&report)
    );
}

#[test]
fn a_grown_array_gives_its_elements_back() {
    // Reference counting, because the whole question is what reclamation
    // returns, and NoGC returns nothing on purpose.
    //
    // This one is not about ordering. It is here because the leak it covers
    // was invisible to every other measurement in the tree: `nts_live_bytes`
    // did not count an array's element block, so a program that leaked every
    // one it ever grew reported holding exactly what it should. The suite
    // asserts live bytes come back to their baseline, which is a claim the
    // accounting only supports since the block started being counted.
    let report = run_suite("storage", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 6,
        "expected at least 6 storage checks, saw {}:\n{report}",
        checks(&report)
    );
}

/// A date, whose whole content is a time value.
#[test]
fn a_date_normalises_its_argument() {
    // `TimeClip` is the whole of what a `Date` does to its argument, and every
    // expected value was read off node. Both halves are observable: truncation
    // toward zero makes `new Date(1.5).getTime()` 1, and the range check makes
    // `new Date(8.64e15 + 1).getTime()` NaN rather than a large number.
    //
    // One of those expectations was wrong when written -- I put `1900-03-01`
    // where node says `1900-02-28`, from memory, in a file whose own comment
    // claimed the values came from the oracle. The implementation had agreed
    // with node all along.
    let report = run_suite("dates", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 11,
        "expected at least 11 date checks, saw {}:\n{report}",
        checks(&report)
    );
}

/// A symbol, whose identity is the address of its cell.
#[test]
fn a_symbol_is_the_address_of_its_own_cell() {
    // Reference counting, because the interesting half is what the registry
    // holds: a registered symbol is reachable for the life of the runtime by
    // the specification's own rule, which is the whole difference between
    // `Symbol.for("a")` and `Symbol("a")`.
    //
    // The map cases are the point. `Map<string | symbol, V>` is what
    // `EventEmitter._events` is and what 318 refusal sites in `runtime/node`
    // are waiting on, and it passes with **no symbol-specific code in the map**
    // -- `nts_hash_key` already hashes an unrecognised reference by its pointer
    // and `nts_key_eq` already compares one by its pointer. Two fallbacks
    // written to be general, now load-bearing for a type they predate.
    let report = run_suite("symbols", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 20,
        "expected at least 20 symbol checks, saw {}:\n{report}",
        checks(&report)
    );
}

#[test]
fn the_map_table_agrees_with_node() {
    // Reference counting: half the suite is what the table retains and gives
    // back, and NoGC releases nothing.
    //
    // Every expected answer in it was transcribed from node rather than from
    // this implementation, which earned its keep immediately: `set` stored the
    // key it was given, and the spec normalizes `-0` to `+0` at insertion. Every
    // lookup still found it, so only the oracle could have said so.
    let report = run_suite("hashmap", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 30,
        "expected at least 30 map checks, saw {}:\n{report}",
        checks(&report)
    );
}

/// The cycle collector, on heap states built by hand.
///
/// Reference counting, necessarily: there is no collector without it.
///
/// The odd one out in this file, because it has no oracle to transcribe from —
/// node has no observable cycle collector. What it checks instead is the
/// property the whole provider rests on: memory comes back, and nothing that is
/// still pointed at goes away. Both checks are regressions of one ordering bug
/// that leaked a link out of every head-first list and, in a heap one shape
/// further along, freed an object a live candidate still held.
/// Six contracts the runtime states, each of which it once broke.
///
/// Reference counting, because four of the six are about what a retain, a
/// release or a clear does — and under `NoGC` none of them does anything.
///
/// They are one suite because they share a shape rather than a subject: a
/// promise made in the header or a comment, kept by a line somewhere else, with
/// nothing asking whether the two still agree. An external audit found all six
/// at `ce2b57a`; every one was reproduced against this runtime before its
/// repair, and reverting any one of them fails this suite.
///
/// The seventh check runs as its own process because it is expected to
/// **abort**: `2^127` is the one bigint value that must be refused, a refusal
/// is a message and `abort`, and the version that admitted it converted an
/// out-of-range double to `__int128` instead.
#[test]
fn the_runtime_keeps_the_contracts_its_header_states() {
    let report = run_suite("contracts", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 20,
        "expected at least 20 contract checks, saw {}:\n{report}",
        checks(&report)
    );
}

/// And the endpoint it must refuse is refused rather than converted.
///
/// Separate because a refusal aborts, so it cannot share a process with the
/// checks above. What makes this a real check rather than an assertion about a
/// message is that the old code *did not* abort here: it converted `2^127` to a
/// signed 128-bit integer, which is undefined, and returned.
#[test]
fn the_bigint_upper_endpoint_is_refused_rather_than_converted() {
    let root = repository();
    let runtime = root.join("runtime/c");
    let out = std::env::temp_dir().join(format!("nts-contracts-abort-{}", std::process::id()));
    std::fs::create_dir_all(&out).expect("a build directory");
    let binary = out.join("contracts");
    let compile = std::process::Command::new("clang")
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror", "-O1"])
        .arg("-DNTS_PROVIDER_RC")
        .arg("-I")
        .arg(&runtime)
        .arg("-o")
        .arg(&binary)
        .arg(runtime.join("tests/contracts.c"))
        .arg(runtime.join("nts_test_host.c"))
        .arg(runtime.join("nts_runtime.c"))
        .arg("-lm")
        .output()
        .expect("clang should run");
    assert!(
        compile.status.success(),
        "the contracts suite did not compile:\n{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let run = std::process::Command::new("timeout")
        .args(["120"])
        .arg(&binary)
        .arg("abort")
        .output()
        .expect("the suite should run");
    assert!(
        !run.status.success(),
        "2^127 was converted rather than refused"
    );
    let said = String::from_utf8_lossy(&run.stderr);
    assert!(
        said.contains("outside the 128 bits a bigint has"),
        "the refusal should name the reason:\n{said}"
    );
}

#[test]
fn the_collector_reclaims_a_chain_and_keeps_what_is_still_held() {
    let report = run_suite("cycles", &["-DNTS_PROVIDER_RC"]);
    assert!(
        checks(&report) >= 3,
        "expected at least 3 collector checks, saw {}:\n{report}",
        checks(&report)
    );
}
