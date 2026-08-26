//! Structural verification of HIR.
//!
//! # Why this exists
//!
//! Invalid SSA does not crash. It compiles, runs, and reads whatever happened to
//! be in a register — and the first version of loop lowering in this compiler
//! produced exactly that: after `while (i < n) { total = total + i; }` the
//! `return total` used the value the *body* defined rather than the header
//! parameter, so the exit block used a value it does not dominate. It was caught
//! by reading the printed IR, which is not a method that scales.
//!
//! Every check here is cheap and runs over the whole program. A backend that
//! trusts its input is entitled to; something has to earn that trust first.

use rustc_hash::FxHashSet;

use super::{Block, BlockId, Func, OpKind, Program, Terminator, ValueId};

/// A way the IR was malformed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    /// A branch names a block that does not exist.
    DanglingSuccessor { func: String, target: BlockId },
    /// A jump passed a different number of arguments than the target takes.
    ///
    /// The arguments *are* the edge's contribution to the target's parameters, so
    /// a mismatch means some parameter has no value on that path.
    ArgumentCount {
        func: String,
        target: BlockId,
        expected: usize,
        found: usize,
    },
    /// A value was used somewhere its definition does not reach.
    ///
    /// The failure this module exists for. Perfectly plausible-looking IR.
    NotDominated {
        func: String,
        value: ValueId,
        used_in: BlockId,
    },
    /// The entry block declares parameters.
    ///
    /// Parameters are supplied by predecessors, and the entry has none — a
    /// function's own arguments are `OpKind::Param`, not block parameters.
    EntryHasParams { func: String },
    /// A block cannot be reached from the entry.
    Unreachable { func: String, block: BlockId },
}

/// Check a whole program.
///
/// # Errors
///
/// Returns every problem found rather than the first, so one run reports the
/// whole picture.
pub fn verify(program: &Program) -> Result<(), Vec<Invalid>> {
    let mut problems = Vec::new();
    for func in &program.funcs {
        verify_func(func, &mut problems);
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}

fn verify_func(func: &Func, problems: &mut Vec<Invalid>) {
    if !func.blocks.is_empty() && !func.entry().params.is_empty() {
        problems.push(Invalid::EntryHasParams {
            func: func.name.clone(),
        });
    }

    // Edges first: dominance is meaningless over a graph with dangling successors.
    let mut edges_sound = true;
    for block in &func.blocks {
        for target in block.terminator.successors() {
            if (target.0 as usize) >= func.blocks.len() {
                problems.push(Invalid::DanglingSuccessor {
                    func: func.name.clone(),
                    target,
                });
                edges_sound = false;
            }
        }
        if edges_sound {
            check_arguments(func, block, problems);
        }
    }
    if !edges_sound {
        return;
    }

    let reachable = reachable_blocks(func);
    for index in 0..func.blocks.len() {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        if !reachable.contains(&id) {
            problems.push(Invalid::Unreachable {
                func: func.name.clone(),
                block: id,
            });
        }
    }

    check_dominance(func, &reachable, problems);
}

/// Every jump must supply exactly the parameters its target declares.
fn check_arguments(func: &Func, block: &Block, problems: &mut Vec<Invalid>) {
    let mut check = |target: BlockId, args: &[ValueId]| {
        let expected = func.blocks[target.0 as usize].params.len();
        if args.len() != expected {
            problems.push(Invalid::ArgumentCount {
                func: func.name.clone(),
                target,
                expected,
                found: args.len(),
            });
        }
    };

    match &block.terminator {
        Terminator::Jump { target, args } => check(*target, args),
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => {
            check(*then_target, then_args);
            check(*else_target, else_args);
        }
        Terminator::Return(_) | Terminator::Unreachable => {}
    }
}

fn reachable_blocks(func: &Func) -> FxHashSet<BlockId> {
    let mut seen = FxHashSet::default();
    let mut worklist = vec![BlockId(0)];
    while let Some(block) = worklist.pop() {
        if !seen.insert(block) {
            continue;
        }
        worklist.extend(func.blocks[block.0 as usize].terminator.successors());
    }
    seen
}

/// Immediate dominators, by the iterative algorithm.
///
/// `idom[i]` is the immediate dominator of block `i`, or `None` for the entry and
/// for unreachable blocks.
fn dominators(func: &Func, reachable: &FxHashSet<BlockId>) -> Vec<Option<BlockId>> {
    let count = func.blocks.len();
    let mut predecessors: Vec<Vec<BlockId>> = vec![Vec::new(); count];
    for (index, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        for target in block.terminator.successors() {
            predecessors[target.0 as usize].push(from);
        }
    }

    // Reverse postorder makes the fixpoint converge in few passes: a block is
    // visited after the predecessors that can reach it, except across back edges.
    let order = reverse_postorder(func);
    let mut position = vec![usize::MAX; count];
    for (rank, block) in order.iter().enumerate() {
        position[block.0 as usize] = rank;
    }

    let mut idom: Vec<Option<BlockId>> = vec![None; count];
    idom[0] = Some(BlockId(0));
    let mut changed = true;
    while changed {
        changed = false;
        for &block in order.iter().skip(1) {
            let mut new_idom = None;
            for &pred in &predecessors[block.0 as usize] {
                if idom[pred.0 as usize].is_none() {
                    continue;
                }
                new_idom = Some(match new_idom {
                    None => pred,
                    Some(current) => intersect(pred, current, &idom, &position),
                });
            }
            if new_idom.is_some() && idom[block.0 as usize] != new_idom {
                idom[block.0 as usize] = new_idom;
                changed = true;
            }
        }
    }

    idom[0] = None;
    for (index, entry) in idom.iter_mut().enumerate() {
        if !reachable.contains(&BlockId(u32::try_from(index).unwrap_or(u32::MAX))) {
            *entry = None;
        }
    }
    idom
}

fn intersect(
    mut a: BlockId,
    mut b: BlockId,
    idom: &[Option<BlockId>],
    position: &[usize],
) -> BlockId {
    while a != b {
        while position[a.0 as usize] > position[b.0 as usize] {
            match idom[a.0 as usize] {
                Some(next) if next != a => a = next,
                _ => return b,
            }
        }
        while position[b.0 as usize] > position[a.0 as usize] {
            match idom[b.0 as usize] {
                Some(next) if next != b => b = next,
                _ => return a,
            }
        }
    }
    a
}

fn reverse_postorder(func: &Func) -> Vec<BlockId> {
    let mut order = Vec::new();
    let mut seen = FxHashSet::default();
    postorder(func, BlockId(0), &mut seen, &mut order);
    order.reverse();
    order
}

fn postorder(func: &Func, block: BlockId, seen: &mut FxHashSet<BlockId>, order: &mut Vec<BlockId>) {
    if !seen.insert(block) {
        return;
    }
    for target in func.blocks[block.0 as usize].terminator.successors() {
        postorder(func, target, seen, order);
    }
    order.push(block);
}

/// Every use of a value must be dominated by its definition.
fn check_dominance(func: &Func, reachable: &FxHashSet<BlockId>, problems: &mut Vec<Invalid>) {
    let idom = dominators(func, reachable);

    // Which block defines each value.
    let mut defined_in = vec![None; func.values.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        for value in block.params.iter().chain(&block.ops) {
            defined_in[value.0 as usize] = Some(id);
        }
    }

    let dominates = |definer: BlockId, user: BlockId| {
        let mut current = Some(user);
        while let Some(block) = current {
            if block == definer {
                return true;
            }
            current = idom[block.0 as usize];
        }
        false
    };

    let report = |value: ValueId, used_in: BlockId, problems: &mut Vec<Invalid>| {
        let Some(definer) = defined_in[value.0 as usize] else {
            return;
        };
        if !dominates(definer, used_in) {
            problems.push(Invalid::NotDominated {
                func: func.name.clone(),
                value,
                used_in,
            });
        }
    };

    for (index, block) in func.blocks.iter().enumerate() {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        if !reachable.contains(&id) {
            continue;
        }

        for value in &block.ops {
            for operand in operands(&func.values[value.0 as usize].kind) {
                report(operand, id, problems);
            }
        }

        // A terminator's operands are used in *this* block, including the
        // arguments it passes onward — they are evaluated here, not there.
        for operand in terminator_operands(&block.terminator) {
            report(operand, id, problems);
        }
    }
}

pub(crate) fn operands(kind: &OpKind) -> Vec<ValueId> {
    match kind {
        OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ObjectNew => Vec::new(),
        OpKind::Binary { lhs, rhs, .. } => vec![*lhs, *rhs],
        OpKind::Unary { operand, .. } | OpKind::Convert(operand) => vec![*operand],
        OpKind::Call { args, .. } => args.clone(),
        OpKind::ArrayNew { length } => vec![*length],
        OpKind::Length(array) | OpKind::Retain(array) | OpKind::Release(array) => {
            vec![*array]
        }
        OpKind::FieldGet { object, .. } => vec![*object],
        OpKind::FieldSet { object, value, .. } => vec![*object, *value],
        OpKind::ArrayGet { array, index, .. } => vec![*array, *index],
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => vec![*array, *index, *value],
        OpKind::Return(value) => value.iter().copied().collect(),
    }
}

pub(crate) fn terminator_operands(terminator: &Terminator) -> Vec<ValueId> {
    match terminator {
        Terminator::Return(value) => value.iter().copied().collect(),
        Terminator::Jump { args, .. } => args.clone(),
        Terminator::Branch {
            cond,
            then_args,
            else_args,
            ..
        } => {
            let mut all = vec![*cond];
            all.extend(then_args);
            all.extend(else_args);
            all
        }
        Terminator::Unreachable => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{HirType, Op, Param};
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
            ty: HirType::Float { bits: 64 },
            origin: origin(),
        }
    }

    fn block(params: Vec<ValueId>, ops: Vec<ValueId>, terminator: Terminator) -> Block {
        Block {
            params,
            ops,
            terminator,
        }
    }

    fn func(values: Vec<Op>, blocks: Vec<Block>) -> Program {
        Program {
            layouts: Vec::new(),
            funcs: vec![Func {
                name: "f".to_owned(),
                params: Vec::<Param>::new(),
                return_type: HirType::Float { bits: 64 },
                values,
                blocks,
                origin: origin(),
                exported: true,
                initializes_receiver: false,
            }],
        }
    }

    /// `f() { b0: %0 = param 0; ret %0 }`
    fn valid() -> Program {
        func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Return(Some(ValueId(0))),
            )],
        )
    }

    #[test]
    fn a_well_formed_function_verifies() {
        assert!(verify(&valid()).is_ok());
    }

    #[test]
    fn a_value_used_where_its_definition_does_not_reach_is_caught() {
        // The exact shape loop lowering produced before it was fixed: b2 defines
        // %1, b1 branches to b2 or b3, and b3 returns %1 — which it does not
        // dominate. Nothing about this looks wrong until dominance is computed.
        let program = func(
            vec![op(OpKind::ConstBool(true)), op(OpKind::ConstFloat(1.0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Branch {
                        cond: ValueId(0),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(1)],
                    Terminator::Jump {
                        target: BlockId(2),
                        args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(1)))),
            ],
        );

        let problems = verify(&program).expect_err("b2 does not dominate b3");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::NotDominated { .. })),
            "{problems:?}",
        );
    }

    #[test]
    fn a_value_flowing_through_a_block_parameter_is_accepted() {
        // The same shape done correctly: b1 passes its value along the edge, and
        // b2 receives it as a parameter. This must verify, or the check would
        // reject every loop.
        let program = func(
            vec![
                op(OpKind::ConstBool(true)),
                op(OpKind::ConstFloat(1.0)),
                op(OpKind::ConstFloat(2.0)),
                op(OpKind::BlockParam(0)),
            ],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(2)],
                    Terminator::Branch {
                        cond: ValueId(0),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: vec![ValueId(2)],
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(1)],
                    Terminator::Jump {
                        target: BlockId(2),
                        args: vec![ValueId(1)],
                    },
                ),
                block(
                    vec![ValueId(3)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(3))),
                ),
            ],
        );
        assert_eq!(verify(&program), Ok(()));
    }

    #[test]
    fn a_dangling_successor_is_caught() {
        let program = func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Jump {
                    target: BlockId(9),
                    args: Vec::new(),
                },
            )],
        );
        let problems = verify(&program).expect_err("b9 does not exist");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::DanglingSuccessor { .. })),
        );
    }

    #[test]
    fn an_edge_supplying_the_wrong_number_of_arguments_is_caught() {
        // The arguments *are* the edge's contribution to the target's parameters,
        // so a mismatch leaves a parameter with no value on that path.
        let program = func(
            vec![op(OpKind::ConstFloat(1.0)), op(OpKind::BlockParam(0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                ),
                block(
                    vec![ValueId(1)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(1))),
                ),
            ],
        );
        let problems = verify(&program).expect_err("b1 takes one parameter");
        assert!(problems.iter().any(|p| matches!(
            p,
            Invalid::ArgumentCount {
                expected: 1,
                found: 0,
                ..
            }
        )));
    }

    #[test]
    fn parameters_on_the_entry_block_are_caught() {
        // Nothing can supply them: the entry has no predecessors. A function's own
        // arguments are `Param`, not block parameters.
        let program = func(
            vec![op(OpKind::BlockParam(0))],
            vec![block(
                vec![ValueId(0)],
                Vec::new(),
                Terminator::Return(Some(ValueId(0))),
            )],
        );
        let problems = verify(&program).expect_err("the entry cannot take parameters");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::EntryHasParams { .. })),
        );
    }

    #[test]
    fn an_unreachable_block_is_caught() {
        let program = func(
            vec![op(OpKind::Param(0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Return(Some(ValueId(0))),
                ),
                block(Vec::new(), Vec::new(), Terminator::Unreachable),
            ],
        );
        let problems = verify(&program).expect_err("b1 has no predecessor");
        assert!(
            problems
                .iter()
                .any(|p| matches!(p, Invalid::Unreachable { .. })),
        );
    }
}
