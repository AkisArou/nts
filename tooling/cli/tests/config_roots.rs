//! A product's `entry` in `nts.config.ts` decides what a build publishes.
//!
//! **The config existed for three rounds of design before anything read it.**
//! `grep -rn "nts\.config" --include="*.rs"` returned two comments and no code.
//! These tests are what make it a fact rather than a shape: a config on disk
//! changes the functions the compiler emits.
//!
//! What it publishes is **what the entry module exports**, which is the whole of
//! the claim. An `exports: [...]` list sat in the config for one commit, and it
//! was a second statement of that -- it only had a question to answer because
//! the default root set is `EveryExport`, which roots at the `export` keyword in
//! every module and is wider than any artifact can publish. The fixture below is
//! built to tell those two apart: `internal.ts` exports a function the entry
//! does not re-export, so `EveryExport` keeps it and `EntrySurface` does not.
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

/// The entry. Publishes `published`, and reaches one private helper.
const ENTRY: &str = r"
import { helper } from './internal.js';

function onlyPublished(n: number): number { return n * 3; }

export function published(n: number): number { return onlyPublished(n) + helper(0); }
";

/// A sibling the entry imports one name from.
///
/// `diagnostic` is the discriminator: it carries `export`, so the `exported`
/// flag makes it a root under `EveryExport`, and the entry does not re-export
/// it, so it is not in the artifact's surface. A test in the same project can
/// still import this module directly, which is the case the deleted `exports`
/// field was introduced to serve.
const INTERNAL: &str = r"
function onlyDiagnostic(n: number): number { return n + 7; }

export function helper(n: number): number { return n; }
export function diagnostic(n: number): number { return onlyDiagnostic(n); }
";

const NAMES: [&str; 5] =
    ["published", "diagnostic", "onlyPublished", "onlyDiagnostic", "helper"];

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
    std::fs::write(src.join("main.ts"), ENTRY).expect("writing the entry");
    std::fs::write(src.join("internal.ts"), INTERNAL).expect("writing the sibling");
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
    addon: library.node({ entry: "./src/main.ts", apiVersion: 8 }),
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
    // `diagnostic` does not survive although it carries `export`, which is the
    // whole distinction: the `exported` flag is what `EveryExport` roots at and
    // the entry not re-exporting it is what `EntrySurface` asks.
    //
    // `helper` is absent too, and for an unrelated reason worth knowing before
    // reading it as evidence: the entry *does* call it, and it is `return n`, so
    // it is inlined and leaves no definition. A trivial function is not a usable
    // reachability probe. `diagnostic` is, because it has a body no caller.
    assert_eq!(run.kept, names(&["published", "onlyPublished"]));
    // Silent narrowing is indistinguishable from a compiler that lost the
    // function, so it says so.
    assert!(run.stderr.contains("publishes what"), "{}", run.stderr);
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
    addon: library.node({ entry: "./src/main.ts", apiVersion: 8 }),
    sdk: library.native({ targets: [], entry: "./src/internal.ts" }),
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

    // **The two products differ only in their entry, and publish different
    // things.** `sdk` roots at `internal.ts`, so `diagnostic` is in its surface
    // and `published` is not -- which is a claim `--product` has to be carrying
    // for this to pass, and the surface has to be coming from the entry rather
    // than from anything global.
    // `helper` appears here and not above, which is the same fact from the other
    // side: `internal.ts` is this product's entry, so `helper` is a *root* and a
    // root is never inlined away.
    let other = emit(&project, &["--product", "sdk"]);
    assert!(other.ok, "{}", other.stderr);
    assert_eq!(other.kept, names(&["diagnostic", "onlyDiagnostic", "helper"]));
    assert!(
        chosen.kept.is_disjoint(&other.kept),
        "two products differing only in `entry` should publish disjoint surfaces",
    );
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
