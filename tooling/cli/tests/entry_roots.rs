//! `--entry` names the reachability roots, and every emitter must honour it.
//!
//! **This exists because one of them did not, silently.** `emit-c` had the roots
//! decision written out separately from `emit_options`, and the copy had
//! drifted: it read `--main` and not `--entry`, so the flag was accepted,
//! ignored, and the output looked like an answer. `emit-llvm` and `emit-jvm`
//! honoured it. Nothing compared them, and nothing could have: `tooling/cli` had
//! no tests at all.
//!
//! The assertion that catches it is not "narrowing works" but **"the emitters
//! keep the same set"**. One backend dropping a function the others keep is the
//! bug; a per-backend test of the narrowing would have passed on LLVM, passed on
//! the JVM, and been absent for C.
//!
//! Skips when the TypeScript frontend cannot be found -- there is no program to
//! lower without it -- and fails rather than skips when it is present, which is
//! the rule `runtime_jar.rs` states for the JDK.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Two exports, each reaching one private helper and nothing else.
///
/// The helpers are the point. Narrowing to `published` must drop `diagnostic`
/// *and* `onlyDiagnostic`: a root set that kept the second would be pruning the
/// export list rather than computing reachability, and on a program this small
/// the difference is invisible without them.
const SOURCE: &str = r"
function onlyPublished(n: number): number { return n * 3; }
function onlyDiagnostic(n: number): number { return n + 7; }

export function published(n: number): number { return onlyPublished(n); }
export function diagnostic(n: number): number { return onlyDiagnostic(n); }
";

const NAMES: [&str; 4] = ["published", "diagnostic", "onlyPublished", "onlyDiagnostic"];

fn frontend_available() -> bool {
    std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some()
}

/// A project on disk, under Cargo's own temp directory for this test target.
///
/// **Named per test, because the first version shared one directory.** Cargo
/// runs the two tests in this file on separate threads, both called this, and
/// both rewrote the same `tsconfig.json` and `main.ts` while the other was
/// invoking the compiler against them. It surfaced as the restored run leaving
/// one test red after a sabotage the change had already fixed -- a failure that
/// reads as "the fix did not take" and was the harness reading a half-written
/// file.
fn fixture(name: &str) -> PathBuf {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let src = root.join("src");
    std::fs::create_dir_all(&src).expect("creating the fixture");
    std::fs::write(src.join("main.ts"), SOURCE).expect("writing the source");
    // `extends` would need a path out of the temp directory, so the settings
    // this needs are written out: `strict` because the repository compiles that
    // way, and nothing else, because nothing else is load-bearing here.
    std::fs::write(
        root.join("tsconfig.json"),
        r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":false},"include":["src/**/*"]}"#,
    )
    .expect("writing the tsconfig");
    root
}

/// The functions an emitter *defined*, as opposed to declared.
///
/// A prototype survives pruning in the C header and would make the C column
/// disagree with the other two for a reason that is not the question. So the
/// match is on the definition -- a name followed by a parameter list and an
/// opening brace, which both C and the LLVM `define` line carry.
fn defined(output: &str) -> BTreeSet<String> {
    NAMES
        .iter()
        .filter(|name| {
            output.lines().any(|line| {
                let trimmed = line.trim_start();
                (trimmed.contains(&format!("{name}(double ")) && trimmed.ends_with('{'))
                    || trimmed.starts_with(&format!("define double @{name}("))
            })
        })
        .map(|name| (*name).to_owned())
        .collect()
}

fn emit(command: &str, project: &Path, extra: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg(command)
        .arg(project.join("tsconfig.json"))
        .args(extra)
        .output()
        .unwrap_or_else(|why| panic!("running {command}: {why}"));
    assert!(
        output.status.success(),
        "{command} {extra:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("emitter output is not UTF-8")
}

#[test]
fn every_emitter_honours_entry() {
    if !frontend_available() {
        eprintln!("skipping: no tsgo frontend; set NTS_TSGO to run this");
        return;
    }
    let project = fixture("entry-roots-honours");
    let all: BTreeSet<String> = NAMES.iter().map(|n| (*n).to_owned()).collect();
    let narrowed: BTreeSet<String> =
        ["published", "onlyPublished"].iter().map(|n| (*n).to_owned()).collect();

    for command in ["emit-c", "emit-llvm"] {
        assert_eq!(
            defined(&emit(command, &project, &[])),
            all,
            "{command} with no roots named should define every function",
        );
        assert_eq!(
            defined(&emit(command, &project, &["--entry", "published"])),
            narrowed,
            "{command} --entry published should keep only what `published` reaches",
        );
    }
}

/// The invariant the per-emitter assertions above cannot state on their own.
///
/// One HIR, two renderers: whatever reachability decides, both must render the
/// same set. This is the assertion that was false for as long as `emit-c` had
/// its own copy of the roots decision.
#[test]
fn the_emitters_agree_about_what_survives() {
    if !frontend_available() {
        eprintln!("skipping: no tsgo frontend; set NTS_TSGO to run this");
        return;
    }
    let project = fixture("entry-roots-agree");
    for extra in [vec![], vec!["--entry", "published"], vec!["--main"]] {
        let c = defined(&emit("emit-c", &project, &extra));
        let llvm = defined(&emit("emit-llvm", &project, &extra));
        assert_eq!(c, llvm, "emit-c and emit-llvm disagree with {extra:?}");
    }
}
