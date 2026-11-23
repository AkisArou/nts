//! An addon whose exports are named like libc functions calls its own (#972).
//!
//! The program is `tests/programs/an-addon-export-named-like-a-libc-function`:
//! `error` and `exit` beside the controls `throwError` and `leave`, each pair
//! one body under two names. Built the way a hand-written build does -- no
//! LTO, no `-fvisibility=hidden`, no `-Bsymbolic` -- because binding is the
//! emitted code's to state, not a flag every builder must remember.
//!
//! Before the fix both backends' addons answered every control and lost
//! `error` to glibc, whose `error()` printed `node: ` and exited the process.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::collections::BTreeSet;
use std::process::{Command, Output};

use crate::scratch;

const SOURCE: &str = include_str!(
    "../../../../tests/programs/an-addon-export-named-like-a-libc-function/src/main.ts"
);

/// The C symbols the four exports' definitions carry.
const SYMBOLS: [&str; 4] = ["error", "throwError", "exit_", "leave"];

/// Fractions and NaN take the generic path, not a whole-number clone.
const OBSERVE: &str = r"
const names = ['error', 'throwError', 'exit', 'leave'];
const inputs = [0, 1, 4, 4.5, 6, 11, -3, NaN];
const answer = a => Object.fromEntries(names.map(name => [name, inputs.map(n => a[name](n))]));
";

#[test]
fn an_addon_calls_its_own_libc_named_exports_on_both_backends() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/libc-named-exports"), "addon");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let oracle = node_oracle(&dir.join("main.ts"));
    assert!(oracle.status.success(), "{}", text(&oracle));
    let expected = String::from_utf8_lossy(&oracle.stdout).trim().to_owned();

    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let addon = nts_codegen_napi::emit(&prepared.program);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);

    for (backend, body, source) in [
        ("c", "program.c", c.writer.text()),
        ("llvm", "program.ll", llvm.text.as_str()),
    ] {
        let out = dir.join(backend);
        let binary = build(&root, &out, body, source, &c, &addon);
        // The control first: a wrong answer for every name is a broken build,
        // not a binding.
        let loaded = load(&binary);
        assert!(loaded.status.success(), "{backend}: {}", text(&loaded));
        assert_eq!(
            String::from_utf8_lossy(&loaded.stdout).trim(),
            expected,
            "{backend}: an export answered other than node"
        );
        let published = dynamic_symbols(&binary);
        let leaked: Vec<_> = SYMBOLS
            .iter()
            .filter(|symbol| published.contains(**symbol))
            .collect();
        assert!(
            leaked.is_empty(),
            "{backend}: the addon publishes program symbols {leaked:?} beside its Node-API entry"
        );
        assert!(
            published.contains("napi_register_module_v1"),
            "{backend}: the Node-API entry is not published: {published:?}"
        );
    }
}

fn build(
    root: &Utf8Path,
    out: &Utf8Path,
    body: &str,
    source: &str,
    support: &nts_codegen_c::Emitted,
    addon: &nts_codegen_napi::Addon,
) -> camino::Utf8PathBuf {
    std::fs::create_dir_all(out).unwrap();
    std::fs::write(out.join(body), source).unwrap();
    addon.write_into(out.as_std_path()).unwrap();
    let mut sources = vec![
        out.join(body).into_std_path_buf(),
        out.join("addon.c").into_std_path_buf(),
    ];
    for file in support.support_files() {
        let path = file.write(out.as_std_path()).unwrap();
        if file.compiled {
            sources.push(path);
        }
    }
    let headers = root.join("third_party/node/src");
    assert!(
        headers.join("node_api.h").is_file(),
        "Node-API headers required"
    );
    let binary = out.join("probe.node");
    let linked = Command::new("clang")
        .args([
            "-std=c11",
            "-O1",
            "-shared",
            "-fPIC",
            "-Wno-override-module",
            "-I",
        ])
        .arg(headers)
        .arg("-I")
        .arg(out)
        .args(sources)
        .args(["-lm", "-o"])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(linked.status.success(), "{}", text(&linked));
    binary
}

fn load(binary: &Utf8Path) -> Output {
    let script = format!(
        "{OBSERVE}const a=require(process.argv[1]);console.log(JSON.stringify(answer(a)));"
    );
    Command::new("node")
        .args(["-e", &script])
        .arg(binary)
        .output()
        .unwrap()
}

/// Defined symbols in the dynamic table, by name.
fn dynamic_symbols(binary: &Utf8Path) -> BTreeSet<String> {
    let listed = Command::new("nm")
        .args(["-D", "--defined-only"])
        .arg(binary)
        .output()
        .unwrap();
    assert!(listed.status.success(), "{}", text(&listed));
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .filter_map(|line| line.split_whitespace().nth(2).map(str::to_owned))
        .collect()
}

fn node_oracle(source: &Utf8Path) -> Output {
    let script = format!(
        "{OBSERVE}import(require('node:url').pathToFileURL(process.argv[1]).href).then(a=>console.log(JSON.stringify(answer(a)))).catch(e=>{{console.error(e);process.exitCode=1;}});"
    );
    Command::new("node")
        .args(["--no-warnings", "-e", &script])
        .arg(source)
        .output()
        .unwrap()
}

fn text(output: &Output) -> String {
    format!(
        "status={}; stdout={}; stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}
