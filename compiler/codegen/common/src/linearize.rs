//! Choosing the order blocks are emitted in.
//!
//! Every textual backend emits blocks one after another, so a jump to the block
//! that happens to come next costs nothing while a jump anywhere else costs a
//! branch. Reverse postorder places a block before the blocks it reaches, which
//! turns most forward edges into fallthrough and puts loop bodies immediately
//! after their headers.
//!
//! Decided here rather than per backend, so C and JVM cannot disagree about it —
//! and so LLVM, which needs the order but not the SSA destruction, can take this
//! and stop.

use nts_core::hir::{BlockId, Func};
use rustc_hash::FxHashSet;

/// Blocks in emission order. The entry is always first.
///
/// Unreachable blocks are omitted: nothing can jump to them, so emitting them
/// costs bytes for code that cannot run.
#[must_use]
pub fn block_order(func: &Func) -> Vec<BlockId> {
    let mut order = Vec::with_capacity(func.blocks.len());
    let mut seen = FxHashSet::default();
    visit(func, BlockId(0), &mut seen, &mut order);
    order.reverse();
    order
}

fn visit(func: &Func, block: BlockId, seen: &mut FxHashSet<BlockId>, order: &mut Vec<BlockId>) {
    if !seen.insert(block) {
        return;
    }
    // Successors in reverse, so that after the final reversal the first successor
    // comes first — which is the one a branch falls through to.
    let successors = func.blocks[block.0 as usize].terminator.successors();
    for target in successors.into_iter().rev() {
        visit(func, target, seen, order);
    }
    order.push(block);
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use nts_core::hir::{Block, HirType, Op, OpKind, Param, Terminator, ValueId};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn func(blocks: Vec<Block>) -> Func {
        Func {
            name: "f".to_owned(),
            params: Vec::<Param>::new(),
            return_type: HirType::Void,
            values: vec![Op {
                kind: OpKind::ConstBool(true),
                ty: HirType::Bool,
                origin: origin(),
            }],
            blocks,
            origin: origin(),
            exported: false,
        }
    }

    fn plain(terminator: Terminator) -> Block {
        Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator,
        }
    }

    #[test]
    fn the_entry_comes_first() {
        let order = block_order(&func(vec![plain(Terminator::Return(None))]));
        assert_eq!(order, vec![BlockId(0)]);
    }

    #[test]
    fn a_branch_places_its_first_successor_next() {
        // `br c, b1, b2` should be followed by b1, so the taken edge is a
        // fallthrough rather than a jump.
        let f = func(vec![
            plain(Terminator::Branch {
                cond: ValueId(0),
                then_target: BlockId(1),
                then_args: Vec::new(),
                else_target: BlockId(2),
                else_args: Vec::new(),
            }),
            plain(Terminator::Return(None)),
            plain(Terminator::Return(None)),
        ]);
        assert_eq!(block_order(&f)[1], BlockId(1));
    }

    #[test]
    fn a_loop_body_follows_its_header() {
        // b0 -> b1(header) -> b2(body) -> b1, and b1 -> b3(exit).
        let f = func(vec![
            plain(Terminator::Jump {
                target: BlockId(1),
                args: Vec::new(),
            }),
            plain(Terminator::Branch {
                cond: ValueId(0),
                then_target: BlockId(2),
                then_args: Vec::new(),
                else_target: BlockId(3),
                else_args: Vec::new(),
            }),
            plain(Terminator::Jump {
                target: BlockId(1),
                args: Vec::new(),
            }),
            plain(Terminator::Return(None)),
        ]);
        let order = block_order(&f);
        let at = |b: BlockId| order.iter().position(|x| *x == b).unwrap();
        assert!(
            at(BlockId(2)) < at(BlockId(3)),
            "body before exit: {order:?}"
        );
    }

    #[test]
    fn an_unreachable_block_is_not_emitted() {
        let f = func(vec![
            plain(Terminator::Return(None)),
            plain(Terminator::Return(None)),
        ]);
        assert_eq!(block_order(&f), vec![BlockId(0)]);
    }
}
