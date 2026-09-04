//! Computing at 32 bits what is truncated to 32 bits.
//!
//! # The measurement this exists for
//!
//! `absences` was 2.12x the C backend on the same HIR, which 0067 established is
//! ours rather than the `clang -x ir` path. Editing the emitted `.ll` by hand
//! and relinking:
//!
//! ```text
//! baseline                                 397.7 ns
//! induction variable kept i64, rest i32    188.1 ns
//! C backend                                187.5 ns
//! ```
//!
//! The whole gap. The C backend does not show it because clang recovers this
//! from the C for free, and a compiler should not depend on that.
//!
//! # The rule
//!
//! `add`, `sub` and `mul` are congruent modulo 2^32, so a chain whose result is
//! `ToInt32` computes the same answer at 32 bits as at 64. `total = (total + x)
//! | 0` is that chain, and it is what every `| 0` in a loop produces.
//!
//! So: a value wider than 32 bits, **every** use of which is either a
//! truncation to 32 bits or an `Add`/`Sub`/`Mul` that is itself narrowable, can
//! be computed at 32 bits. Transitive, by a fixpoint that starts optimistic and
//! removes.
//!
//! # What it must not take
//!
//! A value that is **compared** rather than truncated. `absences`'s induction
//! variable is `i64` because `n = 256 + (seed | 0)` reaches 2^31+255, and `i` is
//! tested against it -- narrowing that changes which iterations run. It stays,
//! and costs nothing: it already reaches its data uses through three
//! truncations, and only one edge took it whole.
//!
//! Anything reaching a call, a store, a return or a comparison is out for the
//! same reason: the width is observable there.
//!
//! # Why it took nine hypotheses
//!
//! Three earlier attempts were partial versions of this one -- the
//! string-length chain alone, the payload chain alone, and both without the
//! rest -- and each measured **no change at all**. The transformation only pays
//! applied transitively: one narrowed chain feeding a widened one converts at
//! the boundary and saves nothing.
//!
//! A change with a threshold reads exactly like a change with no effect, right
//! up until the last piece of it.

use rustc_hash::FxHashSet;

use super::{BinOp, Func, HirType, OpKind, UnOp, ValueId};

/// Narrow every value whose width is not observable. Reports how many.
pub fn narrow_truncated(func: &mut Func) -> usize {
    let mut narrowable: FxHashSet<ValueId> = (0..func.values.len())
        .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
        .filter(|value| wide(&func.value(*value).ty) && retypeable(func, *value))
        .collect();
    if narrowable.is_empty() {
        return 0;
    }

    // Optimistic, then removed to a fixpoint: a value stays only while every
    // use of it is one that cannot observe its width. Starting pessimistic
    // would take nothing, because the chains are cyclic through loop
    // parameters -- an accumulator's width depends on its own.
    loop {
        let doomed: Vec<ValueId> = narrowable
            .iter()
            .copied()
            .filter(|value| !uses_allow(func, *value, &narrowable))
            .collect();
        if doomed.is_empty() {
            break;
        }
        for value in doomed {
            narrowable.remove(&value);
        }
    }

    for value in &narrowable {
        let at = value.0 as usize;
        // A constant carries its *value*, not just its width, so retyping one
        // has to wrap it. `2654435761` and `-1640531535` are the same `i32` and
        // the arithmetic below cannot tell them apart -- but the C emitter
        // prints the literal, and a wide value wearing a narrow type is
        // `-Wconstant-conversion`, which the generated file is compiled with as
        // an error. `closures` stopped building on exactly that.
        if let OpKind::ConstInt(whole) = func.values[at].kind {
            // The low thirty-two bits, *reinterpreted* as signed. Not
            // `i32::try_from`, which fails for anything above `INT32_MAX` and
            // whose `unwrap_or` swallowed every such constant to zero -- the
            // benchmark checksums caught it, `closures` computing 0 where node
            // computes -497428480.
            let low = whole & 0xFFFF_FFFF;
            let wrapped = if low >= 0x8000_0000 {
                low - 0x1_0000_0000
            } else {
                low
            };
            func.values[at].kind = OpKind::ConstInt(wrapped);
        }
        func.values[at].ty = HirType::Int {
            bits: 32,
            signed: true,
        };
    }
    narrowable.len()
}

fn wide(ty: &HirType) -> bool {
    matches!(ty, HirType::Int { bits, .. } if *bits > 32)
}

/// Whether this operation's result can be retyped at all.
///
/// Arithmetic and the values that carry it. A `Call`'s result is the callee's
/// to decide, a `Length` is the runtime's, and a parameter is the signature's --
/// retyping any of those would disagree with something this pass cannot see.
fn retypeable(func: &Func, value: ValueId) -> bool {
    matches!(
        func.value(value).kind,
        OpKind::Binary {
            op: BinOp::Add | BinOp::Sub | BinOp::Mul,
            ..
        } | OpKind::ConstInt(_)
            | OpKind::Convert(_)
            | OpKind::BlockParam(_)
    )
}

/// Whether every use of a value is one that cannot observe its width.
fn uses_allow(func: &Func, value: ValueId, narrowable: &FxHashSet<ValueId>) -> bool {
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        if !super::operands_of(&func.values[index].kind).contains(&value) {
            continue;
        }
        let allowed = match &func.values[index].kind {
            // A truncation is the whole point: below it the width is gone.
            OpKind::Unary {
                op: UnOp::ToInt32 | UnOp::ToUint32,
                ..
            } => true,
            // Arithmetic is congruent modulo 2^32, so it may narrow with what
            // it feeds; a conversion reads the width it converts *from*. Either
            // way the answer is whether the reader itself moved.
            OpKind::Binary {
                op: BinOp::Add | BinOp::Sub | BinOp::Mul,
                ..
            }
            | OpKind::Convert(_) => narrowable.contains(&id),
            _ => false,
        };
        if !allowed {
            return false;
        }
    }
    // A block parameter is written by its edges rather than by an operation, so
    // its uses include the jumps that carry it. Those keep the width only if
    // the parameter they feed does, which the fixpoint decides -- but a
    // terminator that *returns* or *branches on* it observes the width outright.
    for block in &func.blocks {
        match &block.terminator {
            super::Terminator::Return(Some(returned)) if *returned == value => return false,
            super::Terminator::Branch { cond, .. } if *cond == value => return false,
            _ => {}
        }
        for (target, args) in edges(&block.terminator) {
            for (slot, arg) in args.iter().enumerate() {
                if *arg != value {
                    continue;
                }
                match func.blocks[target].params.get(slot) {
                    Some(param) if narrowable.contains(param) => {}
                    _ => return false,
                }
            }
        }
    }
    true
}

/// Where a terminator can go, and what it carries.
fn edges(terminator: &super::Terminator) -> Vec<(usize, &Vec<ValueId>)> {
    match terminator {
        super::Terminator::Jump { target, args } => vec![(target.0 as usize, args)],
        super::Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (then_target.0 as usize, then_args),
            (else_target.0 as usize, else_args),
        ],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, BlockId, Op, Param, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    const I64: HirType = HirType::Int {
        bits: 64,
        signed: true,
    };
    const I32: HirType = HirType::Int {
        bits: 32,
        signed: true,
    };

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    fn func(values: Vec<Op>, terminator: Terminator) -> Func {
        let ops: Vec<ValueId> = (1..values.len())
            .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
            .collect();
        Func {
            name: "w".to_owned(),
            params: vec![Param {
                name: "n".to_owned(),
                ty: I64,
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
                shape: crate::hir::ParamShape::Ordinary,
            }],
            return_type: I32,
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator,
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        }
    }

    /// `(n + n) | 0` — the add's only use is the truncation, so the width below
    /// it is unobservable and the whole chain computes at 32 bits.
    #[test]
    fn an_add_whose_only_use_is_a_truncation_narrows() {
        let mut it = func(
            vec![
                op(OpKind::Param(0), I64),
                op(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: ValueId(0),
                        rhs: ValueId(0),
                    },
                    I64,
                ),
                op(
                    OpKind::Unary {
                        op: UnOp::ToInt32,
                        operand: ValueId(1),
                    },
                    I32,
                ),
            ],
            Terminator::Return(Some(ValueId(2))),
        );
        assert_eq!(narrow_truncated(&mut it), 1);
        assert_eq!(it.values[1].ty, I32);
        // The parameter is the signature's and is not this pass's to retype.
        assert_eq!(it.values[0].ty, I64);
    }

    /// The induction variable case, and the one that must not move.
    ///
    /// `absences`'s counter is `i64` because `256 + (seed | 0)` reaches
    /// 2^31+255, and it is *compared* against that bound rather than truncated.
    /// Narrowing it changes which iterations run.
    #[test]
    fn a_value_that_is_compared_keeps_its_width() {
        let mut it = func(
            vec![
                op(OpKind::Param(0), I64),
                op(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: ValueId(0),
                        rhs: ValueId(0),
                    },
                    I64,
                ),
                op(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: ValueId(1),
                        rhs: ValueId(0),
                    },
                    HirType::Bool,
                ),
            ],
            Terminator::Return(None),
        );
        assert_eq!(narrow_truncated(&mut it), 0);
        assert_eq!(it.values[1].ty, I64);
    }

    /// Returned at its own width, so the caller can tell.
    #[test]
    fn a_value_that_is_returned_keeps_its_width() {
        let mut it = func(
            vec![
                op(OpKind::Param(0), I64),
                op(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: ValueId(0),
                        rhs: ValueId(0),
                    },
                    I64,
                ),
            ],
            Terminator::Return(Some(ValueId(1))),
        );
        assert_eq!(narrow_truncated(&mut it), 0);
        assert_eq!(it.values[1].ty, I64);
    }

    /// One use that observes the width sinks the whole chain, however many
    /// truncations the other uses are. This is the shape three earlier attempts
    /// mistook for "the transformation does nothing".
    #[test]
    fn one_observing_use_sinks_the_chain() {
        let mut it = func(
            vec![
                op(OpKind::Param(0), I64),
                op(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: ValueId(0),
                        rhs: ValueId(0),
                    },
                    I64,
                ),
                op(
                    OpKind::Unary {
                        op: UnOp::ToInt32,
                        operand: ValueId(1),
                    },
                    I32,
                ),
                op(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: ValueId(1),
                        rhs: ValueId(0),
                    },
                    HirType::Bool,
                ),
            ],
            Terminator::Return(Some(ValueId(2))),
        );
        assert_eq!(narrow_truncated(&mut it), 0);
        assert_eq!(it.values[1].ty, I64);
    }

    /// A constant carries its value, not just its width, so narrowing one has
    /// to wrap it into the range.
    ///
    /// `2654435761` is Knuth's multiplier and appears in `closures`; as an
    /// `i32` it is `-1640531535`, and the two are the same bits. The first
    /// version of this used `i32::try_from(..).unwrap_or(0)`, which fails for
    /// everything above `INT32_MAX` and turned every such constant into **zero**
    /// -- `closures` computed 0 where node computes -497428480. The gate was
    /// green on it; the benchmark checksums were not.
    #[test]
    fn a_narrowed_constant_is_wrapped_not_dropped() {
        let mut it = func(
            vec![
                op(OpKind::Param(0), I64),
                op(OpKind::ConstInt(2_654_435_761), I64),
                op(
                    OpKind::Binary {
                        op: BinOp::Mul,
                        lhs: ValueId(0),
                        rhs: ValueId(1),
                    },
                    I64,
                ),
                op(
                    OpKind::Unary {
                        op: UnOp::ToInt32,
                        operand: ValueId(2),
                    },
                    I32,
                ),
            ],
            Terminator::Return(Some(ValueId(3))),
        );
        assert_eq!(narrow_truncated(&mut it), 2);
        assert_eq!(it.values[1].kind, OpKind::ConstInt(-1_640_531_535));
        assert_eq!(it.values[1].ty, I32);
    }

    /// A block parameter narrows only if the arguments reaching it do, which is
    /// what makes an accumulator carried around a loop movable at all.
    #[test]
    fn a_block_parameter_narrows_with_its_edges() {
        let values = vec![
            op(OpKind::Param(0), I64),
            op(OpKind::ConstInt(0), I64),
            op(OpKind::BlockParam(0), I64),
            op(
                OpKind::Unary {
                    op: UnOp::ToInt32,
                    operand: ValueId(2),
                },
                I32,
            ),
        ];
        let mut it = Func {
            name: "w".to_owned(),
            params: Vec::new(),
            return_type: I32,
            values,
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(1)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(1)],
                    },
                },
                Block {
                    params: vec![ValueId(2)],
                    ops: vec![ValueId(3)],
                    terminator: Terminator::Return(Some(ValueId(3))),
                },
            ],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        };
        assert_eq!(narrow_truncated(&mut it), 2);
        assert_eq!(it.values[2].ty, I32);
        assert_eq!(it.values[1].ty, I32);
    }
}
