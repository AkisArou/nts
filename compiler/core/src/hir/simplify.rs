//! Operations whose answer is one of their own operands.
//!
//! # Why this is a pass and not the C compiler's problem
//!
//! Mostly it *is* the C compiler's problem, and clang does remove an `| 0`.
//! This pass exists for what happens before clang sees anything: every one of
//! these operations is a value that reference counting has to place, that
//! liveness has to track, that escape analysis has to follow, and that the SSA
//! verifier has to check. An identity left in the HIR is not free just because
//! it is free in the emitted code.
//!
//! It also makes the dumps readable, which matters more than it sounds. `nts hir
//! --prepared` is how every one of these passes gets debugged, and a listing
//! where a third of the lines are `or %16, 0` hides the two lines that are
//! wrong.
//!
//! # What counts as an identity
//!
//! Only what is exact for every value of the type, which rules out most of the
//! obvious float rules. `x + 0.0` is not `x`: it turns `-0.0` into `+0.0`, and
//! `1 / -0` and `1 / 0` differ, so a fold that quietly loses the sign of zero
//! changes what a program prints. The integer rules have no such corner —
//! two's-complement addition of zero is addition of zero.
//!
//! `x | 0` is the interesting one, because in TypeScript it is not an identity
//! at all: it is `ToInt32(x)`, which is the whole point of writing it. It
//! becomes an identity only *after* specialization has proved `x` is already an
//! `i32` and turned the coercion into a plain bitwise or. So this pass runs
//! after specialization, and would be wrong before it.

use rustc_hash::FxHashMap;

use super::{BinOp, Func, HirType, OpKind, ValueId};

/// Replace operations that return an operand unchanged, and report how many.
pub fn simplify(func: &mut Func) -> usize {
    let mut replacement: FxHashMap<ValueId, ValueId> = FxHashMap::default();

    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        if let Some(same) = identity(func, id) {
            // Chains collapse as they are built, because a value is only ever
            // replaced by one defined before it: `%3 = %2` is already resolved
            // by the time `%4 = %3` is looked at.
            let target = replacement.get(&same).copied().unwrap_or(same);
            replacement.insert(id, target);
        }
    }
    if replacement.is_empty() {
        return 0;
    }

    let of = |value: ValueId| replacement.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        substitute_terminator(&mut block.terminator, of);
    }

    // The replaced operations are now unread. Dead-code elimination is what
    // removes them, which is where removing things belongs.
    replacement.len()
}

/// The operand an operation returns unchanged, if it returns one.
fn identity(func: &Func, value: ValueId) -> Option<ValueId> {
    let op = &func.values[value.0 as usize];
    match &op.kind {
        // A conversion to the type it already has. Specialization inserts these
        // where it does not yet know whether a coercion is needed, and finding
        // out is this pass's job rather than the emitter's.
        OpKind::Convert(operand) if func.values[operand.0 as usize].ty == op.ty => Some(*operand),
        OpKind::Binary { op: bin, lhs, rhs } => {
            let integral = matches!(op.ty, HirType::Int { .. });
            if !integral {
                // Every rule below has a floating-point counterexample, and the
                // counterexample is always the sign of zero.
                return None;
            }
            let left = constant(func, *lhs);
            let right = constant(func, *rhs);
            match bin {
                // Commutative, so either side may be the unit.
                BinOp::Add | BinOp::BitOr | BinOp::BitXor => match (left, right) {
                    (_, Some(0)) => Some(*lhs),
                    (Some(0), _) => Some(*rhs),
                    _ => None,
                },
                BinOp::Mul => match (left, right) {
                    (_, Some(1)) => Some(*lhs),
                    (Some(1), _) => Some(*rhs),
                    _ => None,
                },
                // Not commutative: `0 - x` is not `x`, and neither is `0 >> x`.
                BinOp::Sub | BinOp::Shl | BinOp::Shr | BinOp::UShr => {
                    (right == Some(0)).then_some(*lhs)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

/// A value's integer constant, if it is one.
fn constant(func: &Func, value: ValueId) -> Option<i64> {
    match func.values[value.0 as usize].kind {
        OpKind::ConstInt(literal) => Some(literal),
        _ => None,
    }
}

/// Rewrite every value an operation reads.
///
/// Exhaustive by construction: a new variant with an operand will not compile
/// until it is listed, which is the only way a substitution stays correct as the
/// instruction set grows.
pub fn substitute(kind: &mut OpKind, of: impl Fn(ValueId) -> ValueId) {
    match kind {
        OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ObjectNew { .. } => {}
        OpKind::Binary { lhs, rhs, .. } => {
            *lhs = of(*lhs);
            *rhs = of(*rhs);
        }
        OpKind::Unary { operand, .. } | OpKind::Convert(operand) => *operand = of(*operand),
        OpKind::Call { args, .. } => {
            for arg in args {
                *arg = of(*arg);
            }
        }
        OpKind::Return(value) => {
            if let Some(value) = value {
                *value = of(*value);
            }
        }
        OpKind::Retain(object) | OpKind::Release(object) | OpKind::Length(object) => {
            *object = of(*object);
        }
        OpKind::ArrayNew { length } => *length = of(*length),
        OpKind::FieldGet { object, .. } => *object = of(*object),
        OpKind::FieldSet { object, value, .. } => {
            *object = of(*object);
            *value = of(*value);
        }
        OpKind::ArrayGet { array, index, .. } => {
            *array = of(*array);
            *index = of(*index);
        }
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => {
            *array = of(*array);
            *index = of(*index);
            *value = of(*value);
        }
    }
}

/// Rewrite every value a terminator reads, including the arguments it carries.
pub fn substitute_terminator(terminator: &mut super::Terminator, of: impl Fn(ValueId) -> ValueId) {
    match terminator {
        super::Terminator::Return(Some(value)) => *value = of(*value),
        super::Terminator::Return(None) | super::Terminator::Unreachable => {}
        super::Terminator::Jump { args, .. } => {
            for arg in args {
                *arg = of(*arg);
            }
        }
        super::Terminator::Branch {
            cond,
            then_args,
            else_args,
            ..
        } => {
            *cond = of(*cond);
            for arg in then_args.iter_mut().chain(else_args.iter_mut()) {
                *arg = of(*arg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, Op, Param, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn i32_ty() -> HirType {
        HirType::Int {
            bits: 32,
            signed: true,
        }
    }

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    fn one_block(values: Vec<Op>, ops: Vec<ValueId>, returns: ValueId) -> Func {
        Func {
            name: "f".to_owned(),
            params: vec![Param {
                name: "a".to_owned(),
                ty: i32_ty(),
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
            }],
            return_type: i32_ty(),
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: Terminator::Return(Some(returns)),
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
        }
    }

    /// `(a | 0) + 0` is `a`, twice over, and the chain has to collapse in one
    /// pass or the second identity is left pointing at the first.
    #[test]
    fn a_chain_of_identities_collapses_to_its_source() {
        let mut func = one_block(
            vec![
                op(OpKind::Param(0), i32_ty()),
                op(OpKind::ConstInt(0), i32_ty()),
                op(
                    OpKind::Binary {
                        op: BinOp::BitOr,
                        lhs: ValueId(0),
                        rhs: ValueId(1),
                    },
                    i32_ty(),
                ),
                op(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: ValueId(2),
                        rhs: ValueId(1),
                    },
                    i32_ty(),
                ),
            ],
            vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
            ValueId(3),
        );

        assert_eq!(simplify(&mut func), 2);
        assert_eq!(
            func.blocks[0].terminator,
            Terminator::Return(Some(ValueId(0))),
            "the return should read the parameter, not either identity",
        );
    }

    /// The sign of zero is why none of these rules apply to floats. `-0.0 + 0.0`
    /// is `+0.0`, and `1 / -0` is not `1 / 0`.
    #[test]
    fn adding_zero_to_a_float_is_not_the_identity() {
        let float = HirType::Float { bits: 64 };
        let mut func = one_block(
            vec![
                op(OpKind::Param(0), float.clone()),
                op(OpKind::ConstFloat(0.0), float.clone()),
                op(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: ValueId(0),
                        rhs: ValueId(1),
                    },
                    float,
                ),
            ],
            vec![ValueId(0), ValueId(1), ValueId(2)],
            ValueId(2),
        );
        assert_eq!(simplify(&mut func), 0);
    }

    /// `0 - x` is not `x`, and a rule written for the commutative operators
    /// would say it was.
    #[test]
    fn subtraction_only_cancels_on_the_right() {
        let mut func = one_block(
            vec![
                op(OpKind::Param(0), i32_ty()),
                op(OpKind::ConstInt(0), i32_ty()),
                op(
                    OpKind::Binary {
                        op: BinOp::Sub,
                        lhs: ValueId(1),
                        rhs: ValueId(0),
                    },
                    i32_ty(),
                ),
            ],
            vec![ValueId(0), ValueId(1), ValueId(2)],
            ValueId(2),
        );
        assert_eq!(simplify(&mut func), 0);
    }

    /// A conversion to the type the value already has.
    #[test]
    fn converting_to_the_type_it_already_has_is_nothing() {
        let mut func = one_block(
            vec![
                op(OpKind::Param(0), i32_ty()),
                op(OpKind::Convert(ValueId(0)), i32_ty()),
            ],
            vec![ValueId(0), ValueId(1)],
            ValueId(1),
        );
        assert_eq!(simplify(&mut func), 1);
        assert_eq!(
            func.blocks[0].terminator,
            Terminator::Return(Some(ValueId(0)))
        );
    }
}
