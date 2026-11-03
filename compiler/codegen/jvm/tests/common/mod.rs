//! Running a Java driver against a *sabotaged* copy of the runtime.
//!
//! Shared because two suites need it and a second copy would drift. The store's
//! own entries live in `store.rs`; the ones for the plan's named list live in
//! `sabotage.rs`; the machinery is here.
//!
//! `pub` throughout because an integration-test module is only reachable from
//! the binaries that declare it, and each one uses a different part.
//!
//! # Why the copy is not optional
//!
//! Sabotage is how both halves of a test get proved: change the runtime, watch
//! the suite go red, change it back. Done in place, the shared checkout holds
//! **wrong source** for as long as the cycle takes, and three sessions build
//! from it. `git status` shows the file modified for a few seconds and clean
//! afterwards, so the window is nearly invisible — and what comes out of it is
//! a correct-looking tree that produced a wrong binary. `tooling/jvm/sabotage.sh`
//! says the same at more length, and for the same reason.

#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

/// `snapshot` prepared as `nts emit-jvm` prepares it.
///
/// Managed memory on the JVM belongs to the host's collector
/// (`provider::host_gc`), the provider every program this lane emits has been
/// prepared with since 786f23a48. `hir::prepare` alone answers `NoGc`, a
/// preparation no JVM program receives -- so a test on it could pass on HIR
/// the product never emits, or fail on HIR it never sees.
pub fn prepare(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> Result<nts_core::hir::Prepared, nts_core::hir::Unprepared> {
    let provider = nts_codegen_common::provider::host_gc("jvm", false)
        .expect("the JVM prepares with the host's collector");
    nts_core::hir::prepare_with(
        snapshot,
        &nts_core::hir::Options {
            provider,
            ..nts_core::hir::Options::default()
        },
    )
}

pub fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub fn implementation_name(program: &nts_core::hir::Program, name: &str) -> String {
    let function = program
        .funcs
        .iter()
        .find(|function| function.name == name)
        .expect("the actual source function");
    nts_codegen_jvm::JvmProgram::new(program)
        .implementation_name(function)
        .to_owned()
}

/// Every prepared implementation belonging to the actual source declaration.
/// Specializations retain its source location; their member names come from
/// `JvmProgram` rather than from a suffix convention in the test.
pub fn implementation_names(program: &nts_core::hir::Program, name: &str) -> Vec<String> {
    let declaration = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .expect("the actual source declaration");
    let facts = nts_codegen_jvm::JvmProgram::new(program);
    program
        .funcs
        .iter()
        .filter(|func| func.origin.location == declaration.origin.location)
        .map(|func| facts.implementation_name(func).to_owned())
        .collect()
}

/// One complete javap method block, matching its opaque identity exactly.
/// Quoting is a presentation detail; no generated-name grammar is parsed here.
pub fn method_listing<'a>(listing: &'a str, name: &str) -> &'a str {
    listing
        .split("\n\n")
        .find(|body| {
            body.lines().any(|line| {
                let head = line.trim();
                line.starts_with("  ")
                    && !line.starts_with("   ")
                    && head.ends_with(");")
                    && head
                        .split('(')
                        .next()
                        .and_then(|head| head.split_whitespace().last())
                        .is_some_and(|actual| actual.trim_matches('"') == name)
            })
        })
        .unwrap_or_else(|| panic!("missing actual method {name}: {listing}"))
}

pub fn implementation_bodies(
    listing: &str,
    program: &nts_core::hir::Program,
    name: &str,
) -> String {
    implementation_names(program, name)
        .iter()
        .map(|name| method_listing(listing, name))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn java_members(template: &str) -> String {
    nts_codegen_jvm::generated_members::JAVA_TOKENS
        .iter()
        .fold(template.to_owned(), |source, (token, name)| {
            source.replace(token, name)
        })
}

pub fn tool(name: &str) -> Option<PathBuf> {
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let path = PathBuf::from(home).join("bin").join(name);
        if path.exists() {
            return Some(path);
        }
    }
    let found = nts_jvm_emitter::toolchain::command("sh")
        .arg("-c")
        .arg(format!("command -v {name}"))
        .output()
        .ok()?;
    found
        .status
        .success()
        .then(|| PathBuf::from(String::from_utf8_lossy(&found.stdout).trim().to_owned()))
}

/// A recursive copy, because a sabotage edits a copy and never the checkout.
pub fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// What a sabotaged run said.
pub struct Ran {
    pub said: String,
    pub stderr: String,
    pub ok: bool,
}

impl Ran {
    /// The lines a driver reports a broken case with.
    ///
    /// **Both spellings**, because the drivers do not agree: `StoreTest` prints
    /// `FAIL <what>` and `EnvTest` prints `FAILED: <what>`. Matching only the
    /// first found a sabotage that fired, reported the case it was aimed at,
    /// and was recorded as not having fired -- which is the failure this whole
    /// file exists to make impossible, arriving through the harness instead of
    /// through the sabotage.
    ///
    /// Whole lines rather than the message, so a caller's `contains` works
    /// whichever prefix a driver uses and nothing depends on the spelling. A
    /// run that *throws* has none of these, which is a different thing from a
    /// case reporting.
    pub fn failed(&self) -> Vec<&str> {
        self.said
            .lines()
            .filter(|it| it.starts_with("FAIL"))
            .collect()
    }
}

/// Applies `edits` to a copy of `runtime/jvm/src`, builds it with `driver`, and
/// runs the driver against it.
///
/// Each edit must match, and the match is asserted rather than skipped: a
/// sabotage whose target has been renamed silently stops sabotaging anything,
/// and a suite that then goes green reads as evidence.
pub fn with_sabotage(
    javac: &Path,
    java: &Path,
    name: &str,
    file: &str,
    edits: &[(&str, &str)],
    driver: &Path,
    args: &[String],
) -> Ran {
    let root = repository();
    let dir = std::env::temp_dir().join(format!(
        "nts-sabotage-{}-{:x}",
        std::process::id(),
        fingerprint(name)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let src = dir.join("src");
    copy_tree(&root.join("runtime/jvm/src"), &src);

    let target = src.join(file);
    let mut text = std::fs::read_to_string(&target)
        .unwrap_or_else(|_| panic!("the sabotage `{name}` names a file that is not there: {file}"));
    for (from, to) in edits {
        assert!(
            text.contains(from),
            "the sabotage `{name}` no longer matches `{from}`"
        );
        text = text.replace(from, to);
    }
    std::fs::write(&target, text).unwrap();

    let classes = dir.join("classes");
    let mut compile = nts_jvm_emitter::toolchain::command(javac);
    compile
        .args(["--release", "8", "-Xlint:-options", "-d"])
        .arg(&classes);
    for entry in std::fs::read_dir(src.join("nts/rt")).unwrap().flatten() {
        compile.arg(entry.path());
    }
    let built = compile.output().unwrap();
    assert!(
        built.status.success(),
        "`{name}` did not compile:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let built = nts_jvm_emitter::toolchain::command(javac)
        .args(["--release", "8", "-Xlint:-options", "-cp"])
        .arg(&classes)
        .arg("-d")
        .arg(&classes)
        .arg(driver)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "the driver did not compile under `{name}`:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );

    let stem = driver.file_stem().unwrap().to_string_lossy().into_owned();
    let mut run = nts_jvm_emitter::toolchain::command(java);
    run.arg("-cp").arg(&classes).arg(&stem);
    for arg in args {
        run.arg(arg);
    }
    let ran = run.output().unwrap();
    let out = Ran {
        said: String::from_utf8_lossy(&ran.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&ran.stderr).into_owned(),
        ok: ran.status.success(),
    };
    let _ = std::fs::remove_dir_all(&dir);
    out
}

/// A stable per-name suffix, so two sabotages running concurrently in one test
/// binary do not share a directory. Not a hash anyone should rely on.
fn fingerprint(name: &str) -> u32 {
    name.bytes().fold(2_166_136_261u32, |at, byte| {
        (at ^ u32::from(byte)).wrapping_mul(16_777_619)
    })
}
