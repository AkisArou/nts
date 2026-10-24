//! Unerases a dominating class test already answered, so the cast needs
//! no second test and no fallback.
//!
//! Core's small-receiver dispatch spells a field read through a face as
//! `instanceof` against the class that moves the field, then an unerase
//! of the same value to that class in the taken block. The unerase's own
//! `br_on_cast` re-asks the question the branch just answered, with a
//! tag-reading fallback behind it. Where the taken block is reached only
//! through that branch, one trapping cast is the whole of it: control
//! arrives only when the test passed, so the value is a non-null object
//! of the class or a subclass, whose storage is a subtype of the class's.

use crate::object_plan::Plan;
use nts_core::hir::{Func, HirType, ManagedType, OpKind, Terminator, ValueId};
use std::collections::BTreeSet;

/// The unerase results in `func` a class test guards.
pub(crate) fn values(func: &Func, objects: &Plan) -> BTreeSet<ValueId> {
    let mut preds = vec![0usize; func.blocks.len()];
    for block in &func.blocks {
        for target in block.terminator.successors() {
            preds[target.0 as usize] += 1;
        }
    }
    let mut guarded = BTreeSet::new();
    for block in &func.blocks {
        let Terminator::Branch {
            cond, then_target, ..
        } = &block.terminator
        else {
            continue;
        };
        if preds[then_target.0 as usize] != 1 {
            continue;
        }
        let OpKind::InstanceOf {
            value,
            classes,
            by_layout: false,
        } = &func.values[cond.0 as usize].kind
        else {
            continue;
        };
        let taken = &func.blocks[then_target.0 as usize];
        for &id in &taken.ops {
            let op = &func.values[id.0 as usize];
            // A named face projection keeps its own check deliberately:
            // an unplanned receiver must report core's carried reason.
            if op.kind != (OpKind::unerase(*value)) {
                continue;
            }
            let HirType::Managed(ManagedType::Object(target)) = op.ty else {
                continue;
            };
            if admits(objects, classes, target) {
                guarded.insert(id);
            }
        }
    }
    guarded
}

/// Whether passing the test for `classes` puts the value in `target`'s
/// storage: the target is itself tested for, and every tested class's
/// storage is the target's or a subtype of it (its subclasses, as the
/// test's list names them).
fn admits(
    objects: &Plan,
    classes: &[nts_core::hir::ClassId],
    target: nts_core::hir::ClassId,
) -> bool {
    if !classes.contains(&target) {
        return false;
    }
    let ty = |id| HirType::Managed(ManagedType::Object(id));
    let Ok(target) = objects.object(&ty(target)) else {
        return false;
    };
    classes.iter().all(|&class| {
        objects
            .object(&ty(class))
            .is_ok_and(|object| objects.subtype(object.physical, target.physical))
    })
}
