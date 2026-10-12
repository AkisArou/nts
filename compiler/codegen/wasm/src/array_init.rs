//! Refuse observable typed holes which prepared HIR's zero fill cannot represent.
//!
//! An allocation may be inspected for length before initialization. Element
//! reads require an initialized slot, and aliases/escapes require every slot.
//! Only stores in the allocation block contribute to this conservative proof:
//! stores on another branch must never establish readiness on all paths.

use crate::{EmitError, error::Failure};
use nts_core::hir::{BlockId, Func, HirType, ManagedType, OpKind, ValueId};
use rustc_hash::FxHashMap;
use std::collections::BTreeSet;

struct State {
    owner: BlockId,
    length: Option<u32>,
    initialized: BTreeSet<u32>,
}
impl State {
    fn complete(&self) -> bool {
        self.length
            .is_some_and(|n| self.initialized.len() == n as usize)
    }
}

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

fn harmless(kind: &OpKind, allocation: ValueId) -> bool {
    match kind {
        OpKind::Length(array) => *array == allocation,
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => *array == allocation && *index != allocation && *value != allocation,
        // Every other use needs a complete array, including aliases which
        // could otherwise hide a later element read from this proof.
        _ => false,
    }
}

fn decline(func: &Func, id: ValueId) -> EmitError {
    Failure::Unsupported("typed array holes: observed slots are not proven initialized".into())
        .at(&func.name, &func.value(id).origin)
}

pub(crate) fn check(func: &Func) -> Result<(), EmitError> {
    let order = nts_codegen_common::block_order(func);
    let mut states = FxHashMap::<ValueId, State>::default();
    for &block in &order {
        for &id in &func.blocks[block.0 as usize].ops {
            let op = func.value(id);
            if let OpKind::ArrayNew {
                length,
                zeroed: true,
            } = op.kind
                && let HirType::Managed(ManagedType::Array(element)) = &op.ty
                && element.as_ref() != &HirType::Erased
            {
                states.insert(
                    id,
                    State {
                        owner: block,
                        length: constant(func, length),
                        initialized: BTreeSet::new(),
                    },
                );
            }
            for allocation in nts_core::hir::operands_of(&op.kind) {
                let Some(state) = states.get_mut(&allocation) else {
                    continue;
                };
                if state.owner != block || state.complete() {
                    continue;
                }
                if let OpKind::ArraySet { array, index, .. } = op.kind
                    && array == allocation
                    && harmless(&op.kind, allocation)
                    && let Some(index) = constant(func, index)
                    && state.length.is_none_or(|n| index < n)
                {
                    state.initialized.insert(index);
                } else if let OpKind::ArrayGet { array, index, .. } = op.kind
                    && array == allocation
                    && constant(func, index).is_some_and(|n| state.initialized.contains(&n))
                {
                    // The earlier guarded store must have succeeded on this
                    // execution before the read. Other slots remain unproven.
                } else if !harmless(&op.kind, allocation) {
                    return Err(decline(func, id));
                }
            }
        }
    }
    // The first scan deliberately ignores uses outside the allocation block.
    // Its final state is sound there: SSA dominance places the entire defining
    // block before any such use. No branch-local stores contributed to it.
    for &block in &order {
        let body = &func.blocks[block.0 as usize];
        for &id in &body.ops {
            let kind = &func.value(id).kind;
            for allocation in nts_core::hir::operands_of(kind) {
                if let Some(state) = states.get(&allocation)
                    && state.owner != block
                    && !state.complete()
                    && !harmless(kind, allocation)
                {
                    return Err(decline(func, id));
                }
            }
        }
        for allocation in nts_core::hir::operands_of_terminator(&body.terminator) {
            if let Some(state) = states.get(&allocation)
                && !state.complete()
            {
                return Err(decline(func, allocation));
            }
        }
    }
    Ok(())
}
