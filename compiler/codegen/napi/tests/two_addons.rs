//! Two different nts addons in one node, loaded `RTLD_GLOBAL`, each keep their
//! own runtime (#977).
//!
//! Each addon carries a copy of the runtime. At default visibility the copy was
//! published: an addon's dynamic table held about 500 runtime symbols beside
//! its Node-API entry, and with both addons in node's global scope, 57 of the
//! second one's references bound to the first one's definitions
//! (`nts_alloc`, `nts_release`, `nts_promise_subscribe`, `nts_desc_string1`,
//! ...). It allocated, released and queued work through the other addon's
//! runtime while its inlined paths used its own.
//!
//! The answers are the control, and they agreed with node before the fix too:
//! two runtimes from one compiler run the same code. What the fix changes is
//! the dynamic table, which is exactly the two Node-API entry points, and the
//! binding log, in which neither addon binds anything to the other.
//!
//! One addon is the C backend's and the other LLVM's, built as a hand-written
//! build does, with no `-fvisibility=hidden`.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::collections::BTreeSet;
use std::process::{Command, Output};

use crate::libc_named_exports::{build, dynamic_symbols, text};
use crate::scratch;

const ALPHA: &str = r#"
const seen = new Map<string, number>();
export function count(word: string): number {
  const n = (seen.get(word) ?? 0) + 1;
  seen.set(word, n);
  return n;
}
export function shout(word: string): string {
  return word.toUpperCase() + "!";
}
"#;

const BETA: &str = r#"
const items: number[] = [];
export function push(n: number): number {
  items.push(n * 2);
  return items.length;
}
export function total(): number {
  let sum = 0;
  for (const n of items) sum += n;
  return sum;
}
export function label(n: number): string {
  return "b:" + n.toFixed(2) + ":" + String(n / 3);
}
"#;

/// Calls interleaved between the two, so each runtime's state is in use while
/// the other's is.
const OBSERVE: &str = r"
const answer = (a, b) => {
  const out = [];
  out.push(a.count('x'), b.push(1), a.shout('hi'), b.label(3));
  out.push(a.count('x'), b.push(2.5), b.total(), a.shout('ok'));
  out.push(a.count('y'), b.label(-0.5), b.total());
  return JSON.stringify(out);
};
";

/// What node loads an addon by: the Node-API entry points `node_api.h`
/// declares with explicit default visibility. Nothing of the runtime.
const ENTRY_POINTS: [&str; 2] = [
    "napi_register_module_v1",
    "node_api_module_get_api_version_v1",
];

#[test]
fn two_addons_loaded_globally_each_keep_their_own_runtime() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::in_target("pair");
    let alpha = addon(&root, &dir.join("alpha"), ALPHA, Backend::C);
    let beta = addon(&root, &dir.join("beta"), BETA, Backend::Llvm);

    let oracle = node_oracle(&dir.join("alpha/main.ts"), &dir.join("beta/main.ts"));
    assert!(oracle.status.success(), "{}", text(&oracle));
    let expected = String::from_utf8_lossy(&oracle.stdout).trim().to_owned();

    for (name, binary) in [("alpha (C)", &alpha), ("beta (LLVM)", &beta)] {
        let published = dynamic_symbols(binary);
        let entries: BTreeSet<String> = ENTRY_POINTS.iter().map(|s| (*s).to_owned()).collect();
        assert_eq!(
            published, entries,
            "{name}'s dynamic table holds more than its Node-API entry points"
        );
    }

    for (first, second) in [(&alpha, &beta), (&beta, &alpha)] {
        let log = dir.join("bindings");
        let _ = std::fs::remove_dir_all(&log);
        std::fs::create_dir_all(&log).unwrap();
        let loaded = load_globally(first, second, &alpha, &beta, &log);
        // The control: a wrong answer here is a broken build, not a binding.
        assert!(loaded.status.success(), "{}", text(&loaded));
        assert_eq!(
            String::from_utf8_lossy(&loaded.stdout).trim(),
            expected,
            "loaded {first} then {second}: the addons answered other than node"
        );
        let crossed = cross_bindings(&log, &alpha, &beta);
        assert!(
            crossed.is_empty(),
            "loaded {first} then {second}: one addon's references bound to the other's runtime: \
             {crossed:#?}"
        );
    }
}

#[derive(Clone, Copy)]
enum Backend {
    C,
    Llvm,
}

/// One program, emitted and linked into its own `.node`.
fn addon(root: &Utf8Path, dir: &Utf8Path, source: &str, backend: Backend) -> Utf8PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::new(hir::backend::Backend::C, hir::EntryUnwind::Resuming)
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
    let addon = nts_codegen_napi::emit(&prepared.program);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
    let out = dir.join("build");
    match backend {
        Backend::C => build(root, &out, "program.c", c.writer.text(), &c, &addon),
        Backend::Llvm => {
            let llvm =
                nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
            assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
            build(root, &out, "program.ll", &llvm.text, &c, &addon)
        }
    }
}

/// Both addons in one node, each `dlopen`ed `RTLD_NOW | RTLD_GLOBAL`, with the
/// dynamic linker's bindings logged under `log`.
fn load_globally(
    first: &Utf8Path,
    second: &Utf8Path,
    alpha: &Utf8Path,
    beta: &Utf8Path,
    log: &Utf8Path,
) -> Output {
    let script = format!(
        "{OBSERVE}const os=require('node:os');\
         const flags=os.constants.dlopen.RTLD_NOW|os.constants.dlopen.RTLD_GLOBAL;\
         const load=p=>{{const m={{exports:{{}}}};process.dlopen(m,p,flags);return m.exports;}};\
         const loaded=new Map();for(const p of [process.argv[1],process.argv[2]])loaded.set(p,load(p));\
         console.log(answer(loaded.get(process.argv[3]),loaded.get(process.argv[4])));"
    );
    Command::new("node")
        .args(["-e", &script])
        .args([first, second, alpha, beta])
        .env("LD_DEBUG", "bindings")
        .env("LD_DEBUG_OUTPUT", log.join("ld"))
        .output()
        .unwrap()
}

/// Every symbol either addon's references bound to a definition in the other.
fn cross_bindings(log: &Utf8Path, alpha: &Utf8Path, beta: &Utf8Path) -> Vec<String> {
    let mut crossed = Vec::new();
    for entry in std::fs::read_dir(log).unwrap() {
        let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        for line in text.lines() {
            // `binding file <from> [0] to <to> [0]: normal symbol `name'`
            let Some((from, to)) = line
                .split_once("binding file ")
                .and_then(|(_, rest)| rest.split_once(" to "))
            else {
                continue;
            };
            let reaches = |path: &Utf8Path| from.starts_with(path.as_str());
            let defines = |path: &Utf8Path| to.starts_with(path.as_str());
            if (reaches(alpha) && defines(beta)) || (reaches(beta) && defines(alpha)) {
                crossed.push(line.trim().to_owned());
            }
        }
    }
    crossed
}

fn node_oracle(alpha: &Utf8Path, beta: &Utf8Path) -> Output {
    let script = format!(
        "{OBSERVE}const url=require('node:url');\
         Promise.all([process.argv[1],process.argv[2]].map(p=>import(url.pathToFileURL(p).href)))\
         .then(([a,b])=>console.log(answer(a,b)))\
         .catch(e=>{{console.error(e);process.exitCode=1;}});"
    );
    Command::new("node")
        .args(["--no-warnings", "-e", &script])
        .args([alpha, beta])
        .output()
        .unwrap()
}
