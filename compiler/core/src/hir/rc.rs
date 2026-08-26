//! Reference counting: where a reference is claimed and given up.
//!
//! # The convention, in one sentence
//!
//! Every managed value is owned by the function that names it, and every
//! consumption takes its own reference.
//!
//! That makes the rules local, which is the only way to get this right:
//!
//! - A value whose producer already returns a reference — an allocation, a
//!   concatenation, a call — starts owned.
//! - A value that is *borrowed* from somewhere that outlives the read — a
//!   parameter, a field, an element — is retained at its definition, so it is
//!   owned like any other.
//! - Every consumption retains: storing into a field, passing on an edge,
//!   returning. The consumer's reference is its own.
//! - Every value is released where its live range ends.
//!
//! Retains and releases therefore pair up locally, and a mistake in one place
//! cannot be balanced by a mistake in another. Many of the pairs cancel; that is
//! what an optimizer is for, and correctness first is what RFC §9.2 asks of a
//! first implementation.
//!
//! # Releases go on edges, not at the end of blocks
//!
//! A value can be live along one arm of a branch and dead along the other, and
//! "where the live range ends" is then not a block — it is an edge. Releasing at
//! the end of the branching block would free something the other arm reads;
//! releasing at the start of the successor would release twice when that
//! successor has another predecessor where the value is live.
//!
//! So an edge that has releases to place gets a block of its own, holding them
//! and a jump onward. That is the standard critical-edge split, and it is what
//! makes the placement exact rather than conservative — no path leaks and no
//! path releases twice.
//!
//! A terminator with no successors is the simple case: the function is leaving,
//! so everything it still holds is released. The returned value was retained for
//! the return, so what the caller receives survives it.

use super::liveness;
use super::{BlockId, Func, HirType, Op, OpKind, Program, ValueId};

/// What one pass inserted.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    pub retains: usize,
    pub releases: usize,
}

/// Insert retains and releases across a program.
pub fn insert(program: &mut Program) -> Report {
    let mut report = Report::default();
    for func in &mut program.funcs {
        let one = insert_into(func);
        report.retains += one.retains;
        report.releases += one.releases;
    }
    report
}

/// A deterministic ordering, so one compiler on one input emits one program.
fn ordered(func: &Func, values: &rustc_hash::FxHashSet<ValueId>) -> Vec<ValueId> {
    let mut counted_values: Vec<ValueId> = values
        .iter()
        .copied()
        .filter(|value| counted(func, *value))
        .collect();
    counted_values.sort_unstable();
    counted_values
}

/// Whether a value needs counting at all.
///
/// A string literal is static data with no count to change, and the runtime
/// treats it as immortal — but it is cheaper to not emit the call than to have
/// the runtime ignore it.
fn counted(func: &Func, value: ValueId) -> bool {
    let op = &func.values[value.0 as usize];
    op.ty.is_managed() && !matches!(op.kind, OpKind::ConstString(_))
}

/// Whether a producer already yields a reference the function owns.
fn produces_owned(kind: &OpKind) -> bool {
    matches!(
        kind,
        OpKind::ObjectNew
            | OpKind::ArrayNew { .. }
            | OpKind::Call { .. }
            | OpKind::Binary {
                op: super::BinOp::Concat,
                ..
            }
            // A block parameter arrives from an edge, and the edge retained for
            // it. Retaining again here would count one reference twice.
            | OpKind::BlockParam(_)
    )
}

fn insert_into(func: &mut Func) -> Report {
    let live = liveness::analyze(func);
    let mut report = Report::default();
    let blocks = std::mem::take(&mut func.blocks);
    let mut rebuilt = Vec::with_capacity(blocks.len());
    // Blocks created to hold an edge's releases. Appended after the originals,
    // so the ids of those do not move.
    let mut split_blocks: Vec<super::Block> = Vec::new();
    let original_count = blocks.len();

    for (index, block) in blocks.into_iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(0));
        let mut ops = Vec::with_capacity(block.ops.len());

        for value in &block.ops {
            let kind = func.values[value.0 as usize].kind.clone();

            // A store takes its own reference to what it stores.
            //
            // It should also release whatever the slot held before, and does
            // not: reading the old value back needs a load, and for an element
            // a bounds test the store itself already performed. Every field is
            // written exactly once today -- an object literal writes each of
            // them and nothing else does -- so the missing release is
            // unreachable rather than merely rare. It becomes reachable with
            // mutation of reference fields, and is the first thing to add then.
            if let OpKind::FieldSet { value: stored, .. } | OpKind::ArraySet { value: stored, .. } =
                &kind
                && counted(func, *stored)
            {
                retain(func, &mut ops, *stored, &mut report);
            }

            ops.push(*value);

            // A borrowed producer is retained so that every value is owned.
            if counted(func, *value) && !produces_owned(&kind) {
                retain(func, &mut ops, *value, &mut report);
            }
        }

        // Transfers first: the successor, or the caller, takes its own
        // reference before this function gives any of them up.
        for transferred in super::operands_of_terminator(&block.terminator) {
            if counted(func, transferred) {
                retain(func, &mut ops, transferred, &mut report);
            }
        }

        let successors = block.terminator.successors();
        // With one successor the edge cannot be critical, so the releases can go
        // at the end of this block; with more, each edge needs its own.
        let single = successors.len() == 1;
        let mut terminator = block.terminator.clone();

        if successors.is_empty() {
            // Leaving the function, so everything it still holds goes.
            for value in ordered(func, live.available(at)) {
                release(func, &mut ops, value, &mut report);
            }
        } else {
            for successor in successors {
                let dying: Vec<ValueId> = ordered(func, live.available(at))
                    .into_iter()
                    .filter(|value| !live.live_in(successor).contains(value))
                    .collect();
                if dying.is_empty() {
                    continue;
                }
                if single {
                    for value in dying {
                        release(func, &mut ops, value, &mut report);
                    }
                } else {
                    let landing = BlockId(
                        u32::try_from(original_count + split_blocks.len()).unwrap_or(u32::MAX),
                    );
                    let mut edge_ops = Vec::new();
                    for value in dying {
                        release(func, &mut edge_ops, value, &mut report);
                    }
                    // The arguments travel with the jump, so the split block
                    // forwards exactly what the edge carried.
                    let args = retarget(&mut terminator, successor, landing);
                    split_blocks.push(super::Block {
                        params: Vec::new(),
                        ops: edge_ops,
                        terminator: super::Terminator::Jump {
                            target: successor,
                            args,
                        },
                    });
                }
            }
        }

        rebuilt.push(super::Block {
            params: block.params,
            ops,
            terminator,
        });
    }

    rebuilt.extend(split_blocks);
    func.blocks = rebuilt;
    report
}

/// Send one edge through a new block, and hand back the arguments it carried.
///
/// The arguments move to the new block's jump: they are read where control
/// actually leaves, and the values are still available there because the block
/// they came from dominates it.
fn retarget(terminator: &mut super::Terminator, from: BlockId, to: BlockId) -> Vec<ValueId> {
    match terminator {
        super::Terminator::Jump { target, args } if *target == from => {
            *target = to;
            std::mem::take(args)
        }
        super::Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => {
            // A branch can name one block on both edges. Only the first is
            // retargeted here; the second keeps its own releases and its own
            // split, because the two edges die differently or they would not
            // both be here.
            if *then_target == from {
                *then_target = to;
                std::mem::take(then_args)
            } else if *else_target == from {
                *else_target = to;
                std::mem::take(else_args)
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

fn retain(func: &mut Func, ops: &mut Vec<ValueId>, value: ValueId, report: &mut Report) {
    let origin = func.values[value.0 as usize].origin.clone();
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::Retain(value),
        ty: HirType::Void,
        origin,
    });
    ops.push(id);
    report.retains += 1;
}

fn release(func: &mut Func, ops: &mut Vec<ValueId>, value: ValueId, report: &mut Report) {
    let origin = func.values[value.0 as usize].origin.clone();
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::Release(value),
        ty: HirType::Void,
        origin,
    });
    ops.push(id);
    report.releases += 1;
}
