//! An accumulator in a loop guarded by a 32-bit count is an integer.
//!
//! `hir::loops` bounds what a loop accumulates by counting its iterations, and
//! gave up on any loop that could run more than 10^9 times. A loop guarded by
//! `i < rounds`, with `rounds` an `i32` -- what an exported function's `#whole`
//! clone has -- can run 2^31 - 1 times, so its accumulators were unbounded and
//! stayed doubles: `optional-chain`'s `total` cost two `ToInt32` calls and a
//! conversion per round, 262 us against 55 us as an integer.
//!
//! The control is the same loop accumulating the counter itself. Its bound,
//! 2^31 times 2^31, is past the safe-integer range, where a whole number no
//! longer adds exactly, so it stays a double.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::Utf8Path;
use nts_core::hir::{self, HirType};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const SOURCE: &str = r"
export function small(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    total = total + (i & 7);
  }
  return total;
}

export function large(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    total = total + i;
  }
  return total;
}
";

/// The types of a function's loop-header parameters: its counter and its
/// accumulator.
fn carried(program: &hir::Program, name: &str) -> Vec<HirType> {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is in the program"));
    func.blocks
        .iter()
        .filter(|block| block.params.len() == 2)
        .flat_map(|block| &block.params)
        .map(|param| func.values[param.0 as usize].ty.clone())
        .collect()
}

#[test]
fn an_accumulator_bounded_by_a_32_bit_count_is_an_integer() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP accumulator widths: tsgo is required");
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/accumulator-tests"), "widths");
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

    let small = carried(&prepared.program, "small#whole");
    assert!(!small.is_empty(), "`small#whole` has a loop header");
    assert!(
        small.iter().all(|ty| matches!(ty, HirType::Int { .. })),
        "a total of at most 7 per round over an i32 count is an integer: {small:?}",
    );

    let large = carried(&prepared.program, "large#whole");
    assert!(
        large.iter().any(|ty| matches!(ty, HirType::Float { .. })),
        "a total of the counter itself can pass 2^53, and stays a double: {large:?}",
    );
}
