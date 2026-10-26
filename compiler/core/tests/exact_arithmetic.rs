//! Which integer arithmetic is proved to fit its type (`hir::exact`).
//!
//! `tests/programs/a-wrapping-add-compared-with-its-operand` compares with node
//! on every backend, which is what catches a promise of no overflow that the
//! program breaks. What it cannot say is which operations carry the promise:
//! the `(h + 1) | 0` compared with `h` wraps past `INT32_MAX`, so it must not
//! be marked, and the loop counter bounded by `i < 10` cannot overflow, so it
//! is.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, OpKind, UnOp};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "a-wrapping-add-compared-with-its-operand";

fn prepared() -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(PROGRAM)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{PROGRAM} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::prepare(&snapshot)
        .expect("prepared HIR verifies")
        .program
}

#[test]
fn a_wrapping_add_is_not_exact_and_a_bounded_counter_is() {
    let program = prepared();
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == "wrapsPastMax")
        .expect("`wrapsPastMax` is exported");
    // Every `x + c` compared with its own `x`, in either order.
    let mut pairs = 0;
    for &id in func.blocks.iter().flat_map(|block| &block.ops) {
        let OpKind::Binary {
            op: BinOp::Gt | BinOp::Lt,
            lhs,
            rhs,
        } = func.values[id.0 as usize].kind
        else {
            continue;
        };
        for (compared, other) in [(lhs, rhs), (rhs, lhs)] {
            // Through the `| 0`, which a comparison may still read.
            let sum = match func.values[compared.0 as usize].kind {
                OpKind::Unary {
                    op: UnOp::ToInt32,
                    operand,
                } => operand,
                _ => compared,
            };
            if let OpKind::Binary {
                op: BinOp::Add,
                lhs: operand,
                ..
            } = func.values[sum.0 as usize].kind
                && operand == other
            {
                assert!(
                    !func.exact.contains_key(&sum),
                    "`(h + 1) | 0` wraps past INT32_MAX, so it cannot promise not to overflow"
                );
                pairs += 1;
            }
        }
    }
    assert!(pairs > 0, "`wrapsPastMax` compares `(h + 1) | 0` with `h`");
    assert!(
        !func.exact.is_empty(),
        "the counter bounded by `i < 10` is proved to fit"
    );
}
