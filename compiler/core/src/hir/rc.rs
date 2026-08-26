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
//! # What this version leaks, and why that is the safe direction
//!
//! A value is released in the block where its live range ends. Where a value is
//! live along one arm of a branch and not the other, the union says it is live
//! out of the branching block, so it is released down the arm that reads it and
//! *not* down the arm that does not — which leaks.
//!
//! The fix is per-edge releases, which needs critical edges split. It is not
//! done here because the two failure directions are not equal: a missed release
//! leaks, which is where `NoGC` already is, while a release too many frees memory
//! something still holds. RFC §9.2 names that as the risk, and a first
//! implementation should only be wrong in the direction that cannot corrupt.

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

        // The terminator's transfers, then the deaths.
        for transferred in super::operands_of_terminator(&block.terminator) {
            if counted(func, transferred) {
                retain(func, &mut ops, transferred, &mut report);
            }
        }

        let mut dying: Vec<ValueId> = (0..func.values.len())
            .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
            .filter(|value| counted(func, *value) && live.dies_in(at, *value))
            .collect();
        // Deterministic, so one compiler on one input emits one program.
        dying.sort_unstable();
        for value in dying {
            release(func, &mut ops, value, &mut report);
        }

        rebuilt.push(super::Block {
            params: block.params,
            ops,
            terminator: block.terminator,
        });
    }

    func.blocks = rebuilt;
    report
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
