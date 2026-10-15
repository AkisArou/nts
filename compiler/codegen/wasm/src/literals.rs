//! String literals a loop reads, each read from a local its function sets
//! once at entry.
//!
//! A literal is an imported global, written where it is used rather than set
//! into a local (`Body::constant`): as short as the `local.get` it replaces.
//! Read by an operation inside a loop, though, a global is loaded again on
//! every iteration, and a `charCodeAt` or `length` of it re-checks what kind
//! of string it is each time, where a local's is checked once:
//! `benchmarks/cases/substrings` ran in 6.4 us from a local against 13.1 us
//! from its global, and `strings` 7.8 against 14.2.
//!
//! A literal that only passes along an edge into a block parameter is not
//! read there: the operations read the parameter, whichever literal it holds.
//! Hoisted, it only held a register across the loop, and `absences`, which
//! picks one of two literals each turn, ran 10% slower for it.

use crate::cfg;
use nts_core::hir::{Func, OpKind, ValueId, operands_of};
use std::collections::BTreeSet;

/// The literals an operation inside a loop of `func` reads, wherever they are
/// defined.
pub(crate) fn hoisted(func: &Func, plan: &cfg::Plan) -> BTreeSet<ValueId> {
    let inside = cfg::loop_blocks(func, plan);
    let mut hoisted = BTreeSet::new();
    for id in &plan.order {
        if !inside[id.0 as usize] {
            continue;
        }
        let read = func.blocks[id.0 as usize]
            .ops
            .iter()
            .flat_map(|op| operands_of(&func.value(*op).kind));
        hoisted
            .extend(read.filter(|value| matches!(func.value(*value).kind, OpKind::ConstString(_))));
    }
    hoisted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_common::{block, function, value};
    use nts_core::hir::{BlockId, Callee, HirType, ManagedType, Terminator};

    fn string() -> HirType {
        HirType::Managed(ManagedType::String)
    }

    /// Two literals defined before a loop: the loop reads `inside`, and
    /// only the code after it reads `after`.
    #[test]
    fn a_literal_a_loop_reads_is_hoisted_and_one_read_after_it_is_not() {
        let mut f = function("looping", &[HirType::Bool], string());
        let more = value(&mut f, OpKind::Param(0), HirType::Bool);
        let inside = value(&mut f, OpKind::ConstString("in".into()), string());
        let after = value(&mut f, OpKind::ConstString("after".into()), string());
        let joined = value(
            &mut f,
            OpKind::Call {
                callee: Callee::External("nts_concat".into()),
                args: vec![inside, inside],
                frame: None,
            },
            string(),
        );
        f.blocks = vec![
            block(
                &[],
                &[more, inside, after],
                Terminator::Jump {
                    target: BlockId(1),
                    args: vec![],
                },
            ),
            block(
                &[],
                &[joined],
                Terminator::Branch {
                    cond: more,
                    then_target: BlockId(1),
                    then_args: vec![],
                    else_target: BlockId(2),
                    else_args: vec![],
                },
            ),
            block(&[], &[], Terminator::Return(Some(after))),
        ];
        let plan = cfg::plan(&f).expect("a structured plan");
        assert_eq!(hoisted(&f, &plan), BTreeSet::from([inside]));
    }

    /// A literal the loop passes into a block parameter, where the operation
    /// reads the parameter: not hoisted.
    #[test]
    fn a_literal_a_loop_only_passes_along_an_edge_is_not_hoisted() {
        let mut f = function("passing", &[HirType::Bool], string());
        let more = value(&mut f, OpKind::Param(0), HirType::Bool);
        let word = value(&mut f, OpKind::ConstString("word".into()), string());
        let held = value(&mut f, OpKind::BlockParam(0), string());
        let joined = value(
            &mut f,
            OpKind::Call {
                callee: Callee::External("nts_concat".into()),
                args: vec![held, held],
                frame: None,
            },
            string(),
        );
        f.blocks = vec![
            block(
                &[],
                &[more, word],
                Terminator::Jump {
                    target: BlockId(1),
                    args: vec![word],
                },
            ),
            block(
                &[held],
                &[joined],
                Terminator::Branch {
                    cond: more,
                    then_target: BlockId(1),
                    then_args: vec![word],
                    else_target: BlockId(2),
                    else_args: vec![],
                },
            ),
            block(&[], &[], Terminator::Return(Some(joined))),
        ];
        let plan = cfg::plan(&f).expect("a structured plan");
        assert!(hoisted(&f, &plan).is_empty());
    }
}
