//! Exercise the pool's private state through compiled TypeScript, including
//! alias-read invalidation and public catchable guards before the native call.
//! The direct C suite separately observes abort before allocation/detachment.
use super::{Command, clang, hir, prepare_with_provider};

const SOURCE: &str = include_str!("../../../common/test-support/buffer-untransferable/main.ts");
const CALLER: &str = include_str!("../../../common/test-support/buffer-untransferable/caller.c");

#[test]
fn compiled_transfers_observe_marks_and_length_evaluation_on_c_and_llvm() {
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let (dir, prepared) = prepare_with_provider("buffer-untransferable", SOURCE, provider);
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
            ("caller.c", CALLER),
        ] {
            std::fs::write(dir.join(name), text).unwrap();
        }
        let flags: &[&str] = if provider == hir::Memory::ReferenceCounting {
            &["-DNTS_PROVIDER_RC"]
        } else {
            &[]
        };
        for (source, object) in [("nts_runtime.c", "runtime.o"), ("caller.c", "caller.o")] {
            clang(
                &dir,
                &[
                    &[
                        "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-c", source, "-o",
                        object,
                    ][..],
                    flags,
                ]
                .concat(),
            );
        }
        for (source, object, binary) in [
            ("program.c", "c.o", "c-run"),
            ("program.ll", "llvm.o", "llvm-run"),
        ] {
            clang(
                &dir,
                &[
                    &[
                        "-O2",
                        "-Wall",
                        "-Wextra",
                        "-Werror",
                        "-Wno-override-module",
                        "-c",
                        source,
                        "-o",
                        object,
                    ][..],
                    flags,
                ]
                .concat(),
            );
            clang(
                &dir,
                &[object, "runtime.o", "caller.o", "-lm", "-o", binary],
            );
            let ran = Command::new(dir.join(binary)).output().unwrap();
            let report = String::from_utf8_lossy(&ran.stdout);
            assert!(
                ran.status.success(),
                "{provider:?} {binary}: {report}\n{}",
                String::from_utf8_lossy(&ran.stderr)
            );
            assert_eq!(
                report
                    .lines()
                    .filter(|line| line.starts_with("ok "))
                    .count(),
                18,
                "{report}"
            );
        }
    }
}
