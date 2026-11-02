#[cfg(test)]
use super::work::{Counter, note};
use crate::hir::{Func, OpKind, Terminator, ValueId};
use rustc_hash::FxHashSet;

pub(super) fn operations(func: &mut Func, live: &FxHashSet<ValueId>) -> usize {
    let mut removed = 0;
    for block in &mut func.blocks {
        #[cfg(test)]
        note(Counter::Block);
        let before = block.ops.len();
        block.ops.retain(|value| {
            #[cfg(test)]
            note(Counter::RetainOperation);
            live.contains(value)
        });
        removed += before - block.ops.len();
    }
    removed
}

pub(super) fn parameters(func: &mut Func, live: &FxHashSet<ValueId>) -> usize {
    let mut removed = 0;
    let values = &mut func.values;
    let masks: Vec<Vec<bool>> = func
        .blocks
        .iter_mut()
        .map(|block| {
            #[cfg(test)]
            note(Counter::Block);
            let mut mask = Vec::with_capacity(block.params.len());
            block.params.retain(|param| {
                #[cfg(test)]
                note(Counter::RetainParameter);
                let keep = live.contains(param);
                mask.push(keep);
                removed += usize::from(!keep);
                keep
            });
            for (index, param) in block.params.iter().enumerate() {
                #[cfg(test)]
                note(Counter::RenumberParameter);
                values[param.0 as usize].kind =
                    OpKind::BlockParam(u32::try_from(index).unwrap_or(0));
            }
            mask
        })
        .collect();
    for block in &mut func.blocks {
        #[cfg(test)]
        note(Counter::Block);
        match &mut block.terminator {
            Terminator::Jump { target, args } => {
                if let Some(mask) = masks.get(target.0 as usize) {
                    arguments(args, mask);
                }
            }
            Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                if let Some(mask) = masks.get(then_target.0 as usize) {
                    arguments(then_args, mask);
                }
                if let Some(mask) = masks.get(else_target.0 as usize) {
                    arguments(else_args, mask);
                }
            }
            Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {}
        }
    }
    removed
}

fn arguments(args: &mut Vec<ValueId>, mask: &[bool]) {
    // A malformed arity was conservatively rooted by the same live producer.
    if args.len() != mask.len() {
        return;
    }
    let mut index = 0;
    args.retain(|_| {
        #[cfg(test)]
        note(Counter::RetainArgument);
        let keep = mask[index];
        index += 1;
        keep
    });
}
