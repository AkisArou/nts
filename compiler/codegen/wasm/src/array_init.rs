//! Refuse observable typed holes which prepared HIR's zero fill cannot represent.
//!
//! A typed `ArrayNew { zeroed: true }` holds zeros, not `undefined`, so a slot
//! may be observed only once a store has written it. The proof is a forward
//! must-analysis over the control-flow graph: a constant slot is written at a
//! point when a store wrote it on every path from the allocation to there. So
//! the stores after a branch inside an array literal (a ternary, `??`, a guard
//! that throws) still count, and a store on only one branch proves nothing
//! where the branches meet. The length may be read before initialization; an
//! element read needs its slot; any other use (an alias, an escape, a block
//! argument) needs every slot.

use crate::{EmitError, error::Failure};
use nts_core::hir::{BlockId, Func, HirType, ManagedType, OpKind, ValueId};
use rustc_hash::FxHashMap;
use std::collections::BTreeSet;

/// The constant slots proven written of each allocation that is not yet
/// complete. A complete allocation has no entry, and neither has one not yet
/// made: either admits every use, so absence is the analysis's top.
type Pending = FxHashMap<ValueId, BTreeSet<u32>>;

fn constant(func: &Func, id: ValueId) -> Option<u32> {
    let op = func.value(id);
    match op.kind {
        OpKind::ConstInt(n) => u32::try_from(n).ok(),
        OpKind::ConstFloat(mut n) => {
            if op.ty == (HirType::Float { bits: 32 }) {
                #[allow(clippy::cast_possible_truncation)]
                {
                    n = f64::from(n as f32);
                }
            }
            if !(n >= 0.0 && n <= f64::from(u32::MAX) && n.fract() == 0.0) {
                return None;
            }
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            Some(n as u32)
        }
        _ => None,
    }
}

fn harmless(func: &Func, kind: &OpKind, allocation: ValueId) -> bool {
    match kind {
        OpKind::Length(array) => *array == allocation,
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => *array == allocation && *index != allocation && *value != allocation,
        kind if readies(func, kind, allocation) => true,
        // Every other use needs a complete array, including aliases which
        // could otherwise hide a later element read from this proof.
        _ => false,
    }
}

fn readies(func: &Func, kind: &OpKind, allocation: ValueId) -> bool {
    if let OpKind::Call {
        callee: nts_core::hir::Callee::External(name),
        args,
        ..
    } = kind
    {
        crate::array_methods::external(name).is_some_and(|method| {
            method.initializes()
                || (method.truncates()
                    && args.get(1).is_some_and(|id| constant(func, *id) == Some(0)))
        }) && args.first() == Some(&allocation)
            && !args[1..].contains(&allocation)
    } else {
        false
    }
}

fn decline(func: &Func, id: ValueId) -> EmitError {
    Failure::Unsupported("typed array holes: observed slots are not proven initialized".into())
        .at(&func.name, &func.value(id).origin)
}

/// Each typed zeroed allocation, with its length when that is a constant.
fn allocations(func: &Func) -> FxHashMap<ValueId, Option<u32>> {
    let mut lengths = FxHashMap::default();
    for block in &func.blocks {
        for &id in &block.ops {
            let op = func.value(id);
            if let OpKind::ArrayNew {
                length,
                zeroed: true,
            } = op.kind
                && let HirType::Managed(ManagedType::Array(element)) = &op.ty
                && element.as_ref() != &HirType::Erased
            {
                lengths.insert(id, constant(func, length));
            }
        }
    }
    lengths
}

/// What holds on entry to a block: a slot is written only where every
/// predecessor wrote it. A predecessor not yet visited constrains nothing.
fn meet<'a>(mut outs: impl Iterator<Item = &'a Pending>) -> Pending {
    let mut met = outs.next().cloned().unwrap_or_default();
    for out in outs {
        for (allocation, slots) in out {
            match met.get_mut(allocation) {
                Some(have) => have.retain(|slot| slots.contains(slot)),
                None => {
                    met.insert(*allocation, slots.clone());
                }
            }
        }
    }
    met
}

/// Runs `block` over `pending`. With `check`, a use the facts do not admit
/// declines.
fn transfer(
    func: &Func,
    block: BlockId,
    lengths: &FxHashMap<ValueId, Option<u32>>,
    pending: &mut Pending,
    check: bool,
) -> Result<(), EmitError> {
    let body = &func.blocks[block.0 as usize];
    for &id in &body.ops {
        let kind = &func.value(id).kind;
        for allocation in nts_core::hir::operands_of(kind) {
            let Some(slots) = pending.get_mut(&allocation) else {
                continue;
            };
            let length = lengths[&allocation];
            if readies(func, kind, allocation) {
                pending.remove(&allocation);
            } else if let OpKind::ArraySet { array, index, .. } = *kind
                && array == allocation
                && harmless(func, kind, allocation)
                && let Some(index) = constant(func, index)
                && length.is_none_or(|n| index < n)
            {
                slots.insert(index);
                if length.is_some_and(|n| slots.len() == n as usize) {
                    pending.remove(&allocation);
                }
            } else if let OpKind::ArrayGet { array, index, .. } = *kind
                && array == allocation
                && constant(func, index).is_some_and(|n| slots.contains(&n))
            {
                // A guarded store wrote this slot on every path to here.
            } else if check && !harmless(func, kind, allocation) {
                return Err(decline(func, id));
            }
        }
        if let Some(&length) = lengths.get(&id)
            && length != Some(0)
        {
            pending.insert(id, BTreeSet::new());
        }
    }
    if check
        && let Some(allocation) = nts_core::hir::operands_of_terminator(&body.terminator)
            .into_iter()
            .find(|allocation| pending.contains_key(allocation))
    {
        return Err(decline(func, allocation));
    }
    Ok(())
}

pub(crate) fn check(func: &Func) -> Result<(), EmitError> {
    let lengths = allocations(func);
    if lengths.is_empty() {
        return Ok(());
    }
    let order = nts_codegen_common::block_order(func);
    let mut predecessors = vec![Vec::new(); func.blocks.len()];
    for &block in &order {
        for next in func.blocks[block.0 as usize].terminator.successors() {
            predecessors[next.0 as usize].push(block);
        }
    }
    let mut outs: Vec<Option<Pending>> = vec![None; func.blocks.len()];
    let entry = |outs: &[Option<Pending>], block: BlockId| {
        meet(
            predecessors[block.0 as usize]
                .iter()
                .filter_map(|p| outs[p.0 as usize].as_ref()),
        )
    };
    // To a fixed point: facts only shrink, so a loop settles in a few passes.
    loop {
        let mut changed = false;
        for &block in &order {
            let mut pending = entry(&outs, block);
            transfer(func, block, &lengths, &mut pending, false)?;
            if outs[block.0 as usize].as_ref() != Some(&pending) {
                outs[block.0 as usize] = Some(pending);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for &block in &order {
        let mut pending = entry(&outs, block);
        transfer(func, block, &lengths, &mut pending, true)?;
    }
    Ok(())
}
