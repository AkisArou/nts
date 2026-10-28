//! A calls-only structural view must not expose invented callback storage.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType};
use nts_frontend_ts::Frontend;
use std::process::Command;

const SOURCE: &str = r"
interface Sink {
  write(n: number): number;
  end?: (() => void) | undefined;
}
class Concrete {
  seed: number;
  constructor(n: number) { this.seed = n; }
  write(n: number): number { return this.seed + n; }
  end(): void { this.seed = 0; }
}
export function getSink(n: number): Sink { return new Concrete(n); }
export function throughSink(n: number): number {
  const sink: Sink = new Concrete(7);
  return sink.write(n);
}
export function plain(n: number): number { return new Concrete(7).write(n); }
export function readIdentity(n: number): boolean {
  const sink: Sink = new Concrete(n);
  return sink.end === sink.end;
}
";

#[test]
fn callable_source_transport_does_not_publish_function_value_storage() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/callable-crossing-tests"), "calls-only");
    let source = dir.join("main.ts");
    std::fs::write(&source, SOURCE).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
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
            ..hir::Options::default()
        },
    )
    .unwrap();
    let factory = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "getSink")
        .unwrap();
    assert!(
        !factory.blocks.is_empty(),
        "the factory must compile before testing its bridge"
    );
    let HirType::Managed(ManagedType::Object(face)) = factory.return_type else {
        panic!("the factory must return its structural view");
    };
    assert!(
        prepared
            .program
            .interface_access
            .callable
            .iter()
            .any(|c| c.face == face)
    );
    assert!(prepared.program.uncompiled.iter().any(|entry| {
        entry.name == "readIdentity" && entry.reason.contains("identity and unbound receiver")
    }));
    let program = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(program.is_complete(), "{:?}", program.diagnostics);
    let addon = nts_codegen_napi::emit(&prepared.program);
    assert!(
        addon.skipped.iter().any(|s| s.function == "getSink"),
        "{:?}",
        addon.skipped
    );
    assert!(
        addon
            .skipped
            .iter()
            .all(|s| matches!(s.function.as_str(), "getSink" | "readIdentity")),
        "{:?}",
        addon.skipped
    );
    std::fs::write(dir.join("program.c"), program.writer.text()).unwrap();
    std::fs::write(dir.join("addon.c"), addon.source).unwrap();
    let mut sources = vec![dir.join("program.c"), dir.join("addon.c")];
    for file in program.support_files() {
        let path = file.write(dir.as_std_path()).unwrap();
        if file.compiled {
            sources.push(camino::Utf8PathBuf::from_path_buf(path).unwrap());
        }
    }
    let binary = dir.join("probe.node");
    let linked = Command::new("clang")
        .args(["-std=c11", "-O1", "-fPIC", "-shared"])
        .arg("-I")
        .arg(root.join("third_party/node/src"))
        .arg("-I")
        .arg(dir.as_std_path())
        .args(sources)
        .args(["-lm", "-o"])
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        linked.status.success(),
        "{}",
        String::from_utf8_lossy(&linked.stderr)
    );
    let result = Command::new("node")
        .args(["-e", CLIENT])
        .arg(&binary)
        .arg(&source)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

const CLIENT: &str = r"
const assert = require('node:assert/strict');
const m = {exports:{}};
process.dlopen(m, process.argv[1], require('node:os').constants.dlopen.RTLD_NOW);
assert.equal(Object.hasOwn(m.exports, 'getSink'), false);
assert.equal(Object.hasOwn(m.exports, 'readIdentity'), false);
import(require('node:url').pathToFileURL(process.argv[2]).href).then(oracle => {
  for (const n of [-100, -1, 0, 1, 17, 2147483648]) {
    assert.equal(m.exports.throughSink(n), oracle.throughSink(n));
    assert.equal(m.exports.plain(n), oracle.plain(n));
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
";
