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

use std::collections::BTreeSet;
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
    // `target.linux()` defaults to llvm, whose slice is scalar and which renders
    // to stdout -- so there is nothing for a build to write.
    // Not `build-llvm`: the assertion below looks for "llvm" in the message, and
    // a directory named for it would put it in every path printed. See
    // `a_build_that_drops_functions_says_how_many`, where that mistake made a
    // test pass for two hours without checking anything.
    let project = fixture(
        "build-backend-refusal",
        r#"
import { defineConfig, library, target } from "@nts/config";
export default defineConfig({
  products: { acme: library.native({ targets: [target.linux()], entry: "./src/main.ts" }) },
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

/// A jar is packaged, runs, and refuses a package it cannot produce.
///
/// **Two artifacts and not one.** `apps/java-desktop-brownfield` states the
/// open question: the runtime jar is either shaded in or declared as a
/// dependency, and "neither is free and the choice is not made". Both are
/// written, so the decision stays available.
///
/// The refusal is the other half. `javaPackage` had no reader at all, and
/// `codegen/jvm` hardcodes `nts/gen`; a jar whose classes are somewhere other
/// than where its config says does not match its own declaration.
#[test]
fn a_jar_is_packaged_and_an_impossible_package_is_refused() {
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
    let refused = build(&project, &[]);
    assert!(!refused.ok, "a package the emitter cannot produce should stop the build");
    assert!(
        refused.stderr.contains("com.acme.sdk") && refused.stderr.contains("nts.gen"),
        "the refusal named neither package:\n{}",
        refused.stderr,
    );

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
    let project = Path::new(env!("CARGO_TARGET_TMPDIR")).join("build-binding");
    drop(std::fs::remove_dir_all(&project));
    for sub in ["src", "native"] {
        std::fs::create_dir_all(project.join(sub)).expect("creating the fixture");
    }
    std::fs::write(
        project.join("native/digest.h"),
        "#ifndef PROBE_DIGEST_H\n#define PROBE_DIGEST_H\n#include <stdint.h>\nuint32_t digest_step(uint32_t seed, uint32_t value);\n#endif\n",
    )
    .expect("the header");
    std::fs::write(
        project.join("native/digest.c"),
        "#include \"digest.h\"\nuint32_t digest_step(uint32_t seed, uint32_t value) { return (seed ^ value) * 16777619u; }\n",
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
