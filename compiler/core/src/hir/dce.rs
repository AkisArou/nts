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
        // Asking what class a value is reads one word and compares it. A dead
        // `instanceof` is a dead comparison.
        OpKind::InstanceOf { .. } => false,
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
        | OpKind::Yield { .. }
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

/// [`prune_unreachable`] over every function, which is how the pipeline uses it.
///
/// Called before anything else looks at the program, because everything below
/// reads the block graph and a block nothing can reach is not part of it.
pub fn prune_unreachable_blocks(program: &mut super::Program) -> usize {
    program.funcs.iter_mut().map(prune_unreachable).sum()
}

/// Drop blocks the entry cannot reach, renumbering what is left.
///
/// A loop whose body always leaves — `for (const k of m.keys()) { ...; break; }`
/// — has a latch nothing jumps to. The block is built before the body is
/// lowered, because `continue` needs its id, and by the time the body turns out
/// never to fall through it is already there with a `BlockId` that other
/// terminators are numbered around.
///
/// That is dead code and not a malformed graph, and the difference matters
/// because the verifier reported it as `invalid HIR` and refused the program.
/// A correct source construct was rejected with a message about the compiler's
/// own bookkeeping: the shared DNS cache's eviction loop, and twelve lines
/// reproduce it.
///
/// # Why remove rather than tolerate
///
/// The verifier's check earns its place on the other side: a dead block reaches
/// the C backend as a label nothing jumps to, and the generated file is
/// compiled with `-Werror`, where `-Wunused-label` is fatal. So the block has to
/// go, and the check stays as the assertion that it went.
///
/// Renumbering is the whole cost. A `BlockId` is an index, so removing one
/// shifts every later block, and every terminator naming one has to move with
/// it. Values are left alone: a dropped block's parameters stay in the arena
/// with no readers, which is exactly what [`eliminate`] above is for.
pub fn prune_unreachable(func: &mut Func) -> usize {
    let reachable = super::verify::reachable_blocks(func);
    if reachable.len() == func.blocks.len() {
        return 0;
    }
    // Old index to new, for the ones that survive.
    let mut next = 0u32;
    let moved: Vec<Option<BlockId>> = (0..func.blocks.len())
        .map(|index| {
            let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
            reachable.contains(&id).then(|| {
                let at = BlockId(next);
                next += 1;
                at
            })
        })
        .collect();
    let removed = func.blocks.len() - reachable.len();
    let mut index = 0;
    func.blocks.retain(|_| {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        index += 1;
        reachable.contains(&id)
    });
    // `moved` is total over the survivors, so an unwrap here would be a
    // successor of a reachable block that is itself unreachable -- which the
    // walk above cannot produce.
    let to = |old: BlockId| moved[old.0 as usize].unwrap_or(old);
    for block in &mut func.blocks {
        match &mut block.terminator {
            Terminator::Jump { target, .. } => *target = to(*target),
            Terminator::Branch {
                then_target,
                else_target,
                ..
            } => {
                *then_target = to(*then_target);
                *else_target = to(*else_target);
            }
            Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {}
        }
    }
    // A terminator is not the only thing that names a block. `Await` carries
    // the handler its promise rejects into, because a rejection is the one edge
    // into a handler that no `throw` wrote and the lowering is the only place
    // that knows it exists.
    //
    // Missing it did not produce a wrong answer, which is the part worth
    // recording: `suspend` reads that id as an index into its segment layout,
    // and a stale one was out of bounds rather than merely wrong. The whole
    // shared web-platform tree went from a verifier error to a panic, and the
    // panic is the better outcome -- an id that had shifted by one would have
    // resumed into the wrong handler and said nothing.
    for op in &mut func.values {
        if let OpKind::Await {
            rejects_to: Some(rejection),
            ..
        } = &mut op.kind
        {
            rejection.handler = to(rejection.handler);
        }
    }
    removed
}
