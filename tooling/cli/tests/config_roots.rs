//! `exports:` in `nts.config.ts` narrows what a build keeps.
//!
//! **The field existed for three rounds of design before anything read it.** It
//! was argued down from required to optional, given a documented default, and
//! audited twice -- and `grep -rn "nts\.config" --include="*.rs"` returned two
//! comments and no code. These tests are what make it a fact rather than a
//! shape: a config on disk changes the functions the compiler emits.
//!
//! The half that is not tested here is named rather than left implicit. Nothing
//! reads `manifests`, `dependencies` or `integrate` yet, so nothing here
//! pretends to.
//!
//! Skips when node or the frontend is absent -- the config is TypeScript and is
//! evaluated rather than parsed, so there is nothing to read without both.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

const SOURCE: &str = r"
function onlyPublished(n: number): number { return n * 3; }
function onlyDiagnostic(n: number): number { return n + 7; }

export function published(n: number): number { return onlyPublished(n); }
export function diagnostic(n: number): number { return onlyDiagnostic(n); }
";

const NAMES: [&str; 4] = ["published", "diagnostic", "onlyPublished", "onlyDiagnostic"];

fn available() -> bool {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let node = Command::new(std::env::var("NTS_NODE").unwrap_or_else(|_| "node".to_owned()))
        .arg("--version")
        .output()
        .is_ok_and(|out| out.status.success());
    frontend && node
}

/// A project with `@nts/config` resolvable, which is what a real one has.
///
/// The symlink is the whole point of doing this rather than hand-writing a JSON
/// fixture: the config is evaluated by node against **the package this
/// repository ships**, so `library.node({ exports })` produces here exactly what
/// it produces for a user. A fixture that restated the resolved shape would be a
/// second implementation of the constructors, which is the thing
/// `nts_build::config` exists to avoid.
fn fixture(name: &str, config: Option<&str>) -> PathBuf {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let src = root.join("src");
    std::fs::create_dir_all(&src).expect("creating the fixture");
    std::fs::write(src.join("main.ts"), SOURCE).expect("writing the source");
    std::fs::write(
        root.join("tsconfig.json"),
        r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":false},"include":["src/**/*"]}"#,
    )
    .expect("writing the tsconfig");

    let scope = root.join("node_modules").join("@nts");
    std::fs::create_dir_all(&scope).expect("creating node_modules");
    let link = scope.join("config");
    if !link.exists() {
        let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../config");
        std::os::unix::fs::symlink(package, &link).expect("linking @nts/config");
    }

    let path = root.join("nts.config.ts");
    match config {
        Some(text) => std::fs::write(&path, text).expect("writing the config"),
        // Removed rather than never written, so a test can reuse a directory an
        // earlier one configured and still mean "no config".
        None => drop(std::fs::remove_file(&path)),
    }
    root
}

fn defined(output: &str) -> BTreeSet<String> {
    NAMES
        .iter()
        .filter(|name| {
            output.lines().any(|line| {
                let trimmed = line.trim_start();
                trimmed.contains(&format!("{name}(double ")) && trimmed.ends_with('{')
            })
        })
        .map(|name| (*name).to_owned())
        .collect()
}

struct Run {
    ok: bool,
    kept: BTreeSet<String>,
    stderr: String,
}

fn emit(project: &Path, extra: &[&str]) -> Run {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("emit-c")
        .arg(project.join("tsconfig.json"))
        .args(extra)
        .output()
        .expect("running emit-c");
    Run {
        ok: output.status.success(),
        kept: defined(&String::from_utf8_lossy(&output.stdout)),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

fn names(of: &[&str]) -> BTreeSet<String> {
    of.iter().map(|n| (*n).to_owned()).collect()
}

const ONE_PRODUCT: &str = r#"
import { defineConfig, library } from "@nts/config";
export default defineConfig({
  products: {
    addon: library.node({ entry: "./src/main.ts", apiVersion: 8, exports: ["published"] }),
  },
});
"#;

#[test]
fn a_config_narrows_what_is_emitted() {
    if !available() {
        eprintln!("skipping: needs node and the tsgo frontend");
        return;
    }
    let project = fixture("config-narrows", Some(ONE_PRODUCT));
    let run = emit(&project, &[]);
    assert!(run.ok, "{}", run.stderr);
    assert_eq!(run.kept, names(&["published", "onlyPublished"]));
    // Silent narrowing is indistinguishable from a compiler that lost the
    // function, so it says so.
    assert!(run.stderr.contains("publishes 1 name"), "{}", run.stderr);
}

/// The arm without which the one above proves nothing.
///
/// Same directory, same source, config deleted. If this kept only `published`
/// too, the narrowing above would be something else -- the `exports` list is the
/// only thing that differs between the two runs.
#[test]
fn without_the_config_every_export_is_a_root() {
    if !available() {
        eprintln!("skipping: needs node and the tsgo frontend");
        return;
    }
    let project = fixture("config-absent", Some(ONE_PRODUCT));
    assert_eq!(emit(&project, &[]).kept, names(&["published", "onlyPublished"]));
    let project = fixture("config-absent", None);
    assert_eq!(emit(&project, &[]).kept, names(NAMES.as_slice()));
}

#[test]
fn a_flag_beats_the_file() {
    if !available() {
        eprintln!("skipping: needs node and the tsgo frontend");
        return;
    }
    let project = fixture("config-flag-wins", Some(ONE_PRODUCT));
    let run = emit(&project, &["--entry", "diagnostic"]);
    assert!(run.ok, "{}", run.stderr);
    assert_eq!(run.kept, names(&["diagnostic", "onlyDiagnostic"]));
}

/// Several products and no `--product` stops, rather than picking one.
///
/// Emitting an artifact nobody asked for, under a name that says otherwise, is
/// worse than failing -- and the message has to name what it found, or the fix
/// is a guess.
#[test]
fn several_products_refuse_to_be_guessed() {
    if !available() {
        eprintln!("skipping: needs node and the tsgo frontend");
        return;
    }
    let project = fixture(
        "config-two-products",
        Some(
            r#"
import { defineConfig, library } from "@nts/config";
export default defineConfig({
  products: {
    addon: library.node({ entry: "./src/main.ts", apiVersion: 8, exports: ["published"] }),
    sdk: library.native({ targets: [], entry: "./src/main.ts" }),
  },
});
"#,
        ),
    );
    let run = emit(&project, &[]);
    assert!(!run.ok, "expected a refusal, got:\n{}", run.stderr);
    assert!(run.stderr.contains("--product"), "{}", run.stderr);
    assert!(run.stderr.contains("addon") && run.stderr.contains("sdk"), "{}", run.stderr);

    let chosen = emit(&project, &["--product", "addon"]);
    assert!(chosen.ok, "{}", chosen.stderr);
    assert_eq!(chosen.kept, names(&["published", "onlyPublished"]));

    // `sdk` declares no `exports`, which is not the same as declaring none.
    let wide = emit(&project, &["--product", "sdk"]);
    assert!(wide.ok, "{}", wide.stderr);
    assert_eq!(wide.kept, names(NAMES.as_slice()));
}

/// A config that exists and cannot be read is an error, never a fall-through.
///
/// This is the direction that matters. A permissive failure here means a build
/// that quietly ignores the file it was configured by, and the artifact is wrong
/// in a way nothing reports.
#[test]
fn a_broken_config_stops_the_build() {
    if !available() {
        eprintln!("skipping: needs node and the tsgo frontend");
        return;
    }
    let project = fixture(
        "config-broken",
        Some("throw new Error('the config itself failed');\n"),
    );
    let run = emit(&project, &[]);
    assert!(!run.ok, "a throwing config should stop the build");
    assert!(run.stderr.contains("the config itself failed"), "{}", run.stderr);

    let project = fixture("config-broken", Some("export default 42;\n"));
    let run = emit(&project, &[]);
    assert!(!run.ok, "a config that is not a config should stop the build");
}
