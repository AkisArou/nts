//! A remainder answered from its integers leaves no unread local behind.
//!
//! `x % y` over two `i32`s whose result can be NaN or `-0` stays a floating
//! `rem` over two converts in the HIR, and the C emitter answers it from the
//! integers (`nts_rem_i32`). The converts were still assigned, and nothing
//! read them: `-Wunused-but-set-variable`, an error under the `-Werror` the
//! benchmarks compile with, and `event-state` stopped compiling. What C reads
//! is the emitter's to say (`operands_in_c`), so a convert only the remainder
//! read is neither declared nor assigned.
//!
//! The control reads one convert elsewhere too, so it is still emitted.
//!
//! Skips without the frontend or clang.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

const SOURCE: &str = r"
export function draw(seed: number, max: number): number {
  return (seed | 0) % (max | 0);
}

export function drawAndScale(seed: number, max: number): number {
  const m = max | 0;
  return ((seed | 0) % m) + m * 0.5;
}
";

fn toolchain() -> Option<Utf8PathBuf> {
    let tsgo = nts_frontend_ts::tsgo::locate();
    if tsgo.is_none() || Command::new("clang").arg("--version").output().is_err() {
        eprintln!("SKIP remainder: tsgo and clang are required");
        return None;
    }
    tsgo
}

#[test]
fn a_remainder_answered_from_its_integers_compiles_warning_free() {
    let Some(tsgo) = toolchain() else {
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/remainder-tests"), "unread");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    let prepared = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    // Both functions take the integral remainder: the test is vacuous otherwise.
    assert_eq!(
        text.matches("nts_rem_i32(").count(),
        2,
        "both remainders are answered from their integers:\n{text}"
    );
    std::fs::write(dir.join("program.c"), text).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-O2",
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
        "the emitted C compiles under -Wall -Wextra -Werror:\n{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
}
