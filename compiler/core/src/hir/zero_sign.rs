//! Where the sign of a zero can be seen.
//!
//! # The problem this exists for
//!
//! `-0` and `0` are different doubles and the same integer. So a value the
//! analysis says may be `-0` cannot be represented as an integer — the
//! conversion loses the sign, and `1 / -0` is `-Infinity` while `1 / 0` is
//! `+Infinity`.
//!
//! That rule is correct and it is expensive, because `-0` turns up in places
//! nobody cares about it. `codeUnit * step` may be `-0`, since `0 * -5` is, and
//! that one fact kept an entire string scan in floating point: the product could
//! not be an integer, so the sum could not be, so the accumulator made a
//! `int -> double -> int` round trip every iteration and the loop cost fourteen
//! cycles of dependency instead of two. One line later the product is added to
//! something, and adding to `-0` gives the other operand back — the sign was
//! gone before anything could look at it.
//!
//! # What can look
//!
//! Four things distinguish the two zeros, and everything else cannot:
//!
//! - **Division by it.** `1 / -0` and `1 / 0` differ. The *numerator* does not
//!   matter; a zero denominator is what shows the sign.
//! - **`Math.min` and `Math.max`.** `Math.min(0, -0)` is `-0`, which is the one
//!   place these two are not simply comparisons.
//! - **Leaving the function.** Returned, stored into a field or an element,
//!   written to a global, or passed to a call: what happens next is not visible
//!   here, so it has to be assumed to be one of the above.
//! - **Reaching one of those through arithmetic that carries the sign.** `-0`
//!   times anything is a zero of some sign; `-0` negated is `0`. Multiplication,
//!   division, negation, addition, subtraction and conversion all pass a zero's
//!   sign along, so a value feeding one of them is observed if the result is.
//!
//! Everything else destroys the sign before anyone can look. `ToInt32`, every
//! bitwise operator and every comparison produce values that carry nothing back
//! — which is why `(x * y) | 0` is safe to compute in integers however many
//! negative zeros it passes through.
//!
//! The rounding family is *not* in that group, which is easy to get wrong and
//! was: `Math.floor(-0)` is `-0`, and `Math.ceil(-0.5)` creates one out of a
//! value that was not a zero at all. So is `%`, where `-5 % 5` is `-0`.
//!
//! # The direction it runs
//!
//! Backward, from the places that can look. A value is observed when something
//! it reaches is observed, and a block parameter that is observed makes every
//! argument passed to it observed — which is what stops a loop-carried
//! accumulator from being quietly assumed safe.

use rustc_hash::FxHashSet;

use super::{BinOp, Func, OpKind, Terminator, UnOp, ValueId};

/// A bound on the fixpoint. The set only grows and is bounded by the value
/// count, so this is a bug backstop rather than a limit.
const ROUND_CAP: usize = 64;

/// Values whose zero's sign something in this program can distinguish.
///
/// A value *not* in this set may be represented as an integer even where the
/// analysis says it might be `-0`, because nothing can tell which zero it was.
#[must_use]
pub fn observed(func: &Func) -> FxHashSet<ValueId> {
    let mut seen: FxHashSet<ValueId> = FxHashSet::default();

    // The places that can look.
    for block in &func.blocks {
        for value in &block.ops {
            match &func.values[value.0 as usize].kind {
                // A zero *denominator* is what shows the sign. The numerator is
                // an ordinary operand.
                OpKind::Binary {
                    op: BinOp::Div,
                    rhs,
                    ..
                } => {
                    seen.insert(*rhs);
                }
                // `Math.min(0, -0)` is `-0`: the one place these are not just
                // comparisons.
                OpKind::Binary {
                    op: BinOp::Min | BinOp::Max,
                    lhs,
                    rhs,
                } => {
                    seen.insert(*lhs);
                    seen.insert(*rhs);
                }
                // Gone somewhere this cannot see.
                OpKind::Call { args, .. } => seen.extend(args.iter().copied()),
                OpKind::FieldSet { value: stored, .. }
                | OpKind::ArraySet { value: stored, .. }
                | OpKind::GlobalSet { value: stored, .. } => {
                    seen.insert(*stored);
                }
                _ => {}
            }
        }
        if let Terminator::Return(Some(value)) = &block.terminator {
            seen.insert(*value);
        }
    }

    // And backward, through everything that carries a zero's sign.
    for _ in 0..ROUND_CAP {
        let before = seen.len();

        for index in 0..func.values.len() {
            let id = ValueId(u32::try_from(index).unwrap_or(0));
            if !seen.contains(&id) {
                continue;
            }
            for operand in carries_sign(&func.values[index].kind) {
                seen.insert(operand);
            }
        }

        // An argument reaches its block parameter, so an observed parameter
        // makes every argument that could become it observed too. This is what
        // keeps a loop-carried accumulator honest.
        for block in &func.blocks {
            for (target, args) in edges(&block.terminator) {
                for (param, arg) in func.blocks[target as usize].params.iter().zip(args) {
                    if seen.contains(param) {
                        seen.insert(*arg);
                    }
                }
            }
        }

        if seen.len() == before {
            break;
        }
    }
    seen
}

/// The operands whose zero sign can reach an operation's result.
fn carries_sign(kind: &OpKind) -> Vec<ValueId> {
    match kind {
        // `-0 * x` is a zero whose sign is the product of the two, and `-0 / x`
        // likewise. Addition and subtraction carry it only when both sides are
        // zeros of the same sign, which is a case rather than a reason to
        // exclude them.
        OpKind::Binary {
            // `%` belongs here and is easy to miss: `-5 % 5` is `-0`, and so is
            // `-0 % 5`.
            op:
                BinOp::Mul | BinOp::Div | BinOp::Add | BinOp::Sub | BinOp::Rem | BinOp::Min | BinOp::Max,
            lhs,
            rhs,
        } => vec![*lhs, *rhs],
        OpKind::Unary {
            // The rounding family carries a zero's sign and `ceil` can *create*
            // one: `Math.ceil(-0.5)` is `-0`, and `Math.floor(-0)` is `-0`.
            // Leaving them out of this list was a real bug, and test262 found
            // it as `Math.floor(-0)` coming back `+0`.
            //
            // `Math.abs(-0)` is `+0`, so `Abs` destroys the sign rather than
            // carrying it. It is listed anyway: being conservative here costs a
            // specialization and being wrong costs an answer.
            op: UnOp::Neg | UnOp::Abs | UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round,
            operand,
        }
        | OpKind::Convert(operand) => vec![*operand],
        // Everything else destroys it. A coercion, a bitwise operator and a
        // comparison all produce something that carries nothing back -- which is
        // why `(x * y) | 0` is safe however many negative zeros it passes
        // through.
        _ => Vec::new(),
    }
}

/// The edges leaving a block, each with what it carries.
fn edges(terminator: &Terminator) -> Vec<(u32, &[ValueId])> {
    match terminator {
        Terminator::Jump { target, args } => vec![(target.0, args)],
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![(then_target.0, then_args), (else_target.0, else_args)],
        Terminator::Return(_) | Terminator::Unreachable => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, Param, facts::Facts};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind) -> Op {
        Op {
            kind,
            ty: HirType::NUMBER,
            origin: origin(),
        }
    }

    fn one_block(values: Vec<Op>, terminator: Terminator) -> Func {
        let ops = (0..values.len())
            .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
            .collect();
        Func {
            name: "f".to_owned(),
            params: vec![Param {
                name: "a".to_owned(),
                ty: HirType::NUMBER,
                origin: origin(),
                known: Facts::TOP,
            }],
            return_type: HirType::NUMBER,
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator,
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
        }
    }

    /// `(a * a) | 0` — the product may be `-0` and nothing can tell, because
    /// the coercion carries nothing back. This is the case that keeps a scan in
    /// integers.
    #[test]
    fn a_coercion_hides_the_sign_of_its_operand() {
        let func = one_block(
            vec![
                op(OpKind::Param(0)),
                op(OpKind::Binary {
                    op: BinOp::Mul,
                    lhs: ValueId(0),
                    rhs: ValueId(0),
                }),
                op(OpKind::Unary {
                    op: UnOp::ToInt32,
                    operand: ValueId(1),
                }),
            ],
            Terminator::Return(Some(ValueId(2))),
        );
        let seen = observed(&func);
        assert!(seen.contains(&ValueId(2)), "the returned value is observed");
        assert!(
            !seen.contains(&ValueId(1)),
            "the product is not: `ToInt32` carries no sign back",
        );
    }

    /// `(1 / (a * a)) | 0` — dividing by a value is how its sign is seen, and
    /// that reaches back through the multiplication to what produced it. The
    /// coercion on the outside is what makes this a test of the *divisor* rule
    /// rather than of the return: with the division's own result unobserved, the
    /// only reason anything here is observed is that it is a denominator.
    #[test]
    fn dividing_by_a_value_observes_it_and_everything_behind_it() {
        let func = one_block(
            vec![
                op(OpKind::Param(0)),
                op(OpKind::Binary {
                    op: BinOp::Mul,
                    lhs: ValueId(0),
                    rhs: ValueId(0),
                }),
                op(OpKind::ConstFloat(1.0)),
                op(OpKind::Binary {
                    op: BinOp::Div,
                    lhs: ValueId(2),
                    rhs: ValueId(1),
                }),
                op(OpKind::Unary {
                    op: UnOp::ToInt32,
                    operand: ValueId(3),
                }),
            ],
            Terminator::Return(Some(ValueId(4))),
        );
        let seen = observed(&func);
        assert!(seen.contains(&ValueId(1)), "the divisor is observed");
        assert!(seen.contains(&ValueId(0)), "and so is what produced it");
        assert!(
            !seen.contains(&ValueId(2)),
            "the numerator is not: the quotient's own sign is hidden by the coercion",
        );
    }
}

#[cfg(test)]
mod rounding_tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, Param, facts::Facts};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    /// `Math.floor(-0)` is `-0`, so a rounding carries its operand's sign and
    /// the operand cannot become an integer. test262 found this as a `+0` where
    /// node said `-0`.
    #[test]
    fn a_rounding_carries_the_sign_of_a_zero() {
        let origin = || {
            Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            })
        };
        let op = |kind| Op {
            kind,
            ty: HirType::NUMBER,
            origin: origin(),
        };
        for rounding in [UnOp::Floor, UnOp::Ceil, UnOp::Trunc, UnOp::Round] {
            let func = Func {
                name: "f".to_owned(),
                params: vec![Param {
                    name: "a".to_owned(),
                    ty: HirType::NUMBER,
                    origin: origin(),
                    known: Facts::TOP,
                }],
                return_type: HirType::NUMBER,
                values: vec![
                    op(OpKind::Param(0)),
                    op(OpKind::Unary {
                        op: UnOp::Neg,
                        operand: ValueId(0),
                    }),
                    op(OpKind::Unary {
                        op: rounding,
                        operand: ValueId(1),
                    }),
                ],
                blocks: vec![Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                    terminator: Terminator::Return(Some(ValueId(2))),
                }],
                origin: origin(),
                exported: true,
                initializes_receiver: false,
            };
            let seen = observed(&func);
            assert!(
                seen.contains(&ValueId(1)),
                "{rounding:?} must carry its operand's zero sign",
            );
        }
    }
}
