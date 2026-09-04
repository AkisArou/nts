//! Merging two frames when that is the only way to place an allocation.
//!
//! # Not an inliner
//!
//! `0027` measured a general one and deleted it. Copying every small body made
//! this compiler's analysis strictly worse, because the facts it proves are
//! whole-function and all-or-nothing: `stores_are_aimed` is one `bool` for a
//! function and `inert_slots` empties on the same condition, so one store
//! through a loop-carried tail turns off `still_zero` for everything merged
//! into it. Small functions are the unit this analysis reasons in.
//!
//! This copies a body for one reason, and only where that reason applies.
//!
//! # The reason
//!
//! An object a callee makes and hands back belongs in the *caller's* frame when
//! the caller lets it die. No summary can say so, because placement happens per
//! function and the allocation is in the wrong one:
//!
//! ```text
//! function maybe(v: number): Box | null {
//!   const made = new Box(v);
//!   if (v % 3 === 0) { return null; }
//!   return made;
//! }
//! ```
//!
//! Every `Box` dies in the iteration that asked for one, and every one of them
//! was on the heap. `0025` named this and had no mechanism for it. The two
//! candidates are caller-supplied storage -- a second body and an ABI, which is
//! what `nts_concat_into` is for strings -- and this: make the two functions one
//! function before placement runs, so there is only one frame to choose.
//!
//! So the trigger is not size. It is that the callee **returns something it
//! allocated**. A body that hands back a parameter, or a field, or a constant
//! has nothing here to gain and is left alone, whatever its size.

use rustc_hash::{FxHashMap, FxHashSet};

use super::simplify::{substitute, substitute_terminator};
use super::{
    Block, BlockId, Callee, Func, HirType, Layout, ManagedType, OpKind, Program, Terminator,
    ValueId,
};

/// A bound on the body, so that "small enough to be a factory" stays true.
///
/// Not the point -- the trigger above is -- but a body that returns an
/// allocation and is also five hundred operations long is one whose facts are
/// worth keeping local, by the same argument that deleted the general pass.
const VALUES: usize = 48;
const BLOCKS: usize = 8;

/// How far one function may grow before it stops accepting bodies.
///
/// The call graph being acyclic bounds this on its own, and that bound is
/// exponential: a chain of factories each called twice doubles at every level.
/// Without this the test suite went from twelve seconds to more than four
/// minutes and was still going.
const GROWTH: usize = 256;

/// Copy what has to be copied. Returns how many calls were replaced by a body.
pub fn inline(program: &mut Program) -> usize {
    let by_name: FxHashMap<String, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(at, func)| (func.name.clone(), at))
        .collect();
    let hands_back_an_allocation = worth_merging(program, &by_name);

    let mut done = 0;
    for at in 0..program.funcs.len() {
        let ceiling = program.funcs[at].values.len() + GROWTH;
        while program.funcs[at].values.len() < ceiling {
            let Some((block, position, target)) = next_call(&program.funcs[at], &by_name, |to| {
                to != at && hands_back_an_allocation.contains(&to)
            }) else {
                break;
            };
            let callee = program.funcs[target].clone();
            splice(&mut program.funcs[at], &callee, block, position);
            done += 1;
        }
    }
    done
}

/// Functions that hand back something they allocated.
///
/// And can be copied at all: a body that can reach itself would not terminate,
/// one with no `Return` has nothing to jump to the continuation with, and a
/// suspension is two functions pretending to be one.
fn worth_merging(program: &Program, by_name: &FxHashMap<String, usize>) -> FxHashSet<usize> {
    let reaches = call_graph(program, by_name);
    (0..program.funcs.len())
        .filter(|at| {
            let func = &program.funcs[*at];
            !reaches[*at].contains(at)
                && func.values.len() <= VALUES
                && func.blocks.len() <= BLOCKS
                && func
                    .blocks
                    .iter()
                    .any(|block| matches!(block.terminator, Terminator::Return(_)))
                && !func.values.iter().any(|op| {
                    matches!(
                        op.kind,
                        OpKind::Suspend { .. } | OpKind::Await { .. } | OpKind::CellReady { .. }
                    )
                })
                && func.blocks.iter().any(|block| {
                    let Terminator::Return(Some(value)) = &block.terminator else {
                        return false;
                    };
                    hands_back_plain_storage(func, &program.layouts, *value)
                })
        })
        .collect()
}

/// Whether a returned value is an allocation that owes nothing to anyone.
///
/// The allocation part is the reason to merge at all. "Owes nothing" is where
/// the line has to be drawn, and it is drawn by a defect rather than by taste.
///
/// A frame object's reference fields are released by `rc::release_value`, at
/// the point **the value's live range ends** -- there is no count to reach zero,
/// so the walk is emitted instead. Hand that pointer to a block parameter and
/// the duty lands on a value whose release is a release of a pointer, which
/// returns immediately for immortal storage, and everything it held is lost.
/// `0027` has the measurement: merging a `chain` that returns a list head put
/// the head in a frame and leaked all thirty-two links behind it.
///
/// An object with no reference fields has no such duty. There is nothing to
/// walk, so there is nothing to lose by putting it where the walk would not
/// happen. That is a `Box`, a `Point`, a result record -- which is what a
/// factory in a loop usually hands back -- and it is not a list node.
///
/// Widening this needs the duty attached to the frame rather than to the value.
/// Until then the restriction is the defect, written down.
fn hands_back_plain_storage(func: &Func, layouts: &[Layout], value: ValueId) -> bool {
    if !matches!(
        func.values[value.0 as usize].kind,
        OpKind::ObjectNew { .. }
    ) {
        return false;
    }
    let HirType::Managed(ManagedType::Object(id)) = &func.values[value.0 as usize].ty else {
        return false;
    };
    layouts
        .iter()
        .find(|layout| layout.types.contains(id))
        .is_some_and(|layout| layout.reference_fields().is_empty())
}

/// Which functions each function can reach through direct calls, transitively.
fn call_graph(program: &Program, by_name: &FxHashMap<String, usize>) -> Vec<FxHashSet<usize>> {
    let mut reaches: Vec<FxHashSet<usize>> = program
        .funcs
        .iter()
        .map(|func| {
            func.values
                .iter()
                .filter_map(|op| match &op.kind {
                    OpKind::Call {
                        callee: Callee::Direct(name),
                        ..
                    } => by_name.get(name.as_str()).copied(),
                    _ => None,
                })
                .collect()
        })
        .collect();
    loop {
        let mut grew = false;
        for at in 0..reaches.len() {
            let onward: FxHashSet<usize> = reaches[at]
                .iter()
                .flat_map(|to| reaches[*to].iter().copied())
                .collect();
            for one in onward {
                if reaches[at].insert(one) {
                    grew = true;
                }
            }
        }
        if !grew {
            return reaches;
        }
    }
}

/// The first direct call to a body worth merging, as (block, position, callee).
///
/// From scratch every time, which is what makes the loop above terminate: a
/// splice removes one direct call from the blocks, and the body it leaves
/// behind can only contain calls to functions further down an acyclic graph.
fn next_call(
    func: &Func,
    by_name: &FxHashMap<String, usize>,
    wanted: impl Fn(usize) -> bool,
) -> Option<(usize, usize, usize)> {
    for (at, block) in func.blocks.iter().enumerate() {
        for (position, value) in block.ops.iter().enumerate() {
            let OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } = &func.values[value.0 as usize].kind
            else {
                continue;
            };
            let Some(target) = by_name.get(name.as_str()).copied() else {
                continue;
            };
            if wanted(target) {
                return Some((at, position, target));
            }
        }
    }
    None
}

/// One block of the copied body, renumbered into the caller.
///
/// A parameter is an operation in the entry block and is now the argument, so
/// it is dropped rather than copied. A *block* parameter is not an operation at
/// all -- it is in `params` -- so it copies with the block that receives it.
/// And a `Return` is a jump to the continuation, carrying what it returned.
fn copied_block(
    from: &Func,
    source: &Block,
    map: &FxHashMap<ValueId, ValueId>,
    body: usize,
    onward: BlockId,
) -> Block {
    let shift = |target: BlockId| BlockId(target.0 + u32::try_from(body).unwrap_or(0));
    let ops = source
        .ops
        .iter()
        .filter(|value| !matches!(from.values[value.0 as usize].kind, OpKind::Param(_)))
        .filter_map(|value| map.get(value).copied())
        .collect();
    let params = source
        .params
        .iter()
        .filter_map(|value| map.get(value).copied())
        .collect();
    let terminator = match &source.terminator {
        Terminator::Return(value) => Terminator::Jump {
            target: onward,
            args: value
                .iter()
                .filter_map(|value| map.get(value).copied())
                .collect(),
        },
        other => {
            let mut moved = match other {
                Terminator::Jump { target, args } => Terminator::Jump {
                    target: shift(*target),
                    args: args.clone(),
                },
                Terminator::Branch {
                    cond,
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                } => Terminator::Branch {
                    cond: *cond,
                    then_target: shift(*then_target),
                    then_args: then_args.clone(),
                    else_target: shift(*else_target),
                    else_args: else_args.clone(),
                },
                kept => kept.clone(),
            };
            substitute_terminator(&mut moved, |value| map.get(&value).copied().unwrap_or(value));
            moved
        }
    };
    Block {
        params,
        ops,
        terminator,
    }
}

/// One body, copied in place of one call.
///
/// The callee's parameters are *substituted* rather than copied -- a parameter
/// is the argument, once the two frames are one. The call itself becomes the
/// block parameter of the continuation, which is what makes every existing
/// reader of its result correct without touching one of them: a `Return` in the
/// copy is a jump carrying the returned value, and the value it arrives as is
/// the value the call defined.
fn splice(into: &mut Func, from: &Func, block: usize, at: usize) {
    let call = into.blocks[block].ops[at];
    let OpKind::Call { args, .. } = into.values[call.0 as usize].kind.clone() else {
        return;
    };
    let hands_back = into.values[call.0 as usize].ty != HirType::Void;

    let mut map: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    let first = into.values.len();
    for (index, op) in from.values.iter().enumerate() {
        let each = ValueId(u32::try_from(index).unwrap_or(u32::MAX));
        if let OpKind::Param(slot) = op.kind {
            if let Some(argument) = args.get(slot as usize) {
                map.insert(each, *argument);
            }
            continue;
        }
        map.insert(
            each,
            ValueId(u32::try_from(into.values.len()).unwrap_or(u32::MAX)),
        );
        into.values.push(op.clone());
    }
    for index in first..into.values.len() {
        substitute(&mut into.values[index].kind, |value| {
            map.get(&value).copied().unwrap_or(value)
        });
    }

    let body = into.blocks.len();
    let onward = BlockId(u32::try_from(body + from.blocks.len()).unwrap_or(u32::MAX));

    // What came after the call is what the body returns to.
    let mut rest = into.blocks[block].ops.split_off(at);
    rest.remove(0);
    let ends = std::mem::replace(
        &mut into.blocks[block].terminator,
        Terminator::Jump {
            target: BlockId(u32::try_from(body).unwrap_or(0)),
            args: Vec::new(),
        },
    );

    // A call that returns nothing has no edge to ride, and becomes a dead
    // constant for `dce` to collect -- a value in no block at all would be an
    // operation the verifier cannot place.
    let carried = if hands_back {
        into.values[call.0 as usize].kind = OpKind::BlockParam(0);
        vec![call]
    } else {
        into.values[call.0 as usize].kind = OpKind::ConstBool(false);
        into.values[call.0 as usize].ty = HirType::Bool;
        rest.insert(0, call);
        Vec::new()
    };

    for source in &from.blocks {
        into.blocks.push(copied_block(from, source, &map, body, onward));
    }
    into.blocks.push(Block {
        params: carried,
        ops: rest,
        terminator: ends,
    });
}
