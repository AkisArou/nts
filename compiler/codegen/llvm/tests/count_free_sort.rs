//! A collection at every closure entry exercises partially merged buffers,
//! including reentrant and throwing comparators, with both native emitters.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, Op, OpKind, ValueId};
use nts_frontend_ts::Frontend;
use std::process::Command;

use crate::scratch;
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

fn collect_at_closure_entries(program: &mut hir::Program, numeric_only: bool) {
    let mut inserted = 0;
    for func in &mut program.funcs {
        if !func.name.starts_with("Closure")
            || !func.name.contains("#call")
            || (numeric_only
                && !matches!(
                    func.return_type,
                    HirType::Float { .. } | HirType::Int { .. }
                ))
        {
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
    native_sort_case(
        SOURCE,
        DRIVER,
        "import * as m from './main.ts';\nfor(let i=0;i<32;i++) for(const name of ['stableObjects','emptiedSource','reentrant','retainArgument','throwing','copied','stableStrings','numericControl']) process.stdout.write(String(m[name](i))+'\\n');\n",
        false,
    );
}

#[test]
fn adaptive_sorts_compare_a_natural_run_once_and_keep_snapshot_ownership() {
    native_sort_case(
        include_str!("../../../../tests/programs/adaptive-sort/src/main.ts"),
        ADAPTIVE_DRIVER,
        "import * as m from './main.ts';\nfor(const i of [0,1,2,3,7,15,31,32,63,64,65,127,128,255,256,511,512,1023]) for(const name of ['ordered','reversed','reversedEqual','unevenRuns','shuffled','throwing','mutating','mutatingThrow','copied','copiedMutating','copiedThrow','sharedHelpers','throwingInsertion','separatedRunsControl','throwingMerge','throwingGallop','nanComparator']) process.stdout.write(m[name](i)+'\\n');\n",
        true,
    );
}

fn native_sort_case(source: &str, driver: &str, expected_script: &str, numeric_only: bool) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/count-free-sort-tests"), "collections");
    std::fs::write(dir.join("main.ts"), source).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("drive.c"), driver).unwrap();
    std::fs::write(dir.join("expected.mjs"), expected_script).unwrap();
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
                ..hir::Options::new(nts_core::hir::backend::Backend::Llvm)
            },
        )
        .expect("prepared HIR");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        collect_at_closure_entries(&mut prepared.program, numeric_only);
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
            if numeric_only {
                cc.arg("-Wl,--wrap=nts_collect_cycles");
            }
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

// The linker wrapper both counts comparisons and runs a real collection.
// Number-returning closure entries are comparators; tags' map returns strings.
// The old fixed-width merge loop fails the N-1 assertions even though its
// outputs agree. Empty and singleton arrays remain in the smaller fixture.
const ADAPTIVE_DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
extern NtsString *ordered(double), *reversed(double), *reversedEqual(double);
extern NtsString *unevenRuns(double), *shuffled(double), *throwing(double);
extern NtsString *mutating(double), *mutatingThrow(double), *copied(double);
extern NtsString *copiedMutating(double), *copiedThrow(double);
extern NtsString *sharedHelpers(double), *throwingInsertion(double);
extern NtsString *separatedRunsControl(double), *throwingMerge(double), *throwingGallop(double), *nanComparator(double);
extern void __real_nts_collect_cycles(void);
static uint64_t comparisons;
void __wrap_nts_collect_cycles(void) {
  comparisons++;
  __real_nts_collect_cycles();
}
static void line(NtsString *s) {
  for (uint32_t i = 0; i < s->length; i++) putchar((int)nts_str_char_code_at_int(s, i));
  putchar('\n');
  nts_release((NtsHeader *)s);
}
int main(void) {
  typedef NtsString *(*Case)(double);
  static const Case cases[] = {ordered, reversed, reversedEqual, unevenRuns,
    shuffled, throwing, mutating, mutatingThrow, copied, copiedMutating, copiedThrow,
    sharedHelpers, throwingInsertion, separatedRunsControl, throwingMerge, throwingGallop, nanComparator};
  static const int seeds[] = {0,1,2,3,7,15,31,32,63,64,65,127,128,255,256,511,512,1023};
  for (uint32_t at = 0; at < sizeof(seeds) / sizeof(seeds[0]); at++) {
    int seed = seeds[at];
    for (uint32_t c = 0; c < sizeof(cases) / sizeof(cases[0]); c++) {
      comparisons = 0;
      NtsString *answer = cases[c](seed);
      if (c < 2 && comparisons != (uint64_t)((seed & 1023) + 64)) {
        fprintf(stderr, "case %u seed %d compared %llu times\n", c, seed,
                (unsigned long long)comparisons);
        return 5;
      }
      line(answer);
    }
    nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    if (nts_live_count() != 0 || nts_live_bytes() != 0) return 6;
#endif
  }
  return 0;
}
"#;
