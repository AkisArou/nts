//! What each ecosystem already resolved, read rather than resolved again.
//!
//! A package names a resolver and points at that resolver's *output* -- a
//! Gradle or Maven classpath, `Package.resolved`, `Podfile.lock`, a set of
//! `pkg-config` package names. `runtime/jvm/web-platform/android/dependencies.tsv`
//! states the rule this module enforces: "a version range or a `+` would make
//! the artifact that ships differ from the artifact that was reviewed, which is
//! the whole of a supply-chain problem in one line."
//!
//! So nothing here runs a resolver. `build.gradle` is a Turing-complete program
//! and so is a Makefile; both are read by their own tool, whose *result* is what
//! a config points at.
//!
//! # Keyed by target, which is why the refusals are scoped
//!
//! `dependencies` is a map from target id to a claim, so a build consults only
//! the entry covering the target it is building. `packages/notifications`
//! declares Gradle for `android-29`, `SwiftPM` for `ios-17` and `pkg-config` for
//! `linux-gnu`; building it for Linux reads the third and never looks at the
//! other two. A resolver this cannot read is therefore a refusal *for the
//! targets that name it*, not a refusal to build at all.

use std::collections::BTreeMap;
use std::process::Command;

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use serde::Deserialize;

/// Where a claim's answer came from.
///
/// Spelled as the ecosystem spells it, which is what a config author types and
/// what `tooling/config/src/native.ts` declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Resolver {
    Gradle,
    Maven,
    Swiftpm,
    Cocoapods,
    PkgConfig,
    Vcpkg,
    Npm,
}

impl Resolver {
    /// What the resolver is called in prose, for a message a person reads.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Gradle => "Gradle",
            Self::Maven => "Maven",
            Self::Swiftpm => "SwiftPM",
            Self::Cocoapods => "CocoaPods",
            Self::PkgConfig => "pkg-config",
            Self::Vcpkg => "vcpkg",
            Self::Npm => "npm",
        }
    }
}

/// One claim: a resolver, and the pinned output it produced.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Dependencies {
    pub from: Resolver,
    /// The resolver's own output, copied in rather than re-resolved.
    #[serde(default)]
    pub lockfile: Option<String>,
    /// For resolvers with no lockfile, such as `pkg-config`.
    #[serde(default)]
    pub packages: Option<Vec<String>>,
}

/// What a resolved claim contributes to the build.
///
/// Three lists rather than one, because they go to three different places: a
/// C compile, a C link, and a JVM classpath. A resolver contributes to whichever
/// of them it has an answer for and leaves the rest empty.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Resolution {
    pub cflags: Vec<String>,
    pub libs: Vec<String>,
    pub classpath: Vec<Utf8PathBuf>,
    /// What a claim resolved to when it contributes nothing to link against.
    ///
    /// **So that reading a claim is observable.** A resolver whose output this
    /// build does not consume would otherwise be indistinguishable from one
    /// nothing looked at, and "a field that parses must do something" is not
    /// satisfied by a silent success.
    pub notes: Vec<String>,
}

impl Resolution {
    /// Take on everything another claim resolved to.
    pub fn absorb(&mut self, other: Self) {
        self.cflags.extend(other.cflags);
        self.libs.extend(other.libs);
        self.classpath.extend(other.classpath);
        self.notes.extend(other.notes);
    }

    /// Whether anything was contributed at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.cflags.is_empty()
            && self.libs.is_empty()
            && self.classpath.is_empty()
            && self.notes.is_empty()
    }
}

/// Resolve every claim that covers `target`, in a stable order.
///
/// `dir` is the directory holding the config the claims came from, because a
/// `lockfile` is written relative to it.
///
/// **Absent is not an error here; unreadable is.** A config with no
/// `dependencies`, or none covering this target, resolves to nothing and says
/// nothing. A lockfile that is named and cannot be read is a failure, because
/// the author declared it.
pub fn resolve(
    dir: &Utf8Path,
    declared: &BTreeMap<String, Dependencies>,
    target: &str,
    floor: Option<&str>,
) -> Result<Resolution> {
    let mut total = Resolution::default();
    for (id, claim) in declared {
        if crate::config::claim_covers(id, target, floor) {
            total.absorb(one(dir, id, claim)?);
        }
    }
    Ok(total)
}

fn one(dir: &Utf8Path, id: &str, claim: &Dependencies) -> Result<Resolution> {
    match claim.from {
        Resolver::PkgConfig => pkg_config(id, claim),
        Resolver::Maven | Resolver::Gradle => jars(dir, id, claim),
        Resolver::Npm => npm(dir, id, claim),
        // **Named, with the file it would read.** The alternative is a build
        // that quietly produces an artifact missing everything the claim
        // promised, which is the half-emit this command must not do.
        other => bail!(
            "`dependencies.{id}` resolves with {}, which `nts build` cannot read yet, and \
             what it names would go into the artifact -- so building without it would \
             produce one missing what the claim promised.{} \
             Build a target this claim does not cover, or vendor what it names and \
             declare it with a resolver this build reads (`pkg-config` for C libraries, \
             `maven` or `gradle` for jars).",
            other.name(),
            claim
                .lockfile
                .as_ref()
                .map_or_else(String::new, |file| format!(" It would read `{file}`."))
        ),
    }
}

/// A C library, resolved by the tool whose entire job is compile and link flags.
fn pkg_config(id: &str, claim: &Dependencies) -> Result<Resolution> {
    let Some(packages) = claim.packages.as_deref().filter(|names| !names.is_empty()) else {
        bail!(
            "`dependencies.{id}` resolves with pkg-config and names no `packages`. \
             pkg-config has no lockfile, so the package names are the whole claim: \
             write `packages: [\"libnotify\"]`"
        )
    };
    if Command::new("pkg-config").arg("--version").output().is_err() {
        bail!(
            "`dependencies.{id}` needs pkg-config, which is not installed. \
             Install it (Debian/Ubuntu `apt install pkg-config`, Arch `pacman -S pkgconf`, \
             macOS `brew install pkg-config`)"
        )
    }
    for package in packages {
        let known = Command::new("pkg-config")
            .args(["--exists", package])
            .status()
            .with_context(|| format!("asking pkg-config about `{package}`"))?;
        if !known.success() {
            bail!(
                "`dependencies.{id}` claims the pkg-config package `{package}`, which is not \
                 installed on this machine. Install its development package -- the one \
                 carrying `{package}.pc` -- or add the directory holding that file to \
                 PKG_CONFIG_PATH"
            )
        }
    }
    Ok(Resolution {
        cflags: flags("--cflags", packages)?,
        libs: flags("--libs", packages)?,
        ..Resolution::default()
    })
}

/// One `pkg-config` invocation for every package, because it is one question.
///
/// **Split on whitespace**, which is what every consumer of this tool does and
/// is worth stating rather than discovering: a `.pc` file whose flags contain a
/// quoted path with a space produces arguments this splits wrongly. The tool
/// offers no machine-readable output to do better with, and a path with a space
/// in a `-I` has not been seen in this tree.
fn flags(what: &str, packages: &[String]) -> Result<Vec<String>> {
    let output = Command::new("pkg-config")
        .arg(what)
        .args(packages)
        .output()
        .with_context(|| format!("running pkg-config {what}"))?;
    if !output.status.success() {
        bail!(
            "pkg-config {what} failed for {}: {}",
            packages.join(", "),
            String::from_utf8_lossy(&output.stderr).trim()
        )
    }
    Ok(String::from_utf8_lossy(&output.stdout).split_whitespace().map(ToOwned::to_owned).collect())
}

/// npm, which resolves packages this build neither links nor ships.
///
/// **Read and checked, and contributing nothing -- which is different from
/// being unreadable.** A `.node` addon is loaded by a Node process whose
/// `node_modules` the *consumer* installs, so an npm lockfile describes that
/// consumer's environment rather than an input to this link. Refusing it would
/// be wrong for the same reason ignoring `vcpkg` would be wrong in the other
/// direction: one of them changes the artifact and one of them does not.
///
/// So the claim is validated -- named and unreadable is an error, as everywhere
/// here -- and what it pins is reported rather than silently dropped.
fn npm(dir: &Utf8Path, id: &str, claim: &Dependencies) -> Result<Resolution> {
    let Some(named) = &claim.lockfile else {
        bail!(
            "`dependencies.{id}` resolves with npm and names no `lockfile`. \
             `package-lock.json` is npm's resolved output and is the claim"
        )
    };
    let path = dir.join(named);
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("reading the npm lockfile `dependencies.{id}` names"))?;
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .with_context(|| format!("{path} is not JSON, and npm writes JSON"))?;
    let count = parsed
        .get("packages")
        .and_then(serde_json::Value::as_object)
        // The root project is its own entry under the empty key, and it is not
        // a dependency of itself.
        .map_or(0, |packages| packages.keys().filter(|key| !key.is_empty()).count());
    Ok(Resolution {
        notes: vec![format!(
            "`dependencies.{id}` pins {count} npm package(s) in {named}, which the consumer \
             installs -- nothing here links them"
        )],
        ..Resolution::default()
    })
}

/// One pinned artifact, as `dependencies.tsv` records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pin {
    pub group: String,
    pub artifact: String,
    pub version: String,
    pub sha256: String,
    pub license: String,
    pub scope: String,
    pub repository: String,
}

impl Pin {
    /// What the file is called in every repository layout that holds it.
    #[must_use]
    pub fn file_name(&self) -> String {
        format!("{}-{}.jar", self.artifact, self.version)
    }

    /// `com.android.tools:r8:8.13.23`, which is how a person names it.
    #[must_use]
    pub fn coordinate(&self) -> String {
        format!("{}:{}:{}", self.group, self.artifact, self.version)
    }
}

/// The columns, in the order `dependencies.tsv` writes them.
const COLUMNS: usize = 7;

/// Read a pinned classpath.
///
/// **A malformed row is an error, not a skipped line.** The reader this grew
/// from lived in a test over a file we control and used `filter_map`, so a row
/// with a missing column vanished. Over a file the *user* writes that is
/// silently permissive in the direction that costs correctness: a truncated
/// lockfile would resolve to fewer jars and the build would succeed with one
/// missing.
pub fn parse_pins(text: &str, path: &Utf8Path) -> Result<Vec<Pin>> {
    let mut pins = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let number = index + 1;
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() != COLUMNS {
            bail!(
                "{path}:{number}: a pinned dependency has {} tab-separated field(s) and needs \
                 {COLUMNS}: group, artifact, version, sha256, license, scope, repository",
                fields.len()
            )
        }
        let sha256 = fields[3];
        if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            bail!(
                "{path}:{number}: `{sha256}` is not a SHA-256 digest. It is 64 hexadecimal \
                 characters, and it is what makes this file a pin rather than a version list"
            )
        }
        if !matches!(fields[5], "runtime" | "tool") {
            bail!(
                "{path}:{number}: scope `{}` is neither `runtime` nor `tool`. A `runtime` \
                 artifact ships inside the product; a `tool` only builds it",
                fields[5]
            )
        }
        pins.push(Pin {
            group: fields[0].to_owned(),
            artifact: fields[1].to_owned(),
            version: fields[2].to_owned(),
            sha256: sha256.to_owned(),
            license: fields[4].to_owned(),
            scope: fields[5].to_owned(),
            repository: fields[6].to_owned(),
        });
    }
    Ok(pins)
}

/// A JVM classpath, pinned by a resolver that already ran.
fn jars(dir: &Utf8Path, id: &str, claim: &Dependencies) -> Result<Resolution> {
    let Some(named) = &claim.lockfile else {
        bail!(
            "`dependencies.{id}` resolves with {} and names no `lockfile`. The resolved \
             classpath is the claim: point it at the file `{}` wrote",
            claim.from.name(),
            claim.from.name()
        )
    };
    let path = dir.join(named);
    let text = std::fs::read_to_string(&path).with_context(|| {
        format!("reading the {} classpath `dependencies.{id}` names", claim.from.name())
    })?;
    let mut classpath = Vec::new();
    for pin in parse_pins(&text, &path)? {
        // A tool rewrites the artifact and is not in it, so it is not on the
        // classpath of the thing being built.
        if pin.scope != "runtime" {
            continue;
        }
        classpath.push(locate(&path, id, &pin)?);
    }
    Ok(Resolution { classpath, ..Resolution::default() })
}

/// Find a pinned jar in the local repositories, and prove it is the pinned one.
fn locate(lockfile: &Utf8Path, id: &str, pin: &Pin) -> Result<Utf8PathBuf> {
    let mut looked = Vec::new();
    for candidate in places(lockfile, pin) {
        if candidate.is_file() {
            let bytes = std::fs::read(&candidate)
                .with_context(|| format!("reading the jar pinned as {}", pin.coordinate()))?;
            let found = digest(&bytes);
            if found != pin.sha256 {
                bail!(
                    "{candidate} does not hash to the digest `dependencies.{id}` pins \
                     {} to.\n  pinned {}\n  found  {found}\nThis is not a stale lockfile to \
                     refresh: the bytes on this machine are not the bytes that were reviewed.",
                    pin.coordinate(),
                    pin.sha256
                )
            }
            return Ok(candidate);
        }
        looked.push(candidate);
    }
    // **Named rather than numbered.** This said "puts it in the first of
    // those", and `mvn` fills `~/.m2`, which is the second -- an ordinal into a
    // list whose length depends on whether a Gradle cache happens to exist is
    // not a way to name a directory.
    bail!(
        "`dependencies.{id}` pins {} and no local repository holds it. Looked in:\n{}\n\
         Fetch it from {} -- `mvn dependency:get -Dartifact={}` writes it under \
         `~/.m2/repository` -- or vendor the jar beside the lockfile as `{}`.",
        pin.coordinate(),
        looked.iter().map(|p| format!("  {p}")).collect::<Vec<_>>().join("\n"),
        pin.repository,
        pin.coordinate(),
        pin.file_name()
    )
}

/// Where a pinned jar can be, most specific first.
///
/// Beside the lockfile wins, because vendoring is the one of these that is
/// under the project's own control and survives a machine with no package
/// manager caches at all.
fn places(lockfile: &Utf8Path, pin: &Pin) -> Vec<Utf8PathBuf> {
    let mut places = Vec::new();
    if let Some(beside) = lockfile.parent() {
        places.push(beside.join(pin.file_name()));
    }
    let Some(home) = std::env::var("HOME").ok().map(Utf8PathBuf::from) else {
        return places;
    };
    let mut maven = home.join(".m2").join("repository");
    for segment in pin.group.split('.') {
        maven = maven.join(segment);
    }
    places.push(maven.join(&pin.artifact).join(&pin.version).join(pin.file_name()));
    // Gradle keys the leaf directory on a digest of the file, so the version
    // directory is read rather than constructed.
    let gradle = home
        .join(".gradle/caches/modules-2/files-2.1")
        .join(&pin.group)
        .join(&pin.artifact)
        .join(&pin.version);
    if let Ok(entries) = gradle.read_dir_utf8() {
        let mut found: Vec<Utf8PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path().join(pin.file_name()))
            .collect();
        found.sort();
        places.extend(found);
    }
    places
}

/// SHA-256, so a pinned artifact can be checked against its pin.
///
/// **Here rather than in the test that had it**, which is the rule this
/// repository keeps: the digest a build verifies with and the digest a test
/// verifies with must be one function, or the interesting failure is exactly
/// when they disagree. The round constants are FIPS 180-4's, in the
/// specification's spelling -- the lint's grouping would have to be un-grouped
/// by a reader checking them against the standard, which is the transcription
/// error this is meant to prevent.
#[allow(clippy::unreadable_literal)]
#[must_use]
pub fn digest(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = bytes.to_vec();
    let length = (bytes.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&length.to_be_bytes());
    for block in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    let mut hex = String::with_capacity(64);
    for word in h {
        use std::fmt::Write as _;
        let _ = write!(hex, "{word:08x}");
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path() -> &'static Utf8Path {
        Utf8Path::new("deps/maven.tsv")
    }

    const ROW: &str =
        "com.android.tools\tr8\t8.13.23\te3cdcb003d9beca956209ad6b9e9df31f26b732bfaed9c7c8674e903ca9f3b81\tBSD-3-Clause\ttool\thttps://maven.google.com";

    #[test]
    fn a_pinned_row_carries_every_column() {
        let pins = parse_pins(ROW, path()).expect("the row parses");
        assert_eq!(pins.len(), 1);
        assert_eq!(pins[0].coordinate(), "com.android.tools:r8:8.13.23");
        assert_eq!(pins[0].file_name(), "r8-8.13.23.jar");
        assert_eq!(pins[0].scope, "tool");
        assert_eq!(pins[0].license, "BSD-3-Clause");
    }

    #[test]
    fn comments_and_blank_lines_are_not_rows() {
        let text = format!("# a comment\n\n   \n{ROW}\n");
        assert_eq!(parse_pins(&text, path()).expect("parses").len(), 1);
    }

    /// The improvement over the reader this grew from, which used `filter_map`.
    ///
    /// **A skipped row is silently permissive in the direction that costs
    /// correctness**: a truncated lockfile resolves to fewer jars and the build
    /// succeeds with one missing. The test asserts the *error*, not the count,
    /// because a count assertion passes for a reader that drops the row.
    #[test]
    fn a_row_missing_a_column_is_an_error_rather_than_a_skipped_line() {
        let short = ROW.rsplit_once('\t').expect("a tab").0;
        let failed = parse_pins(short, path()).expect_err("a short row is refused");
        let said = failed.to_string();
        assert!(said.contains("deps/maven.tsv:1"), "does not say where:\n{said}");
        assert!(said.contains("6 tab-separated field(s)"), "does not say what it found:\n{said}");
    }

    #[test]
    fn a_digest_that_is_not_one_is_refused() {
        let bad = ROW.replace("e3cdcb003d9beca956209ad6b9e9df31f26b732bfaed9c7c8674e903ca9f3b81", "cafebabe");
        let said = parse_pins(&bad, path()).expect_err("refused").to_string();
        assert!(said.contains("is not a SHA-256 digest"), "wrong reason:\n{said}");
    }

    #[test]
    fn a_scope_that_is_neither_runtime_nor_tool_is_refused() {
        let bad = ROW.replace("\ttool\t", "\tprovided\t");
        let said = parse_pins(&bad, path()).expect_err("refused").to_string();
        assert!(said.contains("scope `provided`"), "does not name the scope:\n{said}");
    }

    /// The vectors, so the digest a build verifies with is the one everyone means.
    ///
    /// FIPS 180-4's own examples. This function moved here from a test in
    /// `codegen/jvm` so that the digest checking a pin and the digest checking
    /// the Android pins are one function -- the interesting failure is exactly
    /// when two copies disagree.
    #[test]
    fn the_digest_is_the_one_everyone_else_means() {
        assert_eq!(digest(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(
            digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // Past one block, so the padding and the length suffix are exercised.
        assert_eq!(
            digest(&vec![b'a'; 1000]),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
        );
    }

    #[test]
    fn a_target_no_claim_covers_resolves_to_nothing() {
        let mut declared = BTreeMap::new();
        declared.insert(
            "android-29".to_owned(),
            Dependencies {
                from: Resolver::Gradle,
                lockfile: Some("./deps/android.tsv".to_owned()),
                packages: None,
            },
        );
        let found = resolve(Utf8Path::new("."), &declared, "linux-gnu", None)
            .expect("a claim for another target is not consulted");
        assert!(found.is_empty(), "something was resolved: {found:?}");
    }

    /// A resolver this cannot read refuses for the targets naming it, and the
    /// message names the resolver and the file it would have read.
    #[test]
    fn a_resolver_this_cannot_read_refuses_by_name() {
        let mut declared = BTreeMap::new();
        declared.insert(
            "ios-17".to_owned(),
            Dependencies {
                from: Resolver::Swiftpm,
                lockfile: Some("./deps/apple.resolved".to_owned()),
                packages: None,
            },
        );
        let said = resolve(Utf8Path::new("."), &declared, "ios-17", None)
            .expect_err("SwiftPM is not read")
            .to_string();
        assert!(said.contains("SwiftPM"), "does not name the resolver:\n{said}");
        assert!(said.contains("./deps/apple.resolved"), "does not name the file:\n{said}");
    }

    /// pkg-config has no lockfile, so the package names are the whole claim.
    #[test]
    fn pkg_config_with_no_packages_says_what_is_missing() {
        let mut declared = BTreeMap::new();
        declared.insert(
            "linux-gnu".to_owned(),
            Dependencies { from: Resolver::PkgConfig, lockfile: None, packages: None },
        );
        let said = resolve(Utf8Path::new("."), &declared, "linux-gnu", None)
            .expect_err("an empty claim is refused")
            .to_string();
        assert!(said.contains("names no `packages`"), "wrong reason:\n{said}");
    }
}
