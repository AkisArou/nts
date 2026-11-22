//! An addon class constructs from JavaScript on LLVM as on C (#500).
//!
//! Both backends link the same Node-API layer, which allocates each published
//! class through its `nts_construct_*` factory. Every addon is loaded with
//! `RTLD_NOW`, so a factory a backend failed to define fails the load itself
//! rather than hiding behind lazy binding until the first `new`.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::{Command, Output};

use crate::scratch;

const COUNTER: &str = r"
export const scalar: number = 17;
export function declaredFactory(n: number): number { return n + 1; }
export class Counter {
    value: number;
    constructor(n: number) { this.value = n; }
    read(): number { return this.value + 1; }
}
";

const COUNTER_ARMS: &[Arm] = &[Arm {
    name: "values",
    observe: "JSON.stringify({scalar: a.scalar, declared: a.declaredFactory(17), method: new a.Counter(17).read()})",
    answer: "{\"scalar\":17,\"declared\":18,\"method\":18}",
}];

/// #500's fixture, found by #900: a class whose method is a numeric
/// specialization, constructed once by the module itself and once by the host.
const SPECIALIZED: &str = r"

let saved:number[]|null=null;
export function store(xs:number[],before:boolean,after:boolean):number {
  if(before) throw undefined;
  let result=0;
  for(let i=0;i<xs.length;i++) result+=xs[i];
  saved=xs;
  if(after) throw undefined;
  return result;
}
export function direct(n:number):number { return store([n,n+1],false,false); }
export function kept(n:number):number { const xs=[n,n+1]; const result=store(xs,false,false); saved=null; return result+xs[0]; }
function nestedThrow(shouldThrow:boolean):void {
  let value=0;
  for(let i=0;i<3;i++) value+=i;
  if(shouldThrow && value===3) throw undefined;
}
export function nestedStore(xs:number[],before:boolean,after:boolean):number {
  nestedThrow(before);
  const result=xs[0];
  saved=xs;
  nestedThrow(after);
  return result;
}
export function nestedDirect(n:number):number { return nestedStore([n],false,false); }
function relayThrow(shouldThrow:boolean):void {
  for(let i=0;i<3;i++) if(i===2) nestedThrow(shouldThrow);
}
export function deepStore(xs:number[],before:boolean,after:boolean):number {
  relayThrow(before);
  const result=xs[0];
  saved=xs;
  relayThrow(after);
  return result;
}
export function deepDirect(n:number):number { return deepStore([n],false,false); }
function quietRead(xs:number[]):number {
  let value=0;
  for(let i=0;i<xs.length;i++) value+=xs[i];
  return value;
}
export function quietStore(xs:number[]):number {
  const result=quietRead(xs);
  saved=xs;
  return result;
}
export function quietDirect(n:number):number { return quietStore([n,n+1]); }
export function read():number { return saved===null?-1:saved[0]; }
export function clear():void { saved=null; }

export class SpecializedKeeper {
  tag:number;
  constructor(tag:number) { this.tag=tag; }
  keep(xs:number[], mode:number):number {
    nestedThrow(mode<0);
    let answer=xs[0]+this.tag;
    saved=xs;
    nestedThrow(mode>0);
    for(let i=0;i<3;i++) answer+=i;
    return answer;
  }
}
const sharedKeeper=new SpecializedKeeper(7);
export function specializedPublished(xs:number[], mode:number):number {
  return sharedKeeper.keep(xs,mode);
}
export function specializedDirect(n:number):number {
  return new SpecializedKeeper(n).keep([n],0);
}
";

/// The subject constructs through the addon; the control constructs the same
/// class in source and only calls through it.
const SPECIALIZED_ARMS: &[Arm] = &[
    Arm {
        name: "subject",
        observe: "new a.SpecializedKeeper(7).keep([1], 0)",
        answer: "11",
    },
    Arm {
        name: "control",
        observe: "a.specializedPublished([1], 0)",
        answer: "11",
    },
];

struct Arm {
    name: &'static str,
    observe: &'static str,
    answer: &'static str,
}

#[test]
fn an_llvm_addon_class_constructs_as_on_c() {
    agree("counter", COUNTER, COUNTER_ARMS, hir::Memory::NoGc);
}

#[test]
fn an_llvm_addon_specialized_class_constructs_as_on_c() {
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        agree("specialized", SPECIALIZED, SPECIALIZED_ARMS, provider);
    }
}

fn agree(name: &str, source: &str, arms: &[Arm], provider: hir::Memory) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(
        &root.join("target/llvm-addon-class"),
        &format!("{name}-{provider:?}"),
    );
    std::fs::write(dir.join("main.ts"), source).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    for arm in arms {
        let oracle = node_oracle(&dir.join("main.ts"), arm.observe);
        assert!(oracle.status.success(), "{}: {}", arm.name, text(&oracle));
        assert_eq!(
            String::from_utf8_lossy(&oracle.stdout).trim(),
            arm.answer,
            "node's own answer for {}",
            arm.name
        );
    }

    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
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
    let entries = nts_codegen_common::publication::construction_entries(&prepared.program);
    assert!(!entries.is_empty(), "the fixture publishes a class");
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let addon = nts_codegen_napi::emit(&prepared.program);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
    for entry in &entries {
        let symbol = entry.symbol();
        assert!(
            addon
                .source
                .contains(&format!("NtsHeader *{symbol}(void);")),
            "the addon declares {symbol}"
        );
    }

    for (backend, body, emitted) in [
        ("c", "program.c", c.writer.text()),
        ("llvm", "program.ll", llvm.text.as_str()),
    ] {
        let binary = build(
            &root,
            &dir.join(backend),
            body,
            emitted,
            &c,
            &addon,
            provider,
        );
        for arm in arms {
            let ran = load_now(&binary, arm.observe);
            assert!(
                ran.status.success(),
                "{backend} {}: {}",
                arm.name,
                text(&ran)
            );
            assert_eq!(
                String::from_utf8_lossy(&ran.stdout).trim(),
                arm.answer,
                "{backend} {}",
                arm.name
            );
        }
    }
}

fn build(
    root: &Utf8Path,
    out: &Utf8Path,
    body: &str,
    source: &str,
    support: &nts_codegen_c::Emitted,
    addon: &nts_codegen_napi::Addon,
    provider: hir::Memory,
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
    let mut clang = Command::new("clang");
    clang.args([
        "-std=c11",
        "-O1",
        "-shared",
        "-fPIC",
        "-Wno-override-module",
    ]);
    if provider == hir::Memory::ReferenceCounting {
        clang.arg("-DNTS_PROVIDER_RC");
    }
    let linked = clang
        .arg("-I")
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

/// Every symbol is bound when the addon loads, so a missing one is a load
/// failure naming it.
fn load_now(binary: &Utf8Path, observe: &str) -> Output {
    let script = format!(
        "const m={{exports:{{}}}};process.dlopen(m,process.argv[1],require('node:os').constants.dlopen.RTLD_NOW);const a=m.exports;console.log({observe});"
    );
    Command::new("node")
        .args(["-e", &script])
        .arg(binary)
        .output()
        .unwrap()
}

fn node_oracle(source: &Utf8Path, observe: &str) -> Output {
    let script = format!(
        "import(require('node:url').pathToFileURL(process.argv[1]).href).then(a=>console.log({observe})).catch(e=>{{console.error(e);process.exitCode=1;}});"
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
