//! The output clearing helper's size is an integer at the native ABI boundary.

use nts_codegen_llvm::Platform;
use nts_core::hir::{self, Callee, OpKind};

#[test]
fn a_hresult_output_size_reaches_win64_as_size_t() {
    let binding = r#"declare module "winrt:SizeProbe" {
  import type { ComClass } from "winrt:types";
  import type { Float64 } from "@nts/scalars";
  interface Methods {
    /**
     * @ntsVtable 3 Read
     * @ntsHresult
     */
    Read(this: Probe): Float64;
  }
  export type Probe = ComClass<"SizeProbe"> & Methods;
}"#;
    let source = r#"import type { Probe } from "winrt:SizeProbe";
export function run(value: Probe): number {
  try { return value.Read(); } catch { return 7; }
}"#;
    let Some((dir, prepared)) = super::prepare_with_files(
        "hresult-size",
        source,
        hir::Provider::NoGc,
        &[
            ("probe.d.ts", binding),
            (
                "winrt.d.ts",
                include_str!("../../../../../runtime/winrt/winrt.d.ts"),
            ),
        ],
    ) else {
        panic!("NTS_TSGO is required for this guard");
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let mut calls = 0;
    for function in &prepared.program.funcs {
        for value in &function.values {
            if let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &value.kind
                && name == "nts_hresult_clear"
            {
                assert_eq!(
                    function.values[args[2].0 as usize].ty,
                    hir::native::Scalar::Size.representation()
                );
                calls += 1;
            }
        }
    }
    assert_eq!(calls, 1);
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LLP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    let llvm = nts_codegen_llvm::emit(&prepared.program, Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(
        llvm.text
            .contains("declare void @nts_hresult_clear(i32, ptr, i64)"),
        "{}",
        llvm.text
    );
    let call = llvm
        .text
        .lines()
        .find(|line| line.contains("call void @nts_hresult_clear("))
        .unwrap();
    assert!(call.contains(", i64 "), "{call}");
    std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
    let compiled = std::process::Command::new("clang")
        .args([
            "--target=x86_64-w64-windows-gnu",
            "-c",
            "program.ll",
            "-o",
            "program.o",
        ])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
}
