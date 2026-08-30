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
            if has_effects(&func.values[value.0 as usize].kind) {
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
/// Whether an operation has to run even when nothing reads its result.
///
/// Exhaustive, and inverted on purpose. This was an allow-list of the effectful
/// kinds, which makes *pure* the default for anything new -- and a pure
/// operation with no users is deleted. `Suspend` was added and silently
/// removed, so an `async` function set its state, never subscribed, and left
/// its promise pending forever. The program still ran; it just never finished.
///
/// A list of what has effects has to be added to. A list of what does not has
/// to be *decided* about, which is the difference.
#[allow(clippy::match_same_arms)]
/// Runtime functions with no effect but their result.
///
/// A list that has to be *argued* into rather than added to: a name here is a
/// promise that calling it and throwing the answer away is the same as not
/// calling it. Allocation counts as no effect only because a dead allocation
/// is unreachable and reclaimed.
const PURE_RUNTIME_CALLS: &[&str] = &["nts_tag_name"];

// Several arms answer `false` and each answers it for its own reason. Merged
// they would be a list rather than a set of decisions, and the next operation
// to arrive would join the list instead of being thought about.
#[allow(clippy::match_same_arms)]
fn has_effects(kind: &OpKind) -> bool {
    match kind {
        // Erasing, reading a tag and unerasing are all pure: they read one
        // value and produce another. Dead ones go, like any other computation.
        OpKind::Erase { .. } | OpKind::TagOf { .. } | OpKind::Unerase { .. } => false,
        // Named runtime functions that compute and do nothing else. A call is
        // assumed to have effects because it may, and these provably do not:
        // `nts_tag_name` allocates a string and returns it, so a dead one is a
        // dead allocation and removing it is the whole point of folding the
        // comparison that used to read it.
        OpKind::Call {
            callee: super::Callee::External(name),
            ..
        } if PURE_RUNTIME_CALLS.contains(&name.as_str()) => false,
        // A call may do anything. A store certainly does. A suspension hands
        // the frame to the runtime, which is both.
        // The guard's whole purpose is to end the program, which is the
        // strongest effect there is.
        OpKind::CellReady { .. }
        | OpKind::Call { .. }
        | OpKind::ArraySet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::GlobalSet { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_)
        | OpKind::Suspend { .. } => true,
        // Everything else computes a value and does nothing else, so it is
        // worth exactly what reads it. `Await` is here because it does not
        // survive `super::suspend` -- if one reaches this pass the program is
        // already wrong, and deleting it would only hide that.
        OpKind::Await { .. }
        | OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::Return(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic
        | OpKind::Binary { .. }
        | OpKind::Unary { .. }
        | OpKind::Convert(_)
        | OpKind::GlobalGet(_)
        | OpKind::ObjectNew { .. }
        | OpKind::FieldGet { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::StringUnitAt { .. } => false,
    }
}

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
