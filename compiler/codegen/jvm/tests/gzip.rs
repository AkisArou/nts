//! `NtsGzip` against node's `zlib`, at every chunk boundary, plus corruption.
//!
//! # Why the split sizes are the test rather than a parameter of it
//!
//! A gzip decoder that assumes a contiguous header passes every fixture anyone
//! writes by hand and fails on a real connection, because bytes arrive in
//! whatever sizes the network chose. The interesting inputs are not the
//! payloads -- they are the **places the stream is cut**: between the two magic
//! bytes, inside a file name, between the last compressed byte and the trailer.
//!
//! So this feeds each vector at eight input chunk sizes and five output buffer
//! sizes and asserts the forty results are identical. That product found the
//! only real bug in the first implementation: written and consumed were packed
//! into one `int`, **both overflow sixteen bits**, and a one-megabyte output
//! buffer decoded 4,464 bytes of a 70,000-byte payload and reported success.
//! Two of four hundred combinations caught it, and only because the test varies
//! *both* sizes rather than one.
//!
//! # Why node generates the vectors
//!
//! Node is this repository's oracle, and `zlib.gzipSync` is the encoder our
//! users' servers actually run. The optional header fields it never emits --
//! `FEXTRA`, `FNAME`, `FCOMMENT`, `FHCRC` -- are assembled by hand in the same
//! script from `deflateRawSync` plus a computed trailer, because a decoder that
//! has never seen a file name is a decoder that has not been tested.

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

/// Compile the drivers against the runtime jar and run one of them.
fn run(driver: &str) -> Option<String> {
    let (Some(javac), Some(java), Some(node)) = (tool("javac"), tool("java"), tool("node")) else {
        return None;
    };
    let root = repository();
    let here = root.join("compiler/codegen/jvm/tests/gzip");
    let dir = std::env::temp_dir().join(format!("nts-gzip-{}-{driver}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    // `NTS_JVM_RUNTIME_JAR` for the reason the other Java tests take it: to
    // break this check on purpose without editing the checked-in artifact,
    // which another session may be building against at the same moment.
    let jar = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .map_or_else(|| root.join("runtime/jvm/nts-runtime.jar"), PathBuf::from);

    let vectors = dir.join("vectors.txt");
    let generated = Command::new(&node).arg(here.join("vectors.mjs")).output().unwrap();
    assert!(
        generated.status.success(),
        "node could not generate the vectors:\n{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    std::fs::write(&vectors, &generated.stdout).unwrap();

    let compiled = Command::new(&javac)
        .arg("--release")
        .arg("8")
        .arg("-Xlint:-options")
        .arg("-cp")
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(here.join(format!("{driver}.java")))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the {driver} driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg(driver)
        .arg(&vectors)
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).trim().to_owned();
    assert!(
        ran.status.success(),
        "{driver} failed:\n{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    let _ = std::fs::remove_dir_all(&dir);
    Some(said)
}

#[test]
fn every_split_of_every_stream_decodes_to_the_same_bytes() {
    let Some(said) = run("Drive") else { return };
    assert!(said.ends_with("0 mismatches"), "{said}");
}

/// The half that proves the first half can fail.
///
/// A decoder that returns the right bytes for a good stream and also for a
/// corrupt one has not validated anything, and both of gzip's trailer checks
/// exist precisely because the other one is insufficient: CRC alone accepts a
/// stream truncated at a multiple of 4 GiB, ISIZE alone accepts corruption that
/// preserves length.
#[test]
fn every_corruption_is_refused_rather_than_absorbed() {
    let Some(said) = run("Sabotage") else { return };
    assert!(said.ends_with("0 accepted"), "{said}");
}
