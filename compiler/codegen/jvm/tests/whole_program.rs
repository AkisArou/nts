//! A compiled program run whole on the JVM, through `nts.rt.NtsMain`: the
//! module initializer, then the event loop to quiescence.
//!
//! Before the launcher nothing on this lane ran a program as a program --
//! the emitted `Program` has `module$init()` and no `main`, and every other
//! test here drives exported functions -- so whatever only a whole program
//! shows was invisible to every instrument. These pin the three ways a run
//! ends, each against the exit status the C lane gives: 0 for a clean run, 1
//! for an uncaught throw, 134 (C's `abort`) for a run-time refusal.

use std::process::Command;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

mod common;

/// Compile `source` as a one-file program, run it through the launcher, and
/// return `(status, stdout, stderr)`.
fn run_whole(name: &str, source: &str) -> Option<(i32, String, String)> {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP whole_program/{name}: NTS_TSGO is not set");
        return None;
    };
    let Some(java) = common::tool("java") else {
        eprintln!("SKIP whole_program/{name}: no JDK");
        return None;
    };
    let dir = std::env::temp_dir().join(format!("nts-whole-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("a temp dir");
    let fixtures = common::repository().join("tsconfig.fixtures.json");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!("{{\"extends\": {:?}, \"include\": [\"src\"]}}\n", fixtures.display().to_string()),
    )
    .expect("write tsconfig");
    std::fs::write(dir.join("src/main.ts"), source).expect("write the program");

    let tsconfig = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).expect("a UTF-8 path");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).expect("snapshot");
    assert!(!snapshot.has_errors(), "{name} should typecheck");
    let prepared = hir::prepare_with(&snapshot, &hir::Options { provider: hir::Provider::NoGc, ..hir::Options::default() })
        .expect("prepared HIR should verify");
    let emitted = nts_codegen_jvm::emit(&prepared.program);

    let out = dir.join("out");
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().expect("a class has a package")).expect("mkdir");
        std::fs::write(&path, &class.bytes).expect("write a class");
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).expect("write the jar");
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", out.display(), jar.display()))
        .args(["nts.rt.NtsMain", "nts.gen.Program"])
        .output()
        .expect("java runs");
    Some((
        ran.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&ran.stdout).into_owned(),
        String::from_utf8_lossy(&ran.stderr).into_owned(),
    ))
}

#[test]
fn a_clean_run_evaluates_the_module_then_drains_the_loop() {
    let Some((status, stdout, stderr)) = run_whole(
        "clean",
        "let total = 0;\nfor (let i = 0; i < 4; i++) total += i;\nconsole.log(\"total\", total);\n\
         setTimeout(() => console.log(\"timer\", total * 2), 0);\nconsole.log(\"end of module\");\n",
    ) else {
        return;
    };
    assert_eq!(status, 0, "a clean run exits 0: {stderr}");
    assert_eq!(stdout, "total 6\nend of module\ntimer 12\n", "node's order: the module, then the timer");
}

#[test]
fn an_uncaught_throw_at_module_scope_exits_one() {
    let Some((status, stdout, stderr)) =
        run_whole("throw", "console.log(\"before\");\nthrow new RangeError(\"at module scope\");\n")
    else {
        return;
    };
    assert_eq!(status, 1, "C and node both exit 1: {stderr}");
    assert_eq!(stdout, "before\n");
    assert_eq!(stderr.trim(), "nts: uncaught RangeError: at module scope");
}

#[test]
fn a_run_time_refusal_exits_as_c_aborts() {
    let Some((status, stdout, stderr)) = run_whole(
        "refusal",
        "function big(a: bigint, b: bigint): boolean {\n  return a > b;\n}\n\
         console.log(\"start\");\nconsole.log(big(10n ** 30n, 5n));\n",
    ) else {
        return;
    };
    assert_eq!(status, 134, "C's `abort()` status: {stderr}");
    assert_eq!(stdout, "start\n");
    assert!(
        stderr.starts_with("nts: refused at run time: `big` was declined"),
        "the line C prints, naming the declined function: {stderr}"
    );
}
