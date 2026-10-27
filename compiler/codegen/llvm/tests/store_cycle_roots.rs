//! Heap callback cycles must have a final root decrement, with both emitters.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::Frontend;
use std::process::Command;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str = include_str!(
    "../../../../tests/programs/a-dropped-object-whose-callback-captures-it/src/main.ts"
);
const DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
extern double captured(double);
extern double notCaptured(double);
extern double framePlaced(double);
extern double peek(double);
int main(void) {
  double (*cases[])(double) = {captured, notCaptured, framePlaced, peek};
  for (int i = 0; i < 32; ++i) {
    for (size_t j = 0; j < sizeof(cases) / sizeof(cases[0]); ++j) {
      printf("%.0f\n", cases[j](i));
      nts_collect_cycles();
      if (nts_live_count() != 0 || nts_live_bytes() != 0) {
        fprintf(stderr, "case %zu input %d: %zu objects, %zu bytes remain\n",
                j, i, nts_live_count(), nts_live_bytes());
        return 3;
      }
    }
  }
  return 0;
}
"#;

fn checked(command: &mut Command) -> Vec<u8> {
    let output = command.output().expect("execute toolchain");
    assert!(
        output.status.success(),
        "{command:?}: {:?}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty(), "{command:?}: {:?}", output.stderr);
    output.stdout
}

#[test]
fn abandoned_callback_cycles_leave_no_live_storage() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = ScratchDir::new(&root.join("target/store-cycle-roots-tests"), "native");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("drive.c"), DRIVER).unwrap();
    std::fs::write(
        dir.join("expected.mjs"),
        "import * as m from './main.ts';\nfor(let i=0;i<32;i++) for(const name of ['captured','notCaptured','framePlaced','peek']) process.stdout.write(String(m[name](i))+'\\n');\n",
    )
    .unwrap();
    let expected = checked(Command::new("node").arg(dir.join("expected.mjs")));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::ReferenceCounting,
            ..hir::Options::default()
        },
    )
    .expect("prepared HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for (name, frame) in [("captured", false), ("framePlaced", true)] {
        let func = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .unwrap();
        assert!(
            func.values.iter().any(
                |op| matches!(op.kind, OpKind::ObjectNew { frame: actual } if actual == frame)
            ),
            "{name} must exercise its storage mode"
        );
    }
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
    let mut runtime = Vec::new();
    for file in c.support_files() {
        let path = file.write(dir.as_std_path()).unwrap();
        if file.compiled {
            runtime.push(path);
        }
    }
    for input in ["program.c", "program.ll"] {
        for poison in [false, true] {
            let binary = dir.join(format!("run-{input}-{poison}"));
            let mut cc = Command::new("clang");
            cc.current_dir(&*dir).args([
                "-std=c11",
                "-O1",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Wno-override-module",
                "-DNTS_PROVIDER_RC",
                "-I.",
            ]);
            if poison {
                cc.args([
                    "-DNTS_POISON=1",
                    "-fsanitize=address",
                    "-fno-sanitize-recover=all",
                ]);
            }
            checked(
                cc.arg(input)
                    .arg("drive.c")
                    .args(&runtime)
                    .args(["-lm", "-o"])
                    .arg(&binary),
            );
            assert_eq!(
                checked(Command::new("timeout").arg("120").arg(&binary)),
                expected,
                "{input} poison={poison}"
            );
        }
    }
}
