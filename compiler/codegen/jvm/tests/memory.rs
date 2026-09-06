//! `NtsBuffer` and `NtsDataView` against node, line for line.
//!
//! # Why every float is a bit pattern
//!
//! A NaN read out of four bytes has a payload, `toString` says `"NaN"` for all
//! of them, and the payload is the part a hand-written accessor loses. So the
//! oracle prints `doubleToRawLongBits` and the comparison is by bit pattern,
//! which is the same rule the differential keeps for the same reason.
//!
//! It is also load-bearing rather than fastidious. `Float.floatToIntBits`
//! canonicalises every NaN to `0x7fc00000` and `floatToRawIntBits` does not,
//! and **node preserves the payload** -- a signalling `7ff0000000000001` read
//! from bytes and written straight back comes out unchanged. Both accessors
//! were green until a round-trip vector existed, because every NaN written
//! directly is the canonical quiet one and nothing had asked the question.
//!
//! # What the oracle corrected
//!
//! Two things, neither of which was found by reading the specification:
//!
//! `ToIndex` truncates. A `byteOffset` of `0.5` is **zero**, not an error, and
//! so is `NaN`; only a negative or a value past 2^53-1 is a `RangeError`. The
//! first version rejected any non-integer on the reasoning that one comparison
//! catches a fraction, a NaN, an infinity and an overflow at once. It does, and
//! three of the four are wrong -- node reads element zero for all of them.
//!
//! And a refusal is not the same fact as any throw. The driver's `attempt`
//! caught `RuntimeException | Error` and reported all of it as `refuses`, which
//! made every bound in the file untestable: with the checks deleted the access
//! runs off the `byte[]`, the JVM raises `ArrayIndexOutOfBoundsException`, and
//! the catch-all called it a refusal. That is exactly the declined-versus-
//! defect distinction the harness rests on, so the two now print differently.
//!
//! # Typed arrays, and the three rules that are each other's near-misses
//!
//! `Int32Array` stores `ToInt32`; `Float32Array` rounds to nearest even and
//! keeps a NaN's payload; `Uint8ClampedArray` does neither -- it clamps to
//! 0..255 and rounds **half to even**, so `0.5` is `0` and `1.5` is `2` where
//! `Math.round` says `1` and `2`. Those are the inputs that separate the rules
//! and the ones a test is least likely to contain unless it is looking for
//! them, which is why the element pool is mostly halves.
//!
//! A view's length is *computed*, not stored: a view built without an explicit
//! length tracks its buffer, so it shortens when the buffer shrinks. A stored
//! length is right until the first `resize`, which a corpus with no resizable
//! buffers in it never reaches.
//!
//! Skips without a JDK or node, as the other Java suites do.

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

/// The oracle's lines and this runtime's, in that order.
///
/// Run **once** for the whole binary. Both tests used to call this and both
/// built into `nts-memory-{pid}`, so whichever finished first deleted the
/// directory under the other and it died with `NoClassDefFoundError: Drive$21`
/// -- a missing anonymous class, which reads like a compiler bug and is two
/// tests sharing a path. Caching also halves the work: one `node`, one `javac`,
/// one `java`.
fn both() -> Option<(String, String)> {
    static ONCE: std::sync::OnceLock<Option<(String, String)>> = std::sync::OnceLock::new();
    ONCE.get_or_init(compare).clone()
}

fn compare() -> Option<(String, String)> {
    let (Some(javac), Some(java), Some(node)) = (tool("javac"), tool("java"), tool("node")) else {
        return None;
    };
    let root = repository();
    let here = root.join("compiler/codegen/jvm/tests/memory");
    let dir = std::env::temp_dir().join(format!("nts-memory-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    let jar = runtime_jar();

    let expected = Command::new(&node).arg(here.join("vectors.mjs")).output().unwrap();
    assert!(
        expected.status.success(),
        "node could not generate the vectors:\n{}",
        String::from_utf8_lossy(&expected.stderr)
    );

    let compiled = Command::new(&javac)
        .args(["--release", "8", "-Xlint:-options", "-cp"])
        .arg(&jar)
        .arg("-d")
        .arg(&dir)
        .arg(here.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "the driver did not compile:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );

    let ran = Command::new(&java)
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), dir.display()))
        .arg("Drive")
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "the driver failed:\n{}\n{}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    let _ = std::fs::remove_dir_all(&dir);
    Some((
        String::from_utf8_lossy(&expected.stdout).into_owned(),
        String::from_utf8_lossy(&ran.stdout).into_owned(),
    ))
}

#[test]
fn every_accessor_agrees_with_node_by_bit_pattern() {
    let Some((expected, found)) = both() else { return };
    let want: Vec<&str> = expected.lines().collect();
    let got: Vec<&str> = found.lines().collect();
    assert_eq!(
        want.len(),
        got.len(),
        "the driver printed {} lines against the oracle's {}; the two sides walk the same \
         product in the same order, so a count that differs is a missing case rather than a \
         wrong answer",
        got.len(),
        want.len()
    );
    let differing: Vec<String> = want
        .iter()
        .zip(&got)
        .filter(|(a, b)| a != b)
        .take(20)
        .map(|(a, b)| format!("  node: {a}\n  nts:  {b}"))
        .collect();
    assert!(
        differing.is_empty(),
        "{} of {} lines disagree with node:\n{}",
        want.iter().zip(&got).filter(|(a, b)| a != b).count(),
        want.len(),
        differing.join("\n")
    );
}

/// The vectors are worthless if they never reach the paths they name, and two
/// of them did not until a sabotage said so.
#[test]
fn the_vectors_reach_the_cases_they_claim() {
    let Some((expected, _)) = both() else { return };
    for required in [
        // Typed arrays: the three conversion rules that are each other's
        // near-misses, and the one shape that separates aliasing from copying.
        "view u8c 3fe0000000000000",
        "trip-view f32",
        "track-odd 4",
        "subarray 4 6",
        // The bigint views, whose whole difference is the *high* word -- the
        // low one is identical for both, and printing only that made a
        // sign-extending unsigned read invisible.
        "bigview bu64 ffffffffffffffff",
        "bigread bi64",
        "bigtrack-odd 1",
        // The NaN payload, which is the only vector that can tell the raw bit
        // accessors from the canonicalising ones.
        "trip f64 16 be 7ff0000000000001",
        // `ToIndex` truncating rather than refusing.
        "allows read-fractional",
        "allows read-nan-offset",
        // A bound that is checked against the buffer's current length.
        "refuses shrink-after",
        "allows shrink-before",
        // Detaching, which a `transfer` that copied would leave allowed.
        "refuses read-detached",
    ] {
        assert!(
            expected.lines().any(|line| line.starts_with(required)),
            "the oracle no longer produces `{required}`, so whatever it was covering is \
             uncovered -- a vector that stops reaching its case fails silently, which is \
             the failure this test exists to make loud"
        );
    }
}
