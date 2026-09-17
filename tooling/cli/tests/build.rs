//! `nts build` produces the artifacts a config declares.
//!
//! **The command that was missing.** `nts` had seventeen subcommands and none of
//! them built anything, so twenty-two `build.sh` in this tree each reconstructed
//! the pipeline: emit, compile the runtime beside it, link, package. Each could
//! drift from what the compiler actually emits, and several carried flags a
//! person had to know.
//!
//! The assertions here are about the *artifact*, not about the command
//! succeeding. A build that writes a file nothing can link is the failure this
//! lane keeps finding one layer up, and `nts build` exited zero on one for as
//! long as it took to run `nm` on the result.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

const ENTRY: &str = r"
import { helper } from './internal.js';

// Module-level state, and the reason it is here: the string is built and
// stored by `module__init`, so a library that does not run that on load
// publishes a null pointer rather than failing to link.
//
// **Exported, and read as a pointer by the consumer.** The first version called
// a function returning `label.length`, which the compiler folds to a constant --
// so it answered 5 whether or not the module had been evaluated, and passed with
// the initialiser removed. A check whose answer does not depend on its input is
// not a check.
export const label = 'ready';

export function published(n: number): number { return helper(n) * 3; }
";

const INTERNAL: &str = r"
export function helper(n: number): number { return n + 1; }
export function notPublished(n: number): number { return n - 1; }
";

/// Say what is missing, because a test that returns quietly reports `ok`.
///
/// **Sixteen tests here skipped in silence**, every one written on 2026-09-16,
/// in a file whose older tests all print a reason. A suite goes green over
/// tooling that was never installed and the count says `ok` either way --
/// `examples/interop/java-from-ts/build.sh` states the rule: "a skip that
/// prints nothing is indistinguishable from a pass".
///
/// **And printing it is not enough, which is the part that took a measurement.**
/// `cargo test` captures a passing test's output, so an `eprintln!` from a test
/// that skipped is discarded -- the message exists only under `--nocapture`,
/// which is not how `tooling/gate/all.sh` runs the suite. The older tests in
/// this file have followed that convention for as long as they have existed and
/// **none of their messages has ever been seen by the gate.** Verified by
/// shadowing `zig` with a stub that exits 1: `test result: ok`, zero output,
/// and the line appears the moment `--nocapture` is added.
///
/// So the announcement is kept for a person debugging, and
/// `NTS_TESTS_REQUIRE_TOOLING=1` turns every skip into a failure -- which is
/// the form a CI image or a gate step can actually act on, because a panic is
/// the one thing `cargo test` does not swallow.
#[track_caller]
fn skip(needs: &str) {
    let at = std::panic::Location::caller();
    assert!(
        std::env::var_os("NTS_TESTS_REQUIRE_TOOLING").is_none(),
        "skipped {at} for want of {needs}, and NTS_TESTS_REQUIRE_TOOLING says this \
         machine should have it"
    );
    eprintln!("skipping {at}: needs {needs}");
}

fn available() -> bool {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let tool = |name: &str, arg: &str| {
        Command::new(name).arg(arg).output().is_ok_and(|o| o.status.success())
    };
    let node = tool(&std::env::var("NTS_NODE").unwrap_or_else(|_| "node".to_owned()), "--version");
    frontend && node && tool("clang", "--version") && tool("nm", "--version")
}

fn fixture(name: &str, config: &str) -> PathBuf {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let src = root.join("src");
    std::fs::create_dir_all(&src).expect("creating the fixture");
    std::fs::write(src.join("main.ts"), ENTRY).expect("entry");
    std::fs::write(src.join("internal.ts"), INTERNAL).expect("sibling");
    std::fs::write(
        root.join("tsconfig.json"),
        r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":false},"include":["src/**/*"]}"#,
    )
    .expect("tsconfig");
    let scope = root.join("node_modules").join("@nts");
    std::fs::create_dir_all(&scope).expect("node_modules");
    let link = scope.join("config");
    if !link.exists() {
        let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../config");
        std::os::unix::fs::symlink(package, &link).expect("linking @nts/config");
    }
    std::fs::write(root.join("nts.config.ts"), config).expect("config");
    // A previous run's artifacts must not be able to pass for this one's.
    drop(std::fs::remove_dir_all(root.join(".nts")));
    root
}

struct Run {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn build(project: &Path, extra: &[&str]) -> Run {
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .arg(project.join("tsconfig.json"))
        .args(extra)
        .output()
        .expect("running nts build");
    Run {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

/// Function symbols the dynamic table publishes.
fn exported(artifact: &Path) -> BTreeSet<String> {
    let output = Command::new("nm")
        .args(["-D", "--defined-only"])
        .arg(artifact)
        .output()
        .expect("running nm");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let kind = fields.nth(1)?;
            let name = fields.next()?;
            (kind == "T").then(|| name.to_owned())
        })
        .collect()
}

const SHARED: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux({ backend: "c" })], entry: "./src/main.ts" }),
  },
});
"#;

/// The artifact exists, links, and publishes exactly the entry's surface.
///
/// **The symbol count is the assertion.** Linked without a version script, this
/// library exports 318 symbols -- every internal of the runtime and of the
/// vendored dtoa -- which is the collision `apps/linux-brownfield` describes in
/// a comment and had no field to prevent. `nts build` exits zero either way.
#[test]
fn a_shared_library_publishes_its_entry_and_nothing_else() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture("build-shared", SHARED);
    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);

    let artifact = project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");
    assert!(artifact.exists(), "no artifact at {}", artifact.display());
    let symbols = exported(&artifact);
    assert!(symbols.contains("published"), "the entry's export is missing: {symbols:?}");
    assert!(
        !symbols.contains("notPublished") && !symbols.contains("helper"),
        "a name the entry does not export crossed the ABI: {symbols:?}",
    );
    assert!(
        symbols.len() < 5,
        "the runtime's internals are public; there is no version script: {} symbols",
        symbols.len(),
    );
}

/// A backend that cannot write a program is named, not skipped.
///
/// Silently omitting one of several targets is worse than stopping, because the
/// missing artifact is found by whoever links against it.
#[test]
fn a_backend_that_cannot_write_is_refused_by_name() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    // **`backend: "llvm"` is said out loud, and that is the point of the test.**
    // It used to arrive by default, which meant this asserted the refusal *and*
    // silently asserted that the default was unbuildable. The default is now
    // `c`, so a config has to ask for llvm to get this message -- and asking
    // for it is a thing somebody might legitimately do.
    // Not `build-llvm`: the assertion below looks for "llvm" in the message, and
    // a directory named for it would put it in every path printed. See
    // `a_build_that_drops_functions_says_how_many`, where that mistake made a
    // test pass for two hours without checking anything.
    let project = fixture(
        "build-backend-refusal",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({
      targets: [target.linux({ backend: "llvm" })],
      entry: "./src/main.ts",
    }),
  },
});
"#,
    );
    let run = build(&project, &[]);
    assert!(!run.ok, "expected a refusal:\n{}", run.stdout);
    assert!(run.stderr.contains("llvm"), "{}", run.stderr);
    assert!(run.stderr.contains("acme"), "{}", run.stderr);
}

/// Several products build by default; `--product` builds one.
#[test]
fn every_product_is_built_unless_one_is_named() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture(
        "build-two",
        r#"
import { defineConfig, library, target } from "@nts/config";
const targets = [target.linux({ backend: "c" })];
export default defineConfig({
  products: {
    acme: library.native({ targets, entry: "./src/main.ts" }),
    acmeStatic: library.staticNative({ targets, entry: "./src/main.ts" }),
  },
});
"#,
    );
    let all = build(&project, &[]);
    assert!(all.ok, "{}{}", all.stdout, all.stderr);
    assert!(project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so").exists());
    assert!(
        project.join(".nts/build/acmeStatic/linux-gnu-x86_64/libacmeStatic.a").exists(),
        "the static archive was not built:\n{}",
        all.stdout,
    );

    let project = fixture("build-one", SHARED);
    let one = build(&project, &["--product", "acme"]);
    assert!(one.ok, "{}{}", one.stdout, one.stderr);
    assert!(project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so").exists());
}

/// A library runs its own module evaluation when it loads.
///
/// **Nothing caught this until it was asked directly.** The three tests above
/// all pass with the `.init_array` entry removed: the artifact exists, links,
/// and publishes the right symbols. What it does not do is *work* --
/// module-level state stays null, so `label.length` reads through a null
/// pointer. That is a wrong answer rather than a link error, and it is the same
/// failure the root set had when module initialization was left out of it.
///
/// So the assertion is a consumer that links the library and runs.
#[test]
fn a_library_initialises_itself_on_load() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture("build-init", SHARED);
    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    let artifact = project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");

    // **Through the generated header**, with no `extern` written by hand. That
    // is the point of the check as much as the initialiser is: `program.h`'s
    // export loop used to walk `public_api`, look each name up among `funcs`,
    // and skip a published *value* in silence -- so a header that looked
    // complete dropped `label`, and a consumer had to declare it themselves.
    let consumer = project.join("use.c");
    std::fs::write(
        &consumer,
        r#"#include <stdio.h>
#include "program.h"
int main(void) { printf("%s\n", label ? "initialised" : "NULL"); return label ? 0 : 1; }
"#,
    )
    .expect("writing the consumer");
    let binary = project.join("use");
    let compiled = Command::new("clang")
        .arg("-I")
        .arg(project.join(".nts/build/acme/linux-gnu-x86_64"))
        .arg(&consumer)
        .arg(&artifact)
        .arg("-o")
        .arg(&binary)
        .output()
        .expect("compiling the consumer");
    assert!(
        compiled.status.success(),
        "the consumer did not link: {}",
        String::from_utf8_lossy(&compiled.stderr),
    );
    let ran = Command::new(&binary).output().expect("running the consumer");
    assert!(
        ran.status.success(),
        "the library loaded without evaluating its module: `label` is null.\nstdout: {}",
        String::from_utf8_lossy(&ran.stdout),
    );
}

/// An executable links its host and terminates.
///
/// **A compiled program has nothing to print with**, which `examples/standalone`
/// states and is why the assertion is termination *and* exit zero. The two
/// pending timers are the point: a program that exits before they run has a loop
/// that gave up early, and one that never exits has a handle nothing will close.
///
/// It also covers a link that the library cases cannot. `main.c` calls
/// `nts_uv_host_run` and `nts_uv_host_shutdown`, which live in a translation
/// unit `write_standalone` writes and the first version of this build did not
/// compile -- an undefined reference, caught here rather than by a person.
#[test]
fn an_executable_links_its_host_and_terminates() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture(
        "build-exe",
        r#"
import { defineConfig, app } from "@nts/config";
export default defineConfig({ products: { runner: app.cli({ entry: "./src/main.ts" }) } });
"#,
    );
    // Top-level code, because that is what an executable runs. An exported
    // function nothing calls is not a root for one and would be pruned.
    std::fs::write(
        project.join("src/main.ts"),
        "let ticks = 0;\nfunction record(): void { ticks = ticks + 1; }\nsetTimeout(record, 1);\nsetTimeout(record, 2);\n",
    )
    .expect("writing the program");
    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    assert!(
        !run.stdout.contains("cc -std=c11"),
        "the build printed a compile command it had already run:\n{}",
        run.stdout,
    );

    let binary = project.join(".nts/build/runner/linux-gnu-x86_64/runner");
    assert!(binary.exists(), "no executable at {}", binary.display());
    let ran = Command::new(&binary).output().expect("running the program");
    assert!(
        ran.status.success(),
        "the program did not terminate cleanly: {:?}\n{}",
        ran.status,
        String::from_utf8_lossy(&ran.stderr),
    );
}

/// A build that drops functions says so, rather than reporting an artifact.
///
/// `emit-c` prints each refusal and exits zero on purpose -- most are declines,
/// and the program that remains is the one the tree builds. But a build whose
/// last line is `1 artifact(s)` has told the reader the opposite of what
/// happened: a probe emitted an executable whose only statement was refused,
/// and it compiled, linked, ran, exited zero and did nothing.
#[test]
fn a_build_that_drops_functions_says_how_many() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    // **Not named after what it tests.** The directory was `build-refused`, and
    // every path `nts build` prints contains it -- so `stdout.contains("refused")`
    // was true for the fixture's own name, the test passed with the reporting
    // deleted, and it had never once checked anything. A check whose answer does
    // not depend on its input is not a check.
    let project = fixture("build-dropped", SHARED);
    // `console.log` is a global with no definition here, and lowering refuses
    // it by name.
    std::fs::write(
        project.join("src/main.ts"),
        "export function published(): void { console.log('x'); }\n",
    )
    .expect("writing the program");
    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    // The count, not the word: the phrasing carries a number, and a build that
    // merely mentioned refusals without saying how many would still be hiding
    // the size of what it dropped.
    assert!(
        run.stdout.contains("1 function(s) refused"),
        "the build reported an artifact and not the functions missing from it:\n{}",
        run.stdout,
    );
    assert!(
        run.stdout.contains("missing 1 refused function(s)"),
        "the summary line claimed an artifact with nothing missing:\n{}",
        run.stdout,
    );
    // **A refusal is not "published without a symbol".** Both end with an
    // exported name absent from the symbol table, and one sentence for the two
    // would report every refusal twice while making the other message mean
    // nothing. This export was refused; the class message is for a name that
    // compiled and still crosses nothing.
    assert!(
        !run.stdout.contains("crosses no C symbol"),
        "a refused export was reported as though it had compiled:\n{}",
        run.stdout,
    );
}

/// An exported class is named as publishing nothing, and the link still narrows.
///
/// # Two absences that look alike from the symbol table
///
/// `program.h` emits `struct NtsObj_Counter` with its fields, its offsets and
/// its `_Static_assert`s -- and not one function, because `bump` takes
/// `NtsObj_Counter *` and the boundary hands out no way to obtain one. So the
/// class is in `public_api`, the artifact has nothing it can answer to, and for
/// a shared library `local: *` then hides the methods that do exist.
///
/// The version script used to be spelled `c_identifier` over `public_api`, which
/// wrote `global: Counter;` -- a name nothing answers to. `ld` accepts an
/// unmatched pattern silently by default, so the `.so` came out publishing only
/// the loose function and no message said so.
#[test]
fn a_published_class_is_named_as_crossing_no_symbol() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture("build-classless-abi", SHARED);
    std::fs::write(
        project.join("src/main.ts"),
        "export class Counter {\n  private n: number = 0;\n  bump(): number { this.n = this.n + 1; return this.n; }\n}\nexport function published(x: number): number { return x + 1; }\n",
    )
    .expect("writing the program");
    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    assert!(
        run.stdout.contains("`Counter` is exported but crosses no C symbol"),
        "the build published a class silently:\n{}",
        run.stdout,
    );
    // The control, and the half that is not about wording: `published` still
    // crosses. A version script that named nothing would also never print the
    // sentence above, and would pass a test that only looked for it.
    let artifact = project
        .join(".nts/build/acme/linux-gnu-x86_64")
        .join("libacme.so");
    let listed = std::process::Command::new("nm")
        .args(["-D", "--defined-only"])
        .arg(&artifact)
        .output()
        .expect("nm");
    let symbols = String::from_utf8_lossy(&listed.stdout);
    assert!(
        symbols.lines().any(|line| line.ends_with(" published")),
        "the loose function stopped crossing too:\n{symbols}",
    );
    assert!(
        !symbols.lines().any(|line| line.ends_with(" Counter")),
        "something now answers to `Counter`; the message above needs revisiting:\n{symbols}",
    );
}

/// A Node addon loads in node and answers.
///
/// **Loading is the assertion, because linking is not.** `emit-c --napi` emitted
/// a call to `nts_napi_set_env`, defined in `runtime/node/internal/process.c` --
/// present for every node module in this tree and absent from a standalone
/// addon. The `.node` linked, the build exited zero, and `require` died with
/// `symbol lookup error`. The napi emitter carries a weak default now, so this
/// checks the outcome rather than the refusal.
///
/// `nts build` still refuses an addon with any unresolved symbol that is not
/// `napi_`, which is the general form: `--no-undefined` cannot be used here,
/// because the `napi_` family is resolved out of the host process at load.
///
/// Skipped when `node_api.h` is nowhere to be found, because then the build
/// stops for a different reason.
#[test]
fn an_addon_loads_in_node() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let headers = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../third_party/node/src");
    if !headers.join("node_api.h").exists() {
        eprintln!("skipping: no node_api.h to build an addon against");
        return;
    }
    let project = fixture(
        "build-addon",
        r#"
import { defineConfig, library } from "@nts/config";
export default defineConfig({
  products: { thing: library.node({ entry: "./src/main.ts", apiVersion: 8 }) },
});
"#,
    );
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .arg(project.join("tsconfig.json"))
        .env("NTS_NAPI_INCLUDE", &headers)
        .output()
        .expect("running nts build");
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    let artifact = project.join(".nts/build/thing/node-api-8-x86_64/thing.node");
    assert!(artifact.exists(), "no addon at {}", artifact.display());

    let loaded = Command::new("node")
        .arg("-e")
        .arg(format!(
            "const a = require({:?}); process.stdout.write(String(a.published(2)));",
            artifact.to_string_lossy(),
        ))
        .output()
        .expect("running node");
    assert!(
        loaded.status.success(),
        "the addon linked and node could not load it:\n{}",
        String::from_utf8_lossy(&loaded.stderr),
    );
    // `helper(2)` is 3 and the entry triples it. A wrong answer here would mean
    // the addon loaded and published something other than what it compiled.
    assert_eq!(String::from_utf8_lossy(&loaded.stdout), "9");
}

/// A jar is packaged, runs, and lands in the package its config names.
///
/// **Two artifacts and not one.** `apps/java-desktop-brownfield` states the
/// open question: the runtime jar is either shaded in or declared as a
/// dependency, and "neither is free and the choice is not made". Both are
/// written, so the decision stays available.
///
/// **This test asserted a refusal until the refusal stopped being right.**
/// `javaPackage` had no reader and `codegen/jvm` hardcoded `nts/gen`, so a
/// config asking for anything else was stopped rather than half-honoured. The
/// emitter takes a package now, so the same config is built and the classes are
/// checked where it said they would be -- and `a_java_package_moves_the_classes_and_they_still_link`
/// carries the part this one cannot, which is a consumer compiling and running
/// against it.
#[test]
fn a_jar_is_packaged_in_the_package_its_config_names() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let jdk = Command::new("jar").arg("--version").output().is_ok_and(|o| o.status.success());
    if !jdk {
        eprintln!("skipping: no `jar` on PATH");
        return;
    }
    let config = |package: &str| {
        format!(
            r#"
import {{ defineConfig, library }} from "@nts/config";
export default defineConfig({{
  products: {{ calc: library.jvm({{ entry: "./src/main.ts", release: 8, javaPackage: "{package}" }}) }},
}});
"#
        )
    };

    let project = fixture("build-jar", &config("com.acme.sdk"));
    std::fs::write(
        project.join("src/main.ts"),
        "export function add(a: number, b: number): number { return a + b; }\n",
    )
    .expect("writing the program");
    let run = build(&project, &[]);
    assert!(run.ok, "the declared package was not built:\n{}{}", run.stdout, run.stderr);
    // **The archive exists, as its own statement.** `unzip` on a missing file
    // prints nothing and every `contains` below is then false -- so "the classes
    // are not where the config said" would be the message for "there is no jar",
    // which is the pair a check must never merge.
    let named = project.join(".nts/build/calc/java-8/calc.jar");
    assert!(named.is_file(), "no jar at {}:\n{}", named.display(), run.stdout);
    let placed = Command::new("unzip").arg("-l").arg(&named).output().expect("unzip");
    let placed = String::from_utf8_lossy(&placed.stdout);
    assert!(
        placed.contains("com/acme/sdk/") && !placed.contains("nts/gen/"),
        "the classes are not where the config said:\n{placed}"
    );

    // The rest of this asserts the jar itself, which is easier to read against
    // the default package -- and keeps a case where nothing names one.
    std::fs::write(project.join("nts.config.ts"), config("nts.gen")).expect("rewriting the config");
    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    let jar = project.join(".nts/build/calc/java-8/calc.jar");
    let runtime = project.join(".nts/build/calc/java-8/nts-runtime.jar");
    assert!(jar.exists(), "no jar at {}", jar.display());
    assert!(runtime.exists(), "the runtime a consumer needs was not reported beside it");

    // **`-Xverify:all`**, because a class file that loads is the assertion and a
    // verifier rejection is the characteristic failure of a bytecode emitter.
    let listed = Command::new("javap")
        .arg("-cp")
        .arg(&jar)
        .arg("nts.gen.Program")
        .output()
        .expect("running javap");
    assert!(
        String::from_utf8_lossy(&listed.stdout).contains("static double add(double, double)"),
        "the jar does not declare the entry's export:\n{}",
        String::from_utf8_lossy(&listed.stdout),
    );
}

/// A kind with no packaging is refused before anything is written.
///
/// **An `aar` product built a `.jar`** when this was written. The classes were
/// right; the container was not, and Gradle cannot resolve a jar where it
/// expects an AAR. A file of the wrong format under the right name is the worst
/// of the three outcomes -- worse than no file, and worse than a refusal --
/// because a reader has no reason to doubt it. AARs are packaged now, so the
/// case here is the one whose toolchain is genuinely absent.
///
/// The refusal is before the output directory exists, so a build that stops
/// leaves nothing to mistake for a partial result.
#[test]
fn a_kind_with_no_packaging_is_refused_before_it_writes() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    // An XCFramework rather than an AAR: AARs are packaged now, and the kind
    // with no container left is the one needing a toolchain this machine does
    // not have. The test moved rather than being deleted, because "a kind with
    // no packaging stops before it writes" is the rule and not the example.
    let project = fixture(
        "build-apple",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    sdk: library.xcframework({
      targets: [target.macos({ minimumVersion: "14.0" })],
      entry: "./src/main.ts",
      moduleName: "Probe",
    }),
  },
});
"#,
    );
    let run = build(&project, &[]);
    assert!(!run.ok, "a kind with no packaging should stop the build:\n{}", run.stdout);
    assert!(
        run.stderr.contains("xcodebuild"),
        "the refusal did not say what the container needs:\n{}",
        run.stderr,
    );
    assert!(
        !project.join(".nts").exists(),
        "the build wrote an output directory for a product it refused",
    );
}

/// A binding that disagrees with the headers stops the build.
///
/// **Sixteen `build.sh` in this tree compile the witness by hand**, each with
/// its own copy of `-Wall -Wextra -Werror -fsyntax-only`, and it is the step
/// that makes a generated binding a claim rather than an assertion: the witness
/// declares no symbol, includes the real headers itself, and fails to compile
/// when what `nts` believes about a struct disagrees with them. A wrong offset
/// is a silently wrong answer, not a link error.
///
/// The fixture is `examples/interop/native-uname`'s own binding, because a
/// hand-written one would be testing something `nts bind-c` does not produce.
#[test]
fn a_binding_that_disagrees_with_the_headers_stops_the_build() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    // Canonical, because the path lands inside a generated `tsconfig.json` and
    // `include` entries spelled with `..` resolved to nothing: `c:memory` and
    // `c:types` came back unfound while the same shape worked by hand.
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the repository root");
    let source = repo.join("examples/interop/native-uname");
    if !source.join("types/utsname.d.ts").exists() {
        eprintln!("skipping: the native-uname fixture is not here");
        return;
    }
    let project = Path::new(env!("CARGO_TARGET_TMPDIR")).join("build-witness");
    drop(std::fs::remove_dir_all(&project));
    std::fs::create_dir_all(project.join("src")).expect("creating the fixture");
    std::fs::create_dir_all(project.join("types")).expect("creating types");
    for (from, to) in [("src/main.ts", "src/main.ts"), ("types/utsname.d.ts", "types/utsname.d.ts")] {
        std::fs::copy(source.join(from), project.join(to)).expect("copying the fixture");
    }
    // Top-level use, so the binding is reachable: with `--main` a module's
    // exports are not roots, and a library-shaped program built as an executable
    // prunes every binding and needs no witness at all.
    let mut program = std::fs::read_to_string(project.join("src/main.ts")).expect("the program");
    program.push_str("\nlet observed = machineFirstByte();\nif (observed < 0) observed = 0;\n");
    std::fs::write(project.join("src/main.ts"), program).expect("writing the program");
    std::fs::write(
        project.join("tsconfig.json"),
        format!(
            r#"{{"extends":{:?},"compilerOptions":{{"noEmit":false}},"include":["src","types",{:?}]}}"#,
            repo.join("tsconfig.fixtures.json").to_string_lossy(),
            repo.join("runtime/native/libc.d.ts").to_string_lossy(),
        ),
    )
    .expect("tsconfig");
    let scope = project.join("node_modules").join("@nts");
    std::fs::create_dir_all(&scope).expect("node_modules");
    if !scope.join("config").exists() {
        std::os::unix::fs::symlink(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../config"),
            scope.join("config"),
        )
        .expect("linking @nts/config");
    }
    std::fs::write(
        project.join("nts.config.ts"),
        "import { defineConfig, app } from \"@nts/config\";\nexport default defineConfig({ products: { probe: app.cli({ entry: \"./src/main.ts\", backend: \"c\" }) } });\n",
    )
    .expect("config");

    let good = build(&project, &[]);
    assert!(good.ok, "the unmodified binding should build:\n{}{}", good.stdout, good.stderr);

    // 65 is what `<sys/utsname.h>` says. One less moves every later offset.
    let binding = project.join("types/utsname.d.ts");
    let text = std::fs::read_to_string(&binding).expect("the binding");
    std::fs::write(&binding, text.replacen("CArray<c_char, 65>", "CArray<c_char, 64>", 1))
        .expect("corrupting the binding");
    let bad = build(&project, &[]);
    assert!(!bad.ok, "a binding that disagrees with the headers should stop the build");
    assert!(
        bad.stderr.contains("does not match the headers"),
        "the refusal did not say what disagreed:\n{}",
        bad.stderr,
    );
}

/// A project whose own C the build must bind and compile.
///
/// `DIGEST_PRIME` is in the header rather than the `.c` on purpose: it makes the
/// header a dependency whose *value* reaches the artifact, which is what a cache
/// invalidation test needs. A header nothing depends on for its answer cannot
/// tell a reused object from a recompiled one.
fn native_fixture(name: &str) -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the repository root");
    let project = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    drop(std::fs::remove_dir_all(&project));
    for sub in ["src", "native"] {
        std::fs::create_dir_all(project.join(sub)).expect("creating the fixture");
    }
    std::fs::write(
        project.join("native/digest.h"),
        "#ifndef PROBE_DIGEST_H\n#define PROBE_DIGEST_H\n#include <stdint.h>\n#define DIGEST_PRIME 16777619u\nuint32_t digest_step(uint32_t seed, uint32_t value);\n#endif\n",
    )
    .expect("the header");
    std::fs::write(
        project.join("native/digest.c"),
        "#include \"digest.h\"\nuint32_t digest_step(uint32_t seed, uint32_t value) { return (seed ^ value) * DIGEST_PRIME; }\n",
    )
    .expect("the body");
    std::fs::write(
        project.join("src/main.ts"),
        "import { digest_step } from \"c:digest\";\nimport type { c_uint32 } from \"c:types\";\n\nexport function digestOf(value: number): number {\n  return digest_step(2166136261 as c_uint32, value as c_uint32);\n}\n",
    )
    .expect("the program");
    std::fs::write(
        project.join("tsconfig.json"),
        format!(
            r#"{{"extends":{:?},"compilerOptions":{{"noEmit":false}},"include":["src","types",{:?}]}}"#,
            repo.join("tsconfig.fixtures.json").to_string_lossy(),
            repo.join("runtime/native/libc.d.ts").to_string_lossy(),
        ),
    )
    .expect("tsconfig");
    let scope = project.join("node_modules").join("@nts");
    std::fs::create_dir_all(&scope).expect("node_modules");
    if !scope.join("config").exists() {
        std::os::unix::fs::symlink(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../config"),
            scope.join("config"),
        )
        .expect("linking @nts/config");
    }
    std::fs::write(
        project.join("nts.config.ts"),
        "import { defineConfig, library, sources, target } from \"@nts/config\";\nexport default defineConfig({\n  products: { probe: library.native({ targets: [target.linux({ backend: \"c\" })], entry: \"./src/main.ts\" }) },\n  native: [sources({ dir: \"native\", header: \"native/digest.h\" })],\n});\n",
    )
    .expect("config");
    project
}

/// A `c:` import becomes a binding, and the package's C is compiled with it.
///
/// **`native:` had no reader**, and this is the whole of what it is for. The
/// program says `import { digest_step } from "c:digest"`; the config says which
/// header declares it; `nts bind-c` needs both and neither repeats the other.
///
/// The import list is the binding's surface, because `nts bind-c` binds nothing
/// unless told what -- `--module` alone produces `declare module "c:digest" {}`
/// -- and the program has already named the function in the statement a reader
/// looks at anyway.
///
/// The assertion is the answer, not the artifact: the consumer computes the same
/// digest in C and compares, so a binding that generated and bound the wrong
/// thing fails here rather than linking quietly.
#[test]
fn a_c_import_is_bound_and_the_package_c_is_linked_in() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("the repository root");
    let project = native_fixture("build-binding");
    std::fs::write(
        project.join("src/main.ts"),
        "import { digest_step } from \"c:digest\";\nimport type { c_uint32 } from \"c:types\";\n\nexport function digestOf(value: number): number {\n  return digest_step(2166136261 as c_uint32, value as c_uint32);\n}\n",
    )
    .expect("the program");
    std::fs::write(
        project.join("tsconfig.json"),
        format!(
            r#"{{"extends":{:?},"compilerOptions":{{"noEmit":false}},"include":["src","types",{:?}]}}"#,
            repo.join("tsconfig.fixtures.json").to_string_lossy(),
            repo.join("runtime/native/libc.d.ts").to_string_lossy(),
        ),
    )
    .expect("tsconfig");
    let scope = project.join("node_modules").join("@nts");
    std::fs::create_dir_all(&scope).expect("node_modules");
    if !scope.join("config").exists() {
        std::os::unix::fs::symlink(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../config"),
            scope.join("config"),
        )
        .expect("linking @nts/config");
    }
    std::fs::write(
        project.join("nts.config.ts"),
        "import { defineConfig, library, sources, target } from \"@nts/config\";\nexport default defineConfig({\n  products: { probe: library.native({ targets: [target.linux({ backend: \"c\" })], entry: \"./src/main.ts\" }) },\n  native: [sources({ dir: \"native\", header: \"native/digest.h\" })],\n});\n",
    )
    .expect("config");

    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    assert!(
        run.stdout.contains("bound c:digest"),
        "the build did not say it generated a binding:\n{}",
        run.stdout,
    );
    assert!(
        project.join("types/c-digest.d.ts").exists(),
        "no generated binding on disk",
    );

    let consumer = project.join("use.c");
    std::fs::write(
        &consumer,
        r#"#include <stdio.h>
#include <stdint.h>
#include "program.h"
static uint32_t expected(uint32_t v) { return (2166136261u ^ v) * 16777619u; }
int main(void) { return (uint32_t)digestOf(7) == expected(7) ? 0 : 1; }
"#,
    )
    .expect("the consumer");
    let artifact = project.join(".nts/build/probe/linux-gnu-x86_64/libprobe.so");
    let binary = project.join("use");
    let compiled = Command::new("clang")
        .arg("-I")
        .arg(project.join(".nts/build/probe/linux-gnu-x86_64"))
        .arg(&consumer)
        .arg(&artifact)
        .arg("-o")
        .arg(&binary)
        .output()
        .expect("compiling the consumer");
    assert!(
        compiled.status.success(),
        "the consumer did not link -- the package's C is probably not in the artifact: {}",
        String::from_utf8_lossy(&compiled.stderr),
    );
    let ran = Command::new(&binary).output().expect("running the consumer");
    assert!(ran.status.success(), "the artifact answered something other than the C does");
}

/// An AAR carries its classes, its manifest fragment and its R8 rules.
///
/// **No Android SDK.** An AAR is a container the *consumer* dexes, so `d8` and
/// `aapt2` are their build's business. `jar` writes a zip, which is what an AAR
/// is -- and the thing that made this a refusal before was the container, not
/// the classes.
///
/// `manifests` and `consumerProguard` get their first readers here. The fragment
/// is *carried*, not merged: AGP has a manifest merger with a specification and
/// `runtime/jvm/web-platform/android/` already relies on it.
#[test]
fn an_aar_carries_its_manifest_and_rules() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    if !Command::new("jar").arg("--version").output().is_ok_and(|o| o.status.success()) {
        eprintln!("skipping: no `jar` on PATH");
        return;
    }
    let project = fixture(
        "build-android",
        r#"
import { defineConfig, library, manifest } from "@nts/config";
export default defineConfig({
  products: {
    sdk: library.android({
      entry: "./src/main.ts", minSdk: 29, javaPackage: "nts.gen",
      consumerProguard: "./proguard-rules.pro",
    }),
  },
  manifests: [manifest({ targets: ["android-29"], path: "manifests/android.xml" })],
});
"#,
    );
    std::fs::create_dir_all(project.join("manifests")).expect("manifests dir");
    std::fs::write(
        project.join("manifests/android.xml"),
        "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">\n  <uses-permission android:name=\"android.permission.POST_NOTIFICATIONS\" />\n</manifest>\n",
    )
    .expect("the fragment");
    std::fs::write(project.join("proguard-rules.pro"), "-keep class nts.gen.** { *; }\n")
        .expect("the rules");

    let run = build(&project, &[]);
    assert!(run.ok, "{}{}", run.stdout, run.stderr);
    let aar = project.join(".nts/build/sdk/android-29-aarch64/sdk.aar");
    assert!(aar.exists(), "no AAR at {}", aar.display());

    let listed = Command::new("jar").arg("--list").arg("--file").arg(&aar).output().expect("jar -t");
    let entries = String::from_utf8_lossy(&listed.stdout);
    for required in ["classes.jar", "AndroidManifest.xml", "proguard.txt"] {
        assert!(entries.contains(required), "the AAR has no {required}:\n{entries}");
    }

    // The manifest is the package's fragment, not a generated stand-in: a
    // consumer forgetting POST_NOTIFICATIONS gets a silent no-op at run time,
    // which is the failure the fragment exists to prevent.
    let staged = project.join(".nts/build/sdk/android-29-aarch64/aar/AndroidManifest.xml");
    let carried = std::fs::read_to_string(&staged).expect("the staged manifest");
    assert!(
        carried.contains("POST_NOTIFICATIONS"),
        "the AAR carries a generated manifest instead of the declared fragment:\n{carried}",
    );
}

/// Objects are reused between builds, and not when a header they read changed.
///
/// **Measured before built.** A build of `examples/library` was 1.10s, of which
/// compiling `nts_runtime.c` was 0.96s -- the emit 0.06, the config evaluation
/// 0.02, the program's own compile 0.02, the link 0.02. Caching the runtime was
/// the whole problem, and a general action cache would have been the wrong
/// shape. Cold 1.09s, unchanged 0.15s, and **0.14s after a one-line edit**.
///
/// **The header has to change the answer**, and the first version of this test
/// is why that is spelled out. It broke the *recorded* hashes while leaving the
/// files alone, so serving the stale object produced exactly the right artifact
/// and the test passed with the dependency check disabled. A cached object only
/// proves stale if a fresh compile would differ.
///
/// So `DIGEST_PRIME` lives in the header and the `.c` uses it: change the
/// constant and the artifact must answer differently. The build does not rewrite
/// a package's own header, which is what makes it usable as a dependency at all
/// -- everything in the output directory is regenerated identically every time.
#[test]
fn objects_are_reused_but_never_when_a_header_changed() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = native_fixture("build-cache");
    let artifact = project.join(".nts/build/probe/linux-gnu-x86_64/libprobe.so");

    let first = build(&project, &[]);
    assert!(first.ok, "{}{}", first.stdout, first.stderr);
    let cache = project.join(".nts/cache");
    let objects = || {
        std::fs::read_dir(&cache)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|item| item.path().extension().is_some_and(|it| it == "o"))
            .count()
    };
    assert!(objects() > 0, "nothing was cached; the default is supposed to be on");

    // Reusing must not change the artifact.
    let before = std::fs::read(&artifact).expect("the artifact");
    assert!(build(&project, &[]).ok, "the cached build failed");
    assert_eq!(std::fs::read(&artifact).expect("the artifact"), before, "a reused build differs");

    // **The direction that matters.** A header the object was compiled against
    // has changed, so the object is wrong and must not be handed back.
    let header = project.join("native/digest.h");
    let text = std::fs::read_to_string(&header).expect("the header");
    std::fs::write(&header, text.replace("16777619u", "2166136261u")).expect("editing the header");
    let after = build(&project, &[]);
    assert!(after.ok, "{}{}", after.stdout, after.stderr);
    assert_ne!(
        std::fs::read(&artifact).expect("the artifact"),
        before,
        "a changed header was served from the cache: the artifact still computes the old digest",
    );
}

/// A project with no config is told what is missing, not given a stack trace.
#[test]
fn a_project_with_no_config_says_so() {
    if !available() {
        eprintln!("skipping: needs node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture("build-no-config", SHARED);
    std::fs::remove_file(project.join("nts.config.ts")).expect("removing the config");
    let run = build(&project, &[]);
    assert!(!run.ok, "a build with nothing to build should stop");
    assert!(run.stderr.contains("nts.config.ts"), "{}", run.stderr);
}

/// The Android SDK components an APK needs, or `None` to skip.
///
/// Separate from `available()` because the two answer different questions: that
/// one gates the C lane on `clang` and `nm`, and an APK needs neither. A test
/// that skipped on a missing `clang` would be silent on a machine with a full
/// Android SDK and no C compiler, which is a plausible CI image.
fn android_sdk() -> Option<(PathBuf, PathBuf)> {
    let root = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .into_iter()
        .find_map(|var| std::env::var(var).ok().filter(|v| !v.is_empty()))
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(std::env::var("HOME").ok()?).join("Android/Sdk")))
        .filter(|path| path.is_dir())?;
    let mut versions: Vec<PathBuf> = std::fs::read_dir(root.join("build-tools"))
        .ok()?
        .filter_map(|entry| Some(entry.ok()?.path()))
        .collect();
    versions.sort();
    let tools = versions
        .into_iter()
        .rev()
        .find(|dir| ["aapt2", "d8", "apksigner", "zipalign"].iter().all(|t| dir.join(t).is_file()))?;
    let platform = root.join("platforms/android-36/android.jar");
    platform.is_file().then_some((tools, platform))
}

const ANDROID_APP: &str = r#"
import { defineConfig, app } from "@nts/config";
export default defineConfig({
  products: {
    demo: app.android({
      entry: "./src/main.ts",
      id: "dev.nts.buildtest",
      minSdk: 29,
      compileSdk: 36,
    }),
  },
});
"#;

/// An APK that a device would install, asserted through the platform's own tools.
///
/// **Six tools run and the file existing proves none of them worked.** `aapt2`
/// writes a container whether or not a dex was ever added; `jar --update` will
/// happily produce a zip ART cannot load; and an unsigned APK is a file of the
/// right shape that no device accepts. So every assertion here is a question
/// put to the toolchain rather than to the filesystem: does `apksigner` verify
/// it, does the dex exist inside, and does the manifest say what the config
/// said. Checking `artifact.exists()` would have passed on the first draft,
/// which wrote an APK with no `classes.dex` in it at all.
#[test]
fn an_android_application_is_a_signed_installable_apk() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let Some((tools, _)) = android_sdk() else {
        skip("an Android SDK with build-tools and platform 36");
        return;
    };
    if !frontend {
        skip("the tsgo frontend");
        return;
    }
    let project = fixture("build-apk", ANDROID_APP);
    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);

    let artifact = project.join(".nts/build/demo/android-36-aarch64/demo.apk");
    assert!(artifact.is_file(), "no APK at {}:\n{}", artifact.display(), run.stdout);

    // The signature, which is what makes it installable rather than merely
    // well formed. `apksigner verify` exits non-zero on an unsigned APK.
    let verified = Command::new(tools.join("apksigner"))
        .arg("verify")
        .arg(&artifact)
        .output()
        .expect("running apksigner");
    assert!(
        verified.status.success(),
        "apksigner rejected it:\n{}",
        String::from_utf8_lossy(&verified.stderr)
    );

    // The dex, because an APK without one installs and then dies at launch --
    // and every step before `d8` would have succeeded regardless.
    let listing = Command::new("unzip").arg("-l").arg(&artifact).output().expect("running unzip");
    let listing = String::from_utf8_lossy(&listing.stdout);
    assert!(listing.contains("classes.dex"), "no dex in the APK:\n{listing}");

    // The manifest, read back through `aapt2` rather than as the XML we wrote:
    // the generated file is compiled to binary and a package name that failed
    // to survive that would be invisible in the source.
    let badging = Command::new(tools.join("aapt2"))
        .args(["dump", "badging"])
        .arg(&artifact)
        .output()
        .expect("running aapt2");
    let badging = String::from_utf8_lossy(&badging.stdout);
    assert!(badging.contains("name='dev.nts.buildtest'"), "wrong package name:\n{badging}");
    assert!(badging.contains("minSdkVersion:'29'"), "the declared minSdk was lost:\n{badging}");

    // `compileSdk` and `minSdk` are two numbers and the fixture makes them
    // differ, because a build that used one for both would agree with a test
    // that set them equal.
    assert!(badging.contains("compileSdkVersion='36'"), "wrong compileSdk:\n{badging}");

    // Named in the output, so nobody ships an APK believing it is release-signed.
    assert!(
        run.stdout.contains("debug key") && run.stdout.contains("not a release key"),
        "the debug key was not disclosed:\n{}",
        run.stdout
    );
}

/// No `id`, and the refusal names the field rather than failing inside `aapt2`.
///
/// Runs without an SDK: the check is before any tool, which is the point --
/// a message from `aapt2` about a malformed manifest names neither the config
/// field that was missing nor the file to add it to.
#[test]
fn an_apk_without_an_application_id_is_refused_by_name() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    if !frontend || android_sdk().is_none() {
        skip("the tsgo frontend and an Android SDK");
        return;
    }
    let project = fixture(
        "build-apk-no-id",
        r#"
import { defineConfig, app } from "@nts/config";
export default defineConfig({
  products: {
    demo: app.android({ entry: "./src/main.ts", minSdk: 29, compileSdk: 36 }),
  },
});
"#,
    );
    let run = build(&project, &[]);
    assert!(!run.ok, "a product with no id built anyway:\n{}", run.stdout);
    assert!(
        run.stderr.contains("`id`") && run.stderr.contains("side by side"),
        "the refusal does not name the field:\n{}",
        run.stderr
    );
}

/// No SDK, and the message names the variable that would find one.
///
/// **Needs no SDK to run, which is why it is worth having.** The refusals a
/// person actually meets are the ones on a machine that is missing something,
/// and those are exactly the paths a test on a fully-provisioned machine never
/// reaches. `ANDROID_HOME` and `HOME` are both pointed at a directory that does
/// not exist, because the search falls back to `~/Android/Sdk` and a test that
/// only cleared the first would pass here and fail on a developer's laptop.
#[test]
fn an_apk_with_no_android_sdk_names_the_variable() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    if !frontend {
        skip("the tsgo frontend");
        return;
    }
    let project = fixture("build-apk-no-sdk", ANDROID_APP);
    let nowhere = project.join("no-sdk-here");
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .arg(project.join("tsconfig.json"))
        .env("ANDROID_HOME", &nowhere)
        .env("ANDROID_SDK_ROOT", &nowhere)
        .env("HOME", &nowhere)
        .output()
        .expect("running nts build");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "it built with no SDK");
    assert!(
        stderr.contains("ANDROID_HOME"),
        "the refusal does not name the variable:\n{stderr}"
    );
}

const JVM_EXECUTABLE: &str = r#"
import { defineConfig, app, target } from "@nts/config";
export default defineConfig({
  products: {
    tool: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.jvm({ release: 17 })],
    }),
  },
});
"#;

/// A desktop JVM executable is a runnable jar, and it is not an APK.
///
/// **The regression this pins.** `t.android` and `t.jvm` are the same backend
/// and different platforms, and the first version of the APK path keyed on the
/// backend -- so `target.jvm({ release: 17 })` was sent to the Android packager
/// and refused with `sdkmanager "platforms;java-17"`, naming a platform that
/// does not exist for a product that has nothing to do with Android.
///
/// **Both arms, because the interesting failure is silent.** An empty `main`
/// exits zero, so "it ran" cannot be read off the status of a program that
/// prints nothing -- and `console.log` is unsupported in this lowering, so
/// nothing here can print. The positive arm's module evaluation therefore
/// *throws*: `nts: uncaught` on stderr and a non-zero status is proof the
/// launcher called it. The negative arm has nothing to evaluate and must exit
/// zero, which is what separates "it ran" from "the assertion is about the JVM
/// starting up".
#[test]
fn a_jvm_executable_is_a_runnable_jar_that_evaluates_the_module() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let tool = |name: &str| {
        Command::new(name).arg("-version").output().is_ok_and(|o| o.status.success())
    };
    if !frontend || !tool("javac") || !tool("java") {
        skip("the tsgo frontend and a JDK");
        return;
    }

    // --- it ran --------------------------------------------------------------
    let project = fixture("build-jvm-exe", JVM_EXECUTABLE);
    std::fs::write(
        project.join("src/main.ts"),
        "function boom(n: number): number { if (n > 0) { throw new Error('evaluated'); } return n; }\n\
         const answer = boom(1);\n\
         export function unused(): number { return answer; }\n",
    )
    .expect("entry");
    std::fs::write(project.join("src/internal.ts"), "export function helper(n: number): number { return n; }\n")
        .expect("sibling");
    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);

    let artifact = project.join(".nts/build/tool/java-17/tool.jar");
    assert!(artifact.is_file(), "no jar at {}:\n{}", artifact.display(), run.stdout);

    let ran = Command::new("java").arg("-jar").arg(&artifact).output().expect("running java");
    let stderr = String::from_utf8_lossy(&ran.stderr);
    assert!(
        stderr.contains("nts: uncaught") && stderr.contains("evaluated"),
        "module evaluation did not run:\nstatus {:?}\n{stderr}",
        ran.status.code()
    );

    // --- nothing to evaluate -------------------------------------------------
    // A launcher that called `module$init` unconditionally fails here, and the
    // sabotage says where: `javac` refuses with `cannot find symbol`, because
    // the launcher is compiled against the emitted classes. That is the build
    // catching what would otherwise be a `NoSuchMethodError` on the machine
    // that ran the jar.
    let quiet = fixture("build-jvm-exe-quiet", JVM_EXECUTABLE);
    std::fs::write(
        quiet.join("src/main.ts"),
        "export function twice(n: number): number { return n * 2; }\n",
    )
    .expect("entry");
    std::fs::write(quiet.join("src/internal.ts"), "export function helper(n: number): number { return n; }\n")
        .expect("sibling");
    let run = build(&quiet, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);
    let empty = quiet.join(".nts/build/tool/java-17/tool.jar");
    let ran = Command::new("java").arg("-jar").arg(&empty).output().expect("running java");
    assert!(
        ran.status.success(),
        "a program with nothing to evaluate did not exit cleanly:\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
}

/// Java a package contributes is compiled into the artifact, not left beside it.
///
/// **The assertion is the archive, because the build directory lies.** `javac`
/// writes `com/example/Helper.class` into the output directory whether or not
/// anything packages it, and `package_jvm` archives `nts` by name -- so the
/// first version compiled the Java, printed that it had, and shipped a jar
/// without it. Everything on disk looked right.
#[test]
fn java_a_package_contributes_is_compiled_into_the_jar() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let javac = Command::new("javac").arg("-version").output().is_ok_and(|o| o.status.success());
    if !frontend || !javac {
        skip("the tsgo frontend and javac");
        return;
    }
    let project = fixture(
        "build-java-root",
        r#"
import { defineConfig, library, sources } from "@nts/config";
export default defineConfig({
  products: {
    api: library.jvm({ entry: "./src/main.ts", javaPackage: "nts.gen", release: 8 }),
  },
  native: [sources({ dir: "java" })],
});
"#,
    );
    let pkg = project.join("java/com/example");
    std::fs::create_dir_all(&pkg).expect("java dir");
    std::fs::write(
        pkg.join("Helper.java"),
        "package com.example;\npublic final class Helper { public static int two() { return 2; } }\n",
    )
    .expect("java source");

    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);
    assert!(run.stdout.contains("compiled 1 Java package"), "not reported:\n{}", run.stdout);

    let artifact = project.join(".nts/build/api/java-8/api.jar");
    assert!(artifact.is_file(), "no jar at {}:\n{}", artifact.display(), run.stdout);
    let listing = Command::new("unzip").arg("-l").arg(&artifact).output().expect("unzip");
    let listing = String::from_utf8_lossy(&listing.stdout);
    assert!(
        listing.contains("com/example/Helper.class"),
        "the contributed Java is not in the jar:\n{listing}"
    );
    // And the emitted classes are still there, because naming two roots is
    // where one of them gets dropped.
    assert!(listing.contains("nts/gen/"), "the emitted classes went missing:\n{listing}");
}

/// A root declared for a JVM target that holds no Java is refused by name.
///
/// `native_sources` collects `.c` and would report nothing here, so without
/// this the root is declared, contributes nothing, and the build says so
/// nowhere -- the same silence twice.
#[test]
fn a_jvm_native_root_with_no_java_is_refused() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    if !frontend {
        skip("the tsgo frontend");
        return;
    }
    let project = fixture(
        "build-java-empty-root",
        r#"
import { defineConfig, library, sources } from "@nts/config";
export default defineConfig({
  products: {
    api: library.jvm({ entry: "./src/main.ts", javaPackage: "nts.gen", release: 8 }),
  },
  native: [sources({ dir: "java" })],
});
"#,
    );
    let pkg = project.join("java");
    std::fs::create_dir_all(&pkg).expect("java dir");
    std::fs::write(pkg.join("Helper.kt"), "class Helper\n").expect("kotlin source");

    let run = build(&project, &[]);
    assert!(!run.ok, "a root with no Java built anyway:\n{}", run.stdout);
    assert!(
        run.stderr.contains("holds") && run.stderr.contains("`.java`"),
        "the refusal does not name what is wrong:\n{}",
        run.stderr
    );
}

/// An APK refuses to generate a manifest that would drop a package's fragment.
///
/// **The case is the silent one, so the test has to build the silence.** A
/// package contributing `<uses-permission>` and an app declaring no manifest of
/// its own produces, without this, a signed installable APK missing the
/// permission -- which installs, launches, and crashes at the call. That is why
/// the refusal is scoped to an app with *no* fragment: one that declares its own
/// owns its manifest, and the second arm here proves the refusal does not fire
/// then.
#[test]
fn an_apk_refuses_to_silently_drop_a_package_fragment() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    if !frontend || android_sdk().is_none() {
        skip("the tsgo frontend and an Android SDK");
        return;
    }
    let project = fixture("build-apk-fragment", ANDROID_APP);
    // A package beside the app, with a config of its own. `config_roots` is
    // every config above a file in the program, so importing one file from it
    // is what puts it in scope -- the same mechanism `examples/workspace` uses.
    let pkg = project.join("pkg");
    std::fs::create_dir_all(pkg.join("manifests")).expect("package dir");
    std::fs::write(pkg.join("lib.ts"), "export function two(): number { return 2; }\n")
        .expect("package source");
    std::fs::write(
        pkg.join("manifests/android.xml"),
        "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">\n\
         \x20 <uses-permission android:name=\"android.permission.CAMERA\" />\n\
         </manifest>\n",
    )
    .expect("fragment");
    std::fs::write(
        pkg.join("nts.config.ts"),
        "import { defineConfig, manifest } from \"@nts/config\";\n\
         export default defineConfig({\n\
         \x20 targets: [\"android-29\"],\n\
         \x20 manifests: [manifest({ targets: [\"android-29\"], path: \"manifests/android.xml\" })],\n\
         });\n",
    )
    .expect("package config");
    std::fs::write(
        project.join("src/main.ts"),
        "import { two } from '../pkg/lib.js';\nexport function main(): number { return two(); }\n",
    )
    .expect("entry");

    let run = build(&project, &[]);
    assert!(!run.ok, "the fragment was silently dropped:\n{}", run.stdout);
    assert!(
        run.stderr.contains("manifest") && run.stderr.contains("android.xml"),
        "the refusal does not name the fragment:\n{}",
        run.stderr
    );

    // --- and it does not fire once the app owns its manifest -----------------
    std::fs::create_dir_all(project.join("manifests")).expect("app manifests");
    std::fs::write(
        project.join("manifests/android.xml"),
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n\
         <manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"\n\
         \x20         package=\"dev.nts.buildtest\">\n\
         \x20 <uses-sdk android:minSdkVersion=\"29\" />\n\
         \x20 <uses-permission android:name=\"android.permission.CAMERA\" />\n\
         \x20 <application android:label=\"demo\" />\n\
         </manifest>\n",
    )
    .expect("app manifest");
    let config = std::fs::read_to_string(project.join("nts.config.ts")).expect("config");
    std::fs::write(
        project.join("nts.config.ts"),
        config
            .replace(
                "import { defineConfig, app } from \"@nts/config\";",
                "import { defineConfig, app, manifest } from \"@nts/config\";",
            )
            .replace(
                "});",
                "  manifests: [manifest({ targets: [\"android-29\"], path: \"manifests/android.xml\" })],\n});",
            ),
    )
    .expect("config with manifest");

    let run = build(&project, &[]);
    assert!(run.ok, "an app that owns its manifest was refused:\n{}{}", run.stdout, run.stderr);
    // The permission is the app's, read back through the platform rather than
    // off the file we wrote.
    let (tools, _) = android_sdk().expect("checked above");
    let artifact = project.join(".nts/build/demo/android-36-aarch64/demo.apk");
    let badging = Command::new(tools.join("aapt2"))
        .args(["dump", "badging"])
        .arg(&artifact)
        .output()
        .expect("running aapt2");
    let badging = String::from_utf8_lossy(&badging.stdout);
    assert!(
        badging.contains("android.permission.CAMERA"),
        "the app's own manifest did not reach the APK:\n{badging}"
    );
}

/// `c:types` is the compiler's, and the refusal says where to get it.
///
/// **The message it replaced was true and unusable.** Trying to bind the brand
/// module from a package's header failed with ``no complete definition of
/// `c_uint32` in these headers`` -- a correct sentence about a symbol the reader
/// never asked for, in a module their package was never supposed to declare.
/// `examples/workspace/apps/node-brownfield` sat behind it, and the thing to do
/// was add one path to a tsconfig.
#[test]
fn the_scalar_brand_module_is_not_bound_from_a_header() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    if !frontend {
        skip("the tsgo frontend");
        return;
    }
    let project = fixture(
        "build-c-brands",
        r#"
import { defineConfig, library, sources, target } from "@nts/config";
export default defineConfig({
  products: {
    lib: library.native({ targets: [target.linux({ backend: "c" })], entry: "./src/main.ts" }),
  },
  native: [sources({ dir: "native", header: "native/thing.h" })],
});
"#,
    );
    std::fs::create_dir_all(project.join("native")).expect("native dir");
    std::fs::write(project.join("native/thing.h"), "int thing(int n);\n").expect("header");
    // Imports the brands and does not put `libc.d.ts` in the program, which is
    // the whole of the mistake being reported.
    std::fs::write(
        project.join("src/main.ts"),
        "import type { c_int } from 'c:types';\n\
         export function one(n: c_int): number { return n as unknown as number; }\n",
    )
    .expect("entry");

    let run = build(&project, &[]);
    assert!(!run.ok, "it bound the brand module anyway:\n{}", run.stdout);
    assert!(
        run.stderr.contains("libc.d.ts") && run.stderr.contains("c:types"),
        "the refusal does not name the module and the file to add:\n{}",
        run.stderr
    );
    // And not the old message, which named a symbol nobody wrote.
    assert!(
        !run.stderr.contains("no complete definition"),
        "it still reports the header question:\n{}",
        run.stderr
    );
}

const WINDOWS_LIB: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    sdk: library.native({ targets: [target.windows()], entry: "./src/main.ts" }),
  },
});
"#;

/// A Windows target cross-compiles to a Windows artifact, not a host one.
///
/// **The bug this pins produced `libsdk.so` -- an ELF shared object under a
/// Linux name -- for a Windows product.** `link_c` never read `target.os` and
/// `artifact_name` hardcoded `.so`, and neither was visible while
/// `target.windows()` defaulted to the llvm backend and refused before reaching
/// the linker. Fixing the default exposed it, which is the ordinary way a bug
/// kept alive by an unrelated refusal comes out.
///
/// `file` is the assertion, because every intermediate step succeeds on the
/// wrong platform: the C compiles, the objects link, and the artifact exists.
#[test]
fn a_windows_target_produces_a_windows_dll() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let zig = Command::new("zig").arg("version").output().is_ok_and(|o| o.status.success());
    // On a Windows host this is not a cross build and the toolchain question is
    // a different one; the assertions below are about the cross path.
    if !frontend || !zig || cfg!(target_os = "windows") {
        skip("the tsgo frontend and zig, on a non-Windows host");
        return;
    }
    let project = fixture("build-win-cross", WINDOWS_LIB);
    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);

    let dll = project.join(".nts/build/sdk/windows-x86_64/sdk.dll");
    assert!(dll.is_file(), "no DLL at {}:\n{}", dll.display(), run.stdout);
    assert!(
        !project.join(".nts/build/sdk/windows-x86_64/libsdk.so").exists(),
        "a host-shaped artifact was written beside it"
    );

    let kind = Command::new("file").arg("-b").arg(&dll).output().expect("running file");
    let kind = String::from_utf8_lossy(&kind.stdout);
    assert!(
        kind.contains("PE32+") && kind.contains("DLL"),
        "not a Windows DLL -- `file` says: {kind}"
    );

    // The import library, which is the half a Windows consumer links against.
    // Unnamed, the linker calls it after the first object -- `program.c.lib`,
    // beside `sdk.dll`, under a name nobody could guess.
    let implib = project.join(".nts/build/sdk/windows-x86_64/sdk.lib");
    assert!(implib.is_file(), "no import library at {}", implib.display());
    assert!(
        !project.join(".nts/build/sdk/windows-x86_64/program.c.lib").exists(),
        "the import library is still named after an object"
    );
}

/// Apple is refused by name, with the reason that was measured rather than guessed.
#[test]
fn cross_compiling_to_apple_is_refused_by_name() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    if !frontend || cfg!(target_os = "macos") {
        skip("the tsgo frontend, on a non-Apple host");
        return;
    }
    let project = fixture(
        "build-apple-cross",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    mac: library.native({
      targets: [target.macos({ minimumVersion: "14.0" })],
      entry: "./src/main.ts",
    }),
  },
});
"#,
    );
    let run = build(&project, &[]);
    assert!(!run.ok, "it produced something for macOS:\n{}", run.stdout);
    assert!(
        run.stderr.contains("SDK") && run.stderr.contains("macos-14"),
        "the refusal names neither the target nor what is missing:\n{}",
        run.stderr
    );
}

/// Naming the config means naming the project it describes.
///
/// **Three spellings of one request, and one of them did something else.** A
/// directory already resolved to the `tsconfig.json` in it; naming the config
/// file -- the one a person has open -- made the *config* the program, and
/// `examples/library` failed with four `TS5097`s about `@nts/config`'s
/// `package.json`. The sources were fine and the other two spellings built it.
///
/// All three are asserted together, because the bug is a disagreement between
/// them rather than a property of any one.
#[test]
fn a_project_can_be_named_by_directory_config_or_tsconfig() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture("build-naming", SHARED);
    let artifact = project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");
    for spelling in [
        project.clone(),
        project.join("tsconfig.json"),
        project.join("nts.config.ts"),
    ] {
        drop(std::fs::remove_file(&artifact));
        let output = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("build")
            .arg(&spelling)
            .output()
            .expect("running nts build");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "`{}` failed:\n{stdout}{stderr}", spelling.display());
        assert!(
            artifact.is_file(),
            "`{}` built no artifact:\n{stdout}",
            spelling.display()
        );
    }
}

/// A `CMake` project that includes the hook and links what it defines.
fn a_cmake_consumer(project: &Path, hook: &Path) -> PathBuf {
    let consumer = project.join("consumer");
    std::fs::create_dir_all(&consumer).expect("consumer dir");
    std::fs::write(
        consumer.join("CMakeLists.txt"),
        format!(
            "cmake_minimum_required(VERSION 3.20)\n\
             project(consumer C)\n\
             include({})\n\
             add_executable(consumer main.c)\n\
             target_link_libraries(consumer PRIVATE nts::acme)\n",
            hook.display()
        ),
    )
    .expect("CMakeLists");
    std::fs::write(consumer.join("main.c"), "int main(void){return 0;}\n").expect("main.c");

    let nts = env!("CARGO_BIN_EXE_nts");
    let configured = Command::new("cmake")
        .args(["-S", ".", "-B", "build"])
        .arg(format!("-DNTS_EXECUTABLE={nts}"))
        .current_dir(&consumer)
        .output()
        .expect("running cmake");
    assert!(
        configured.status.success(),
        "cmake could not configure:\n{}",
        String::from_utf8_lossy(&configured.stderr)
    );
    consumer
}

/// The `CMake` hook configures, builds through us, and re-runs only on a change.
///
/// **Running it is the assertion, and the first version proves why.** That one
/// wrote the paths as this build saw them -- relative -- and `CMake` resolves a
/// relative path against its own build directory. It *configured* cleanly and
/// failed at build with `No rule to make target`, which is exactly what an
/// adapter that was generated and never executed looks like.
///
/// The incremental half is the reason the adapter exists at all: a host that is
/// not told what the step consumes and produces re-runs it on every build.
#[test]
fn the_cmake_hook_builds_a_consumer_and_declares_its_inputs() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let cmake = Command::new("cmake").arg("--version").output().is_ok_and(|o| o.status.success());
    if !cmake {
        skip("cmake");
        return;
    }
    let project = fixture(
        "build-cmake-hook",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux()], entry: "./src/main.ts" }),
  },
  integrate: ["cmake"],
});
"#,
    );
    // **Invoked with a relative path, on purpose.** `CARGO_TARGET_TMPDIR` is
    // absolute, so building the usual way makes `absolute()` a no-op and the
    // relative-path bug cannot reproduce -- the first version of this test
    // passed with that call removed, which is the definition of not checking.
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["build", "tsconfig.json", "--out", ".nts/build"])
        .current_dir(&project)
        .output()
        .expect("running nts build");
    let run = Run {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    };
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);
    let hook = project.join(".nts/build/nts.cmake");
    assert!(hook.is_file(), "no hook at {}:\n{}", hook.display(), run.stdout);
    assert!(run.stdout.contains("hook:"), "the hook was not reported:\n{}", run.stdout);

    // Every path in it must be absolute, because `CMake` reads it from its own
    // build directory. This is the assertion the relative version passed.
    let text = std::fs::read_to_string(&hook).expect("reading the hook");
    for line in text.lines().filter(|l| l.contains("DEPENDS ") || l.contains("OUTPUT ")) {
        let path = line.split_whitespace().last().unwrap_or("");
        assert!(path.starts_with('/'), "a relative path in the hook: {line}");
    }

    let consumer = a_cmake_consumer(&project, &hook);

    // Delete the artifact so the custom command has to run.
    drop(std::fs::remove_file(project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so")));
    let built = Command::new("cmake")
        .args(["--build", "build"])
        .current_dir(&consumer)
        .output()
        .expect("running cmake --build");
    assert!(
        built.status.success(),
        "cmake could not build through the hook:\n{}{}",
        String::from_utf8_lossy(&built.stdout),
        String::from_utf8_lossy(&built.stderr)
    );
    assert!(consumer.join("build/consumer").is_file(), "no consumer executable");

    // **The inputs and outputs, both directions.** "Nothing changed, nothing
    // re-runs" is also what a rule with *no* inputs does -- dropping `DEPENDS`
    // entirely passes that assertion -- so the arm that discriminates is the
    // other one: touch the entry and the hook must run.
    let rebuild = |what: &str| -> String {
        let out = Command::new("cmake")
            .args(["--build", "build"])
            .current_dir(&consumer)
            .output()
            .unwrap_or_else(|e| panic!("running cmake --build {what}: {e}"));
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let quiet = rebuild("with nothing changed");
    assert!(
        !quiet.contains("nts: building"),
        "the hook re-ran with nothing changed:\n{quiet}"
    );

    // `cmake` compares mtimes at second granularity, so a touch in the same
    // second as the build reads as unchanged.
    let entry = project.join("src/main.ts");
    let source = std::fs::read_to_string(&entry).expect("reading the entry");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(&entry, source).expect("touching the entry");
    let after = rebuild("after touching the entry");
    assert!(
        after.contains("nts: building"),
        "the entry changed and the hook did not re-run, so its `DEPENDS` names \
         nothing that matters:\n{after}"
    );
}

/// A hook nobody here can run is refused rather than written.
#[test]
fn an_integration_with_no_adapter_is_refused_by_name() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture(
        "build-hook-refusal",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux()], entry: "./src/main.ts" }),
  },
  integrate: ["gradle"],
});
"#,
    );
    let run = build(&project, &[]);
    assert!(!run.ok, "it emitted an adapter it cannot run:\n{}", run.stdout);
    assert!(
        run.stderr.contains("gradle") && run.stderr.contains("not written"),
        "the refusal does not name the hook:\n{}",
        run.stderr
    );
}

/// The npm hook is a script that runs, and builds for the machine running it.
///
/// **`prepare` runs on the installing machine**, which is why the generated
/// script resolves the platform at run time rather than baking in whichever one
/// generated it. That is also the one place node's vocabulary is translated:
/// `darwin` and `win32` are npm's spellings and `macos` and `windows` are the
/// config's, and the boundary where the first arrives is where it converts.
#[test]
fn the_npm_hook_runs_and_builds_for_the_host() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture(
        "build-npm-hook",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux()], entry: "./src/main.ts" }),
  },
  integrate: ["npm"],
});
"#,
    );
    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);
    let hook = project.join(".nts/build/nts-prepare.mjs");
    assert!(hook.is_file(), "no hook at {}:\n{}", hook.display(), run.stdout);

    let text = std::fs::read_to_string(&hook).expect("reading the hook");
    assert!(
        text.contains("process.platform") && text.contains("\"--os\""),
        "the hook does not resolve the installing machine:\n{text}"
    );
    // npm's names translated here and nowhere else.
    assert!(text.contains("darwin") && text.contains("macos"), "no vocabulary bridge:\n{text}");

    // Delete the artifact and let the script rebuild it, which is the whole
    // claim: this file is an adapter that runs, not a file that looks like one.
    let artifact = project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");
    drop(std::fs::remove_file(&artifact));
    let node = std::env::var("NTS_NODE").unwrap_or_else(|_| "node".to_owned());
    let ran = Command::new(node)
        .arg(&hook)
        .env("NTS_BIN", env!("CARGO_BIN_EXE_nts"))
        .output()
        .expect("running the hook");
    assert!(
        ran.status.success(),
        "the hook failed:\n{}{}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(artifact.is_file(), "the hook ran and built nothing at {}", artifact.display());
}

/// The workspace fixture builds, which nothing in the tree checked.
///
/// **`examples/workspace` is the config language's only multi-package fixture
/// and it had no observer.** The gate's `config` step typechecks its nineteen
/// configs and builds none of them, which is how `examples/library` carried a
/// broken `nts build` invocation for an unknown length of time -- and how the
/// APK path, cross-compilation and the `integrate` hooks would rot next, since
/// every one of them is exercised only here.
///
/// One app per lane, and each is skipped only for a *toolchain* it needs, never
/// for a refusal: a refusal is the thing under test everywhere else in this
/// file, and skipping one here would hide exactly what the others assert.
#[test]
fn the_workspace_fixture_still_builds() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let apps = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/workspace/apps");
    if !apps.is_dir() {
        skip("examples/workspace to be present");
        return;
    }
    let out = Path::new(env!("CARGO_TARGET_TMPDIR")).join("workspace-build");
    drop(std::fs::remove_dir_all(&out));

    let build_app = |app: &str, extra: &[&str], env: &[(&str, String)]| -> Run {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nts"));
        command.arg("build").arg(apps.join(app)).arg("--out").arg(out.join(app)).args(extra);
        for (key, value) in env {
            command.env(key, value);
        }
        let output = command.output().expect("running nts build");
        Run {
            ok: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    };

    // The C lane, plus the CMake hook this app declares.
    let run = build_app("linux-brownfield", &[], &[]);
    assert!(run.ok, "linux-brownfield:\n{}{}", run.stdout, run.stderr);
    assert!(
        out.join("linux-brownfield/nts.cmake").is_file(),
        "no CMake hook for the app that declares one:\n{}",
        run.stdout
    );

    // **`windows-brownfield` refuses, and refuses before writing.** It declares
    // `integrate: ["msbuild"]`, whose adapter is not written -- and the check
    // for that runs before the emitter, so a project that cannot be finished
    // does not leave half of itself on disk. The cross-compilation this app
    // would otherwise cover is asserted by `a_windows_target_produces_a_windows_dll`
    // against a fixture, which does not carry an unrelated hook.
    let run = build_app("windows-brownfield", &[], &[]);
    assert!(!run.ok, "the msbuild hook was not refused:\n{}", run.stdout);
    assert!(
        run.stderr.contains("msbuild") && run.stderr.contains("not written"),
        "the refusal does not name the hook:\n{}",
        run.stderr
    );
    assert!(
        !out.join("windows-brownfield").exists(),
        "it emitted before refusing, which is the half-build this check exists to stop"
    );

    // The addon lane and the npm hook. `--os` because the product declares four
    // machines and a Linux box can build one of them.
    let headers = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../third_party/node/src");
    if headers.join("node_api.h").exists() {
        let env = [("NTS_NAPI_INCLUDE".to_owned(), headers.display().to_string())];
        let env: Vec<(&str, String)> = env.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
        let run = build_app("node-brownfield", &["--os", "linux"], &env);
        assert!(run.ok, "node-brownfield:\n{}{}", run.stdout, run.stderr);
        assert!(
            out.join("node-brownfield/nts-prepare.mjs").is_file(),
            "no npm hook for the app that declares one:\n{}",
            run.stdout
        );
    }
}

/// `javaPackage` moves the classes, and a Java consumer can call them.
///
/// **`nts.gen` was hardcoded in the emitter and `package_jvm` refused any
/// config that asked otherwise** -- which is the honest thing to do while the
/// emitter cannot, and `docs/jvm-interop.md` listed it under packaging gaps
/// because "`nts.gen` is wrong for a shipped library".
///
/// The assertion is a consumer that compiles and runs, because every weaker one
/// passed while this was broken. Half-done, the jar held
/// `com/acme/sdk/Counter.class` beside `nts/gen/Program.class` -- the layouts
/// had moved and the class every free function lives on had not -- and then a
/// jar with the right paths still threw `NoClassDefFoundError: nts/gen/Program`
/// from a stale `invokestatic`. Listing the archive says nothing about the
/// names inside the bytecode.
#[test]
fn a_java_package_moves_the_classes_and_they_still_link() {
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    let tool = |n: &str| Command::new(n).arg("-version").output().is_ok_and(|o| o.status.success());
    if !frontend || !tool("javac") || !tool("java") {
        skip("the tsgo frontend and a JDK");
        return;
    }
    let project = fixture(
        "build-java-package",
        r#"
import { defineConfig, library } from "@nts/config";
export default defineConfig({
  products: {
    sdk: library.jvm({ entry: "./src/main.ts", javaPackage: "com.acme.sdk", release: 8 }),
  },
});
"#,
    );
    // A class with a method and a free function that calls it, so both the
    // layout classes and the program class are exercised.
    std::fs::write(
        project.join("src/main.ts"),
        "export function twice(n: number): number { return n * 2; }\n\
         export class Counter {\n\
         \x20 private n: number = 0;\n\
         \x20 bump(): number { this.n = this.n + 1; return this.n; }\n\
         }\n\
         export function drive(c: Counter): number { return c.bump(); }\n",
    )
    .expect("entry");
    std::fs::write(project.join("src/internal.ts"), "export function helper(n: number): number { return n; }\n")
        .expect("sibling");

    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);

    let jar = project.join(".nts/build/sdk/java-8/sdk.jar");
    let runtime = project.join(".nts/build/sdk/java-8/nts-runtime.jar");
    assert!(jar.is_file(), "no jar at {}:\n{}", jar.display(), run.stdout);
    assert!(runtime.is_file(), "no runtime jar beside it:\n{}", run.stdout);
    let listing = Command::new("unzip").arg("-l").arg(&jar).output().expect("unzip");
    let listing = String::from_utf8_lossy(&listing.stdout);
    assert!(listing.contains("com/acme/sdk/Program.class"), "no program class:\n{listing}");
    assert!(listing.contains("com/acme/sdk/Counter.class"), "no layout class:\n{listing}");
    assert!(!listing.contains("nts/gen/"), "classes left in the default package:\n{listing}");

    // The consumer, which is what says the *bytecode* agrees with the paths.
    let consumer = project.join("Use.java");
    std::fs::write(
        &consumer,
        "public final class Use {\n\
         \x20 public static void main(String[] a) {\n\
         \x20   com.acme.sdk.Counter c = new com.acme.sdk.Counter();\n\
         \x20   System.out.println(com.acme.sdk.Program.twice(21) + \" \" + com.acme.sdk.Program.drive(c));\n\
         \x20 }\n\
         }\n",
    )
    .expect("consumer");
    let classes = project.join("use");
    let compiled = Command::new("javac")
        .arg("-cp")
        .arg(format!("{}:{}", jar.display(), runtime.display()))
        .arg("-d")
        .arg(&classes)
        .arg(&consumer)
        .output()
        .expect("running javac");
    assert!(
        compiled.status.success(),
        "a consumer could not compile against it:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new("java")
        .arg("-Xverify:all")
        .arg("-cp")
        .arg(format!("{}:{}:{}", classes.display(), jar.display(), runtime.display()))
        .arg("Use")
        .output()
        .expect("running java");
    let printed = String::from_utf8_lossy(&ran.stdout);
    assert!(
        ran.status.success() && printed.trim() == "42.0 1.0",
        "the consumer did not run: {:?}\n{}{}",
        printed.trim(),
        printed,
        String::from_utf8_lossy(&ran.stderr)
    );
}

/// A package whose claim does not cover the target refuses at configuration time.
///
/// **`tooling/config`'s doc promised this and nothing did it.**
/// `Config.targets` is "a claim rather than a preference … A consumer whose
/// target is outside this set should fail at *configuration* time, naming the
/// package and the target, rather than at link time with a missing symbol." It
/// was read in one place, to decide which bindings a package generates for
/// itself.
///
/// **No fixture violates a claim, which is why this is a test and not an
/// example.** `examples/workspace` is careful: `apps/linux` says "deliberately
/// not biometrics" and `apps/macos` says "no biometrics -- `biometrics`
/// declares", so every app respects every claim and the check would never have
/// fired there. A constraint nothing violates is a constraint nothing tests.
///
/// Both arms, because a refusal that fires on everything is not a check: the
/// second package claims the target and must not be named.
#[test]
fn a_package_claim_that_excludes_the_target_is_refused() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture(
        "build-claim",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux()], entry: "./src/main.ts" }),
  },
});
"#,
    );
    // Two packages: one that claims Android only, one that claims Linux too.
    for (dir, claims) in [("mobile", r#""android-29""#), ("portable", r#""android-29", "linux-gnu""#)] {
        let pkg = project.join(dir);
        std::fs::create_dir_all(&pkg).expect("package dir");
        std::fs::write(pkg.join("lib.ts"), format!("export function {dir}(): number {{ return 1; }}\n"))
            .expect("package source");
        std::fs::write(
            pkg.join("nts.config.ts"),
            format!("import {{ defineConfig }} from \"@nts/config\";\nexport default defineConfig({{ targets: [{claims}] }});\n"),
        )
        .expect("package config");
    }
    std::fs::write(
        project.join("src/main.ts"),
        "import { mobile } from '../mobile/lib.js';\n\
         import { portable } from '../portable/lib.js';\n\
         export function published(): number { return mobile() + portable(); }\n",
    )
    .expect("entry");

    let run = build(&project, &[]);
    assert!(!run.ok, "a claim that excludes the target did not stop it:\n{}", run.stdout);
    assert!(
        run.stderr.contains("mobile") && run.stderr.contains("android-29"),
        "the refusal names neither the package nor its claim:\n{}",
        run.stderr
    );
    // The one that does claim Linux must not be named, or the refusal is
    // firing on "has a claim" rather than on "the claim excludes this".
    assert!(
        !run.stderr.contains("portable"),
        "a package that claims this target was named too:\n{}",
        run.stderr
    );

    // --- and with the claim widened, it builds -------------------------------
    std::fs::write(
        project.join("mobile/nts.config.ts"),
        "import { defineConfig } from \"@nts/config\";\nexport default defineConfig({ targets: [\"android-29\", \"linux-gnu\"] });\n",
    )
    .expect("widened claim");
    let run = build(&project, &[]);
    assert!(run.ok, "widening the claim did not let it build:\n{}{}", run.stdout, run.stderr);
}

/// `Config.tsconfig` names the program, and a named file still wins over it.
///
/// **The field parsed and did nothing.** Its own documentation calls it "the
/// program's source of truth … optional, defaulting to `./tsconfig.json` beside
/// this file … named only when it differs" -- and a config naming
/// `./program.json` was ignored, the build failing on a `tsconfig.json` its
/// author had deliberately not written.
///
/// Three arms, because the rule is a precedence and one arm cannot show one.
/// The third is the interesting one: naming a file explicitly is the caller
/// being specific and has to beat the config, or a project can never be built
/// against anything but what its config says.
#[test]
fn the_config_names_the_program_unless_a_file_is_named() {
    if !available() {
        skip("node, the tsgo frontend, clang and nm");
        return;
    }
    let project = fixture(
        "build-tsconfig-field",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  tsconfig: "./program.json",
  products: {
    acme: library.native({ targets: [target.linux()], entry: "./src/main.ts" }),
  },
});
"#,
    );
    // The program the config names, and a *different* one beside it. Neither is
    // `tsconfig.json`: the default must not be what makes this pass.
    let options = r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":false}"#;
    std::fs::write(project.join("program.json"), format!("{options},\"include\":[\"src/**/*\"]}}"))
        .expect("program.json");
    std::fs::write(project.join("other.json"), format!("{options},\"files\":[\"src/only.ts\"]}}"))
        .expect("other.json");
    std::fs::write(project.join("src/only.ts"), "export function onlyOne(): number { return 1; }\n")
        .expect("only.ts");
    drop(std::fs::remove_file(project.join("tsconfig.json")));

    let artifact = project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");

    // `build()` appends `tsconfig.json` to what it is given, so the arms that
    // name a file go straight to the binary.
    let named = |path: &Path| -> Run {
        let out = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg("build")
            .arg(path)
            .output()
            .expect("running nts build");
        Run {
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        }
    };

    // 1. the config file names the project it describes
    drop(std::fs::remove_file(&artifact));
    let run = named(&project.join("nts.config.ts"));
    assert!(run.ok, "naming the config ignored its `tsconfig`:\n{}{}", run.stdout, run.stderr);
    assert!(artifact.is_file(), "no artifact:\n{}", run.stdout);

    // 2. so does the directory
    drop(std::fs::remove_file(&artifact));
    let run = named(&project);
    assert!(run.ok, "the directory ignored the config's `tsconfig`:\n{}{}", run.stdout, run.stderr);
    assert!(artifact.is_file(), "no artifact:\n{}", run.stdout);

    // 3. **a named file wins.** `other.json` holds only `src/only.ts`, so the
    // product's entry is not in that program and the build says exactly that --
    // which is the proof the field did *not* override what was asked for.
    let run = named(&project.join("other.json"));
    assert!(!run.ok, "the config's `tsconfig` overrode a file the caller named:\n{}", run.stdout);
    assert!(
        run.stderr.contains("./src/main.ts") && run.stderr.contains("no source in this program"),
        "the mismatch is not what was reported:\n{}",
        run.stderr
    );
}

const ZLIB_DEPENDENCY: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux({ backend: "c" })], entry: "./src/main.ts" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["zlib"] },
  },
});
"#;

/// A `pkg-config` claim reaches the link line, and its absence does not.
///
/// **Both arms, because a build that links nothing extra also exits zero.** The
/// positive arm asserts `libz` is in the dynamic table; the negative arm is the
/// same program with the claim removed, and it must not be. Without the second
/// half this passes for a build that ignores `dependencies` entirely -- a check
/// whose answer does not depend on its input is not a check.
///
/// `zlib` rather than the fixture's `libnotify`: it is what a machine with a
/// compiler has, and the question here is whether the flags arrive, not which
/// library they name.
#[test]
fn a_pkg_config_dependency_reaches_the_link_and_its_absence_does_not() {
    let has = Command::new("pkg-config")
        .args(["--exists", "zlib"])
        .status()
        .is_ok_and(|status| status.success());
    if !available() || !has {
        skip("clang, the tsgo frontend and zlib's pkg-config entry");
        return;
    }
    let needed = |artifact: &Path| {
        let shown = Command::new("readelf").arg("-d").arg(artifact).output().expect("readelf");
        String::from_utf8_lossy(&shown.stdout).contains("libz.so")
    };

    let project = fixture("build-pkgconfig", ZLIB_DEPENDENCY);
    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);
    let artifact = project.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");
    assert!(artifact.is_file(), "no library at {}", artifact.display());
    assert!(needed(&artifact), "the claim did not reach the link:\n{}", run.stdout);

    // --- the same program, without the claim ---------------------------------
    let bare = fixture("build-pkgconfig-bare", SHARED);
    let run = build(&bare, &[]);
    assert!(run.ok, "the control build failed:\n{}{}", run.stdout, run.stderr);
    let artifact = bare.join(".nts/build/acme/linux-gnu-x86_64/libacme.so");
    assert!(
        !needed(&artifact),
        "the control links zlib too, so the assertion above is not about the claim"
    );
}

const MISSING_PACKAGE: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux({ backend: "c" })], entry: "./src/main.ts" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["a-library-nobody-has"] },
  },
});
"#;

/// An unsatisfiable package claim is one message naming the package and the fix.
///
/// The alternative is a link failure about a symbol, in a file the reader did
/// not write -- which is the same argument `refuse_unclaimed_target` makes about
/// a target, one level down.
#[test]
fn an_unresolvable_package_refuses_by_name_before_the_build_starts() {
    if !available() {
        skip("node, the tsgo frontend and clang");
        return;
    }
    let project = fixture("build-pkgconfig-missing", MISSING_PACKAGE);
    let run = build(&project, &[]);
    assert!(!run.ok, "an unsatisfiable claim built anyway:\n{}", run.stdout);
    assert!(
        run.stderr.contains("a-library-nobody-has"),
        "the refusal does not name the package:\n{}",
        run.stderr
    );
    assert!(
        run.stderr.contains("PKG_CONFIG_PATH"),
        "the refusal does not say how to fix it:\n{}",
        run.stderr
    );
    // **Before anything is built**, because a configuration error reported
    // after `building ...` says a build started that never could.
    assert!(
        !run.stdout.contains("building `acme`"),
        "it announced a build it then refused:\n{}",
        run.stdout
    );
}

const SWIFTPM_DEPENDENCY: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    acme: library.native({ targets: [target.linux({ backend: "c" })], entry: "./src/main.ts" }),
  },
  dependencies: {
    "linux-gnu": { from: "swiftpm", lockfile: "./deps/apple.resolved" },
  },
});
"#;

/// A resolver this build cannot read refuses, rather than resolving to nothing.
///
/// **The failure mode this closes is silent.** An unread resolver that
/// contributed an empty list would produce an artifact missing everything the
/// claim promised, and say `1 artifact(s)` about it.
#[test]
fn a_resolver_this_build_cannot_read_refuses_and_names_it() {
    if !available() {
        skip("node, the tsgo frontend and clang");
        return;
    }
    let project = fixture("build-swiftpm", SWIFTPM_DEPENDENCY);
    let run = build(&project, &[]);
    assert!(!run.ok, "an unread resolver built anyway:\n{}", run.stdout);
    assert!(run.stderr.contains("SwiftPM"), "does not name the resolver:\n{}", run.stderr);
    assert!(
        run.stderr.contains("./deps/apple.resolved"),
        "does not name the file it would read:\n{}",
        run.stderr
    );
}

const JVM_WITH_DEPENDENCY: &str = r#"
import { defineConfig, app, target } from "@nts/config";
export default defineConfig({
  products: {
    tool: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.jvm({ release: 17 })],
    }),
  },
  dependencies: {
    "java-8": { from: "maven", lockfile: "./deps/maven.tsv" },
  },
});
"#;

/// Build a real jar to depend on, and pin it at `digest`.
///
/// **A real jar rather than a written-out fixture**, because everything
/// interesting here is about bytes: the digest is computed over them, and the
/// packaging step unpacks them. A stand-in file would exercise the lookup and
/// nothing after it.
fn vendored_jar(project: &Path, digest: &str) -> bool {
    let lib = project.join("lib/com/example");
    std::fs::create_dir_all(&lib).expect("the library source directory");
    std::fs::create_dir_all(project.join("deps")).expect("the deps directory");
    std::fs::write(
        lib.join("Greeter.java"),
        "package com.example;\npublic final class Greeter {\n  \
         public static String greet(String who) { return \"hello, \" + who; }\n}\n",
    )
    .expect("the library source");
    let compiled = Command::new("javac")
        .args(["--release", "8", "-nowarn"])
        .arg(lib.join("Greeter.java"))
        .status()
        .is_ok_and(|status| status.success());
    if !compiled {
        return false;
    }
    let packaged = Command::new("jar")
        .arg("--create")
        .arg("--file")
        .arg(project.join("deps/greeter-1.0.0.jar"))
        .arg("-C")
        .arg(project.join("lib"))
        .arg("com")
        .status()
        .is_ok_and(|status| status.success());
    if !packaged {
        return false;
    }
    let bytes = std::fs::read(project.join("deps/greeter-1.0.0.jar")).expect("the built jar");
    let pinned = if digest == "real" { nts_build::dependencies::digest(&bytes) } else { digest.to_owned() };
    std::fs::write(
        project.join("deps/maven.tsv"),
        format!(
            "# Maven's resolved output, pinned.\n\
             com.example\tgreeter\t1.0.0\t{pinned}\tApache-2.0\truntime\thttps://repo1.maven.org/maven2\n"
        ),
    )
    .expect("the lockfile");
    true
}

fn jdk() -> bool {
    let tool = |name: &str, arg: &str| {
        Command::new(name).arg(arg).output().is_ok_and(|o| o.status.success())
    };
    let frontend =
        std::env::var_os("NTS_TSGO").is_some() || nts_frontend_ts::tsgo::locate().is_some();
    frontend && tool("javac", "-version") && tool("jar", "--version")
}

/// A pinned jar ends up inside the executable, and its absence leaves it out.
///
/// **The artifact's contents are the assertion, not the build's exit status.**
/// A build that resolved the jar, verified it, and then forgot to package it
/// exits zero and produces something that dies at the first call into it -- so
/// the test reads the archive.
#[test]
fn a_pinned_jar_ships_inside_the_executable() {
    if !jdk() {
        skip("the tsgo frontend and a JDK");
        return;
    }
    let project = fixture("build-jar-dependency", JVM_WITH_DEPENDENCY);
    if !vendored_jar(&project, "real") {
        skip("a JDK that can build the jar to depend on");
        return;
    }
    let run = build(&project, &[]);
    assert!(run.ok, "the build failed:\n{}{}", run.stdout, run.stderr);

    let artifact = project.join(".nts/build/tool/java-17/tool.jar");
    assert!(artifact.is_file(), "no jar at {}:\n{}", artifact.display(), run.stdout);
    let listed = Command::new("jar")
        .arg("--list")
        .arg("--file")
        .arg(&artifact)
        .output()
        .expect("jar --list");
    let inside = String::from_utf8_lossy(&listed.stdout);
    assert!(
        inside.contains("com/example/Greeter.class"),
        "the pinned jar was resolved and not packaged:\n{inside}"
    );

    // --- the same program with no claim --------------------------------------
    let bare = fixture("build-jar-none", JVM_EXECUTABLE);
    let run = build(&bare, &[]);
    assert!(run.ok, "the control build failed:\n{}{}", run.stdout, run.stderr);
    let listed = Command::new("jar")
        .arg("--list")
        .arg("--file")
        .arg(bare.join(".nts/build/tool/java-17/tool.jar"))
        .output()
        .expect("jar --list");
    assert!(
        !String::from_utf8_lossy(&listed.stdout).contains("com/example/Greeter.class"),
        "the control carries it too, so the assertion above is not about the claim"
    );
}

/// The bytes on this machine are not the bytes that were reviewed.
///
/// A pin whose digest is not checked is a version list, and the whole argument
/// for reading a resolver's output rather than re-running it is that the
/// artifact which ships is the artifact that was reviewed.
#[test]
fn a_jar_that_does_not_hash_to_its_pin_is_refused() {
    if !jdk() {
        skip("the tsgo frontend and a JDK");
        return;
    }
    let project = fixture("build-jar-wrong-digest", JVM_WITH_DEPENDENCY);
    let wrong = "0".repeat(64);
    if !vendored_jar(&project, &wrong) {
        skip("a JDK that can build the jar to depend on");
        return;
    }
    let run = build(&project, &[]);
    assert!(!run.ok, "a substituted artifact built anyway:\n{}", run.stdout);
    assert!(
        run.stderr.contains("does not hash to the digest"),
        "the refusal is not about the digest:\n{}",
        run.stderr
    );
    assert!(
        run.stderr.contains("not a stale lockfile to refresh"),
        "the refusal does not say not to update the pin:\n{}",
        run.stderr
    );
}

/// `nts build`, in the project directory, with no argument at all.
///
/// **The invocation every other test in this file avoids.** They pass an
/// absolute path, because `CARGO_TARGET_TMPDIR` is absolute -- and that blind
/// spot hid a real defect: `package_runnable_jar` runs `jar --extract` with its
/// working directory changed, so a relative output path resolved against the
/// wrong directory and the build died with `tool.jar (No such file or
/// directory)`. It is the same blind spot `absolute()` was written for, found
/// the same way, one path later.
#[test]
fn a_runnable_jar_builds_from_the_project_directory_with_no_argument() {
    if !jdk() {
        skip("the tsgo frontend and a JDK");
        return;
    }
    let project = fixture("build-jar-relative", JVM_EXECUTABLE);
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .current_dir(&project)
        .output()
        .expect("running nts build");
    assert!(
        output.status.success(),
        "a build with no argument failed:\n{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        project.join(".nts/build/tool/java-17/tool.jar").is_file(),
        "no jar:\n{}",
        String::from_utf8_lossy(&output.stdout)
    );
}

const WINDOWS_EXECUTABLE: &str = r#"
import { defineConfig, app, target } from "@nts/config";
export default defineConfig({
  products: {
    tool: app({ kind: "executable", entry: "./src/main.ts", targets: [target.windows()] }),
  },
});
"#;

/// A cross build that needs libuv says so, rather than failing inside clang.
///
/// **What this replaced is the point.** A program that awaits anything links the
/// libuv host, `zig cc` bundles a libc for the target and nothing else, and the
/// build died forty lines in with `fatal error: 'uv.h' file not found` -- a
/// message naming a file the reader never wrote, about a dependency nobody
/// told them they had.
///
/// **The control is `a_windows_target_produces_a_windows_dll` above**: the same
/// target and the same cross toolchain, built as a *library*, and it still
/// succeeds. Only the executable path emits the libuv host -- `main.c` includes
/// it -- so the pair separates "this refuses a Windows build that needs libuv"
/// from "this refuses Windows".
#[test]
fn a_cross_build_that_needs_libuv_names_it_rather_than_failing_in_the_compiler() {
    let zig = Command::new("zig").arg("version").output().is_ok_and(|o| o.status.success());
    if !available() || !zig {
        skip("the tsgo frontend, clang and zig");
        return;
    }
    let project = fixture("build-windows-libuv", WINDOWS_EXECUTABLE);
    let run = build(&project, &[]);
    assert!(!run.ok, "it built without libuv:\n{}", run.stdout);
    assert!(
        run.stderr.contains("`uv.h` is not reachable") && run.stderr.contains("libuv"),
        "the refusal does not name what it measured:\n{}",
        run.stderr
    );
    assert!(
        !run.stderr.contains("uv.h' file not found"),
        "it still reports the compiler's error rather than its own:\n{}",
        run.stderr
    );
}

const RELATIVE_LIB: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    lib: library.native({ targets: [target.linux()], entry: "./src/main.ts" }),
  },
});
"#;

/// Two projects built the same way are two projects.
///
/// **The snapshot cache keyed on the tsconfig path as given**, so every project
/// on the machine built as `nts build tsconfig.json` from its own directory
/// hashed to one entry -- and the `listing` guard that should have caught it was
/// vacuous for exactly those calls, because `Utf8Path::new("tsconfig.json")`
/// has an empty parent and `read_dir("")` fails. An empty listing matches an
/// empty listing.
///
/// Reproduced from a cleared cache: the first project built and the second was
/// handed the first's program. It surfaced as the product-entry check failing,
/// which is luck rather than protection -- two projects whose entry paths agree
/// would have compiled the wrong sources and said nothing.
///
/// **Both halves are asserted**, because "the second one builds" also passes for
/// a cache that answered from the first: the test reads the emitted C and
/// requires the second project's function and not the first's.
#[test]
fn two_projects_built_from_their_own_directories_do_not_share_a_snapshot() {
    if !available() {
        skip("node, the tsgo frontend and clang");
        return;
    }
    let build_there = |project: &Path| {
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["build", "tsconfig.json"])
            .current_dir(project)
            .output()
            .expect("running nts build")
    };
    let alpha = fixture("build-relative-alpha", RELATIVE_LIB);
    std::fs::write(
        alpha.join("src/main.ts"),
        "export function alphaOnly(n: number): number { return n + 1; }\n",
    )
    .expect("alpha entry");
    let beta = fixture("build-relative-beta", RELATIVE_LIB);
    std::fs::write(
        beta.join("src/main.ts"),
        "export function betaOnly(n: number): number { return n + 2; }\n",
    )
    .expect("beta entry");

    let first = build_there(&alpha);
    assert!(
        first.status.success(),
        "the first build failed:\n{}{}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    let second = build_there(&beta);
    assert!(
        second.status.success(),
        "the second build failed, which is what the collision looked like:\n{}{}",
        String::from_utf8_lossy(&second.stdout),
        String::from_utf8_lossy(&second.stderr)
    );

    let emitted = beta.join(".nts/build/lib/linux-gnu-x86_64/program.c");
    let text = std::fs::read_to_string(&emitted).expect("the second project's C");
    assert!(text.contains("betaOnly"), "the second project's own function is absent");
    assert!(
        !text.contains("alphaOnly"),
        "the second project was compiled from the first's sources"
    );
}

const APPLE_WITH_UNREADABLE_DEPENDENCY: &str = r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: {
    sdk: library.native({ targets: [target.macos({ minimumVersion: "14.0" })], entry: "./src/main.ts" }),
  },
  dependencies: {
    "macos-14": { from: "cocoapods", lockfile: "./deps/Podfile.lock" },
  },
});
"#;

/// When two things are wrong, the one you can act on is reported.
///
/// **A refusal that stops hides the cause behind it.** `apps/ios` reported that
/// a package declares a `CocoaPods` claim this build cannot read -- true, and not
/// the reason the build was never going to work on Linux, which is that there
/// is no Apple SDK here. Reading the dependency first put the smaller fact in
/// front of the larger one, and the larger one is the only one with a fix the
/// reader can carry out.
#[test]
fn a_missing_toolchain_is_reported_before_a_dependency_it_would_never_reach() {
    if !available() || host_is_apple() {
        skip("a non-Apple host with the tsgo frontend and clang");
        return;
    }
    let project = fixture("build-apple-before-deps", APPLE_WITH_UNREADABLE_DEPENDENCY);
    let run = build(&project, &[]);
    assert!(!run.ok, "an Apple target built on this machine:\n{}", run.stdout);
    assert!(
        run.stderr.contains("Cross-compiling to Apple needs its SDK"),
        "the toolchain is not what it reported:\n{}",
        run.stderr
    );
    assert!(
        !run.stderr.contains("CocoaPods"),
        "the dependency refusal is still standing in front of it:\n{}",
        run.stderr
    );
}

fn host_is_apple() -> bool {
    std::env::consts::OS == "macos"
}

/// The libuv probe answers differently when libuv is reachable.
///
/// **The arm that makes the other one a check.** A test asserting a refusal
/// passes for a probe that refuses unconditionally, and that is what the first
/// version was: it asked `-fsyntax-only`, which `zig cc` does not honour --
/// it reports `error: FileNotFound` against line 1 column 1 whatever the file
/// says -- so every cross build reaching it was refused whether or not `uv.h`
/// was there. The refusal test could not see it and the library control never
/// reached the probe.
///
/// So this puts a `uv.h` somewhere *only a dependency claim names*, which also
/// pins the second half: the probe compiles with the include path the real
/// compile uses, not a narrower one. A header arriving through `--cflags` is
/// exactly the case the probe's own comment says it exists to permit.
///
/// It gets past the probe and fails later in the compile, because the header is
/// a stub with none of libuv's types in it. That is the assertion -- not that
/// the build succeeds, but that it no longer stops *here*.
#[test]
fn the_libuv_probe_sees_a_header_that_only_a_dependency_claim_names() {
    let zig = Command::new("zig").arg("version").output().is_ok_and(|o| o.status.success());
    if !available() || !zig {
        skip("the tsgo frontend, clang and zig");
        return;
    }
    let project = fixture("build-libuv-reachable", WINDOWS_EXECUTABLE_WITH_UV);
    let include = project.join("fakeuv/include");
    std::fs::create_dir_all(&include).expect("the include directory");
    std::fs::write(include.join("uv.h"), "#ifndef FAKE_UV_H\n#define FAKE_UV_H\n#endif\n")
        .expect("the stub header");
    let pc = project.join("pc");
    std::fs::create_dir_all(&pc).expect("the pkg-config directory");
    std::fs::write(
        pc.join("fakeuv.pc"),
        format!(
            "prefix={}\nName: fakeuv\nDescription: a libuv reachable only through a claim\n\
             Version: 1.0.0\nCflags: -I${{prefix}}/include\nLibs:\n",
            project.join("fakeuv").display()
        ),
    )
    .expect("the pkg-config file");

    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .arg(project.join("tsconfig.json"))
        .env("PKG_CONFIG_PATH", &pc)
        .output()
        .expect("running nts build");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !stderr.contains("`uv.h` is not reachable"),
        "the probe refused a header its own dependency claim names:\n{stderr}"
    );
}

const WINDOWS_EXECUTABLE_WITH_UV: &str = r#"
import { defineConfig, app, target } from "@nts/config";
export default defineConfig({
  products: {
    tool: app({ kind: "executable", entry: "./src/main.ts", targets: [target.windows()] }),
  },
  dependencies: {
    windows: { from: "pkg-config", packages: ["fakeuv"] },
  },
});
"#;

const JVM_GRADLE_DEPENDENCY: &str = r#"
import { defineConfig, app, target } from "@nts/config";
export default defineConfig({
  products: {
    tool: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.jvm({ release: 17 })],
    }),
  },
  dependencies: {
    "java-8": { from: "gradle", lockfile: "./deps/gradle.tsv" },
  },
});
"#;

/// A pin is found in a Gradle cache, whose layout is not Maven's.
///
/// **Two layouts, and getting them the same way round is the whole of this.**
/// Maven splits the group on dots into directories; Gradle keeps it as one
/// directory name and puts the file under a *digest* directory it computes, so
/// the leaf has to be read rather than constructed:
///
/// ```text
/// ~/.m2/repository/com/google/code/gson/gson/2.9.1/gson-2.9.1.jar
/// ~/.gradle/caches/modules-2/files-2.1/com.google.code.gson/gson/2.9.1/<sha1>/gson-2.9.1.jar
/// ```
///
/// Checked against a real cache before it was written, and the path this builds
/// was then exercised end to end against a real `gson-2.9.1.jar`: located,
/// digest verified, 216 of its classes inside the executable, and it ran. That
/// run is not reproducible here -- it depends on what the developer's Gradle
/// cache happens to hold -- so the layout is staged under a `HOME` this test
/// owns, which exercises the same branch and can fail.
#[test]
fn a_pin_is_found_in_a_gradle_cache_and_not_only_beside_the_lockfile() {
    if !jdk() {
        skip("the tsgo frontend and a JDK");
        return;
    }
    let project = fixture("build-gradle-cache", JVM_GRADLE_DEPENDENCY);
    if !vendored_jar(&project, "real") {
        skip("a JDK that can build the jar to depend on");
        return;
    }
    // Move the jar out of the one place that would find it without a cache, so
    // a pass cannot come from the vendored branch.
    let staged =
        project.join("gradle-home/caches/modules-2/files-2.1/com.example/greeter/1.0.0/abc123");
    std::fs::create_dir_all(&staged).expect("the gradle cache layout");
    std::fs::rename(project.join("deps/greeter-1.0.0.jar"), staged.join("greeter-1.0.0.jar"))
        .expect("staging the jar into the cache");
    std::fs::rename(project.join("deps/maven.tsv"), project.join("deps/gradle.tsv"))
        .expect("the lockfile this config names");

    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("build")
        .arg(project.join("tsconfig.json"))
        // **`GRADLE_USER_HOME` rather than `HOME`.** Overriding `HOME` is what
        // this reached for first, and on a machine whose JDK arrives through
        // asdf it breaks every tool: `jar` is a shim under `$HOME/.asdf`, so it
        // exited 126 with empty stderr and the build reported "packaging
        // failed" with nothing after the colon. `GRADLE_USER_HOME` is what
        // Gradle itself reads, so honouring it is the more correct lookup as
        // well as the testable one.
        .env("GRADLE_USER_HOME", project.join("gradle-home"))
        .output()
        .expect("running nts build");
    assert!(
        run.status.success(),
        "the pin was not found in the Gradle cache:\n{}{}",
        String::from_utf8_lossy(&run.stdout),
        String::from_utf8_lossy(&run.stderr)
    );
    let listed = Command::new("jar")
        .arg("--list")
        .arg("--file")
        .arg(project.join(".nts/build/tool/java-17/tool.jar"))
        .output()
        .expect("jar --list");
    assert!(
        String::from_utf8_lossy(&listed.stdout).contains("com/example/Greeter.class"),
        "found and not packaged"
    );
}

/// `nts help` lists every command, and only commands that exist.
///
/// **Two derivations of one fact, so one of them asserts.** The usage text and
/// the `match` in `main` are both answers to "what can this be asked to do",
/// and a usage naming a command that is not dispatched makes the same promise a
/// config field nothing reads makes. Keeping them in step by hand is what fails
/// quietly -- a command added to the dispatch is invisible to anyone who has
/// not read `main.rs`, which is the state `help` was added to fix.
///
/// Reads the dispatch out of the source rather than restating it, because a
/// hardcoded list here would be a *third* copy.
#[test]
fn the_usage_names_every_command_and_no_others() {
    let source = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/main.rs"),
    )
    .expect("reading main.rs");
    let dispatch = source
        .split_once("fn main() -> Result<()> {")
        .expect("main's dispatch")
        .1;
    let body = dispatch.split_once("\n}\n").map_or(dispatch, |(body, _)| body);

    let mut dispatched: BTreeSet<String> = BTreeSet::new();
    for at in body.match_indices("Some(\"") {
        let rest = &body[at.0 + "Some(\"".len()..];
        let Some(name) = rest.split('"').next() else { continue };
        // `--help` and `-h` are spellings of `help`, not commands of their own.
        if !name.is_empty() && !name.starts_with('-') {
            dispatched.insert(name.to_owned());
        }
    }
    assert!(dispatched.len() > 5, "the dispatch was not found: {dispatched:?}");

    let shown = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("help")
        .output()
        .expect("running nts help");
    let text = String::from_utf8_lossy(&shown.stdout);
    let listed: BTreeSet<String> = text
        .lines()
        .filter_map(|line| {
            // A command row is two spaces, the name, then the *column gap* and
            // prose. Requiring two spaces after the name is what separates it
            // from the `nts <command> [project]` line in the usage block, which
            // has one -- and which this counted as a command called `nts`.
            let rest = line.strip_prefix("  ")?;
            let (name, described) = rest.split_once("  ")?;
            let name = name.trim();
            (!name.is_empty() && !name.contains(' ') && !name.starts_with('-')
                && !described.trim().is_empty())
            .then(|| name.to_owned())
        })
        .collect();

    let missing: Vec<&String> = dispatched.difference(&listed).collect();
    assert!(missing.is_empty(), "dispatched and not in `nts help`: {missing:?}");
    let invented: Vec<&String> = listed.difference(&dispatched).collect();
    assert!(invented.is_empty(), "named by `nts help` and not dispatched: {invented:?}");
}

/// `nts` with no argument says what it is, and `--help` is not an error.
///
/// It printed a version banner and exited zero, which tells someone who has
/// just installed it nothing; `--help` answered ``unknown command `--help` ``,
/// which is the one spelling every other tool on the machine accepts.
#[test]
fn the_bare_command_and_the_usual_help_spellings_all_print_usage() {
    for arguments in [vec![], vec!["help"], vec!["--help"], vec!["-h"]] {
        let shown = Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(&arguments)
            .output()
            .expect("running nts");
        let text = String::from_utf8_lossy(&shown.stdout);
        assert!(shown.status.success(), "`nts {arguments:?}` failed");
        assert!(text.contains("USAGE"), "`nts {arguments:?}` printed no usage:\n{text}");
        assert!(
            text.contains("build"),
            "`nts {arguments:?}` does not mention the main command:\n{text}"
        );
    }
    // And an unknown command still fails, pointing at the listing.
    let wrong = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("bulid")
        .output()
        .expect("running nts");
    assert!(!wrong.status.success(), "a typo exited zero");
    assert!(
        String::from_utf8_lossy(&wrong.stderr).contains("nts help"),
        "the error does not point at the listing"
    );
}

/// The snapshot cache hits on a second run, which nothing checked.
///
/// **A cache that never hits is invisible.** The tests around this asserted
/// *correctness* -- that two projects do not share an entry -- and nothing
/// asserted *effect*. So when the canonicalisation that fixed the key left the
/// entry's `configs` field derived from the un-canonicalised path, the stored
/// chain was `["tsconfig.json"]` and the compared chain was the absolute one:
/// never equal, the entry rewritten on every run, and the whole cache dead. Every
/// test still passed, because a build that recomputes everything is a correct
/// build.
///
/// It was found by measuring -- cache and no-cache came back at 0.445s against
/// 0.442s, which is what a cache that never hits looks like from outside.
///
/// Asserted by *writes*, not by timing: an entry rewritten is a miss, and a
/// timing assertion on a half-second build would be a flake.
#[test]
fn a_second_build_hits_the_snapshot_cache_rather_than_rewriting_it() {
    if !available() {
        skip("node, the tsgo frontend and clang");
        return;
    }
    let project = fixture("build-snapshot-hit", SHARED);
    let cache = project.join("snapshots");
    drop(std::fs::remove_dir_all(&cache));
    // **Invoked with a relative path, from the project directory.** The first
    // version of this test passed an absolute one and *passed the sabotage* --
    // with an absolute path the two derivations of the config chain agree, so
    // the bug it was written for cannot reproduce. That is the same blind spot,
    // in the same session, in a test written for exactly that blind spot: every
    // fixture path is absolute unless someone deliberately reaches for the
    // other case.
    let build_once = || {
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["build", "tsconfig.json"])
            .current_dir(&project)
            .env("NTS_SNAPSHOT_CACHE", &cache)
            .output()
            .expect("running nts build")
    };
    let stamps = || -> BTreeMap<PathBuf, std::time::SystemTime> {
        std::fs::read_dir(&cache)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let at = entry.metadata().ok()?.modified().ok()?;
                Some((entry.path(), at))
            })
            .collect()
    };

    let first = build_once();
    assert!(first.status.success(), "{}", String::from_utf8_lossy(&first.stderr));
    let after_first = stamps();
    assert!(!after_first.is_empty(), "the first build wrote no cache entry at all");

    // A second apart, so a rewrite is visible in the timestamp.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let second = build_once();
    assert!(second.status.success(), "{}", String::from_utf8_lossy(&second.stderr));
    let after_second = stamps();

    let rewritten: Vec<&PathBuf> = after_second
        .iter()
        .filter(|(path, at)| after_first.get(*path).is_none_or(|was| was != *at))
        .map(|(path, _)| path)
        .collect();
    assert!(
        rewritten.is_empty(),
        "the second build rewrote {} entr(ies), so the cache did not hit: {rewritten:?}",
        rewritten.len()
    );
}
