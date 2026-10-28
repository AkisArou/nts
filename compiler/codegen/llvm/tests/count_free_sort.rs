//! A collection at every closure entry exercises partially merged buffers,
//! including reentrant and throwing comparators, with both native emitters.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, Op, OpKind, ValueId};
use nts_frontend_ts::Frontend;
use std::process::Command;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str = include_str!("../../../../tests/programs/count-free-sort/src/main.ts");
const DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
extern NtsString *stableObjects(double);
extern NtsString *emptiedSource(double);
extern NtsString *reentrant(double);
extern double retainArgument(double);
extern NtsString *throwing(double);
extern NtsString *copied(double);
extern NtsString *stableStrings(double);
extern NtsString *numericControl(double);

static void line(NtsString *s) {
  for (uint32_t i = 0; i < s->length; i++)
    putchar((int)nts_str_char_code_at_int(s, i));
  putchar('\n');
  nts_release((NtsHeader *)s);
}

int main(void) {
#ifdef NTS_PROVIDER_RC
  /* The first injected collection must really run, not merely find an empty
   * root buffer. This unrelated garbage cycle is its positive control. */
  typedef struct Cycle { NtsHeader header; NtsHeader *next; } Cycle;
  static const uint32_t offsets[] = {offsetof(Cycle, next)};
  static const NtsDescriptor descriptor = {
    .kind = NTS_KIND_OBJECT, .size = sizeof(Cycle), .references = 1,
    .cyclic = 1, .offsets = offsets, .name = "SortCollectionControl"
  };
  Cycle *cycle = (Cycle *)nts_object_new(&descriptor);
  cycle->next = (NtsHeader *)cycle;
  nts_retain((NtsHeader *)cycle);
  nts_release((NtsHeader *)cycle);
  uint64_t epoch = nts_collection_epoch();
  NtsString *first = stableObjects(7);
  if (nts_collection_epoch() == epoch) return 2;
  nts_release((NtsHeader *)first);
  nts_collect_cycles();
  if (nts_live_count() != 0 || nts_live_bytes() != 0) return 3;
#endif
  for (int i = 0; i < 32; i++) {
    line(stableObjects(i));
    line(emptiedSource(i));
    line(reentrant(i));
    printf("%.0f\n", retainArgument(i));
    line(throwing(i));
    line(copied(i));
    line(stableStrings(i));
    line(numericControl(i));
    nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    if (nts_live_count() != 0 || nts_live_bytes() != 0) return 4;
#endif
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

fn collect_at_closure_entries(program: &mut hir::Program) {
    let mut inserted = 0;
    for func in &mut program.funcs {
        if !func.name.starts_with("Closure") || !func.name.contains("#call") {
            continue;
        }
        let value = ValueId(u32::try_from(func.values.len()).unwrap());
        func.values.push(Op {
            kind: OpKind::Call {
                callee: Callee::External("nts_collect_cycles".into()),
                args: vec![],
                frame: None,
            },
            ty: HirType::Void,
            origin: func.origin.clone(),
        });
        func.blocks[0].ops.insert(0, value);
        inserted += 1;
    }
    assert!(inserted >= 8, "the comparators must be exercised");
    hir::verify::verify(program).expect("injected collection preserves valid HIR");
}

#[test]
fn native_sort_snapshots_survive_collection_reentrancy_and_throws() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/count-free-sort-tests"), "collections");
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("drive.c"), DRIVER).unwrap();
    std::fs::write(
        dir.join("expected.mjs"),
        "import * as m from './main.ts';\nfor(let i=0;i<32;i++) for(const name of ['stableObjects','emptiedSource','reentrant','retainArgument','throwing','copied','stableStrings','numericControl']) process.stdout.write(String(m[name](i))+'\\n');\n",
    )
    .unwrap();
    let expected = checked(Command::new("node").arg(dir.join("expected.mjs")));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let mut prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        )
        .expect("prepared HIR");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        collect_at_closure_entries(&mut prepared.program);
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
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
            let binary = dir.join(format!("run-{input}-{provider:?}"));
            let mut cc = Command::new("clang");
            cc.current_dir(&*dir).args([
                "-std=c11",
                "-O1",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Wno-override-module",
                "-I.",
            ]);
            if provider == hir::Memory::ReferenceCounting {
                cc.args([
                    "-DNTS_PROVIDER_RC",
                    "-DNTS_COUNT_OPERATIONS",
                    "-DNTS_POISON=1",
                    "-fsanitize=address,undefined",
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
                "{input} {provider:?}"
            );
        }
    }
}
