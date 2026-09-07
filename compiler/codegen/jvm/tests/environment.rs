//! `NtsEnv`: isolation, two clocks, liveness, waiting, and letting go.
//!
//! # Why the retirement check is a weak reference rather than a counter
//!
//! `tooling/memory` proves retirement on the counting lanes by watching retains
//! and releases balance. There is no such number here: `Provider::NoGc` means
//! the platform collector owns lifetimes, a retained callback is invisible to
//! every counter, and an empty diagnostic set means the instrument is absent
//! rather than that there is nothing to verify.
//!
//! So this proves it by reachability — a weak reference that must clear after
//! close — under a **bounded** protocol, because a collection that never comes
//! is a hang, and this document's own completion contract says a hang is the
//! correct failure of a *different* test.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// The runtime jar, copied somewhere this process owns.
///
/// Three sessions share this checkout and `runtime_jar.rs` rewrites
/// `runtime/jvm/nts-runtime.jar` **in place**, so a driver that reads the
/// checked-in path directly can be handed a half-written archive. That fails as
/// a `ZipException` or a missing class, in whichever suite happened to be
/// running at the moment, and it looks exactly like the thing under test being
/// broken -- which cost another session a run before the cause was found.
///
/// Copied once per test binary, so the artifact is immutable for the run.
/// `OnceLock` rather than an `exists` check because cargo runs these in
/// parallel threads and two of them racing on the same destination is the same
/// half-written file one layer down.
fn runtime_jar() -> PathBuf {
    static JAR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    JAR.get_or_init(|| {
        let source = std::env::var_os("NTS_JVM_RUNTIME_JAR")
            .map_or_else(|| repository().join("runtime/jvm/nts-runtime.jar"), PathBuf::from);
        let mine = std::env::temp_dir().join(format!("nts-runtime-{}.jar", std::process::id()));
        if std::fs::copy(&source, &mine).is_ok() { mine } else { source }
    })
    .clone()
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
fn an_environment_is_isolated_clocked_bounded_and_lets_go() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-env-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let jar = runtime_jar();

    let compiled = Command::new(&javac)
        .arg("--release")
        .arg("8")
        .arg("-Xlint:-options")
        .arg("-cp")
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(root.join("compiler/codegen/jvm/tests/env/EnvTest.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the environment driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("EnvTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the environment test failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
        // The **count**, not only the zero. A suite that stopped running half its
    // cases reports no failures perfectly well, which is the assertion
    // `android.rs` already makes about `PASS: 11` and the one every other
    // driver here was missing.
    assert!(said.ends_with("26 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// One default environment, and one lane owns it.
///
/// `NtsEnv.current()` answers for a thread that entered none, which
/// `runtime/c` also has -- "never null: a program that never asks for one still
/// has exactly one". Singular there, and it was not singular here: the lazy
/// initializer was the textbook unsafe singleton on a plain static, and **64
/// threads racing it produced 56 to 62 distinct environments** on every run. A
/// completion submitted against one and drained from another goes to an inbox
/// nobody reads.
///
/// The second property is a decision rather than a repair. A second lane is
/// refused by name rather than handed a share, because `post` wakes the
/// inbox's owner and two lanes on one inbox leaves one of them parked in
/// `drain` with work it will never be told about.
#[test]
fn one_default_environment_and_one_lane_owns_it() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let root = repository();
    let jar = runtime_jar();
    let dir = std::env::temp_dir().join(format!("nts-default-lane-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let compiled = Command::new(&javac)
        .args(["--release", "8", "-Xlint:-options", "-cp"])
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(root.join("compiler/codegen/jvm/tests/env/DefaultLaneTest.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the default-lane driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("DefaultLaneTest")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the default-lane test failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(said.ends_with("5 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Closing while completions are still arriving.
///
/// The interesting instant has no lock in it: a worker has read the closed flag
/// as false and is about to link its slot, and the owner lane is inside close.
/// Three things must hold for **every** interleaving rather than the one this
/// machine happens to produce — no completion runs after close, every credit
/// comes back, and liveness reaches zero — so the race runs many times with the
/// closing moment moved around inside it.
///
/// Verified able to fail: replacing `reclaim` with a single `discard` gives
/// `close returned 16 of 32 credits` on the first round and 40 failures in 40.
/// A single drain walks past a worker that links a moment later, and the credit
/// it held is gone — after which the environment can never reach zero liveness
/// and never finishes closing.
#[test]
fn closing_under_arriving_completions_loses_nothing() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-close-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let jar = runtime_jar();
    let compiled = Command::new(&javac)
        .arg("--release")
        .arg("8")
        .arg("-Xlint:-options")
        .arg("-cp")
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(root.join("compiler/codegen/jvm/tests/env/CloseRaceTest.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the close-race driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("CloseRaceTest")
        .arg("60")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the close race failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
        // The **count**, not only the zero. A suite that stopped running half its
    // cases reports no failures perfectly well, which is the assertion
    // `android.rs` already makes about `PASS: 11` and the one every other
    // driver here was missing.
    assert!(said.ends_with("240 checks, 0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}
