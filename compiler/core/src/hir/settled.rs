//! An `await` of a call that has already settled.
//!
//! # What this is
//!
//! `await step(x)`, where `step` is an `async` function that can neither
//! suspend nor reject, runs `step`'s body to completion inside the call, and
//! the promise it hands back is fulfilled before the caller sees it. The
//! `await` then subscribes to a settled promise, which queues the resumption
//! as one microtask -- and the promise is never read again except for its
//! payload. Every such `await` allocated a promise, fulfilled it, subscribed
//! to it, read it and destroyed it, for a value the callee had in a register.
//!
//! So such a call names the callee's **settled variant**: the same body,
//! answering its payload directly, with no promise made. The `await` keeps its
//! one microtask: [`super::suspend`] stores the payload in the frame and
//! queues the resumption at once ([`super::OpKind::Suspend`] with no promise),
//! which is exactly the job a subscription to a fulfilled promise queues, at
//! the same position in the same queue. Nothing a program can observe
//! changes: not the tick, not the order, not the value.
//!
//! # Which callees
//!
//! Each condition is a reason the subscription could do something the
//! microtask alone does not:
//!
//! - **It cannot suspend**: no `await`, `for await` or `yield` in its own body,
//!   and no frame. One that suspends settles later, on a turn of its own.
//! - **It cannot reject**: its result promise is only ever fulfilled. The
//!   lowering writes a `throw` in an `async` body, and a raise out of a call
//!   in one, as a rejection of that promise (`nts_promise_reject_*`), so a
//!   body whose promise has no rejection has no raise that reaches it.
//! - **Its payload cannot be a thenable**: a number, a boolean, a string, or
//!   nothing. Fulfilling with a promise or a thenable adopts it, which takes
//!   further ticks; an object, `unknown` or `any` could be one, so none of
//!   them is admitted. The lowering writes adoption as `nts_promise_adopt`,
//!   which is not a fulfilment and so also keeps a callee out.
//! - **Each return fulfils its promise once, immediately before returning,**
//!   and nothing else reads the promise -- not a store, not a closure, not a
//!   reaction. The variant then answers the value that fulfilment carried.
//!
//! And of the call: its promise is read by that one `await` and nothing else.
//! A promise stored, raced or awaited twice is a promise the program holds,
//! and it keeps one.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, ValueId};

/// The name of a callee's settled variant.
fn variant_name(callee: &str) -> String {
    format!("{callee}@settled")
}

/// A fulfilment a settled callee may end in. `nts_promise_fulfill_value` and
/// `_reference` are not one: their callers do not know the value's kind,
/// which is the case a thenable hides in.
enum Fulfilment {
    /// With nothing: `Promise<void>`.
    Nothing,
    /// With the value at this argument position.
    Value(usize),
}

fn fulfilment(name: &str) -> Option<Fulfilment> {
    match name {
        "nts_promise_fulfill_void" => Some(Fulfilment::Nothing),
        "nts_promise_fulfill_number" | "nts_promise_fulfill_tagged" => Some(Fulfilment::Value(1)),
        _ => None,
    }
}

/// A payload that is never a thenable, whatever value it holds.
fn plain_payload(payload: &HirType) -> bool {
    matches!(
        payload,
        HirType::Void
            | HirType::Bool
            | HirType::Float { .. }
            | HirType::Int { .. }
            | HirType::Managed(ManagedType::String)
    )
}

/// The settled variant of `func`, where it has one: see the module comment.
fn variant(func: &Func) -> Option<Func> {
    let result = func.async_result?;
    if func.frame.is_some() || func.exported || func.abstract_declaration {
        return None;
    }
    let HirType::Managed(ManagedType::Promise(payload)) = &func.return_type else {
        return None;
    };
    if !plain_payload(payload) {
        return None;
    }
    if func.values.iter().any(|op| {
        matches!(
            op.kind,
            OpKind::Await { .. } | OpKind::Yield { .. } | OpKind::Suspend { .. }
        )
    }) {
        return None;
    }
    // Where the promise is made, and what each returning block fulfils it with.
    let mut made = None;
    let mut answers: Vec<(usize, Option<ValueId>)> = Vec::new();
    for (at, block) in func.blocks.iter().enumerate() {
        let returns =
            matches!(block.terminator, Terminator::Return(Some(value)) if value == result);
        // The terminator reads the promise only by returning it.
        if !returns && super::operands_of_terminator(&block.terminator).contains(&result) {
            return None;
        }
        for (position, value) in block.ops.iter().enumerate() {
            if *value == result {
                made = Some((at, position));
                continue;
            }
            let kind = &func.values[value.0 as usize].kind;
            if !super::operands_of(kind).contains(&result) {
                continue;
            }
            // The one read a promise here may have: the fulfilment its
            // block's return hands back.
            let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = kind
            else {
                return None;
            };
            let carried = fulfilment(name)?;
            if !returns || position + 1 != block.ops.len() || args.first() != Some(&result) {
                return None;
            }
            if args.iter().skip(1).any(|arg| *arg == result) {
                return None;
            }
            let answer = match carried {
                Fulfilment::Nothing => None,
                Fulfilment::Value(at) => Some(args[at]),
            };
            if let Some(answer) = answer
                && func.values[answer.0 as usize].ty != **payload
            {
                return None;
            }
            answers.push((at, answer));
        }
        if returns && answers.last().is_none_or(|(block, _)| *block != at) {
            return None;
        }
    }
    let (made_in, made_at) = made?;
    if !matches!(
        &func.values[result.0 as usize].kind,
        OpKind::Call { callee: Callee::External(name), .. } if name == "nts_promise_new"
    ) {
        return None;
    }
    let mut settled = func.clone();
    settled.name = variant_name(&func.name);
    settled.return_type = (**payload).clone();
    settled.async_result = None;
    settled.blocks[made_in].ops.remove(made_at);
    for (at, answer) in answers {
        let block = &mut settled.blocks[at];
        block.ops.pop();
        block.terminator = Terminator::Return(answer);
    }
    Some(settled)
}

/// Every function's settled variant, by the name of the function it is a
/// variant of.
pub(super) fn variants(program: &Program) -> FxHashMap<String, Func> {
    program
        .funcs
        .iter()
        .filter_map(|func| Some((func.name.clone(), variant(func)?)))
        .collect()
}

/// `func` with each `await` of a call to a settled callee calling its variant
/// instead, and the awaits that now take a value rather than a promise.
///
/// `None` where no `await` in it qualifies, so the caller keeps the original.
pub(super) fn settle_awaits(
    func: &Func,
    variants: &FxHashMap<String, Func>,
) -> Option<(Func, FxHashSet<ValueId>)> {
    let mut reads: FxHashMap<ValueId, usize> = FxHashMap::default();
    for block in &func.blocks {
        for value in &block.ops {
            for operand in super::operands_of(&func.values[value.0 as usize].kind) {
                *reads.entry(operand).or_default() += 1;
            }
        }
        for operand in super::operands_of_terminator(&block.terminator) {
            *reads.entry(operand).or_default() += 1;
        }
    }
    let mut settled = FxHashSet::default();
    let mut rewritten = func.clone();
    for block in &func.blocks {
        for value in &block.ops {
            let OpKind::Await { promise, .. } = &func.values[value.0 as usize].kind else {
                continue;
            };
            let OpKind::Call {
                callee: Callee::Direct(callee),
                args,
                frame,
            } = &func.values[promise.0 as usize].kind
            else {
                continue;
            };
            let Some(variant) = variants.get(callee) else {
                continue;
            };
            if reads.get(promise).copied() != Some(1) {
                continue;
            }
            let call = &mut rewritten.values[promise.0 as usize];
            call.kind = OpKind::Call {
                callee: Callee::Direct(variant.name.clone()),
                args: args.clone(),
                frame: *frame,
            };
            call.ty = variant.return_type.clone();
            settled.insert(*value);
        }
    }
    if settled.is_empty() {
        return None;
    }
    // A settled await has no rejection to deliver, so its edge into a `catch`
    // goes, and a handler only that edge reached goes with it: a block with no
    // predecessor is one the verifier refuses.
    for value in &settled {
        if let OpKind::Await { rejects_to, .. } = &mut rewritten.values[value.0 as usize].kind {
            *rejects_to = None;
        }
    }
    super::dce::prune_unreachable(&mut rewritten);
    Some((rewritten, settled))
}
