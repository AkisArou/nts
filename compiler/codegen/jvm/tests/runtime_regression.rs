//! The runtime's own tests, run against the jar this crate embeds.
//!
//! # Why this exists beside the differential
//!
//! Every other check on `runtime/jvm` is *whole-program*: compile TypeScript,
//! run it, compare with node. That is the right instrument for "does the
//! compiler emit a correct program" and a poor one for "is this data structure
//! correct", because a corpus of ninety-nine examples reaches a hash table
//! through whatever handful of shapes those programs happen to use.
//!
//! These are direct: 4.6 million assertions over the map, bigint, arrays,
//! strings, promises and the timer heap, with the randomised parts grounded on
//! something independent -- 128-bit arithmetic against `BigInteger`, timer
//! ordering against a list sorted by delay and creation index, which is the
//! contract `docs/async.md` states.
//!
//! They arrived with an audit of this runtime that also proposed replacing the
//! number formatter with `Double.toString` behind a JDK-version check. That
//! part was rejected -- it is wrong on any JVM whose `Double.toString` is not
//! the shortest form, which includes ART -- but the audit found a real bug in
//! this runtime's formatter on the way, and this suite is the half of it worth
//! keeping. A package that arrives with its own tests is worth more than one
//! that arrives with its own numbers.
//!
//! Skips without a JDK, exactly as `runs.rs` and `number_to_string.rs` do.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

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

#[test]
fn the_runtime_passes_its_own_tests() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else {
        return;
    };
    let root = repository();
    let sources = root.join("runtime/jvm/tests/nts/rt");
    // The jar this crate embeds, or whichever one the caller is testing --
    // `runtime_jar.rs` regenerates it, and a stale one here would test the
    // sources against themselves.
    let jar = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);

    let dir = std::env::temp_dir().join(format!("nts-jvm-regression-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    let mut compile = Command::new(&javac);
    compile.arg("-nowarn").arg("-cp").arg(&jar).arg("-d").arg(&dir);
    for entry in std::fs::read_dir(&sources).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|it| it == "java") {
            compile.arg(path);
        }
    }
    let built = compile.output().unwrap();
    assert!(built.status.success(), "javac: {}", String::from_utf8_lossy(&built.stderr));

    let ran = Command::new(&java)
        // Assertions on: the suite says it runs either way, and a `-ea` run is
        // the one that also exercises the JDK's own invariants.
        .arg("-ea")
        .arg("-cp")
        .arg(format!("{}:{}", dir.display(), jar.display()))
        .arg("nts.rt.RuntimeRegression")
        .output()
        .unwrap();
    let out = String::from_utf8_lossy(&ran.stdout);
    let err = String::from_utf8_lossy(&ran.stderr);
    assert!(ran.status.success(), "the runtime's own tests failed:\n{out}\n{err}");
    assert!(out.contains("PASS "), "no PASS line; the suite did not reach its end:\n{out}");
    let _ = std::fs::remove_dir_all(&dir);
}
