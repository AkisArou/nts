//! A bitwise operator over booleans is C's own operator, with no conversion.
//!
//! `x ?? 1` over an optional call tests the answer's absence with an `or` of
//! two booleans, and the emitter sent each through `nts_to_uint32` -- a
//! promotion to `double` and ECMAScript's `ToUint32` back -- because only an
//! integer operand was passed through. A C `bool` is already 0 or 1, which is
//! what `ToInt32` makes of `false` and `true`. With `optional-chain`'s
//! accumulator an integer, that round trip was what the loop waited on.
//!
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

/// `optional-chain`'s shape: an optional function field, called optionally,
/// with a default for its absence.
const SOURCE: &str = r"
interface Held {
  fn?: (x: number) => number;
}

function plusOne(x: number): number {
  return x + 1;
}

export function run(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    const h: Held = {};
    if ((total & 1) === 0) {
      h.fn = plusOne;
    }
    total = total + (h.fn?.(total & 7) ?? 1);
  }
  return total;
}
";

#[test]
fn an_or_of_two_booleans_converts_neither() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/bitwise-tests"), "bool-or");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), SOURCE).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    let prepared = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    // The program does have the `or`: the test is vacuous otherwise.
    let ors = prepared
        .program
        .funcs
        .iter()
        .flat_map(|func| func.values.iter().map(move |op| (func, op)))
        .filter(|(func, op)| {
            matches!(
                op.kind,
                hir::OpKind::Binary { op: hir::BinOp::BitOr, lhs, rhs }
                    if func.values[lhs.0 as usize].ty == hir::HirType::Bool
                        && func.values[rhs.0 as usize].ty == hir::HirType::Bool
            )
        })
        .count();
    assert!(ors > 0, "the absence test is an `or` of two booleans");
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        !text.contains("nts_to_uint32("),
        "a boolean operand went through ToUint32:\n{}",
        text.lines()
            .filter(|line| line.contains("nts_to_uint32("))
            .collect::<Vec<_>>()
            .join("\n")
    );
}
