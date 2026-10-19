//! The gated C-oracle fixture for `pointerBits` on both backends and both
//! memory providers: a pointer's bits with no load and no count.
use super::{Command, clang, hir, prepare_with_files};

const SOURCE: &str = include_str!("../../../../../tests/interop/native-pointer-bits/src/main.ts");
const DECLARATIONS: &str =
    include_str!("../../../../../tests/interop/native-pointer-bits/types/bits.d.ts");
const HEADER: &str = include_str!("../../../../../tests/interop/native-pointer-bits/native/bits.h");
const LIBRARY: &str =
    include_str!("../../../../../tests/interop/native-pointer-bits/native/bits.c");
const CALLER: &str =
    include_str!("../../../../../tests/interop/native-pointer-bits/consumer/caller.c");

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one native fixture on two backends and two providers"
)]
fn pointer_bits_are_c_uintptr_with_no_load_or_count() {
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let Some((dir, prepared)) = prepare_with_files(
            "pointer-bits",
            SOURCE,
            provider,
            &[("bits.d.ts", DECLARATIONS)],
        ) else {
            return;
        };
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let program = &prepared.program;
        let bits = program.funcs.iter().find(|f| f.name == "bits").unwrap();
        let read: Vec<_> = bits
            .values
            .iter()
            .filter_map(|op| match op.kind {
                hir::OpKind::NativePointerBits { pointer } => Some(pointer),
                _ => None,
            })
            .collect();
        assert_eq!(read.len(), 1, "one pointer's bits in `bits`");
        assert!(matches!(
            bits.value(read[0]).ty,
            hir::HirType::NativePointer(_)
        ));
        // Nothing read through it, and no conversion of the pointer itself:
        // the one `Convert` widens the bits to the program's bigint.
        assert!(!bits.values.iter().any(|op| match op.kind {
            hir::OpKind::NativeLoad { .. } => true,
            hir::OpKind::Convert(from) => {
                matches!(bits.value(from).ty, hir::HirType::NativePointer(_))
            }
            _ => false,
        }));
        // No count moves for a pointer anywhere, the bits included.
        for func in &program.funcs {
            for op in &func.values {
                if let hir::OpKind::Retain(v) | hir::OpKind::Release(v) = op.kind {
                    assert!(!matches!(func.value(v).ty, hir::HirType::NativePointer(_)));
                }
            }
        }
        let c = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        assert!(c.writer.text().contains("(uint64_t)(uintptr_t)"));
        let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        assert!(llvm.text.contains("= ptrtoint ptr "));
        let win = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::WIN64_X86_64);
        assert!(win.diagnostics.is_empty(), "{:?}", win.diagnostics);
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        for (name, text) in [
            ("program.c", c.writer.text()),
            ("program.ll", llvm.text.as_str()),
            ("program-win64.ll", win.text.as_str()),
            ("bits.h", HEADER),
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
        let counted: &[&str] = if provider == hir::Provider::ReferenceCounting {
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
                    .contains("exact bits, no load, agree with C's (uintptr_t)p")
            );
        }
    }
}
