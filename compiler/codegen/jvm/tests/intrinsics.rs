//! TypeScript compiled to JVM, calling the fixed networking intrinsics.
//!
//! # Why this test exists when nine others already drive the same code
//!
//! The plan says host Java tests alone are insufficient, and it is right in a
//! way that is easy to miss: `transport.rs`, `environment.rs`, `gzip.rs` and
//! the rest all call `nts.rt` from a Java `main`. Every one of them would stay
//! green if the JVM backend could not emit a call to the runtime at all. What
//! sits between a working runtime and a program that can reach it is one table
//! -- `ops::web_external` -- and a name missing from it is a refusal that no
//! amount of Java testing can see. It was missing until this test existed, and
//! the four refusals it produced are quoted in the record.
//!
//! # The direction is the point
//!
//! Java opens the sockets and the compiled TypeScript counts them. State
//! created on one side of the intrinsic boundary is observed on the other, so a
//! wrong entry -- a name mapped to some other method that also returns a
//! `double` -- changes a number rather than nothing. The fixture existed for a
//! minute in a form where every function returned zero, which would have passed
//! against a table with all four names mapped wrongly.
//!
//! # Four of nine
//!
//! `runtime/web-platform/android/intrinsics.d.ts` declares nine. Five take an
//! environment handle or a byte view; there is no common environment type and
//! `ManagedType::View` does not exist, so those five cannot be written in
//! TypeScript yet. They are named as gated there and absent here, rather than
//! left to look like the four that work are all there ever were.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
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

/// What the driver must print. Three connections rather than one, because one
/// would not tell a count from a boolean and two would not tell a count from a
/// toggle; and `changed` twice, because the second sweep has nothing to close
/// and must say so rather than repeat the first answer.
const EXPECTED: &str = "\
open 3
after close 2
after cancel 2
changed 2
open 0
changed 0
";

#[test]
fn typescript_reaches_the_provider_through_the_intrinsic_table() {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        // Announced, because a skip that prints nothing is indistinguishable
        // from a pass.
        eprintln!("SKIP intrinsics: NTS_TSGO is not set");
        return;
    };
    if !tsgo.exists() {
        eprintln!("SKIP intrinsics: no tsgo at {tsgo}");
        return;
    }
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else {
        eprintln!("SKIP intrinsics: no JDK");
        return;
    };

    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/intrinsics");
    let tsconfig = Utf8PathBuf::from_path_buf(
        fixture.join("tsconfig.json").canonicalize().expect("fixture is checked in"),
    )
    .expect("a UTF-8 path");

    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).expect("snapshot");
    assert!(!snapshot.has_errors(), "the intrinsics fixture should typecheck");

    // `NoGc`, which is what this lane ships: a tracing collector owns these
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
        "the backend declined {}: {}",
        emitted.diagnostics.len(),
        emitted
            .diagnostics
            .iter()
            .map(|it| it.message.clone())
            .collect::<Vec<_>>()
            .join("; ")
    );

    let dir = std::env::temp_dir().join(format!("nts-intrinsics-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a temp dir");

    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().expect("a class has a package")).expect("mkdir");
        std::fs::write(&path, &class.bytes).expect("write a class");
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).expect("write the jar");

    let compiled = Command::new(&javac)
        .args(["--release", "8", "-Xlint:all,-options", "-Werror", "-cp"])
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(fixture.join("Drive.java"))
        .output()
        .expect("javac runs");
    assert!(
        compiled.status.success(),
        "the driver should compile: {}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    // `-Xverify:all` because the verifier is a free second opinion on the
    // StackMapTable, and because a class this backend wrote is the one in the
    // classpath that has not been through `javac`.
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", dir.display(), jar.display()))
        .arg("Drive")
        .current_dir(repository())
        .output()
        .expect("java runs");
    let out = String::from_utf8_lossy(&ran.stdout);
    assert!(
        ran.status.success(),
        "the driver should exit cleanly: {}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert_eq!(out, EXPECTED, "stderr: {}", String::from_utf8_lossy(&ran.stderr));

    let _ = std::fs::remove_dir_all(&dir);
}
