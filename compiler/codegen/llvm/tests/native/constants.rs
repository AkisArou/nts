//! The same gated C-oracle fixture on both backends and both memory providers.
use super::{Command, clang, hir, prepare_with_files};

const SOURCE: &str =
    include_str!("../../../../../tests/interop/native-pointer-constants/src/main.ts");
const DECLARATIONS: &str =
    include_str!("../../../../../tests/interop/native-pointer-constants/types/constants.d.ts");
const HEADER: &str =
    include_str!("../../../../../tests/interop/native-pointer-constants/native/constants.h");
const LIBRARY: &str =
    include_str!("../../../../../tests/interop/native-pointer-constants/native/constants.c");
const CALLER: &str =
    include_str!("../../../../../tests/interop/native-pointer-constants/consumer/caller.c");

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one native fixture on two backends and two providers"
)]
fn pointer_constants_keep_exact_bits_and_native_equality() {
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let (dir, prepared) = prepare_with_files(
            "pointer-constants",
            SOURCE,
            provider,
            &[("constants.d.ts", DECLARATIONS)],
        );
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let program = &prepared.program;
        let broadcast = program
            .funcs
            .iter()
            .find(|f| f.name == "broadcast")
            .unwrap();
        assert!(
            broadcast
                .values
                .iter()
                .any(|op| matches!(op.kind, hir::OpKind::ConstHandle(65535)))
        );
        assert!(!broadcast.values.iter().any(|op| matches!(
            op.kind,
            hir::OpKind::Convert(_) | hir::OpKind::ConstFloat(_)
        )));
        let number = program
            .funcs
            .iter()
            .find(|f| f.name == "numberControl")
            .unwrap();
        assert!(
            number
                .values
                .iter()
                .any(|op| matches!(op.kind, hir::OpKind::ConstFloat(65535.0)))
        );
        for func in &program.funcs {
            for op in &func.values {
                if let hir::OpKind::Retain(v)
                | hir::OpKind::Release(v)
                | hir::OpKind::Erase { value: v, .. } = op.kind
                {
                    assert!(!matches!(func.value(v).ty, hir::HirType::NativePointer(_)));
                }
            }
        }
        let c = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        assert!(llvm.text.contains("inttoptr i64 9007199254740993 to ptr"));
        let win = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::WIN64_X86_64);
        assert!(win.diagnostics.is_empty(), "{:?}", win.diagnostics);
        assert!(
            win.text
                .contains("inttoptr i64 18446744073709551615 to ptr")
        );
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        for (name, text) in [
            ("program.c", c.writer.text()),
            ("program.ll", llvm.text.as_str()),
            ("program-win64.ll", win.text.as_str()),
            ("constants.h", HEADER),
            ("native.c", LIBRARY),
            ("caller.c", CALLER),
        ] {
            std::fs::write(dir.join(name), text).unwrap();
        }
        clang(
            &dir,
            &[
                "-target",
                "x86_64-w64-windows-gnu",
                "-c",
                "program-win64.ll",
                "-o",
                "win64.o",
            ],
        );
        clang(
            &dir,
            &[
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-fsyntax-only",
                nts_codegen_c::NATIVE_WITNESS_NAME,
            ],
        );
        let counted: &[&str] = if provider == hir::Memory::ReferenceCounting {
            &["-DNTS_PROVIDER_RC"]
        } else {
            &[]
        };
        for file in ["native.c", "caller.c", "nts_runtime.c"] {
            clang(
                &dir,
                &[
                    &["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", file][..],
                    counted,
                ]
                .concat(),
            );
        }
        for (source, object, executable) in [
            ("program.c", "c.o", "c-run"),
            ("program.ll", "llvm.o", "llvm-run"),
        ] {
            clang(
                &dir,
                &[
                    &["-O2", "-Wno-override-module", "-c", source, "-o", object][..],
                    counted,
                ]
                .concat(),
            );
            clang(
                &dir,
                &[
                    object,
                    "native.o",
                    "caller.o",
                    "nts_runtime.o",
                    "-lm",
                    "-o",
                    executable,
                ],
            );
            let run = Command::new(dir.join(executable)).output().unwrap();
            assert!(
                run.status.success(),
                "{executable}: {}",
                String::from_utf8_lossy(&run.stderr)
            );
            assert!(
                String::from_utf8_lossy(&run.stdout)
                    .contains("exact bits, typed calls and equality agree with C")
            );
        }
    }
}
