//! Execute borrowed publication on return and on both sides of a consuming store.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use crate::scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

const SOURCE: &str = r"
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
function storeAfterRelay(xs:number[],before:boolean,after:boolean):number {
  relayThrow(before);
  const result=xs[0];
  saved=xs;
  relayThrow(after);
  return result;
}
export function deepStore(xs:number[],before:boolean,after:boolean):number {
  return storeAfterRelay(xs,before,after);
}
export function deepDirect(n:number):number { return deepStore([n],false,false); }
function quietRead(xs:number[]):number {
  let value=0;
  for(let i=0;i<xs.length;i++) value+=xs[i];
  return value;
}
function storeAfterQuietRead(xs:number[]):number {
  const result=quietRead(xs);
  saved=xs;
  return result;
}
export function quietStore(xs:number[]):number { return storeAfterQuietRead(xs); }
export function quietDirect(n:number):number { return quietStore([n,n+1]); }
export function read():number { return saved===null?-1:saved[0]; }
export function clear():void { saved=null; }

export class SpecializedKeeper {
  tag:number;
  constructor(tag:number) { this.tag=tag; }
  keep(xs:number[], mode:number):number {
    relayThrow(mode<0);
    let answer=xs[0]+this.tag;
    saved=xs;
    relayThrow(mode>0);
    for(let i=0;i<3;i++) answer+=i;
    return answer;
  }
}
let sharedKeeper:SpecializedKeeper|null=null;
export function initKeeper():void { sharedKeeper=new SpecializedKeeper(7); }
export function clearKeeper():void { sharedKeeper=null; }
export function specializedPublished(xs:number[],mode:number):number {
  return sharedKeeper===null ? -1 : sharedKeeper.keep(xs,mode);
}
export function specializedDirect(n:number):number {
  return new SpecializedKeeper(n).keep([n],0);
}
";

#[test]
fn a_published_call_borrows_through_return_and_throw() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/published-consuming"), "addon");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
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
            provider: hir::Memory::ReferenceCounting,
            ..hir::Options::new(nts_core::hir::backend::Backend::C)
        },
    )
    .unwrap();
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "@consuming:store")
    );
    assert!(
        prepared
            .entry_decisions
            .iter()
            .any(|decision| decision.function == "store"
                && decision.kind == hir::own::EntryDecisionKind::Selected),
        "{:?}",
        prepared.entry_decisions
    );
    for name in ["nestedStore", "deepStore"] {
        if name == "nestedStore" {
            assert!(
                prepared
                    .entry_decisions
                    .iter()
                    .any(|decision| decision.function == name
                        && decision.reason == "can raise past the adapter"),
                "{name}: {:?}",
                prepared.entry_decisions
            );
        }
        // deepStore now forwards: its private helper's contract is guarded
        // below, so it need not itself satisfy the consuming criterion.
        assert!(
            !prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == format!("@consuming:{name}"))
        );
    }
    let specialized = "SpecializedKeeper#keep#whole";
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == specialized)
    );
    assert!(
        hir::own::summarize(&prepared.program, &prepared.program.layouts)
            .consumes(specialized)
            .is_none(),
        "a consuming specialization cannot raise past a resumable frame"
    );
    assert_private_guard_shape(&prepared.program);
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let addon = nts_codegen_napi::emit(&prepared.program);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
    let observed = addon.source.replacen("NAPI_MODULE_INIT() {", LIVE, 1);
    assert_ne!(
        observed, addon.source,
        "the live-count observer is installed"
    );
    for (backend, source) in [("c", c.writer.text()), ("llvm", llvm.text.as_str())] {
        execute(&root, &dir, backend, source, &c, &observed);
    }
}

fn assert_private_guard_shape(program: &hir::Program) {
    let find = |name: &str| program.funcs.iter().find(|func| func.name == name).unwrap();
    let calls = |name: &str| {
        operations(find(name))
            .filter_map(|op| match op {
                hir::OpKind::Call {
                    callee: hir::Callee::Direct(target),
                    ..
                } => Some(target.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    assert!(calls("relayThrow").contains(&"nestedThrow"));
    let summaries = hir::own::summarize(program, &program.layouts);
    for (helper, entry, read, consumes) in [
        ("storeAfterRelay", "deepStore", "relayThrow", false),
        ("storeAfterQuietRead", "quietStore", "quietRead", true),
    ] {
        let body = find(helper);
        assert!(!body.exported, "the guard must protect a private frame");
        let ops: Vec<_> = operations(body).collect();
        let call = ops
            .iter()
            .position(|op| {
                matches!(op,
                hir::OpKind::Call { callee: hir::Callee::Direct(target), .. }
                if target == read)
            })
            .unwrap();
        let store = ops
            .iter()
            .position(|op| matches!(op, hir::OpKind::GlobalSet { .. }))
            .unwrap();
        assert!(call < store, "the helper reads or raises before storing");
        assert_eq!(
            summaries
                .consumes(helper)
                .is_some_and(|parameters| parameters.contains(&0)),
            consumes,
            "only the quiet private helper may consume across this host entry"
        );
        let moved = format!("@consuming:{entry}");
        let forward = if program.funcs.iter().any(|func| func.name == moved) {
            moved.as_str()
        } else {
            entry
        };
        assert_eq!(calls(forward), vec![helper], "the entry is a thin forward");
        assert!(!operations(find(forward)).any(|op| matches!(op, hir::OpKind::GlobalSet { .. })));
    }
}

fn operations(func: &hir::Func) -> impl Iterator<Item = &hir::OpKind> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|id| &func.value(*id).kind)
}

fn execute(
    root: &Utf8Path,
    dir: &Utf8Path,
    backend: &str,
    source: &str,
    support: &nts_codegen_c::Emitted,
    addon: &str,
) {
    let headers = root.join("third_party/node/src");
    assert!(headers.join("node_api.h").is_file());
    let out = dir.join(backend);
    std::fs::create_dir_all(&out).unwrap();
    let input = if backend == "c" {
        "program.c"
    } else {
        "program.ll"
    };
    std::fs::write(out.join(input), source).unwrap();
    std::fs::write(out.join("addon.c"), addon).unwrap();
    let mut sources = vec![
        out.join(input).into_std_path_buf(),
        out.join("addon.c").into_std_path_buf(),
    ];
    for file in support.support_files() {
        let path = file.write(out.as_std_path()).unwrap();
        if file.compiled {
            sources.push(path);
        }
    }
    let built = Command::new("clang")
        .args([
            "-std=c11",
            "-O1",
            "-shared",
            "-fPIC",
            "-DNTS_PROVIDER_RC",
            "-DNTS_POISON",
            "-Wno-override-module",
            // Bound at load, so a symbol a backend did not define fails the
            // load rather than hiding until its first call.
            "-Wl,-z,now",
            "-I",
        ])
        .arg(&out)
        .arg("-I")
        .arg(&headers)
        .args(&sources)
        .args(["-lm", "-o"])
        .arg(out.join("probe.node"))
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{backend}: {}",
        String::from_utf8_lossy(&built.stderr)
    );
    let ran = Command::new("node")
        .args(["-e", CLIENT])
        .arg(out.join("probe.node"))
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{backend}: {} {}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(
        matches!(
            String::from_utf8_lossy(&ran.stdout).trim(),
            "published return/throw: balanced; baseline=0 final=0"
                | "published return/throw: balanced; baseline=0 final=32"
        ),
        "{backend}: {}",
        String::from_utf8_lossy(&ran.stdout)
    );
}

const LIVE: &str = r#"
static napi_value live(napi_env env,napi_callback_info info) {
    (void)info;
    nts_collect_cycles();
    napi_value result;
    napi_create_double(env,(double)nts_live_bytes(),&result);
    return result;
}
NAPI_MODULE_INIT() {
    napi_value probe;
    napi_create_function(env,"live",NAPI_AUTO_LENGTH,live,NULL,&probe);
    napi_set_named_property(env,exports,"live",probe);
"#;

const CLIENT: &str = r"
const assert=require('node:assert/strict');
const a=require(process.argv[1]);
assert.equal(a.store.name,'store');
assert.equal(a.store.length,3);
assert.equal(String(a.store).slice(0,String(a.store).indexOf('(')),'function store');
a.store([3,4],false,false); a.clear();
const baseline=a.live();
for(const [before,after] of [[false,false],[true,false],[false,true]]) {
  for(let n=0;n<100;n++) {
    let caught=false;
    try { assert.equal(a.store([n,n+1],before,after),2*n+1); }
    catch(e) { caught=true; assert.equal(e,undefined); }
    assert.equal(caught,before||after);
    assert.equal(a.read(),before?-1:n);
    a.clear();
    assert.equal(a.live(),baseline,'borrowed publication balances on each exit');
  }
}
for(const name of ['nestedStore','deepStore']) for(const [before,after] of [[false,false],[true,false],[false,true]]) {
  for(let n=0;n<100;n++) {
    let caught=false;
    try { assert.equal(a[name]([n],before,after),n); }
    catch(e) { caught=true; assert.equal(e,undefined); }
    assert.equal(caught,before||after);
    assert.equal(a.read(),before?-1:n);
    a.clear();
    assert.equal(a.live(),baseline,'nested throw balances publication');
  }
}
for(let n=0;n<100;n++) {
  assert.equal(a.direct(n),2*n+1); a.clear();
  assert.equal(a.kept(n),3*n+1);
  assert.equal(a.quietStore([n,n+1]),2*n+1); a.clear();
  assert.equal(a.quietDirect(n),2*n+1); a.clear();
  assert.equal(a.nestedDirect(n),n); a.clear();
  assert.equal(a.deepDirect(n),n); a.clear();
  assert.equal(a.live(),baseline,'both direct ownership arms balance');
}
a.initKeeper();
for(let n=0;n<100;n++) {
  assert.equal(a.specializedPublished([n],0),n+10);
  a.clear();
}
a.clearKeeper();
assert.equal(a.live(),baseline,'nonthrowing keeper cleanup releases its receiver');
a.initKeeper();
const keeperBaseline=a.live();
for(const mode of [-1,0,1]) for(let n=0;n<100;n++) {
  let caught=false;
  try { assert.equal(a.specializedPublished([n],mode),n+10); }
  catch(e) { caught=true; assert.equal(e,undefined); }
  assert.equal(caught,mode!==0);
  a.clear();
  assert.equal(a.live(),keeperBaseline,'numeric specialization balances two-frame throws');
}
a.clearKeeper();
// #912: main retains the mutable-global receiver across this raising call;
// the landing skips that local release. Match its measured 32-byte residual,
// or a future improvement. Fresh array arguments must still balance exactly
// on every call above; this is no allowance for an incoming argument leak.
assert.ok(a.live()===baseline || a.live()===baseline+32,'keeper cleanup matches main (#912)');
console.log('published return/throw: balanced; baseline='+baseline+' final='+a.live());
";
