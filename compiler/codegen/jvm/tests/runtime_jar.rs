//! The checked-in runtime jar, checked against the sources it was built from.
//!
//! # Why a binary artifact is in the repository at all
//!
//! `nts` must compile TypeScript to class files on a machine with no JDK --
//! only *running* the result needs one. So the runtime is embedded with
//! `include_bytes!` rather than compiled on demand, which means a build product
//! is checked in.
//!
//! That is safe exactly as long as something notices when it drifts, which is
//! the rule `codegen/llvm/tests/signatures.rs` already states for clang: a
//! generated artifact and its generator live beside each other, and the test is
//! what keeps them honest. Without this file the jar is a binary nobody can
//! account for, and a change to `NtsRuntime.java` that was never rebuilt would
//! be invisible until a program got a wrong answer from a stale method.
//!
//! # Skips without a JDK, fails with one
//!
//! A missing toolchain is not a passing test. The gate's `jvm` step already
//! refuses to run without a JDK for the same reason, so on the machine that
//! gates this, every assertion here is live.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root")
}

fn tool(name: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return Some(path);
        }
    }
    let found = Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {name}"))
        .output()
        .ok()?;
    found
        .status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&found.stdout).trim()))
}

/// Rebuilding the sources reproduces the jar byte for byte.
///
/// `--date` pins the archive's timestamps and `--release 8` pins the class file
/// version, so the only thing that can move the bytes is the source. Regenerate
/// with `NTS_REGENERATE=1 cargo test -p nts-codegen-jvm --test runtime_jar`.
#[test]
fn the_jar_matches_the_sources_it_was_built_from() {
    if tool("javac").is_none() || tool("jar").is_none() {
        return;
    }
    let root = root();
    let checked_in = root.join("runtime/jvm/nts-runtime.jar");
    let regenerate = std::env::var("NTS_REGENERATE").is_ok_and(|value| value != "0");
    let rebuilt = if regenerate {
        checked_in.clone()
    } else {
        std::env::temp_dir().join("nts-runtime-rebuilt.jar")
    };

    let built = Command::new("sh")
        .arg(root.join("runtime/jvm/build.sh"))
        .arg(&rebuilt)
        .output()
        .expect("running runtime/jvm/build.sh");
    assert!(
        built.status.success(),
        "the runtime did not build:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    if regenerate {
        return;
    }

    let theirs = std::fs::read(&rebuilt).expect("the rebuilt jar");
    let ours = std::fs::read(&checked_in).expect("the checked-in jar");
    assert_eq!(
        ours.len(),
        theirs.len(),
        "runtime/jvm/nts-runtime.jar is {} bytes and rebuilding its sources \
         gives {} -- run `NTS_REGENERATE=1 cargo test -p nts-codegen-jvm \
         --test runtime_jar`",
        ours.len(),
        theirs.len()
    );
    assert!(
        ours == theirs,
        "runtime/jvm/nts-runtime.jar does not match its sources -- run \
         `NTS_REGENERATE=1 cargo test -p nts-codegen-jvm --test runtime_jar`"
    );
}

/// The jar carries no `invokedynamic`, and is class file version 52.
///
/// # Why this is a ratchet and not a curiosity
///
/// From JDK 9 on, `javac` compiles a string `+` into
/// `invokedynamic makeConcatWithConstants`, which needs **Android API 26**. So
/// the day somebody drops `--release 8` from `build.sh` -- or writes the
/// runtime against a newer feature -- the Android path closes, and nothing else
/// in the repository would notice until a `d8` run years later.
///
/// One assertion keeps it open for free. Version 52 is the same bargain: Java 8
/// is the floor `d8` and every current JVM accept, and it is old enough that
/// nothing here can accidentally depend on a feature Android has not got.
#[test]
fn nothing_in_the_runtime_needs_a_feature_android_lacks() {
    let Some(javap) = tool("javap") else {
        return;
    };
    let jar = root().join("runtime/jvm/nts-runtime.jar");
    let listed = Command::new(&javap)
        .arg("-v")
        .arg("-p")
        .arg("-cp")
        .arg(&jar)
        .args(["nts.rt.NtsRuntime", "nts.rt.Check", "nts.rt.NtsRefusal"])
        .output()
        .expect("running javap");
    assert!(
        listed.status.success(),
        "javap could not read the jar:\n{}",
        String::from_utf8_lossy(&listed.stderr)
    );
    let text = String::from_utf8_lossy(&listed.stdout);

    assert!(
        !text.contains("invokedynamic"),
        "the runtime jar contains `invokedynamic`, which needs Android API 26. \
         The usual cause is `javac` turning a string `+` into \
         `makeConcatWithConstants`; `build.sh` passes `--release 8` to prevent \
         exactly that."
    );

    let versions: Vec<&str> = text
        .lines()
        .filter_map(|line| line.trim().strip_prefix("major version: "))
        .collect();
    assert!(!versions.is_empty(), "javap printed no class versions");
    for version in versions {
        assert_eq!(
            version, "52",
            "a class in the runtime jar is not Java 8; `d8` and the Android \
             floor both want 52"
        );
    }
}
