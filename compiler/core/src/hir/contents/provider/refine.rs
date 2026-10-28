//! A use's nearest conditional, through a bounded chain of unique jumps.
//! Stop at a merge, unknown predicate or cycle. No new alias/dominator pass.

use super::{Budget, Facts, Func, HirType, OpKind, Tags, Terminator, ValueFact, ValueId};
use crate::hir::{BinOp, BlockId, UnOp};

#[derive(Clone, Copy, Default)]
enum Incoming {
    #[default]
    None,
    One {
        from: BlockId,
        test: Option<(ValueId, bool)>,
    },
    Many,
}

pub(super) struct Contexts {
    owner: Vec<Option<BlockId>>,
    incoming: Vec<Incoming>,
}

impl Contexts {
    pub(super) fn new(func: &Func, budget: &mut Budget) -> Result<Self, ()> {
        budget.charge(func.values.len() + func.blocks.len())?;
        let mut owner = vec![None; func.values.len()];
        let mut incoming = vec![Incoming::None; func.blocks.len()];
        for (index, block) in func.blocks.iter().enumerate() {
            let from = BlockId(u32::try_from(index).expect("bounded content blocks"));
            budget.charge(block.params.len() + block.ops.len())?;
            for id in block.params.iter().chain(&block.ops) {
                owner[id.0 as usize] = Some(from);
            }
            let mut edge = |target: BlockId, test| {
                budget.charge(1)?;
                let slot = &mut incoming[target.0 as usize];
                *slot = match slot {
                    Incoming::None => Incoming::One { from, test },
                    _ => Incoming::Many,
                };
                Ok::<(), ()>(())
            };
            match &block.terminator {
                Terminator::Jump { target, .. } => edge(*target, None)?,
                Terminator::Branch {
                    cond,
                    then_target,
                    else_target,
                    ..
                } => {
                    edge(*then_target, Some((*cond, true)))?;
                    edge(*else_target, Some((*cond, false)))?;
                }
                _ => {}
            }
        }
        Ok(Self { owner, incoming })
    }

    pub(super) fn at(
        &self,
        func: &Func,
        use_id: ValueId,
        value: ValueId,
        fact: ValueFact,
        budget: &mut Budget,
    ) -> Result<ValueFact, ()> {
        let ValueFact::Known { tags, numbers } = fact else {
            return Ok(fact);
        };
        let Some(mut block) = self.owner[use_id.0 as usize] else {
            return Ok(fact);
        };
        let mut seen = Vec::new();
        for _ in 0..8 {
            budget.charge(1)?;
            if seen.contains(&block) {
                return Ok(fact);
            }
            seen.push(block);
            match self.incoming[block.0 as usize] {
                Incoming::One { from, test: None } => block = from,
                Incoming::One {
                    test: Some(test), ..
                } => {
                    let Some(tags) = tested(func, value, tags, test, budget)? else {
                        return Ok(fact);
                    };
                    return Ok(ValueFact::Known {
                        tags,
                        numbers: if tags.contains(Tags::NUMBER) {
                            numbers
                        } else {
                            Facts::BOTTOM
                        },
                    });
                }
                _ => return Ok(fact),
            }
        }
        Ok(fact)
    }
}

fn tested(
    func: &Func,
    value: ValueId,
    mut allowed: Tags,
    test: (ValueId, bool),
    budget: &mut Budget,
) -> Result<Option<Tags>, ()> {
    let mut pending = vec![test];
    let mut seen = Vec::new();
    while let Some((condition, truth)) = pending.pop() {
        budget.charge(1)?;
        if seen.len() >= 16 || seen.contains(&condition) {
            return Ok(None);
        }
        seen.push(condition);
        match func.value(condition).kind {
            OpKind::Unary {
                op: UnOp::Not,
                operand,
            } => pending.push((operand, !truth)),
            OpKind::Binary { op, lhs, rhs }
                if (op == BinOp::BitOr && !truth) || (op == BinOp::BitAnd && truth) =>
            {
                if func.value(lhs).ty != HirType::Bool || func.value(rhs).ty != HirType::Bool {
                    return Ok(None);
                }
                budget.charge(2)?;
                pending.extend([(lhs, truth), (rhs, truth)]);
            }
            OpKind::Binary {
                op: op @ (BinOp::Eq | BinOp::Ne),
                lhs,
                rhs,
            } => {
                let Some(tag) =
                    compared(func, value, lhs, rhs).or_else(|| compared(func, value, rhs, lhs))
                else {
                    return Ok(None);
                };
                allowed = if truth == (op == BinOp::Eq) {
                    allowed.intersect(tag)
                } else {
                    allowed.without(tag)
                };
            }
            _ => return Ok(None),
        }
    }
    Ok(Some(allowed))
}

fn compared(func: &Func, value: ValueId, lhs: ValueId, rhs: ValueId) -> Option<Tags> {
    if !matches!(func.value(lhs).kind, OpKind::TagOf { value: tested } if tested == value) {
        return None;
    }
    let OpKind::ConstInt(tag) = func.value(rhs).kind else {
        return None;
    };
    Tags::from_runtime(u32::try_from(tag).ok()?)
}
