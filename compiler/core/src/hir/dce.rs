//! Removing operations nothing reads.
//!
//! # Why a compiler that emits C still needs this
//!
//! Not for speed — clang deletes dead code perfectly well. For *correctness of
//! the output as a C program*: the emitter declares a local for every value it
//! assigns, and a local that is assigned and never read is
//! `-Wunused-but-set-variable`, which is an error under the flags the generated
//! file is compiled with.
//!
//! Specialization creates these deliberately. When it folds `(int32_t)1.0` into
//! the constant `1`, the original `1.0` is left with no readers. Rather than
//! have that pass track what it orphaned, everything it orphans is collected
//! here.

use rustc_hash::FxHashSet;

use super::{BlockId, Func, OpKind, Terminator, ValueId};

/// Drop operations whose results nothing reads, and report how many.
pub fn eliminate(func: &mut Func) -> usize {
    let mut live: FxHashSet<ValueId> = FxHashSet::default();

    // Seeds: anything a terminator reads, and every call. A call's result may
    // be unused while the call itself still has to happen.
    for block in &func.blocks {
        for operand in super::verify::terminator_operands(&block.terminator) {
            live.insert(operand);
        }
        for value in &block.ops {
            // A call may have effects and a store certainly does, so both stay
            // whatever reads their results.
            if matches!(
                func.values[value.0 as usize].kind,
                OpKind::Call { .. }
                    | OpKind::ArraySet { .. }
                    | OpKind::FieldSet { .. }
                    | OpKind::GlobalSet { .. }
                    | OpKind::Retain(_)
                    | OpKind::Release(_)
            ) {
                live.insert(*value);
            }
        }
    }

    // Reaching a fixpoint rather than one backward sweep: a loop body can read a
    // value defined in a block that comes later in the arena, so one pass in any
    // fixed order can miss it.
    loop {
        let before = live.len();
        for block in &func.blocks {
            for value in &block.ops {
                if !live.contains(value) {
                    continue;
                }
                for operand in super::verify::operands(&func.values[value.0 as usize].kind) {
                    live.insert(operand);
                }
            }
        }
        if live.len() == before {
            break;
        }
    }

    let mut removed = 0;
    for block in &mut func.blocks {
        let before = block.ops.len();
        block.ops.retain(|value| live.contains(value));
        removed += before - block.ops.len();
    }
    removed
}

/// Drop block parameters nothing reads, with the arguments that fed them.
///
/// # Why this belongs beside dead operations
///
/// The same reason, and it is the one in this module's header: the emitter
/// declares a local for every value, and one an edge assigns and nothing reads
/// is `-Wunused-but-set-variable`, which the generated file is compiled with as
/// an error.
///
/// A `switch` produces these routinely. Every clause is a merge, so every
/// clause takes a parameter for every name the switch carries — and a clause
/// that returns reads none of them.
///
/// # The index moves with the parameter
///
/// `OpKind::BlockParam(n)` carries its own position, and [`super::loops`] reads
/// it to find the matching argument on each incoming edge. Removing the
/// parameter before it without renumbering would make that read the wrong one,
/// which is a wrong loop bound rather than a crash.
///
/// # Why a fixpoint
///
/// Dropping an argument can be what made the value feeding it dead, and that
/// value may itself be another block's parameter — a name carried through a
/// loop and never used is a chain of them.
pub fn prune_parameters(func: &mut Func) -> usize {
    let mut removed = 0;
    loop {
        let mut read: FxHashSet<ValueId> = FxHashSet::default();
        for block in &func.blocks {
            for value in &block.ops {
                for operand in super::verify::operands(&func.values[value.0 as usize].kind) {
                    read.insert(operand);
                }
            }
            for operand in super::verify::terminator_operands(&block.terminator) {
                read.insert(operand);
            }
        }

        let doomed: Vec<(usize, Vec<usize>)> = func
            .blocks
            .iter()
            .enumerate()
            .filter_map(|(at, block)| {
                let dead: Vec<usize> = block
                    .params
                    .iter()
                    .enumerate()
                    .filter(|(_, param)| !read.contains(param))
                    .map(|(index, _)| index)
                    .collect();
                (!dead.is_empty()).then_some((at, dead))
            })
            .collect();
        if doomed.is_empty() {
            return removed;
        }

        for (at, dead) in doomed {
            removed += dead.len();
            let target = BlockId(u32::try_from(at).unwrap_or(0));
            // Back to front, so an earlier index is still the one it names.
            for index in dead.iter().rev() {
                func.blocks[at].params.remove(*index);
            }
            for block in &mut func.blocks {
                let drop_from = |args: &mut Vec<ValueId>| {
                    for index in dead.iter().rev() {
                        args.remove(*index);
                    }
                };
                match &mut block.terminator {
                    Terminator::Jump { target: to, args } if *to == target => drop_from(args),
                    Terminator::Branch {
                        then_target,
                        then_args,
                        else_target,
                        else_args,
                        ..
                    } => {
                        if *then_target == target {
                            drop_from(then_args);
                        }
                        if *else_target == target {
                            drop_from(else_args);
                        }
                    }
                    _ => {}
                }
            }
            let surviving = func.blocks[at].params.clone();
            for (index, param) in surviving.iter().enumerate() {
                func.values[param.0 as usize].kind =
                    OpKind::BlockParam(u32::try_from(index).unwrap_or(0));
            }
        }
    }
}
