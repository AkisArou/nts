//! Witness the declarations, then execute the same integer-value fixture on C/LLVM.
use super::{Command, clang, hir, prepare_with_files};

const SOURCE: &str =
    include_str!("../../../../../tests/interop/native-bigint-constants/src/main.ts");
const DECLARATIONS: &str =
    include_str!("../../../../../tests/interop/native-bigint-constants/types/constants.d.ts");
const HEADER: &str =
    include_str!("../../../../../tests/interop/native-bigint-constants/native/constants.h");
const LIBRARY: &str =
    include_str!("../../../../../tests/interop/native-bigint-constants/native/constants.c");
const CALLER: &str =
    include_str!("../../../../../tests/interop/native-bigint-constants/consumer/caller.c");

#[test]
fn bigint_constants_cross_c_without_a_floating_point_step() {
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let (dir, prepared) = prepare_with_files(
            "bigint-constants",
            SOURCE,
            provider,
            &[("constants.d.ts", DECLARATIONS)],
        );
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        for (name, text) in [
            ("program.c", c.writer.text()),
            ("program.ll", llvm.text.as_str()),
            ("constants.h", HEADER),
            ("native.c", LIBRARY),
            ("caller.c", CALLER),
        ] {
            std::fs::write(dir.join(name), text).unwrap();
        }
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
        for (source, executable) in [("program.c", "c-run"), ("program.ll", "llvm-run")] {
            clang(
                &dir,
                &[
                    &[
                        "-O2",
                        "-Wno-override-module",
                        source,
                        "native.c",
                        "caller.c",
                        "nts_runtime.c",
                        "-lm",
                        "-o",
                        executable,
                    ][..],
                    counted,
                ]
                .concat(),
            );
            let run = Command::new(dir.join(executable)).output().unwrap();
            assert!(
                run.status.success(),
                "{executable}: {}",
                String::from_utf8_lossy(&run.stderr)
            );
            assert_eq!(
                String::from_utf8_lossy(&run.stdout),
                "bigint constants: exact signed and unsigned C values\n"
            );
        }
    }
}
