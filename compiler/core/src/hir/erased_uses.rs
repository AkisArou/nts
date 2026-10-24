//! How the uses of an erased answer take it.
//!
//! A backend whose erased value is a box -- Wasm's `i31` or tagged struct,
//! the JVM's `NtsValue` -- builds one for nothing where every use of a
//! call's erased answer reads it straight back out: as the scalar it holds,
//! by its tag, or by its truthiness. `(counts[w] || 0) + 1` on a
//! `Record<string, number>` is the idiom: a box built per lookup for a
//! truthiness test and an unerase. Which of those reads a backend can answer
//! without the box is its own -- Wasm answers all three from the entry a
//! lookup found; the JVM's fusion, only an unerase to a float -- so this
//! says what the uses are, and each backend decides.
//!
//! One answer here because "every use reads it as X" is the same walk in
//! every backend, and two copies of it would come to disagree about which
//! op reads a value, in whichever direction was not tested. Its readers:
//! Wasm's `collections::typed_gets` (a table `get` answered by its entry)
//! and `collections::typed_reads` (a cursor's key or value kept as stored),
//! and so does the JVM's `fuse::fused` (an answer every use unerases to a
//! float, sent to its scalar form).
//!
//! A use as a block argument -- a value carried into a join, as `x || "none"`
//! carries its left side -- counts as needing the erased value, as every
//! terminator operand does: the join's parameter is erased, so the box has
//! to exist. Relaxing that for a backend that could carry the scalar instead
//! is a decision to make deliberately, not a default to drift into.

use std::collections::{BTreeMap, BTreeSet};

use super::{Func, HirType, OpKind, UnOp, ValueId, operands_of, operands_of_terminator};

/// What the live uses of one value ask of it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ErasedUses {
    /// The types its `Unerase`s read it as, each once.
    pub unerased_to: Vec<HirType>,
    /// Whether a `TagOf` reads it.
    pub tag: bool,
    /// Whether a truthiness test reads it: `Truthy` or `Not`, or a
    /// conversion to `bool`.
    pub truthiness: bool,
    /// Whether anything else reads it -- another op, or a terminator -- and so
    /// needs the erased value itself.
    pub erased: bool,
}

impl ErasedUses {
    /// Whether every use, if any, unerases it as `ty`, and nothing reads its
    /// tag, its truthiness or the erased value itself.
    #[must_use]
    pub fn only_unerased_to(&self, ty: &HirType) -> bool {
        !self.erased && !self.tag && !self.truthiness && self.unerased_to.iter().all(|t| t == ty)
    }
}

/// The uses of each of `values` in `func`'s live ops and terminators.
///
/// One walk however many values are asked about: a backend asks about every
/// candidate call in a function at once, and a walk per value would be
/// quadratic in a function made of lookups. A value nothing reads answers the
/// default: no uses at all.
#[must_use]
pub fn erased_uses(func: &Func, values: &BTreeSet<ValueId>) -> BTreeMap<ValueId, ErasedUses> {
    let mut uses: BTreeMap<ValueId, ErasedUses> = values
        .iter()
        .map(|&value| (value, ErasedUses::default()))
        .collect();
    if uses.is_empty() {
        return uses;
    }
    for block in &func.blocks {
        for &id in &block.ops {
            let op = func.value(id);
            for operand in operands_of(&op.kind) {
                let Some(found) = uses.get_mut(&operand) else {
                    continue;
                };
                match &op.kind {
                    OpKind::Unerase { .. } => {
                        if !found.unerased_to.contains(&op.ty) {
                            found.unerased_to.push(op.ty.clone());
                        }
                    }
                    OpKind::TagOf { .. } => found.tag = true,
                    OpKind::Unary {
                        op: UnOp::Truthy | UnOp::Not,
                        ..
                    } => found.truthiness = true,
                    OpKind::Convert(_) if op.ty == HirType::Bool => found.truthiness = true,
                    _ => found.erased = true,
                }
            }
        }
        for operand in operands_of_terminator(&block.terminator) {
            if let Some(found) = uses.get_mut(&operand) {
                found.erased = true;
            }
        }
    }
    uses
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::collections::BTreeSet;

    use super::{ErasedUses, erased_uses};
    use crate::hir::{BinOp, Block, BlockId, Func, HirType, Op, OpKind, Terminator, UnOp, ValueId};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    const F64: HirType = HirType::Float { bits: 64 };

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    /// One block: an erased parameter, then `uses` of it, ending in `end`.
    /// `dead` ops are values no block holds.
    fn func(uses: &[(OpKind, HirType)], dead: &[(OpKind, HirType)], end: Terminator) -> Func {
        let mut values = vec![Op {
            kind: OpKind::Param(0),
            ty: HirType::Erased,
            origin: origin(),
        }];
        let mut ops = vec![ValueId(0)];
        for (kind, ty) in uses {
            ops.push(ValueId(u32::try_from(values.len()).unwrap()));
            values.push(Op {
                kind: kind.clone(),
                ty: ty.clone(),
                origin: origin(),
            });
        }
        for (kind, ty) in dead {
            values.push(Op {
                kind: kind.clone(),
                ty: ty.clone(),
                origin: origin(),
            });
        }
        Func {
            name: "f".to_owned(),
            params: Vec::new(),
            return_type: HirType::Void,
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            written_return_elements: Vec::new(),
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: end,
            }],
            origin: origin(),
            exported: false,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
        }
    }

    fn of_param(func: &Func) -> ErasedUses {
        erased_uses(func, &BTreeSet::from([ValueId(0)]))
            .remove(&ValueId(0))
            .unwrap()
    }

    const V: ValueId = ValueId(0);

    #[test]
    fn the_reads_back_out_are_named_and_need_no_erased_value() {
        let uses = of_param(&func(
            &[
                (OpKind::unerase(V), F64),
                (OpKind::unerase(V), F64),
                (
                    OpKind::TagOf { value: V },
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                ),
                (
                    OpKind::Unary {
                        op: UnOp::Truthy,
                        operand: V,
                    },
                    HirType::Bool,
                ),
                (
                    OpKind::Unary {
                        op: UnOp::Not,
                        operand: V,
                    },
                    HirType::Bool,
                ),
                (OpKind::Convert(V), HirType::Bool),
            ],
            &[],
            Terminator::Return(None),
        ));
        assert_eq!(
            uses,
            ErasedUses {
                unerased_to: vec![F64],
                tag: true,
                truthiness: true,
                erased: false,
            }
        );
        assert!(!uses.only_unerased_to(&F64));
    }

    #[test]
    fn only_unerases_is_asked_of_every_use() {
        let uses = of_param(&func(
            &[(OpKind::unerase(V), F64)],
            &[],
            Terminator::Return(None),
        ));
        assert!(uses.only_unerased_to(&F64));
        assert!(!uses.only_unerased_to(&HirType::Bool));
        assert!(ErasedUses::default().only_unerased_to(&F64));
    }

    #[test]
    fn any_other_read_or_a_terminator_needs_the_erased_value() {
        let other = [
            (
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: V,
                    rhs: V,
                },
                HirType::Erased,
            ),
            (
                OpKind::Unary {
                    op: UnOp::Neg,
                    operand: V,
                },
                F64,
            ),
            (OpKind::Convert(V), F64),
        ];
        for (kind, ty) in other {
            let uses = of_param(&func(&[(kind, ty)], &[], Terminator::Return(None)));
            assert!(uses.erased, "{uses:?}");
        }
        let returned = of_param(&func(&[], &[], Terminator::Return(Some(V))));
        assert!(returned.erased);
    }

    /// The arm a backend is likeliest to want relaxed, kept explicit: a value
    /// carried into a join is a use of the erased value itself.
    #[test]
    fn a_block_argument_is_an_erased_use() {
        let jumped = of_param(&func(
            &[(OpKind::unerase(V), F64)],
            &[],
            Terminator::Jump {
                target: BlockId(0),
                args: vec![V],
            },
        ));
        assert!(jumped.erased, "{jumped:?}");
        assert!(!jumped.only_unerased_to(&F64));
        let branched = of_param(&func(
            &[(
                OpKind::Unary {
                    op: UnOp::Truthy,
                    operand: V,
                },
                HirType::Bool,
            )],
            &[],
            Terminator::Branch {
                cond: ValueId(1),
                then_target: BlockId(0),
                then_args: vec![V],
                else_target: BlockId(0),
                else_args: Vec::new(),
            },
        ));
        assert!(branched.erased, "{branched:?}");
        assert!(branched.truthiness);
    }

    #[test]
    fn a_dead_op_is_no_use() {
        let uses = of_param(&func(
            &[],
            &[(
                OpKind::Binary {
                    op: BinOp::Add,
                    lhs: V,
                    rhs: V,
                },
                HirType::Erased,
            )],
            Terminator::Return(None),
        ));
        assert_eq!(uses, ErasedUses::default());
    }
}
