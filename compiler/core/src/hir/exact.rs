//! Which integer arithmetic provably fits its type.
//!
//! An integer `+`, `-` or `*` wraps: `(a + b) | 0` is defined modulo 2^32, and
//! specialization narrows such a chain to `i32` *because* it wraps. So a
//! backend may not promise that one cannot overflow -- LLVM's `nsw`, C's plain
//! signed operator -- unless something proved it. This is that proof: an
//! operation whose operands' intervals put every result inside its type is
//! [`super::Func::exact`], and only those carry the promise. Everything else
//! is spelled to wrap.
//!
//! **Last, from the final program.** Specialization, width narrowing and the
//! bounds pass's reconcile all change an operation's type after the numbers
//! are first analyzed, and a proof made at `i64` says nothing at `i32`. So this
//! runs once nothing will change a type or an operand again, over facts
//! computed for the program as it is, and [`super::verify`] checks that each
//! marked operation is still the arithmetic, at the type, the mark was made
//! for.
//!
//! Unary `-` is not marked: its result type is chosen to hold `-x`
//! (`-INT32_MIN` widens to `i64`), so it cannot overflow by construction.

use super::facts::{Facts, SAFE_MAX};
use super::{BinOp, Func, HirType, OpKind, flow};

/// Mark every integer `+`, `-` and `*` in `func` whose result fits its type.
pub(super) fn mark(func: &mut Func, analysis: &flow::Analysis) {
    let mut exact = rustc_hash::FxHashMap::default();
    for &id in func.blocks.iter().flat_map(|block| &block.ops) {
        let op = &func.values[id.0 as usize];
        let HirType::Int { bits, signed: true } = op.ty else {
            continue;
        };
        let OpKind::Binary { op: bin, lhs, rhs } = op.kind else {
            continue;
        };
        if fits(bin, analysis.get(lhs), analysis.get(rhs), u32::from(bits)) {
            exact.insert(id, op.ty.clone());
        }
    }
    func.exact = exact;
}

/// Whether every `a <bin> b` lies inside a signed integer of `bits`.
///
/// The bounds are computed in `f64`, which is exact while they stay within
/// `SAFE_MAX`; a bound past it is not a proof of anything.
fn fits(bin: BinOp, a: Facts, b: Facts, bits: u32) -> bool {
    let finite = |facts: Facts| {
        facts.whole && !facts.maybe_nan && facts.lo.is_finite() && facts.hi.is_finite()
    };
    if !finite(a) || !finite(b) {
        return false;
    }
    let (lo, hi) = match bin {
        BinOp::Add => (a.lo + b.lo, a.hi + b.hi),
        BinOp::Sub => (a.lo - b.hi, a.hi - b.lo),
        BinOp::Mul => {
            let corners = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
            (
                corners.iter().copied().fold(f64::INFINITY, f64::min),
                corners.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            )
        }
        _ => return false,
    };
    let limit = 2f64.powi(i32::try_from(bits).unwrap_or(64) - 1);
    lo.abs() <= SAFE_MAX && hi.abs() <= SAFE_MAX && lo >= -limit && hi < limit
}
