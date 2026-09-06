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
    let jar = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);

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
    assert!(said.ends_with("0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}
