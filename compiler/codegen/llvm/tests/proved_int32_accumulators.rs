//! Execute both emitters, then restore only the original floating arithmetic.
//! The disabled rewrite must fail an executed ToInt32-operation guard while
//! answers, cleanup and live storage remain identical.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind, UnOp};
use nts_frontend_ts::Frontend;
use std::process::Command;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str =
    include_str!("../../../../tests/programs/proved-int32-accumulators/src/main.ts");
const DRIVER: &str = r#"
#include "nts_runtime.h"
#include <stdio.h>
#include <stdlib.h>
extern double closedAdd(double), closedSubtract(double), fractionalWriter(double);
extern double unsignedWriter(double), nonfiniteWriter(double), absentRead(double);
extern double widerWriter(double), twoUpdates(double), extraFloatingUse(double);
extern double capturedOrder(double), signedEdges(double);
extern double dense(double);
extern NtsString *zeroSignOtherUse(double);
static size_t conversions;
int32_t nts_test_to_int32(double value) { conversions++; return nts_to_int32(value); }
int32_t nts_test_to_int32_fn(double value) { return nts_test_to_int32(value); }
static void number(double value) {
  uint64_t bits; memcpy(&bits, &value, sizeof bits);
  printf("%016llx\n", (unsigned long long)bits);
}
int main(int argc, char **argv) {
  const double inputs[]={-2147483649.,-2147483648.,-3.,-0.,0.,1.,2.,7.,2147483647.,2147483648.,0.5,NAN,INFINITY,-INFINITY};
  for(int repeat=0;repeat<4;repeat++) for(size_t i=0;i<sizeof inputs/sizeof inputs[0];i++) {
    double n=inputs[i];
    number(closedAdd(n)); number(closedSubtract(n)); number(fractionalWriter(n));
    number(unsignedWriter(n)); number(nonfiniteWriter(n)); number(absentRead(n));
    NtsString *s=zeroSignOtherUse(n);
    for(uint32_t j=0;j<s->length;j++) putchar((int)nts_str_char_code_at_int(s,j));
    putchar('\n'); nts_release((NtsHeader *)s);
    number(widerWriter(n)); number(twoUpdates(n)); number(extraFloatingUse(n));
    number(capturedOrder(n)); number(signedEdges(n)); number(dense(n));
    nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    if(nts_live_count()!=0 || nts_live_bytes()!=0) _Exit(4);
#endif
  }
  printf("conversions %zu\n",conversions);
  return argc==2 && conversions>strtoull(argv[1],NULL,10) ? 3 : 0;
}
"#;
const ORACLE: &str = r"
import * as m from './main.ts';
function number(n){const b=Buffer.alloc(8);b.writeDoubleBE(n);process.stdout.write(b.toString('hex')+'\n');}
for(let repeat=0;repeat<4;repeat++)for(const n of [-2147483649,-2147483648,-3,-0,0,1,2,7,2147483647,2147483648,0.5,NaN,Infinity,-Infinity]){
  for(const name of ['closedAdd','closedSubtract','fractionalWriter','unsignedWriter','nonfiniteWriter','absentRead']) number(m[name](n));
  process.stdout.write(m.zeroSignOtherUse(n)+'\n');
  for(const name of ['widerWriter','twoUpdates','extraFloatingUse','capturedOrder','signedEdges','dense']) number(m[name](n));
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

fn disabled(prepared: &hir::Prepared) -> hir::Program {
    let mut program = prepared.program.clone();
    for site in &prepared.accumulators.sites {
        if site.decision != hir::accumulators::Decision::Wrapping {
            continue;
        }
        let func = program
            .funcs
            .iter_mut()
            .find(|f| f.name == site.function)
            .unwrap();
        func.values[site.sum.0 as usize].kind = OpKind::Binary {
            op: site.bin,
            lhs: site.lhs,
            rhs: site.rhs,
        };
        func.values[site.sink.0 as usize].kind = OpKind::Unary {
            op: UnOp::ToInt32,
            operand: site.sum,
        };
        let block = func
            .blocks
            .iter_mut()
            .find(|b| b.ops.contains(&site.sink))
            .unwrap();
        let at = block.ops.iter().position(|id| *id == site.sink).unwrap();
        block.ops.insert(at, site.sum);
    }
    for func in &mut program.funcs {
        hir::dce::eliminate(func);
    }
    hir::verify::verify(&program).expect("disabled rewrite is valid");
    program
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
        module.text.replace("@nts_to_int32", "@nts_test_to_int32")
    } else {
        format!(
            "#include \"nts_runtime.h\"\nint32_t nts_test_to_int32(double);\n{}",
            c.writer
                .text()
                .replace("nts_to_int32(", "nts_test_to_int32(")
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
    let text = String::from_utf8(output.stdout).unwrap();
    let (answers, count) = text
        .rsplit_once("conversions ")
        .expect("executed conversion count");
    assert_eq!(answers.as_bytes(), expected, "{binary}");
    count.trim().parse().unwrap()
}

#[test]
fn proved_operands_remove_executed_conversions_on_both_native_emitters() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/proved-int32-tests"), "native");
    let mut source = SOURCE.to_owned();
    source.push_str("\nexport function dense(n: number): number { const values = new Map<string, number>(); values.set('key', n | 0); const held = values.get('key') ?? 0; let total = n | 0;\n");
    for _ in 0..96 {
        source.push_str("total = (total + held) | 0;\n");
    }
    source.push_str("return total; }\n");
    std::fs::write(dir.join("main.ts"), source).unwrap();
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
        assert!(
            prepared
                .accumulators
                .sites
                .iter()
                .any(|site| site.function.starts_with("closedAdd")
                    && site.decision == hir::accumulators::Decision::Wrapping),
            "{:?}",
            prepared.accumulators
        );
        for unproved in [
            "fractionalWriter",
            "unsignedWriter",
            "nonfiniteWriter",
            "absentRead",
            "widerWriter",
            "extraFloatingUse",
        ] {
            assert!(
                !prepared
                    .accumulators
                    .sites
                    .iter()
                    .any(|site| site.function.starts_with(unproved)
                        && site.decision == hir::accumulators::Decision::Wrapping),
                "{unproved}: {:?}",
                prepared.accumulators
            );
        }
        assert!(
            prepared
                .accumulators
                .sites
                .iter()
                .filter(|site| site.function == "dense"
                    && site.decision == hir::accumulators::Decision::Wrapping)
                .count()
                >= 96
        );
        let disabled = disabled(&prepared);
        for llvm in [false, true] {
            let count = execute(
                &compile(&dir, &prepared.program, llvm, "enabled"),
                None,
                &expected,
                0,
            );
            let restored = execute(
                &compile(&dir, &disabled, llvm, "disabled"),
                Some(count),
                &expected,
                3,
            );
            assert!(
                restored > count,
                "disabling the rewrite must fail the executed guard"
            );
        }
    }
}
