//! A Node caller constructs classes whose storage is shared, including aliases.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

#[test]
fn shared_storage_keeps_each_exported_constructor_and_its_members() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let headers = root.join("third_party/node/src");
    assert!(
        headers.join("node_api.h").exists(),
        "Node-API headers required"
    );
    for (fixture, first, second, control) in [
        (
            "tests/refusals/an-exported-class-with-a-shared-layout",
            "Shared",
            "Twin",
            "Unique",
        ),
        (
            "compiler/core/tests/programs/class-export-identities",
            "First",
            "Second",
            "First",
        ),
    ] {
        let snapshot = TsgoApi::for_compilation(tsgo.clone())
            .snapshot(&root.join(fixture).join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors());
        let options = hir::Options {
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::default()
        };
        let prepared = hir::prepare_with(&snapshot, &options).unwrap();
        let program = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(program.is_complete(), "{:?}", program.diagnostics);
        let addon = nts_codegen_napi::emit(&prepared.program);
        assert!(
            addon
                .skipped
                .iter()
                .all(|skipped| skipped.function == "readEarlierNumber"),
            "{:?}",
            addon.skipped
        );
        let dir = scratch::ScratchDir::new(&root.join("target/class-export-tests"), first);
        std::fs::write(dir.join("program.c"), program.writer.text()).unwrap();
        std::fs::write(dir.join("addon.c"), addon.source).unwrap();
        let mut sources = vec![
            dir.join("program.c").into_std_path_buf(),
            dir.join("addon.c").into_std_path_buf(),
        ];
        for file in program.support_files() {
            let path = file.write(dir.as_std_path()).unwrap();
            if file.compiled {
                sources.push(path);
            }
        }
        let binary = dir.join("probe.node");
        let linked = Command::new("clang")
            .args(["-std=c11", "-O1", "-fPIC", "-shared"])
            .arg("-I")
            .arg(&headers)
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
            .args([first, second, control])
            .arg(root.join(fixture).join("src/main.ts"))
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{fixture}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}

const CLIENT: &str = r"
const assert = require('node:assert/strict');
const m = {exports:{}};
process.dlopen(m, process.argv[1], require('node:os').constants.dlopen.RTLD_NOW);
const a = m.exports;
const First = a[process.argv[2]], Second = a[process.argv[3]], Control = a[process.argv[4]];
import(require('node:url').pathToFileURL(process.argv[5]).href).then(oracle => {
assert.equal(First.name, oracle[process.argv[2]].name);
assert.equal(Second.name, oracle[process.argv[3]].name);
if (oracle.Solo) {
  assert.equal(a.Solo.name, oracle.Solo.name);
  assert.equal(new a.Solo(37).get(), new oracle.Solo(37).get());
}
for (const flag of [false, true]) {
  const first = new First(flag), second = new Second(flag);
  assert.equal(first.get(), flag);
  assert.equal(second.get(), !flag);
  assert.equal(first.flag, flag);
  assert.equal(second.flag, !flag);
  assert.ok(first instanceof First);
  assert.ok(!(first instanceof Second));
  assert.equal(new Control(flag).get(), flag);
}
}).catch(error => { console.error(error); process.exitCode = 1; });
";
