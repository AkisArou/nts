//! TypeScript in, a running JVM program out, answers checked.
//!
//! # What this adds, and what it deliberately is not
//!
//! The plan asks for "the C lane's `execute.rs` equivalent". That file is 1,754
//! lines and calls itself "the only place that answers the question the project
//! actually asks". **On this lane that claim is not available**, and saying so
//! is the point of this comment:
//!
//! - the `jvm` gate step compiles **every** example and compares it to node;
//! - its sweep drives 10,005 generated cases through this backend;
//! - `intrinsics.rs` already compiles TypeScript, emits, and runs it, so
//!   `cargo test` is not green over a backend that emits nothing.
//!
//! So corpus-level coverage exists and this is not a second copy of it. What
//! **is** missing is construct coverage inside `cargo test`: the only program
//! compiled there drives the networking intrinsics, so an operator spelled
//! wrongly or a loop whose blocks are ordered wrongly is caught by the gate --
//! which needs node, a lock, and a quiet machine -- and by nothing a person can
//! run in a second while editing `ops.rs`.
//!
//! That is the whole of what these tests are for, and why there are a handful
//! of them rather than a corpus. Anything that wants corpus scale belongs in
//! the gate, where it already is.
//!
//! Skips loudly without `NTS_TSGO` or a JDK: a skip that prints nothing is
//! indistinguishable from a pass.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::{Path, PathBuf};
use std::process::Command;

fn repository() -> PathBuf {
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    from.canonicalize().unwrap_or(from)
}

fn tool(name: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return Some(path);
        }
    }
    let found = Command::new("sh").arg("-c").arg(format!("command -v {name}")).output().ok()?;
    found
        .status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&found.stdout).trim().to_owned()))
}

/// Compile `examples/<example>` through this backend, run `body` against it,
/// and return what it printed.
///
/// `body` is the inside of a `main`, so a test reads as the Java it drives with
/// rather than as a string-building exercise.
fn run(example: &str, body: &str) -> Option<String> {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP execute/{example}: NTS_TSGO is not set");
        return None;
    };
    if !tsgo.exists() {
        eprintln!("SKIP execute/{example}: no tsgo at {tsgo}");
        return None;
    }
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else {
        eprintln!("SKIP execute/{example}: no JDK");
        return None;
    };

    let tsconfig = Utf8PathBuf::from_path_buf(
        repository()
            .join("examples")
            .join(example)
            .join("tsconfig.json")
            .canonicalize()
            .expect("the example is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).expect("snapshot");
    assert!(!snapshot.has_errors(), "{example} should typecheck");

    // `NoGc`, which is what this lane ships: the platform collector owns these
    // objects, so `Retain` and `Release` are refused by name rather than
    // emitted as nothing.
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options { provider: hir::Provider::NoGc, ..hir::Options::default() },
    )
    .expect("prepared HIR should verify");

    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(
        emitted.diagnostics.is_empty(),
        "the backend declined {} function(s) in {example}: {}",
        emitted.diagnostics.len(),
        emitted.diagnostics.iter().map(|it| it.message.clone()).collect::<Vec<_>>().join("; ")
    );

    let dir = std::env::temp_dir()
        .join(format!("nts-execute-{example}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a temp dir");
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().expect("a class has a package")).expect("mkdir");
        std::fs::write(&path, &class.bytes).expect("write a class");
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).expect("write the jar");

    let driver = dir.join("Drive.java");
    std::fs::write(&driver, format!("public class Drive {{ public static void main(String[] a) {{\n{body}\n}} }}\n"))
        .expect("write the driver");
    let compiled = Command::new(&javac)
        .args(["--release", "8", "-Xlint:all,-options", "-Werror", "-cp"])
        .arg(format!("{}:{}", dir.display(), jar.display()))
        .arg("-d")
        .arg(&dir)
        .arg(&driver)
        .output()
        .expect("javac runs");
    assert!(
        compiled.status.success(),
        "the driver should compile: {}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    // `-Xverify:all`, because the verifier is a free second opinion on the
    // StackMapTable and these classes are the ones in the path that `javac`
    // never saw.
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", dir.display(), jar.display()))
        .arg("Drive")
        .output()
        .expect("java runs");
    assert!(
        ran.status.success(),
        "the driver should exit cleanly: {}",
        String::from_utf8_lossy(&ran.stderr)
    );
    Some(String::from_utf8_lossy(&ran.stdout).into_owned())
}

/// The five arithmetic operators, and the two that answer a boolean.
///
/// Every expected value is read off `examples/arith/src/main.ts`, which is one
/// line per function -- `return a % b;` and so on -- so none of them is a
/// number somebody remembered.
#[test]
fn arithmetic_and_comparison_answer_what_the_source_says() {
    let Some(out) = run(
        "arith",
        r"    System.out.println(nts.gen.Program.add(2.0, 3.0));
    System.out.println(nts.gen.Program.sub(2.0, 3.0));
    System.out.println(nts.gen.Program.mul(2.0, 3.0));
    System.out.println(nts.gen.Program.div(3.0, 2.0));
    System.out.println(nts.gen.Program.rem(7.0, 3.0));
    System.out.println(nts.gen.Program.lt(2.0, 3.0));
    System.out.println(nts.gen.Program.gt(2.0, 3.0));",
    ) else {
        return;
    };
    assert_eq!(out, "5.0\n-1.0\n6.0\n1.5\n1.0\ntrue\nfalse\n");
}

/// A `while` with a two-clause condition, which is the family the C lane's own
/// header singles out: "a block order ... individually well-formed and
/// collectively wrong".
///
/// `sumTo` is `while (i < n && i < 65536) { total = total + i; ... }`, so
/// `sumTo(10)` is 0 through 9 and not 1 through 10. Reading the bound off the
/// source is the difference between this test and one that asserts 55.
#[test]
fn a_loop_runs_the_number_of_times_its_condition_says() {
    let Some(out) = run(
        "loops",
        r"    System.out.println(nts.gen.Program.sumTo(10.0));
    System.out.println(nts.gen.Program.sumTo(0.0));
    System.out.println(nts.gen.Program.sumTo(1.0));",
    ) else {
        return;
    };
    assert_eq!(out, "45.0\n0.0\n0.0\n");
}
