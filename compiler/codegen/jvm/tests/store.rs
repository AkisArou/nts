//! The durable byte store, against a real filesystem.
//!
//! # Why this is a Java driver rather than Rust
//!
//! The store is Java that names no Android SDK member, so the desktop JVM and
//! ART run the same class -- and the thing worth testing is what the *runtime*
//! does with a real directory, not what the compiler emits. Driving it from
//! Java means the same file can be pushed to a device unchanged, which is where
//! the second half of its evidence comes from.
//!
//! # The one guarantee no test here demonstrates
//!
//! `commit` syncs the file and then syncs the directory, and the second sync is
//! what makes the rename survive a power cut. Showing that it matters means
//! cutting power between the two, which no test in this suite can do. It is in
//! because an API-26 device was measured to support it, and it is recorded as
//! reasoning rather than as evidence.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// The runtime jar, copied somewhere this process owns.
///
/// `runtime_jar.rs` rewrites the checked-in path **in place**, so a driver that
/// reads it directly can be handed a half-written archive -- which fails as a
/// `ZipException` in whichever suite happened to be running and looks exactly
/// like the thing under test being broken.
fn runtime_jar() -> PathBuf {
    static JAR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    JAR.get_or_init(|| {
        let source = std::env::var_os("NTS_JVM_RUNTIME_JAR")
            .map_or_else(|| repository().join("runtime/jvm/nts-runtime.jar"), PathBuf::from);
        let mine = std::env::temp_dir().join(format!("nts-runtime-store-{}.jar", std::process::id()));
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
fn a_value_is_whole_or_absent_and_a_name_cannot_escape() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-store-{}", std::process::id()));
    let store = dir.join("store");
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
        .arg(root.join("compiler/codegen/jvm/tests/store/StoreTest.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the store driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("StoreTest")
        .arg(&store)
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "the durable store failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    // The count as well as the zero. A driver that stopped running early prints
    // no summary at all, but one whose cases stopped being *reached* would
    // print `0 checks, 0 failures` and satisfy an assertion on the zero alone.
    let (count, _) = said.rsplit_once(" checks,").unwrap_or(("", ""));
    let count: usize = count.rsplit(' ').next().unwrap_or("0").parse().unwrap_or(0);
    assert!(count >= 40, "only {count} checks ran: {said}");
    assert!(said.ends_with("0 failures"), "{said}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A commit syncs the file, renames, and then syncs the *directory*.
///
/// The store's durability promise needs two syncs and not one, and the second
/// is invisible to every functional test: without it a committed value is still
/// whole, still atomic and still correct on every machine that does not lose
/// power. So this checks the cause rather than the effect, by standing in front
/// of libc and reporting which calls a commit makes and in which order.
///
/// It is not a power-cut test and does not claim to be. What it rules out is
/// the change that would quietly remove the guarantee -- deleting the directory
/// sync, or ordering it before the rename it is supposed to make durable -- on
/// the machine of whoever made it.
///
/// Linux and glibc only; skips without a C compiler or `/proc/self/fd`.
#[test]
fn a_commit_syncs_the_file_then_renames_then_syncs_the_directory() {
    if !cfg!(target_os = "linux") || !Path::new("/proc/self/fd").exists() {
        return;
    }
    let (Some(javac), Some(java), Some(cc)) = (tool("javac"), tool("java"), tool("cc")) else {
        return;
    };
    let root = repository();
    let dir = std::env::temp_dir().join(format!("nts-durability-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let jar = runtime_jar();

    let shim = dir.join("shim.so");
    let built = Command::new(&cc)
        .arg("-shared")
        .arg("-fPIC")
        .arg("-o")
        .arg(&shim)
        .arg(root.join("compiler/codegen/jvm/tests/store/durability-shim.c"))
        .arg("-ldl")
        .output()
        .unwrap();
    if !built.status.success() {
        // A shim that will not build is a missing instrument, not a failure of
        // the thing under test -- announced, because a silent skip reads as a
        // pass and this is the only check this guarantee has.
        eprintln!(
            "SKIP durability: the syscall shim did not build:\n{}",
            String::from_utf8_lossy(&built.stderr)
        );
        return;
    }

    let compiled = Command::new(&javac)
        .arg("--release")
        .arg("8")
        .arg("-Xlint:-options")
        .arg("-cp")
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(root.join("compiler/codegen/jvm/tests/store/Durability.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the durability driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let store = dir.join("nts-durable-store");
    let ran = Command::new(&java)
        .env("LD_PRELOAD", &shim)
        .env("NTS_SHIM_MARK", "nts-durable-store")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("Durability")
        .arg(&store)
        .output()
        .unwrap();
    assert!(ran.status.success(), "{}", String::from_utf8_lossy(&ran.stderr));

    let said = String::from_utf8_lossy(&ran.stderr);
    let calls: Vec<&str> = said
        .lines()
        .filter_map(|line| line.strip_prefix("SHIM "))
        .map(|line| if line.starts_with("rename") { "rename" } else if line.contains(".nts-partial") { "fsync file" } else { "fsync directory" })
        .collect();
    // If the shim saw nothing at all, `LD_PRELOAD` did not take -- which every
    // assertion below would read as "the calls are absent". The two are
    // opposite conclusions from the same silence, so they are told apart here.
    assert!(!calls.is_empty(), "the shim observed nothing; LD_PRELOAD did not take:\n{said}");
    assert_eq!(
        calls,
        vec!["fsync file", "rename", "fsync directory"],
        "a commit did not sync, rename and sync in that order:\n{said}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
