//! Recorded gap: an exported function's declared C kind reaches `program.h`
//! only on a `number` parameter. A `bigint` kind crosses as the program's
//! `__int128` on either side, and any kind returned crosses as the program's
//! representation -- `double` for a `Uint32`, `__int128` for a `c_size_t`.
//!
//! Found through `pointerBits`: `export function bits(p): c_uintptr_t` is
//! `__int128 bits(const uint16_t *)` to C, not `uintptr_t`. `c_size_t` stands
//! for every bigint kind here; `BigUint64`, `c_ulong` and `c_uintptr_t` cross
//! the same way.
//!
//! Two one-difference controls, both on `takesU32(n: Uint32)`, which crosses
//! as `uint32_t` because `written_roots` narrows a root's `number` parameter
//! to its kind:
//! - the kind's base: `takesSize(n: c_size_t)` differs only in being a bigint
//!   kind, and crosses as `__int128`;
//! - the position: `answer(): Uint32` differs only in returning the kind, and
//!   crosses as `double`.
//!
//! A fix spells each declared kind's C type on both sides (`size_t size(void)`,
//! `uint32_t answer(void)`), and then these assertions become its guard.
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
    // The control: a `number` parameter crosses at its kind.
    assert!(
        header.contains("double takesU32(uint32_t v0);"),
        "the control lost its kind, which is a regression:\n{header}"
    );
    // The gap, one difference from it each way.
    for gap in [
        "double takesSize(__int128 v0);",
        "double answer(void);",
        "__int128 size(void);",
    ] {
        assert!(
            header.contains(gap),
            "this records the gap; when it fails because the header is right \
             (`size_t`, `uint32_t`), flip it to a guard. Expected `{gap}` in:\n{header}"
        );
    }
}
