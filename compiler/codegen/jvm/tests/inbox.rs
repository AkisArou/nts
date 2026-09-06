//! The completion inbox: publication, credit conservation, and the ceiling.
//!
//! # Why one of these assertions is about a declaration rather than a behaviour
//!
//! The inbox's central property is that everything a producer wrote before
//! posting is visible to the owner lane after receipt. That is a Java Memory
//! Model guarantee bought by one `volatile` field, and **it cannot be falsified
//! on x86**, which does not reorder stores. A behavioural test here passes with
//! or without the keyword; the plan therefore requires the stress to run on a
//! real ARM device, where removing it fails.
//!
//! So this asserts the *cause* as well as the effect: the stress exercises the
//! path under sixteen producers, and a reflection check fails immediately if
//! the link stops being volatile. An untestable invariant with a testable cause
//! is worth asserting at the cause, on the machine whoever broke it is using.

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
fn every_producer_publishes_and_every_credit_returns() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-inbox-{}", std::process::id()));
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
        .arg(root.join("compiler/codegen/jvm/tests/inbox/Stress.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the inbox stress driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("Stress")
        .arg("16")
        .arg("200")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the inbox stress failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(said.ends_with("0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}
