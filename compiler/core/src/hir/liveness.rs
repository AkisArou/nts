//! Where each value is still needed.
//!
//! # What it is for
//!
//! Reference counting. A managed value has to be released when nothing will
//! read it again, and "nothing will read it again" is exactly what liveness
//! answers. Getting it wrong in one direction leaks; in the other it frees
//! memory something still holds, which is the failure RFC §9.2 names as the
//! risk of reference counting done by a compiler.
//!
//! # The algorithm
//!
//! Backward dataflow to a fixpoint, which is the textbook one:
//!
//! ```text
//! live_out(b) = union of live_in(s) for every successor s
//! live_in(b)  = (used(b) ∪ live_out(b)) \ defined(b)
//! ```
//!
//! SSA makes `defined` trivial — a value is defined once, in one block — and
//! block parameters are defined by the block that declares them, not by the
//! edges that supply them. An argument on an edge is *used* by the block that
//! jumps, which is where it is read.
//!
//! The subtraction covers `used` and not only `live_out`, which is the whole
//! content of the textbook's "upward-exposed uses". A value defined in a block
//! and read by that same block's terminator — every loop-carried value is one,
//! since the back edge passes it — is not live on entry: it does not exist yet.
//! Writing `used ∪ (live_out \ defined)` instead makes such a value live at the
//! top of its own loop, and therefore *available* at the loop header, where it
//! is not yet defined. Dominance says a block cannot name it there, so the
//! mistake shows up as a release the verifier rejects rather than as anything
//! subtle — but only once a program carries an object around a loop.

use rustc_hash::FxHashSet;

use super::{BlockId, Func, ValueId};

/// A hard bound on the fixpoint. Liveness converges in at most one pass per
/// block over a reducible graph; reaching this means a bug, and looping forever
/// would hide it.
const ROUND_CAP: usize = 1024;

/// Which values are live where.
#[derive(Debug, Clone)]
pub struct Liveness {
    live_in: Vec<FxHashSet<ValueId>>,
    live_out: Vec<FxHashSet<ValueId>>,
    /// Values a block can name: those arriving live, and those it defines.
    ///
    /// Kept here rather than recomputed from the function, so that a caller
    /// rebuilding a function's blocks can still ask where a live range ends —
    /// which is exactly when it needs to.
    available: Vec<FxHashSet<ValueId>>,
}

impl Liveness {
    /// Values that must already hold on entry to a block.
    #[must_use]
    pub fn live_in(&self, block: BlockId) -> &FxHashSet<ValueId> {
        &self.live_in[block.0 as usize]
    }

    /// Values that must still hold when a block ends.
    #[must_use]
    pub fn live_out(&self, block: BlockId) -> &FxHashSet<ValueId> {
        &self.live_out[block.0 as usize]
    }

    /// Values a block can name: those arriving live, and those it defines.
    #[must_use]
    pub fn available(&self, block: BlockId) -> &FxHashSet<ValueId> {
        &self.available[block.0 as usize]
    }

    /// Hold a value live until every exit.
    ///
    /// A borrow is only good while the place it came from is, so a local that
    /// *anchors* one has to outlive it. Stretching the range here rather than
    /// special-casing it where releases are placed means every rule that reads
    /// liveness agrees about it -- where a release goes, and whether handing a
    /// value on is a move or a copy. Two rules disagreeing about one value is
    /// how a reference gets consumed twice.
    ///
    /// Only sound for a value the *entry* block defines, which runs exactly
    /// once, so the value names one object for the whole call. A value defined
    /// in a loop names a different one each time round and must die each time
    /// round with it.
    pub fn hold_to_every_exit(&mut self, func: &Func, value: ValueId) {
        for (index, block) in func.blocks.iter().enumerate() {
            self.available[index].insert(value);
            if index != 0 {
                self.live_in[index].insert(value);
            }
            if block.terminator.successors().is_empty() {
                // Nowhere left to go, so this is where it dies and where the
                // release belongs.
                self.live_out[index].remove(&value);
            } else {
                self.live_out[index].insert(value);
            }
        }
    }

    /// Whether a value's last read is inside this block.
    ///
    /// True when it is available in the block — defined there, or arriving live
    /// — and dead by the end of it. This is where a release belongs.
    #[must_use]
    pub fn dies_in(&self, block: BlockId, value: ValueId) -> bool {
        let index = block.0 as usize;
        self.available[index].contains(&value) && !self.live_out[index].contains(&value)
    }
}

/// Compute liveness for a function.
#[must_use]
pub fn analyze(func: &Func) -> Liveness {
    let count = func.blocks.len();
    let mut live_in: Vec<FxHashSet<ValueId>> = vec![FxHashSet::default(); count];
    let mut live_out: Vec<FxHashSet<ValueId>> = vec![FxHashSet::default(); count];

    // Precomputed per block, since the fixpoint revisits them.
    let used: Vec<FxHashSet<ValueId>> = (0..count).map(|index| reads(func, index)).collect();
    let defined: Vec<FxHashSet<ValueId>> = (0..count).map(|index| writes(func, index)).collect();

    for _ in 0..ROUND_CAP {
        let mut changed = false;
        // Backward, so a block's successors are usually settled before it.
        for index in (0..count).rev() {
            let mut out = FxHashSet::default();
            for successor in func.blocks[index].terminator.successors() {
                out.extend(live_in[successor.0 as usize].iter().copied());
            }

            let mut entering = out.clone();
            entering.extend(used[index].iter().copied());
            for value in &defined[index] {
                entering.remove(value);
            }

            if out != live_out[index] || entering != live_in[index] {
                live_out[index] = out;
                live_in[index] = entering;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    let available = (0..count)
        .map(|index| {
            let mut here = live_in[index].clone();
            here.extend(defined[index].iter().copied());
            here
        })
        .collect();

    Liveness {
        live_in,
        live_out,
        available,
    }
}

/// Values a block reads, including the arguments its terminator passes on.
///
/// An edge argument is read by the block that *jumps*, not by the one that
/// receives it: that is where the value is loaded from.
fn reads(func: &Func, index: usize) -> FxHashSet<ValueId> {
    let block = &func.blocks[index];
    let mut used = FxHashSet::default();
    for value in &block.ops {
        used.extend(super::operands_of(&func.values[value.0 as usize].kind));
    }
    used.extend(super::operands_of_terminator(&block.terminator));
    used
}

/// Values a block defines: its operations and its own parameters.
fn writes(func: &Func, index: usize) -> FxHashSet<ValueId> {
    let block = &func.blocks[index];
    let mut defined: FxHashSet<ValueId> = block.ops.iter().copied().collect();
    defined.extend(block.params.iter().copied());
    defined
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, OpKind, Param, Terminator};
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

    /// `f(a) { %1 = a + a; if (..) { use %1 } ; return }`
    ///
    /// `%1` is defined in the entry and read only in one arm, so it is live
    /// out of the entry and dies in that arm.
    fn branching() -> Func {
        let values = vec![
            op(OpKind::Param(0)), // %0
            op(OpKind::Binary {
                // %1
                op: crate::hir::BinOp::Add,
                lhs: ValueId(0),
                rhs: ValueId(0),
            }),
            op(OpKind::Binary {
                // %2  the test
                op: crate::hir::BinOp::Lt,
                lhs: ValueId(0),
                rhs: ValueId(0),
            }),
            op(OpKind::Binary {
                // %3  reads %1
                op: crate::hir::BinOp::Mul,
                lhs: ValueId(1),
                rhs: ValueId(1),
            }),
        ];
        Func {
            name: "f".to_owned(),
            params: vec![Param {
                name: "a".to_owned(),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
            }],
            return_type: HirType::Float { bits: 64 },
            values,
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                    terminator: Terminator::Branch {
                        cond: ValueId(2),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(3)],
                    terminator: Terminator::Return(Some(ValueId(3))),
                },
                Block {
                    params: Vec::new(),
                    ops: Vec::new(),
                    terminator: Terminator::Return(Some(ValueId(0))),
                },
            ],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
        }
    }

    #[test]
    fn a_value_is_live_along_the_path_that_reads_it() {
        let func = branching();
        let live = analyze(&func);

        // %1 is read only in block 1, so it must survive the branch.
        assert!(live.live_out(BlockId(0)).contains(&ValueId(1)));
        assert!(live.live_in(BlockId(1)).contains(&ValueId(1)));

        // ...and not down the other arm, which never mentions it. This is the
        // asymmetry a release has to respect: freeing `%1` at the end of block 0
        // would free something block 1 goes on to read.
        assert!(!live.live_in(BlockId(2)).contains(&ValueId(1)));
    }

    #[test]
    fn a_live_range_ends_where_the_last_read_is() {
        let func = branching();
        let live = analyze(&func);

        // `%1` arrives live in block 1, is read there, and nothing follows.
        assert!(live.dies_in(BlockId(1), ValueId(1)));
        // It does not die in block 0: block 1 still needs it.
        assert!(!live.dies_in(BlockId(0), ValueId(1)));
        // And it was never available in block 2 at all.
        assert!(!live.dies_in(BlockId(2), ValueId(1)));
    }

    #[test]
    fn a_loop_keeps_its_carried_values_live_around_the_back_edge() {
        // The case a fixpoint is needed for: a value defined in the body and
        // passed back to the header is live *out* of the body, which one
        // backward pass in block order would not see.
        let values = vec![
            op(OpKind::ConstFloat(0.0)), // %0
            op(OpKind::BlockParam(0)),   // %1
            op(OpKind::Binary {
                // %2
                op: crate::hir::BinOp::Lt,
                lhs: ValueId(1),
                rhs: ValueId(0),
            }),
            op(OpKind::Binary {
                // %3  the back edge's argument
                op: crate::hir::BinOp::Add,
                lhs: ValueId(1),
                rhs: ValueId(0),
            }),
        ];
        let func = Func {
            name: "loop".to_owned(),
            params: Vec::new(),
            return_type: HirType::Float { bits: 64 },
            values,
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0)],
                    },
                },
                Block {
                    params: vec![ValueId(1)],
                    ops: vec![ValueId(2)],
                    terminator: Terminator::Branch {
                        cond: ValueId(2),
                        then_target: BlockId(2),
                        then_args: Vec::new(),
                        else_target: BlockId(3),
                        else_args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(3)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(3)],
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: Vec::new(),
                    terminator: Terminator::Return(Some(ValueId(1))),
                },
            ],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
        };

        let live = analyze(&func);
        // The header parameter is read in the body and in the exit, so it is
        // live across the whole loop.
        assert!(live.live_out(BlockId(1)).contains(&ValueId(1)));
        assert!(live.live_in(BlockId(2)).contains(&ValueId(1)));
        // `%0` is the constant the loop compares against every iteration, so it
        // stays live around the back edge -- which is exactly what one backward
        // pass in block order would miss.
        assert!(live.live_in(BlockId(2)).contains(&ValueId(0)));

        // `%3` is defined in the body and read by the body's own terminator, so
        // it is not live on entry to the body: it does not exist yet. Getting
        // this wrong makes it live in the body, therefore live out of the
        // header, therefore *available* at the header -- a block that cannot
        // name it, because the definition does not dominate. Under reference
        // counting that becomes a release the SSA verifier rejects, which is a
        // long way from the mistake. Every loop that carries an object has this
        // shape.
        assert!(!live.live_in(BlockId(2)).contains(&ValueId(3)));
        assert!(!live.live_in(BlockId(1)).contains(&ValueId(3)));
        assert!(!live.available(BlockId(1)).contains(&ValueId(3)));
        // It is available in the body and dies there. Not "live out": the back
        // edge *reads* it, and a read is where a live range ends, not something
        // that extends it past the terminator. The header's parameter is a
        // different value that the edge supplies. This is what lets reference
        // counting hand the reference on as a move -- the value is transferred
        // and dying at the same point, so it needs neither a retain nor a
        // release.
        assert!(!live.live_out(BlockId(2)).contains(&ValueId(3)));
        assert!(live.available(BlockId(2)).contains(&ValueId(3)));
        assert!(live.dies_in(BlockId(2), ValueId(3)));
    }
}
