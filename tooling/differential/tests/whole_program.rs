//! Whether a program with no case to call is compared whole, end to end.
//!
//! `nts check` on a program that exports nothing used to answer "nothing to
//! check" and compare nothing at all, however wrong its output. Each program
//! here is compiled, run once on the backend and once under node, and the
//! check's own JSON is read: stdout and exit status agree, or the program is
//! refused by name. Its siblings differ from it in one thing each:
//!
//! - `prints` agrees on every backend: lines, a microtask and timers that
//!   only a drained loop reaches.
//! - `throws` ends with an uncaught throw: status 1 on both sides, an answer.
//! - `reads-a-clock` reads `Date.now`, which the deterministic host cannot
//!   run as the shipped program would: refused by name, never passed.
//! - `exits` calls `process.exit(3)`, an explicit status no harness models:
//!   refused by name.
//! - `refused-initializer` has a module-scope initializer lowering refuses,
//!   which evaluation skips: refused by name, not a missing line.
//!
//! The comparison's own controls -- one line different, another status, a
//! signal, a run past its allowance -- are the unit tests in
//! `src/whole_program.rs`, which feed it the runs those programs would make.
//!
//! Requires the compiled nts under test (`NTS_BIN`) and the prepared oracle
//! that `tooling/gate/inner.ts` seals.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn binary() -> PathBuf {
    let path = std::env::var("NTS_BIN")
        .map_or_else(|_| repository().join("target/release/nts"), PathBuf::from);
    assert!(
        path.is_file(),
        "build the compiler under test or set NTS_BIN: {}",
        path.display()
    );
    path
}

/// A project of one `src/main.ts`, under the fixtures' own configuration.
fn project(root: &Path, name: &str, source: &str, node_types: bool) -> PathBuf {
    let directory = root.join(name);
    std::fs::create_dir_all(directory.join("src")).unwrap();
    std::fs::write(directory.join("src/main.ts"), source).unwrap();
    let repository = repository().canonicalize().unwrap();
    let mut config = serde_json::json!({
        "extends": repository.join("tsconfig.fixtures.json"),
        "include": ["src"],
    });
    if node_types {
        config["compilerOptions"] = serde_json::json!({
            "types": ["node"],
            "typeRoots": [repository.join("node_modules/@types")],
        });
    }
    let tsconfig = directory.join("tsconfig.json");
    std::fs::write(&tsconfig, config.to_string()).unwrap();
    tsconfig
}

/// The check's JSON report and its exit status, on `backend`.
fn check(tsconfig: &Path, backend: &str) -> (serde_json::Value, bool) {
    let output = std::process::Command::new(binary())
        .arg("check")
        .arg(tsconfig)
        .arg("--json")
        .env("NTS_BACKEND", backend)
        .output()
        .unwrap();
    let report = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "{backend}: no JSON report ({error}): {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    (report, output.status.success())
}

/// A scratch directory this test owns for as long as the value lives.
fn scratch(name: &str) -> crate::scratch::StdScratchDir {
    crate::scratch::StdScratchDir::in_std_target(name)
}

#[test]
fn a_whole_program_agrees_on_every_backend_and_its_status_is_an_answer() {
    let root = scratch("nts-whole-program-agrees");
    let prints = project(
        &root,
        "prints",
        "console.log(\"hello, world\");\n\
         console.log([1, 2, 3].map((x) => x * 2).join(\",\"));\n\
         Promise.resolve(7).then((v) => console.log(\"then\", v));\n\
         setTimeout(() => console.log(\"later\"), 20);\n\
         setTimeout(() => console.log(\"sooner\"), 5);\n\
         console.log(\"end of module\");\n",
        false,
    );
    let throws = project(
        &root,
        "throws",
        "console.log(\"before\");\nthrow new Error(\"boom\");\n",
        false,
    );
    for backend in ["c", "llvm", "jvm"] {
        for tsconfig in [&prints, &throws] {
            let (report, succeeded) = check(tsconfig, backend);
            assert!(
                succeeded && report["status"] == "agrees",
                "{backend} {}: {report}",
                tsconfig.display()
            );
            assert_eq!(report["counts"]["programs"], 1, "{backend}: {report}");
            assert_eq!(report["counts"]["functions"], 0, "{backend}: {report}");
            assert_eq!(report["counts"]["compared"], 1, "{backend}: {report}");
        }
    }
}

#[test]
fn a_whole_program_the_deterministic_host_cannot_run_is_refused_by_name() {
    let root = scratch("nts-whole-program-refused");
    let clock = project(
        &root,
        "reads-a-clock",
        "const start = Date.now();\nsetTimeout(() => console.log(Date.now() - start >= 5), 5);\n",
        false,
    );
    let exits = project(
        &root,
        "exits",
        "import process from \"node:process\";\nconsole.log(\"before\");\nprocess.exit(3);\n",
        true,
    );
    // An initializer lowering refuses is skipped by evaluation, so node's
    // "init" line would be missing: refused by name, never a wrong answer.
    let initializer = project(
        &root,
        "refused-initializer",
        "function log(s: string): number { console.log(s); return 1; }\n\
         const unused = log(\"init\") + new Function(\"return 1\")();\n\
         console.log(\"end\");\n",
        false,
    );
    for (tsconfig, name) in [
        (&clock, "`Date.now`"),
        (&exits, "`process.exit`"),
        (&initializer, "a computed callee"),
    ] {
        let (report, succeeded) = check(tsconfig, "c");
        assert!(!succeeded, "{report}");
        assert_eq!(report["status"], "error", "{report}");
        assert_eq!(report["error"]["kind"], "backend_declined", "{report}");
        assert!(
            report["error"]["message"]
                .as_str()
                .unwrap()
                .contains("a whole program is compared whole"),
            "{report}"
        );
        assert!(
            report["refusals"]
                .as_array()
                .unwrap()
                .iter()
                .any(|refusal| refusal["message"].as_str().unwrap().contains(name)),
            "{name} is named: {report}"
        );
    }
}

/// A refusal no evaluation reaches cannot change what a whole program prints,
/// so it is compared: an exported generic no call instantiates is refused (the
/// shape of `tests/programs/advanced`), and the program agrees. The control
/// differs in one thing, a refusal reached at run time: `xs.at(5)!` stops the
/// run with its `nts: refused` line, which declines -- never a disagreement,
/// and never agreement.
#[test]
fn only_a_refusal_the_run_reaches_keeps_a_whole_program_from_agreeing() {
    let root = scratch("nts-whole-program-reach");
    let unreached = project(
        &root,
        "unreached",
        "export function identity<T>(value: T): T { return value; }\n\
         console.log(\"before\");\n\
         console.log([1, 2].at(1)! + 1);\n",
        false,
    );
    let reached = project(
        &root,
        "reached",
        "const xs: number[] = [1, 2];\n\
         function pick(at: number): number { return xs.at(at)!; }\n\
         console.log(\"before\");\n\
         console.log(pick(5) + 1);\n",
        false,
    );
    let (report, succeeded) = check(&unreached, "c");
    assert!(succeeded && report["status"] == "agrees", "{report}");
    assert!(
        !report["refusals"].as_array().unwrap().is_empty(),
        "the generic export is still refused, though nothing runs it: {report}"
    );
    let (report, succeeded) = check(&reached, "c");
    assert!(!succeeded, "{report}");
    assert_eq!(report["status"], "all_declined", "{report}");
    assert_eq!(report["counts"]["runtime_declined"], 1, "{report}");
    assert_eq!(report["counts"]["disagreements"], 0, "{report}");
}
