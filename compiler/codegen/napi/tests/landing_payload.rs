//! The landing owns one thrown value, whether the throw moved a temporary or
//! acquired a reference to a borrowed host argument.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use crate::scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

const SOURCE: &str = r"
export function fresh(n:number):number { throw 'thrown '+n; }
export function borrowed(value:string):number { throw value; }
export function error(n:number):number { throw new RangeError('error '+n); }
export function control(value:string):string { return value; }
";

#[test]
fn the_landing_releases_moved_and_borrowed_payloads_once() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/landing-payload"), "addon");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    let config = dir.join("tsconfig.json");
    std::fs::write(
        &config,
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            roots: hir::reachable::Roots::EntrySurface,
            entry_files: &nts_frontend_ts::entry_uris(&config, &snapshot),
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
    let observed = addon.source.replacen("NAPI_MODULE_INIT() {", LIVE, 1);
    assert_ne!(observed, addon.source);
    for (backend, name, source) in [
        ("c", "program.c", c.writer.text()),
        ("llvm", "program.ll", llvm.text.as_str()),
    ] {
        execute(&root, &dir, &c, &observed, backend, name, source);
    }
}

fn execute(
    root: &Utf8Path,
    dir: &Utf8Path,
    c: &nts_codegen_c::Emitted,
    observed: &str,
    backend: &str,
    name: &str,
    source: &str,
) {
    let out = dir.join(backend);
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join(name), source).unwrap();
    std::fs::write(out.join("addon.c"), observed).unwrap();
    let mut sources = vec![
        out.join(name).into_std_path_buf(),
        out.join("addon.c").into_std_path_buf(),
    ];
    for file in c.support_files() {
        let path = file.write(out.as_std_path()).unwrap();
        if file.compiled {
            sources.push(path);
        }
    }
    let binary = out.join("probe.node");
    let built = Command::new("clang")
        .args([
            "-std=c11",
            "-O1",
            "-shared",
            "-fPIC",
            "-DNTS_PROVIDER_RC",
            "-DNTS_POISON",
            "-Wno-override-module",
            "-I",
        ])
        .arg(&out)
        .arg("-I")
        .arg(root.join("third_party/node/src"))
        .args(&sources)
        .args(["-lm", "-o"])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{backend}: {}",
        String::from_utf8_lossy(&built.stderr)
    );
    let ran = Command::new("node")
        .args(["-e", CLIENT])
        .arg(binary)
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{backend}: {} {}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&ran.stdout).trim(),
        "landing payload: balanced",
        "{backend}"
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
const baseline=a.live();
assert.equal(baseline,0);
for(let n=0;n<100;n++) {
  const value='borrowed '+n;
  assert.equal(a.control(value),value);
  assert.equal(a.live(),baseline,'the return control releases its input');
  assert.throws(()=>a.borrowed(value),e=>e===value);
  assert.equal(a.live(),baseline,'the landing and argument cleanup each release their own reference');
  assert.throws(()=>a.fresh(n),e=>e==='thrown '+n);
  assert.equal(a.live(),baseline,'a temporary moves to the landing');
  assert.throws(()=>a.error(n),e=>e instanceof RangeError && e.message==='error '+n);
  assert.equal(a.live(),baseline,'the thrown object releases its message');
}
console.log('landing payload: balanced');
";
