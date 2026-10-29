//! The native literal contract is executed by an independent C caller through
//! both emitters, including RC error-path cleanup under `ASan` and `UBSan`.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;
#[path = "../../../test-support/scratch.rs"]
mod scratch;

fn checked(command: &mut Command) -> Vec<u8> {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{command:?}: {:?}\n{}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn erased_literal_membership_is_checked_on_both_native_backends() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/literal-assertions"), "native");
    std::fs::write(
        dir.join("main.ts"),
        include_str!("../../common/test-support/literal-assertions/main.ts"),
    )
    .unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    std::fs::write(
        dir.join("caller.c"),
        include_str!("../../common/test-support/literal-assertions/caller.c"),
    )
    .unwrap();
    for rc in [false, true] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider: if rc {
                    hir::Memory::ReferenceCounting
                } else {
                    hir::Memory::NoGc
                },
                ..hir::Options::default()
            },
        )
        .unwrap();
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(dir.join("program.h"), &c.header).unwrap();
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
        for source in ["program.c", "program.ll"] {
            let mut build = Command::new("clang");
            build.current_dir(&dir).args([
                "-std=c11",
                "-O1",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Wno-override-module",
            ]);
            if rc {
                build.args([
                    "-DNTS_PROVIDER_RC",
                    "-DNTS_POISON=1",
                    "-fsanitize=address,undefined",
                    "-fno-sanitize-recover=all",
                ]);
            }
            checked(build.args([source, "nts_runtime.c", "caller.c", "-lm", "-o", "run"]));
            assert_eq!(
                checked(Command::new(dir.join("run")).current_dir(&dir)),
                b"130 cases\n"
            );
        }
    }
}
