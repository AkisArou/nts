//! Execute inert-cleanup elision and its disabled/unsound controls through both
//! native emitters. Source annotations alone must never remove managed cleanup.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str = include_str!("../../../../tests/programs/container-content-facts/src/main.ts");
// One difference in the scalar pair: an intrinsic size read versus its known
// value. The read used to open the writer set and block cleanup and arithmetic.
const SIZE_SOURCE: &str = r#"
export function sizeScalar(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  const size = values.size;
  let total = 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  values.clear();
  return size === 1 ? total : 0;
}
export function sizeScalarControl(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  const size = 1;
  let total = 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  values.clear();
  return size === 1 ? total : 0;
}
export function sizeManaged(n: number): string {
  const narrow = new Map<string, number>();
  const wide: Map<string, unknown> = narrow;
  wide.set("key", "sized:" + String(n));
  const size = narrow.size;
  const held = wide.get("key");
  wide.clear();
  return size === 1 ? String(held) : "bad size";
}
export function sizeUnknownWriter(n: number): string {
  const values = new Map<string, unknown>();
  values.set("key", n);
  callWriter(values, n);
  const size = values.size;
  const held = values.get("key");
  values.clear();
  return size === 1 ? String(held) : "bad size";
}
"#;
const DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
#include <stdlib.h>
extern double closedNumber(double);
extern NtsString *scalarThroughWide(double), *managedThroughWide(double), *absent(double);
extern NtsString *mergedScalar(double), *mergedManaged(double), *returned(double);
extern NtsString *otherWriter(double), *closureWriter(double), *mergedIdentity(double);
extern NtsString *arrayControl(double), *exceptionControl(double), *numericEdges(double);
extern double sizeScalar(double), sizeScalarControl(double);
extern NtsString *sizeManaged(double), *sizeUnknownWriter(double);
static size_t caller_releases;
void nts_test_value_release(NtsValue value) {
  caller_releases++;
  nts_value_release(value);
}
static void number(double value) {
  if (isnan(value)) puts("nan");
  else { uint64_t bits; memcpy(&bits,&value,sizeof bits); printf("%016llx\n",(unsigned long long)bits); }
}
static void string(NtsString *value) {
  for (uint32_t i=0; i<value->length; i++) putchar((int)nts_str_char_code_at_int(value,i));
  putchar('\n'); nts_release((NtsHeader *)value);
}
int main(int argc, char **argv) {
  const double inputs[]={-3,0,1,2,7,NAN,-0.};
  for (int repeat=0;repeat<8;repeat++) for (size_t i=0;i<sizeof inputs/sizeof inputs[0];i++) {
    double n=inputs[i];
    number(closedNumber(n));
    string(scalarThroughWide(n)); string(managedThroughWide(n)); string(absent(n));
    string(mergedScalar(n)); string(mergedManaged(n)); string(returned(n));
    string(otherWriter(n)); string(closureWriter(n)); string(mergedIdentity(n));
    string(arrayControl(n)); string(exceptionControl(n)); string(numericEdges(n));
    number(sizeScalar(n)); number(sizeScalarControl(n));
    string(sizeManaged(n)); string(sizeUnknownWriter(n));
    nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    /* Keep this failure distinct from LeakSanitizer's exit-time override in
     * the intentionally leaking control. Successful runs still run LSan. */
    if (nts_live_count()!=0 || nts_live_bytes()!=0) _Exit(4);
#endif
  }
  printf("caller-release-count %zu\n",caller_releases);
  return argc==2 && caller_releases>strtoull(argv[1],NULL,10) ? 3 : 0;
}
"#;
const ORACLE: &str = r"
import * as m from './main.ts';
function number(v){if(Number.isNaN(v)){process.stdout.write('nan\n');return;}const b=Buffer.alloc(8);b.writeDoubleBE(v);process.stdout.write(b.toString('hex')+'\n');}
for(let repeat=0;repeat<8;repeat++)for(const n of [-3,0,1,2,7,NaN,-0]){
  number(m.closedNumber(n));
  for(const name of ['scalarThroughWide','managedThroughWide','absent','mergedScalar','mergedManaged','returned','otherWriter','closureWriter','mergedIdentity','arrayControl','exceptionControl','numericEdges'])process.stdout.write(m[name](n)+'\n');
  number(m.sizeScalar(n)); number(m.sizeScalarControl(n));
  process.stdout.write(m.sizeManaged(n)+'\n'); process.stdout.write(m.sizeUnknownWriter(n)+'\n');
}
";

fn checked(command: &mut Command) -> Vec<u8> {
    let output = command.output().expect("run toolchain");
    assert!(
        output.status.success(),
        "{command:?}: {:?}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty(), "{command:?}: {:?}", output.stderr);
    output.stdout
}

fn restore_cleanup(program: &mut hir::Program, report: &hir::contents::Report) {
    // A saved next operation can itself have been elided. Reverse order puts
    // that anchor back before restoring the operation that preceded it.
    for removed in report.elisions.iter().rev() {
        let function = program
            .funcs
            .iter_mut()
            .find(|f| f.name == removed.function)
            .unwrap();
        let block = &mut function.blocks[removed.block.0 as usize];
        assert!(!block.ops.contains(&removed.operation));
        let at = removed.before.map_or(block.ops.len(), |next| {
            block
                .ops
                .iter()
                .position(|id| *id == next)
                .expect("restored anchor")
        });
        block.ops.insert(at, removed.operation);
    }
    hir::verify::verify(program).expect("restored cleanup is valid");
}

fn remove_managed_cleanup(program: &mut hir::Program) {
    let mut removed = 0;
    for function in &mut program.funcs {
        if !function.name.starts_with("managedThroughWide") {
            continue;
        }
        let reads: Vec<_> = function.blocks.iter().flat_map(|b| &b.ops).copied().filter(|id| matches!(&function.value(*id).kind, OpKind::Call {callee: Callee::External(name), ..} if name=="nts_map_get")).collect();
        let values = &function.values;
        for block in &mut function.blocks {
            block.ops.retain(|id| {
                let drop = matches!(values[id.0 as usize].kind, OpKind::Release(value) if reads.contains(&value));
                removed += usize::from(drop);
                !drop
            });
        }
    }
    assert!(
        removed > 0,
        "unsafe control must delete actual managed-read cleanup"
    );
}

fn compile(dir: &Utf8Path, program: &hir::Program, llvm: bool, label: &str) -> camino::Utf8PathBuf {
    let c = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let mut runtime = Vec::new();
    for support in c.support_files() {
        let path = support.write(dir.as_std_path()).unwrap();
        if support.compiled {
            runtime.push(path);
        }
    }
    let input = dir.join(if llvm { "program.ll" } else { "program.c" });
    let text = if llvm {
        let module = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(module.diagnostics.is_empty(), "{:?}", module.diagnostics);
        module
            .text
            .replace("@nts_value_release", "@nts_test_value_release")
    } else {
        format!(
            "#include \"nts_runtime.h\"\nvoid nts_test_value_release(NtsValue);\n{}",
            c.writer
                .text()
                .replace("nts_value_release(", "nts_test_value_release(")
        )
    };
    std::fs::write(&input, text).unwrap();
    let binary = dir.join(format!("{label}-{}", if llvm { "llvm" } else { "c" }));
    let mut cc = Command::new("clang");
    cc.current_dir(dir).args([
        "-std=c11",
        "-O1",
        "-ffp-contract=off",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wno-override-module",
        "-I.",
    ]);
    if program.provider == hir::Memory::ReferenceCounting {
        cc.args([
            "-DNTS_PROVIDER_RC",
            "-DNTS_POISON=1",
            "-fsanitize=address,undefined",
            "-fno-sanitize-recover=all",
        ]);
    }
    checked(
        cc.arg(&input)
            .arg("drive.c")
            .args(runtime)
            .args(["-lm", "-o"])
            .arg(&binary),
    );
    binary
}

fn execute(binary: &Utf8Path, maximum: Option<usize>, expected: &[u8], status: i32) -> usize {
    let mut run = Command::new("timeout");
    run.arg("120").arg(binary);
    if let Some(maximum) = maximum {
        run.arg(maximum.to_string());
    }
    let output = run.output().unwrap();
    assert_eq!(
        output.status.code(),
        Some(status),
        "{binary}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty(), "{binary}: {:?}", output.stderr);
    if status == 4 {
        return 0;
    }
    let text = String::from_utf8(output.stdout).unwrap();
    let (answers, count) = text
        .rsplit_once("caller-release-count ")
        .expect("execution counter");
    assert_eq!(answers.as_bytes(), expected, "{binary}");
    count.trim().parse().unwrap()
}

fn assert_size_facts(prepared: &hir::Prepared) {
    for name in ["sizeScalar", "sizeScalarControl"] {
        assert!(
            prepared
                .contents
                .reads
                .iter()
                .any(|r| r.function == name && r.fact.is_inert()),
            "size reads must preserve the scalar content proof in {name}"
        );
        assert!(
            prepared
                .accumulators
                .sites
                .iter()
                .any(|r| r.function == name && r.decision == hir::accumulators::Decision::Wrapping),
            "the same int32 proof must reach arithmetic in {name}"
        );
    }
    for name in ["sizeManaged", "sizeUnknownWriter"] {
        assert!(
            prepared
                .contents
                .reads
                .iter()
                .any(|r| r.function == name && !r.fact.is_inert()),
            "size reads must not license managed or open-writer cleanup in {name}"
        );
    }
}

#[test]
fn actual_writers_and_executed_cleanup_agree_on_both_native_emitters() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/content-fact-tests"), "native");
    std::fs::write(dir.join("main.ts"), format!("{SOURCE}\n{SIZE_SOURCE}")).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("drive.c"), DRIVER).unwrap();
    std::fs::write(dir.join("oracle.mjs"), ORACLE).unwrap();
    let expected = checked(Command::new("node").arg(dir.join("oracle.mjs")));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..Default::default()
            },
        )
        .expect("prepared");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        if provider == hir::Memory::NoGc {
            assert!(prepared.contents.elisions.is_empty());
            for llvm in [false, true] {
                execute(
                    &compile(&dir, &prepared.program, llvm, "nogc"),
                    None,
                    &expected,
                    0,
                );
            }
            continue;
        }
        assert!(
            !prepared.contents.elisions.is_empty(),
            "consumer must remove real cleanup"
        );
        assert!(
            prepared
                .contents
                .reads
                .iter()
                .any(|r| r.function.starts_with("scalarThroughWide") && r.fact.is_inert())
        );
        assert!(
            prepared
                .contents
                .reads
                .iter()
                .any(|r| r.function.starts_with("managedThroughWide") && !r.fact.is_inert())
        );
        assert_size_facts(&prepared);
        let mut disabled = prepared.program.clone();
        restore_cleanup(&mut disabled, &prepared.contents);
        let mut unsafe_program = prepared.program.clone();
        remove_managed_cleanup(&mut unsafe_program);
        for llvm in [false, true] {
            let enabled = compile(&dir, &prepared.program, llvm, "enabled");
            let count = execute(&enabled, None, &expected, 0);
            let disabled = compile(&dir, &disabled, llvm, "disabled");
            let restored = execute(&disabled, Some(count), &expected, 3);
            assert!(
                restored > count,
                "disabled consumer must fail the executed operation guard"
            );
            // A type-only cleanup rule leaks the freshly built string read
            // through the wider alias; the live-storage guard must catch it.
            execute(
                &compile(&dir, &unsafe_program, llvm, "unsafe"),
                None,
                &expected,
                4,
            );
        }
    }
}
