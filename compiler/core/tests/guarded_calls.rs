//! A call inside the program to a guarded root goes to its `#whole` copy
//! directly when its arguments already pass the guard's test.
//!
//! The guard (`hir::guards`) tests a root's float arguments at the boundary,
//! for callers outside the program. A caller inside it that holds a whole
//! `int32` went through that test anyway: json-scan's `work#whole` converted
//! its `i32` cursor to a double to call `scanNumber`'s entry, which converted
//! it back to test it and then called `scanNumber#whole` -- 19% of the JVM's
//! profile in `toInt32`.
//!
//! The control differs in one thing: an argument that may be a fraction
//! (`i / 2`), which the test exists for, and which still goes through it.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const SOURCE: &str = r"
export function scan(text: string, from: number): number {
  let at = from;
  while (at < text.length && text.charCodeAt(at) === 32) {
    at = at + 1;
  }
  return at;
}

export function work(text: string, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    total = (total + scan(text, i & 7)) | 0;
  }
  return total;
}

export function halves(text: string, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    total = total + scan(text, i / 2);
  }
  return total;
}
";

/// The functions `name` calls directly, by name.
fn callees(program: &hir::Program, name: &str) -> Vec<String> {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is in the program"));
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(callee),
                ..
            } => Some(callee.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_call_that_passes_the_guard_calls_the_whole_copy() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP guarded calls: tsgo is required");
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/guarded-call-tests"), "direct");
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
    let prepared = hir::prepare(&snapshot).expect("prepared HIR should verify");
    let program = &prepared.program;
    assert!(
        program.funcs.iter().any(|func| func.name == "scan#whole"),
        "`scan` is guarded, so it has a whole-number copy"
    );

    let work = callees(program, "work#whole");
    assert!(
        work.iter().any(|callee| callee == "scan#whole"),
        "`i & 7` is a whole int32, so `work#whole` calls the copy directly: {work:?}"
    );
    assert!(
        !work.iter().any(|callee| callee == "scan"),
        "and not the guarded entry: {work:?}"
    );

    let halves = callees(program, "halves#whole");
    assert!(
        halves.iter().any(|callee| callee == "scan"),
        "`i / 2` may be a fraction, so it goes through the guard: {halves:?}"
    );
}
