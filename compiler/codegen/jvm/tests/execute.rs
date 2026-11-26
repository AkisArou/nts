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
//! indistinguishable from a pass.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;
use std::path::{Path, PathBuf};

use crate::common;

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
    let found = nts_codegen_jvm::toolchain::command("sh")
        .arg("-c")
        .arg(format!("command -v {name}"))
        .output()
        .ok()?;
    found
        .status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&found.stdout).trim().to_owned()))
}

/// Compile `tests/programs/<example>` through this backend, run `body` against it,
/// and return what it printed.
///
/// `body` is the inside of a `main`, so a test reads as the Java it drives with
/// rather than as a string-building exercise.
fn run(example: &str, body: &str) -> Option<String> {
    run_project(
        &repository().join("tests/programs").join(example),
        example,
        body,
    )
    .map(|(out, _)| out)
}

/// [`run`] for the project at `project`, named `example` in messages and
/// scratch, answering what it printed and the bytes of the classes it ran.
fn run_project(project: &Path, example: &str, body: &str) -> Option<(String, Vec<Vec<u8>>)> {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else {
        eprintln!("SKIP execute/{example}: no JDK");
        return None;
    };

    let tsconfig = Utf8PathBuf::from_path_buf(
        project
            .join("tsconfig.json")
            .canonicalize()
            .expect("the example is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{example} should typecheck");

    // Prepared as this lane ships (`common::prepare`): the host's collector
    // owns these objects, so preparation counts nothing, and a `Retain` the
    // middle end emits regardless -- `hir::suspend`'s -- is dropped with its
    // `Release`.
    let prepared = common::prepare(&snapshot).expect("prepared HIR should verify");

    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(
        emitted.diagnostics.is_empty(),
        "the backend declined {} function(s) in {example}: {}",
        emitted.diagnostics.len(),
        emitted
            .diagnostics
            .iter()
            .map(|it| it.message.clone())
            .collect::<Vec<_>>()
            .join("; ")
    );

    let dir = crate::scratch::StdScratchDir::path_in_std_target(&format!("nts-execute-{example}"));
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
    std::fs::write(
        &driver,
        format!("public class Drive {{ public static void main(String[] a) {{\n{body}\n}} }}\n"),
    )
    .expect("write the driver");
    let compiled = nts_codegen_jvm::toolchain::command(&javac)
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
    let ran = nts_codegen_jvm::toolchain::command(&java)
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
    Some((
        String::from_utf8_lossy(&ran.stdout).into_owned(),
        emitted
            .classes
            .iter()
            .map(|class| class.bytes.clone())
            .collect(),
    ))
}

/// The five arithmetic operators, and the two that answer a boolean.
///
/// Every expected value is read off `tests/programs/arith/src/main.ts`, which is one
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

/// Set iteration and Map values use the same int32 cursor ABI end to end.
#[test]
fn map_and_set_walks_use_the_runtime_cursor_contract() {
    let Some(out) = run(
        "a-set-walked-by-its-cursor",
        r#"    for (int n = -14; n <= 14; ++n) {
        if (nts.gen.Program.walked(n) != (n & 63) / 2) {
            throw new AssertionError("Set cursor at " + n);
        }
        if (nts.gen.Program.listed(n) != 2 * (n & 15)) {
            throw new AssertionError("Map key/value cursors at " + n);
        }
    }
    System.out.println("PASS");"#,
    ) else {
        return;
    };
    assert_eq!(out, "PASS\n");
}

/// Whether any of `classes` names `member` in its constant pool: which of
/// `NtsJson`'s two tape forms a program calls.
fn names(classes: &[Vec<u8>], member: &str) -> bool {
    classes.iter().any(|bytes| {
        bytes
            .windows(member.len())
            .any(|window| window == member.as_bytes())
    })
}

/// A typed `JSON.parse`'s errors on this lane, where node cannot be the
/// oracle: its `as` checks nothing. The same program and the same words as
/// the C lane's `execute.rs`: the `TypeError` names the JSON path and what was
/// expected there, invalid text is V8's `SyntaxError` before any mismatch, and
/// a parse in a helper throws through the call to its caller's handler. It
/// grows no array, so its tape is a bare `double[]` (`NtsJson.tape`).
#[test]
fn a_typed_json_parse_names_the_path_it_mismatches() {
    let Some((out, classes)) = run_project(
        &repository()
            .join("compiler/core/tests/programs/a-json-parse-names-the-path-it-mismatches"),
        "a-json-parse-names-the-path-it-mismatches",
        "    for (int n = 0; n < 9; n++) nts.gen.Program.report(n);",
    ) else {
        return;
    };
    assert_eq!(
        out,
        "parsed 1 true 1 true\n\
        TypeError: JSON.parse as Row: $.id: expected a number, found a string\n\
        TypeError: JSON.parse as Row: $.name: expected a string or null, found a number\n\
        TypeError: JSON.parse as Row: $.tags[1]: expected a string, found a number\n\
        TypeError: JSON.parse as Row: $.inner.tag[\"odd key\"]: expected a number, found a string\n\
        TypeError: JSON.parse as Row: $.inner: missing the property \"ok\"\n\
        TypeError: JSON.parse as Row: $: missing the property \"inner\"\n\
        TypeError: JSON.parse as Row: $: expected an object, found an array\n\
        SyntaxError: Expected ',' or '}' after property value in JSON at position 52 (line 1 column 53)\n"
    );
    assert!(
        !names(&classes, "tapeArray"),
        "a program that grows no array reads a bare tape"
    );
}

/// The same reads where the program's arrays grow, so every `number[]` is an
/// `NtsArrayD` and the scan answers `NtsJson.tapeArray`: the other overload
/// of each kernel, an escaped key decoded before it is compared, and a path
/// into an array of strings.
#[test]
fn a_typed_json_parse_reads_a_growable_tape() {
    let Some((out, classes)) = run_project(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/json-parse-grows"),
        "json-parse-grows",
        "    for (int n = 0; n < 5; n++) nts.gen.Program.report(n);",
    ) else {
        return;
    };
    assert_eq!(
        out,
        "parsed 1 a,b true\n\
        TypeError: JSON.parse as Row: $.tags[1]: expected a string, found a number\n\
        TypeError: JSON.parse as Row: $.inner: missing the property \"ok\"\n\
        SyntaxError: Expected ',' or '}' after property value in JSON at position 18 (line 1 column 19)\n\
        parsed 2 \u{e9} false\n"
    );
    assert!(
        names(&classes, "tapeArray"),
        "a program whose arrays grow reads an NtsArrayD tape"
    );
}
