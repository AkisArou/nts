//! A refused nested function must not leave unread name strings in C.
//!
//! `benches.sh` found this in CLBG reverse-complement: another export keeps
//! emission nonempty after the nested function and its caller are refused.
//! The compiler still collected the nested function's name even though no
//! emitted descriptor read it. The control changes only the refused byte
//! `indexOf` operation to a supported element read.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

const SOURCE: &str = include_str!("../../common/test-support/refused-names/main.ts");

#[test]
fn a_refused_nested_function_leaves_no_unread_immortal_name() {
    assert!(Command::new("clang").arg("--version").output().is_ok());
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let control = SOURCE.replace("bytes.indexOf(n)", "bytes[0]!");
    for (label, source, refused) in [
        ("control", control.as_str(), false),
        ("refused", SOURCE, true),
    ] {
        let dir = ScratchDir::new(&root.join("target/refused-name-tests"), label);
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
        )
        .unwrap();
        std::fs::write(dir.join("main.ts"), source).unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&dir.join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors(), "{label} must typecheck");
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider: hir::Memory::ReferenceCounting,
                ..hir::Options::default()
            },
        )
        .unwrap();
        assert_eq!(!prepared.diagnostics.is_empty(), refused, "{label}");
        let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
        for file in emitted.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        let compiled = Command::new("clang")
            .current_dir(&dir)
            .args([
                "-O2",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-std=c11",
                "-DNTS_PROVIDER_RC",
                "-I.",
                "-c",
                "program.c",
                "-o",
                "program.o",
            ])
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{label}: the emitted program must compile under benches.sh's warning flags:\n{}",
            String::from_utf8_lossy(&compiled.stderr)
        );
    }
}
