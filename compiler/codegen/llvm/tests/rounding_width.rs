//! A converting unary operation can have different operand/result widths.
//! Use verified prepared HIR so the test exercises the emitter's contract
//! independently of which widths a particular frontend program infers today.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir::{self, Block, HirType, OpKind, Terminator, UnOp, ValueId};
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;
use std::process::Command;

fn checked(command: &mut Command) -> String {
    let result = command.output().expect("run toolchain");
    assert!(
        result.status.success(),
        "{command:?}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8(result.stdout).expect("UTF-8 output")
}

fn program(dir: &Utf8Path, signed: bool, rounding: Option<UnOp>) -> hir::Program {
    std::fs::write(
        dir.join("main.ts"),
        "export function subject(n: number): number { return n; }\n",
    )
    .unwrap();
    std::fs::write(dir.join("tsconfig.json"), r#"{"compilerOptions":{"target":"ESNext","strict":true,"noEmit":true},"files":["main.ts"]}"#).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let mut program = hir::prepare(&snapshot).expect("prepared skeleton").program;
    program.funcs.retain(|func| func.name == "subject");
    let func = &mut program.funcs[0];
    let input = HirType::Int { bits: 32, signed };
    let output = HirType::Int {
        bits: 64,
        signed: true,
    };
    func.params[0].ty = input.clone();
    func.return_type = output.clone();
    let mut param = func
        .values
        .iter()
        .find(|op| matches!(op.kind, OpKind::Param(0)))
        .unwrap()
        .clone();
    param.ty = input;
    let mut rounded = param.clone();
    rounded.kind = match rounding {
        Some(op) => OpKind::Unary {
            op,
            operand: ValueId(0),
        },
        None => OpKind::Convert(ValueId(0)),
    };
    rounded.ty = output;
    func.values = vec![param, rounded];
    func.blocks = vec![Block {
        params: vec![],
        ops: vec![ValueId(0), ValueId(1)],
        terminator: Terminator::Return(Some(ValueId(1))),
    }];
    hir::verify::verify(&program).expect("rounding across widths is valid HIR");
    program
}

#[test]
fn integer_rounding_agrees_with_explicit_conversion_and_c() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    for signed in [true, false] {
        let dir = ScratchDir::new(
            &root.join("target/rounding-width-tests"),
            if signed { "signed" } else { "unsigned" },
        );
        for file in nts_codegen_c::support_files(true) {
            file.write(dir.as_std_path()).unwrap();
        }
        let (input, values, expected) = if signed {
            (
                "int32_t",
                "INT32_MIN,-1,0,1,INT32_MAX",
                "-2147483648\n-1\n0\n1\n2147483647\n",
            )
        } else {
            (
                "uint32_t",
                "0,1,2147483648u,UINT32_MAX",
                "0\n1\n2147483648\n4294967295\n",
            )
        };
        std::fs::write(dir.join("main.c"), format!("#include <stdint.h>\n#include <stdio.h>\n#include <inttypes.h>\nextern int64_t subject({input});\nint main(void){{ {input} xs[]={{{values}}}; for(unsigned i=0;i<sizeof(xs)/sizeof(xs[0]);i++) printf(\"%\" PRId64 \"\\n\",subject(xs[i])); }}\n")).unwrap();
        for rounding in [
            None,
            Some(UnOp::Trunc),
            Some(UnOp::Floor),
            Some(UnOp::Ceil),
            Some(UnOp::Round),
        ] {
            eprintln!("signed={signed}, rounding={rounding:?}");
            let program = program(&dir, signed, rounding);
            let c = nts_codegen_c::emit(&program, hir::native::NativeAbi::LP64);
            assert!(c.is_complete(), "{:?}", c.diagnostics);
            let llvm = nts_codegen_llvm::emit(&program, nts_codegen_llvm::Platform::SYSV_X86_64);
            assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
            std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
            std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
            for source in ["program.c", "program.ll"] {
                let binary = dir.join("run");
                checked(
                    Command::new("clang")
                        .args(["-O2", "-Wno-override-module", "-I"])
                        .arg(&*dir)
                        .arg(dir.join(source))
                        .arg(dir.join("main.c"))
                        .args(["-lm", "-o"])
                        .arg(&binary),
                );
                assert_eq!(
                    checked(&mut Command::new(&binary)),
                    expected,
                    "{signed} {rounding:?} {source}"
                );
            }
        }
    }
}
