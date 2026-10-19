//! An exported function's written kind reaches `program.h` at the kind's
//! width (`written_roots`): a `number` parameter's, and a `number` return's
//! -- `uint32_t answer(void)`, where it was `double`. A guard for those.
//!
//! **Still a recorded gap for a `bigint` kind**, which crosses as the
//! program's `__int128` on either side: a host has to know it was a bigint,
//! and the width alone does not say so.
//!
//! Found through `pointerBits`: `export function bits(p): c_uintptr_t` is
//! `__int128 bits(const uint16_t *)` to C, not `uintptr_t`. `c_size_t` stands
//! for every bigint kind here; `BigUint64`, `c_ulong` and `c_uintptr_t` cross
//! the same way.
//!
//! One-difference controls on `takesU32(n: Uint32)`, which crosses as
//! `uint32_t`:
//! - the position: `answer(): Uint32` differs only in returning the kind, and
//!   crosses as `uint32_t` too;
//! - the kind's base: `takesSize(n: c_size_t)` differs only in being a bigint
//!   kind, and crosses as `__int128` (the gap).
//!
//! The header spells the kind's **width**, not its C name: the width is what
//! holds the kind's values on every target the program is built for, so
//! `c_size_t` will be `uint64_t size(void)` and `double takesSize(uint64_t
//! v0)`, and the bigint assertions become a guard with it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

const SOURCE: &str = r#"
import type { c_size_t, Uint32 } from "@nts/scalars";
export function takesU32(n: Uint32): number { return n; }
export function takesSize(n: c_size_t): number { return Number(n); }
export function answer(): Uint32 { return 42 as Uint32; }
export function size(): c_size_t { return 7n as c_size_t; }
"#;

#[test]
fn recorded_gap_exported_kinds_reach_the_header_only_on_number_parameters() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/export-kind-tests"), "kinds");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/libc.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let header = &emitted.header;
    // A `number` parameter and a `number` return cross at the kind's width.
    for guard in ["double takesU32(uint32_t v0);", "uint32_t answer(void);"] {
        assert!(
            header.contains(guard),
            "a written kind lost its width at the boundary, which is a regression; \
             expected `{guard}` in:\n{header}"
        );
    }
    // The gap: a bigint kind, either way.
    for gap in ["double takesSize(__int128 v0);", "__int128 size(void);"] {
        assert!(
            header.contains(gap),
            "this records the gap; when it fails because the header is right \
             (`uint64_t`), flip it to a guard. Expected `{gap}` in:\n{header}"
        );
    }
}
