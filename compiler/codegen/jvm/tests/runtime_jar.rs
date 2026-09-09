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
/// # What this still catches, now that the floor is 29
///
/// It was written for a different reason and that reason is spent: `d8` turns
/// `invokedynamic` into `invoke-custom`, which needs API 26, and this lane's
/// floor is 29. The Android path no longer closes when one appears, so the
/// original argument would have kept the assertion alive on a claim that had
/// stopped being true.
///
/// What survives is the case the version check beside it **cannot** see. A
/// dropped `--release 8` raises the class version and that assertion fails; but
/// a *lambda* written in the runtime emits `invokedynamic LambdaMetafactory` at
/// version 52, which is legal Java 8 and passes every other check here.
/// Verified rather than assumed -- `javac --release 8` on `x -> x + 1` gives
/// exactly that, at `major version: 52`.
///
/// So what this enforces now is *no lambdas and no method references in the
/// runtime*, which is the same decision as `ClosureStatic` one level up:
/// `LambdaMetafactory` does not promise one instance, so `f === f` could not be
/// `if_acmpeq`, and a bootstrap resolved at first execution is a startup cost
/// on ART that a static field is not.
///
/// Version 52 stays on its own terms: Java 8 is the floor `d8` and every
/// current JVM accept, and it is old enough that nothing here can accidentally
/// depend on a feature Android has not got.
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
        "the runtime jar contains `invokedynamic`. At a floor of API 29 that \
         dexes, so this is not about what Android accepts: it is a lambda or a \
         method reference, which `--release 8` compiles to `LambdaMetafactory` \
         at version 52, and every other check here passes. One instance is not \
         promised and the bootstrap runs at first execution. Write the class \
         out."
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

/// No call whose *descriptor* differs between a desktop JDK and Android.
///
/// # The bug this exists for
///
/// `NtsStore.close` called `ConcurrentHashMap.keySet()`. Java 8 gave that method
/// a covariant return type — `ConcurrentHashMap.KeySetView` where Java 7 and
/// Android's `core-oj` say `Set` — so `javac --release 8` wrote
/// `()Ljava/util/concurrent/ConcurrentHashMap$KeySetView;` into the call site.
/// It resolved on every desktop JVM, passed 47 checks, and raised
/// `NoSuchMethodError` on ART.
///
/// # Why the checks that already exist could not see it
///
/// `--release 8` fixes the *language* level and the platform signatures javac
/// compiles against; it says nothing about which of those signatures Android
/// kept. `-Xlint`, `d8 --min-api 29` and the no-`invokedynamic` ratchet all pass
/// — the bytecode is valid, dexes cleanly and needs nothing above API 26. The
/// member simply is not there, and **ART resolves lazily**, so even forcing
/// linkage over the corpus would not find it: only executing that line does.
///
/// So this reads the artifact. A method reference is in the constant pool
/// whether or not anything calls it, which is the property that makes a jar
/// checkable without a device attached.
///
/// # Why a list rather than a rule
///
/// The general question — does every `java.*` reference in this jar resolve
/// against `android.jar` — cannot be answered by recompiling, because compiling
/// against Android's bootclasspath would emit descriptors the *desktop* JVM
/// then rejects. The two platforms genuinely disagree and one jar has to run on
/// both, so the only safe rule is to avoid the members where they disagree.
/// That set is small and known; this is it, and the device suite is what finds
/// the next one.
#[test]
fn the_jar_names_no_method_android_spells_differently() {
    /// `(the descriptor fragment, what to write instead)`.
    const DIFFERS: &[(&str, &str)] = &[(
        "ConcurrentHashMap$KeySetView",
        "`ConcurrentHashMap.keySet()`, whose return type Java 8 made covariant \
         and Android's `core-oj` did not -- use `entrySet()` or `values()`",
    )];

    let Some(javap) = tool("javap") else {
        return;
    };
    if std::env::var("NTS_REGENERATE").is_ok_and(|value| value != "0") {
        // A sibling in this binary rewrites the jar **in place** under
        // `NTS_REGENERATE`, and cargo runs the two concurrently -- so this read
        // a half-written archive and reported the very defect it exists to
        // find. Twice, in one session, with the comment in `tests/inbox.rs`
        // warning about it already loaded. The check is about the committed
        // artifact, so during a regeneration there is nothing for it to say.
        eprintln!("SKIP android spellings: the jar is being regenerated in this run");
        return;
    }
    let jar = root().join("runtime/jvm/nts-runtime.jar");
    let names = Command::new("sh")
        .arg("-c")
        .arg(format!("unzip -Z1 '{}' '*.class'", jar.display()))
        .output()
        .expect("listing the jar");
    let classes: Vec<String> = String::from_utf8_lossy(&names.stdout)
        .lines()
        .map(|line| line.trim_end_matches(".class").replace('/', "."))
        .collect();
    assert!(classes.len() > 20, "the jar listed {} classes", classes.len());

    let listed = Command::new(&javap)
        .arg("-v")
        .arg("-p")
        .arg("-cp")
        .arg(&jar)
        .args(&classes)
        .output()
        .expect("running javap");
    let text = String::from_utf8_lossy(&listed.stdout);

    for (fragment, instead) in DIFFERS {
        assert!(
            !text.contains(fragment),
            "this jar has to run on ART as well as on a desktop JVM, and it names {instead}"
        );
    }
}

/// `d8` accepts the jar, which is the thing the two ratchets above are
/// preconditions for.
///
/// # Why a precondition is not the check
///
/// `nothing_in_the_runtime_needs_a_feature_android_lacks` asserts no
/// `invokedynamic` and class file version 52, and
/// `the_jar_names_no_method_android_spells_differently` asserts the names
/// resolve. Both are true of a jar `d8` would still refuse -- they were chosen
/// because they are the *known* ways to lose the Android path, and a rule
/// chosen that way cannot cover the ones nobody thought of.
///
/// Until this test, nothing had ever run `d8`. The path was held open by two
/// claims about the artefact and never by the tool that consumes it, and when
/// it was finally tried by hand the whole runtime dexed to 134KB and nine cases
/// ran bit-identically under `dalvikvm`. That is a good outcome and it was
/// **unverified for as long as this backend has existed**.
///
/// # Why here and not in the gate
///
/// It costs a second, needs no device, and skips where `d8` is absent -- so it
/// belongs beside the claims it checks rather than in a shared twenty-minute
/// run. Running the *program* on a device is `tooling/android/agrees-on-device.sh`
/// and stays a tool rather than a step: it needs an emulator, and a gate step
/// that silently skips on every machine without one is a ratchet in name.
#[test]
fn d8_accepts_the_runtime_jar() {
    let root = root();
    let jar = root.join("runtime/jvm/nts-runtime.jar");
    assert!(jar.exists(), "the jar this test is about is missing: {}", jar.display());

    let Some(sdk) = std::env::var("ANDROID_HOME")
        .or_else(|_| std::env::var("ANDROID_SDK_ROOT"))
        .ok()
    else {
        eprintln!("SKIP d8_accepts_the_runtime_jar: no ANDROID_HOME");
        return;
    };
    // The newest build-tools, because `d8` only gained `--min-api` behaviour
    // worth relying on in recent ones and an old copy would answer about a
    // tool nobody ships with.
    let Some(d8) = std::fs::read_dir(PathBuf::from(&sdk).join("build-tools"))
        .ok()
        .map(|entries| {
            let mut found: Vec<PathBuf> = entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .collect();
            found.sort();
            found
        })
        .and_then(|found| found.into_iter().rev().map(|dir| dir.join("d8")).find(|d8| d8.exists()))
    else {
        eprintln!("SKIP d8_accepts_the_runtime_jar: no build-tools with d8");
        return;
    };

    // A named directory rather than a `tempfile` dependency: this crate's
    // manifest says every addition is a maintenance obligation, and one test
    // needing a scratch directory is not worth one.
    let out = std::env::temp_dir().join(format!("nts-d8-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).expect("a directory to dex into");
    let run = Command::new(&d8)
        .arg("--min-api")
        .arg("29")
        .arg("--output")
        .arg(&out)
        .arg(&jar)
        .output()
        .expect("running d8");
    let dexed = out.join("classes.dex").exists();
    let _ = std::fs::remove_dir_all(&out);
    assert!(
        run.status.success(),
        "d8 refused the runtime jar, so this backend's output cannot reach Android:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    assert!(dexed, "d8 reported success and produced no classes.dex");
}
