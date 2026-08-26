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
//! - A value read out of somewhere that outlives the read — a field, an element
//!   — is retained at its definition, so it is owned like any other.
//! - A *parameter* is the exception: it is borrowed, never retained on entry and
//!   never released on exit. See below.
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
//!
//! # Parameters are borrowed
//!
//! A callee could retain each managed parameter on entry and release it on exit,
//! which is uniform and costs two atomic operations per argument per call. It is
//! also unnecessary, because the caller is already holding one.
//!
//! The argument is a value the caller owns — that is the invariant this module
//! maintains for every value — and the caller's release for it is placed either
//! at the end of the block containing the call or on an edge leaving that block.
//! Both are strictly after the call returns, and the call is synchronous. So the
//! object cannot reach zero while the callee is running, and the callee needs no
//! reference of its own.
//!
//! What the callee does with the parameter is unaffected. Storing it into a
//! field retains, returning it retains, passing it along an edge retains — the
//! rules above are about consumption, and they do not change. Only the entry
//! retain and the exit release go away, and with them the whole convention of a
//! function taking a reference just to give it back.
//!
//! This is the one place where correctness rests on an argument about the caller
//! rather than on a local rule, which is why it is spelled out rather than
//! assumed.
//!
//! # Handing a reference on is a move, not a copy
//!
//! A value that is passed on *and* dies where it is passed on does not need a
//! retain and a release: it needs neither. The consumer takes the reference this
//! function was already holding. `return new C()` is the everyday case — retain
//! for the caller, release because the local is dying, both on the same value
//! with nothing in between.
//!
//! Cancelling the pair is safe here for a reason worth stating, because it is
//! not safe in general. Suppose the same edge also releases an object `o` that
//! holds the moved value in a field, and that releasing `o` drops what its
//! fields hold. Without the retain, could the move leave the value at zero
//! before the consumer sees it? No — the store into `o`'s field took its own
//! reference, so the value is held twice and the local's reference is genuinely
//! the local's to give. That is the convention at the top of this module doing
//! the work it exists to do.

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
        .filter(|value| owned(func, *value))
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

/// Whether this function holds a reference of its own to a value.
///
/// Everything counted is owned except a parameter, which the caller holds for
/// the length of the call. An owned value is retained where it is produced and
/// released where it dies; a borrowed one is neither.
fn owned(func: &Func, value: ValueId) -> bool {
    counted(func, value) && !matches!(func.values[value.0 as usize].kind, OpKind::Param(_))
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

            // A producer that hands back a borrow is retained, so that every
            // value this function owns is owned the same way.
            if owned(func, *value) && !produces_owned(&kind) {
                retain(func, &mut ops, *value, &mut report);
            }
        }

        let edges = edges_of(&block.terminator);
        let mut terminator = block.terminator.clone();

        if edges.is_empty() {
            // Leaving the function. What is returned is handed to the caller and
            // everything else is dropped -- and a value that is both is moved.
            let mut dying = ordered(func, live.available(at));
            let transfers: Vec<ValueId> = super::operands_of_terminator(&block.terminator)
                .into_iter()
                .filter(|value| counted(func, *value))
                .collect();
            for value in settle(&transfers, &mut dying) {
                retain(func, &mut ops, value, &mut report);
            }
            for value in dying {
                release(func, &mut ops, value, &mut report);
            }
        } else {
            // With one edge it cannot be critical, so its work can go at the end
            // of this block; with more, each edge needs a block of its own.
            let single = edges.len() == 1;
            for (slot, (successor, args)) in edges.into_iter().enumerate() {
                let mut dying: Vec<ValueId> = ordered(func, live.available(at))
                    .into_iter()
                    .filter(|value| !live.live_in(successor).contains(value))
                    .collect();
                let transfers: Vec<ValueId> = args
                    .into_iter()
                    .filter(|value| counted(func, *value))
                    .collect();
                let retains = settle(&transfers, &mut dying);
                if retains.is_empty() && dying.is_empty() {
                    continue;
                }
                let mut edge_ops = Vec::new();
                if single {
                    for value in retains {
                        retain(func, &mut ops, value, &mut report);
                    }
                    for value in dying {
                        release(func, &mut ops, value, &mut report);
                    }
                } else {
                    for value in retains {
                        retain(func, &mut edge_ops, value, &mut report);
                    }
                    for value in dying {
                        release(func, &mut edge_ops, value, &mut report);
                    }
                    let landing = BlockId(
                        u32::try_from(original_count + split_blocks.len()).unwrap_or(u32::MAX),
                    );
                    // The arguments travel with the jump, so the split block
                    // forwards exactly what the edge carried.
                    let args = retarget(&mut terminator, slot, landing);
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

/// The edges leaving a block, each with the arguments it carries.
///
/// Arguments belong to an edge and not to the terminator: a branch's two arms
/// pass different things, and where a value's reference goes depends on which
/// arm runs. A `Branch` condition is a `bool` and so is never counted, which is
/// why it does not appear here.
fn edges_of(terminator: &super::Terminator) -> Vec<(BlockId, Vec<ValueId>)> {
    match terminator {
        super::Terminator::Jump { target, args } => vec![(*target, args.clone())],
        super::Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (*then_target, then_args.clone()),
            (*else_target, else_args.clone()),
        ],
        super::Terminator::Return(_) | super::Terminator::Unreachable => Vec::new(),
    }
}

/// Cancel each transfer against a death of the same value, leaving the transfers
/// that still need a retain. What is cancelled is a move.
fn settle(transfers: &[ValueId], dying: &mut Vec<ValueId>) -> Vec<ValueId> {
    let mut retains = Vec::new();
    for value in transfers {
        if let Some(at) = dying.iter().position(|d| d == value) {
            // Passed on and dying here: the consumer takes the reference this
            // function already holds, so neither operation is emitted. One
            // death cancels one transfer, which is what makes `f(v, v)` right.
            dying.remove(at);
        } else {
            retains.push(*value);
        }
    }
    retains
}

/// Send one edge through a new block, and hand back the arguments it carried.
///
/// The arguments move to the new block's jump: they are read where control
/// actually leaves, and the values are still available there because the block
/// they came from dominates it. The edge is named by position rather than by
/// target, because a branch can name one block on both arms and those two edges
/// are not interchangeable.
fn retarget(terminator: &mut super::Terminator, slot: usize, to: BlockId) -> Vec<ValueId> {
    match terminator {
        super::Terminator::Jump { target, args } => {
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
            if slot == 0 {
                *then_target = to;
                std::mem::take(then_args)
            } else {
                *else_target = to;
                std::mem::take(else_args)
            }
        }
        super::Terminator::Return(_) | super::Terminator::Unreachable => Vec::new(),
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
