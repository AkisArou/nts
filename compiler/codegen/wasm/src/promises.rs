//! Promises, the tasks their settlement queues, and the checkpoint that runs
//! them, as the C runtime's `NtsPromise`, `NtsTask` and `nts_leave`
//! (docs/async.md; runtime/c `nts_promise_*`).
//!
//! - **A promise** is an object (descriptor, identity hash) holding its state
//!   (0 pending, 1 fulfilled, 2 rejected), one erased settlement, the pair of
//!   resolving functions that may resolve it now, whether anything subscribed,
//!   and its reactions in subscription order.
//! - **A task** is `{ run, state }`, where every `run` has one type,
//!   `(anyref) -> ()`: a resumption's thunk with its frame, a closure's call
//!   thunk with the closure, or an adoption step with its adoption.
//! - **Settling** a pending promise stores the settlement and queues every
//!   reaction, in order; settling twice is a no-op. Subscribing to a settled
//!   promise queues the reaction; it never runs inline. A rejection nothing
//!   listened to is a candidate, and the outermost checkpoint throws one still
//!   unhandled uncaught, as `nts_uncaught` does.
//! - **The checkpoint** drains ticks to empty, then microtasks to empty, and
//!   repeats while ticks remain (ticks are unreachable today; the shape keeps
//!   timers from reordering). It runs when the outermost export returns,
//!   however it returns, and when module initialization ends, unless a host
//!   owns the queue (`host_owned`, the Blink case).
use crate::{
    body::Body,
    contract,
    erased::{self, Singleton},
    error::Failure,
    gc::PromiseTypes,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    numeric, objects, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, OpKind, ValueId};
use wasm_encoder::{BlockType, GlobalType, HeapType, Instruction as I, RefType, ValType};

const PENDING: i32 = 0;
const FULFILLED: i32 = 1;
const REJECTED: i32 = 2;

/// A module helper of the promise machinery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// Append a task to a queue: `(task)`.
    Enqueue(Queue),
    /// `(promise, task)`.
    Subscribe,
    /// `(promise, state, value)`: settle a pending promise.
    Settle,
    /// `(outer, inner)`.
    Adopt,
    /// `(promise, value)`: adopt a promise, fulfil with anything else.
    Resolve,
    /// Run every queued task to a fixpoint, then report.
    Drain,
    /// One host entry out: the checkpoint at the outermost.
    Leave,
    /// `(promise)`: a rejection nothing listened to, for the report.
    Candidate,
    /// `(promise, name) -> T`: the settlement of a promise in `state`, read
    /// as `T`, refused by name otherwise.
    Read(i32, Read),
}

/// What a settlement is read as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Read {
    Erased,
    Number,
    Boolean,
    String,
    /// A nullable reference of this type: null for an absent settlement.
    Reference(u32),
}

/// Which queue a task goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Queue {
    Tick,
    Micro,
}

/// A task's `run`, each of type `(anyref) -> ()`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Thunk {
    /// Resume the frame by the named resumption.
    Resume(String),
    /// Call a closure of this class through this slot, with no arguments.
    Closure(nts_core::hir::ClassId, u32),
    /// An adoption's first step: subscribe its second to the inner promise.
    AdoptBegin,
    /// An adoption's second step: forward the inner settlement outward.
    AdoptSettled,
    /// Tell the host a promise it watches settled: the state is its id.
    Watch,
}

/// The module-wide state the checkpoint keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum State {
    Queue(Queue),
    Head(Queue),
    Tail(Queue),
    /// How many exports are running, one inside another.
    Depth,
    /// Whether a checkpoint is running.
    Active,
    /// Whether the host owns the microtask queue (none does yet).
    HostOwned,
    /// The rejected promises nothing listened to, and how many.
    Rejected,
    RejectedCount,
}

/// The runtime calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    New,
    FulfillVoid,
    FulfillNumber,
    FulfillReference,
    FulfillTagged,
    FulfillValue,
    Reject,
    RejectValue,
    RejectWith,
    IsRejected,
    Number,
    Reference,
    Value,
    Reason,
    State,
    Claim,
    Pair,
    Adopt,
    ResolveValue,
    EnqueueJob,
    IsPromise,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_promise_new" => Op::New,
        "nts_promise_fulfill_void" => Op::FulfillVoid,
        "nts_promise_fulfill_number" => Op::FulfillNumber,
        "nts_promise_fulfill_reference" => Op::FulfillReference,
        "nts_promise_fulfill_tagged" => Op::FulfillTagged,
        "nts_promise_fulfill_value" => Op::FulfillValue,
        "nts_promise_reject" => Op::Reject,
        "nts_promise_reject_value" => Op::RejectValue,
        "nts_promise_reject_with" => Op::RejectWith,
        "nts_promise_is_rejected" => Op::IsRejected,
        "nts_promise_number" => Op::Number,
        "nts_promise_reference" => Op::Reference,
        "nts_promise_value" => Op::Value,
        "nts_promise_reason" => Op::Reason,
        "nts_promise_state" => Op::State,
        "nts_promise_claim" => Op::Claim,
        "nts_promise_pair" => Op::Pair,
        "nts_promise_adopt" => Op::Adopt,
        "nts_promise_resolve_value" => Op::ResolveValue,
        "nts_enqueue_job" => Op::EnqueueJob,
        "nts_is_promise" => Op::IsPromise,
        _ => return None,
    })
}

#[cfg(test)]
impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    pub(crate) const fn inline(self) -> bool {
        !matches!(
            self,
            Self::FulfillVoid
                | Self::FulfillNumber
                | Self::FulfillReference
                | Self::FulfillTagged
                | Self::FulfillValue
                | Self::Reject
                | Self::RejectValue
                | Self::RejectWith
                | Self::Adopt
                | Self::ResolveValue
                | Self::EnqueueJob
        )
    }
}

pub(crate) fn types(m: &Builder<'_>) -> Result<PromiseTypes, Failure> {
    m.types
        .promise
        .ok_or_else(|| Failure::Invariant("unplanned promise types".into()))
}
fn concrete(index: u32, nullable: bool) -> RefType {
    RefType {
        nullable,
        heap_type: HeapType::Concrete(index),
    }
}
fn field(p: PromiseTypes, index: u32) -> I<'static> {
    I::StructGet {
        struct_type_index: p.promise,
        field_index: index,
    }
}
fn store(p: PromiseTypes, index: u32) -> I<'static> {
    I::StructSet {
        struct_type_index: p.promise,
        field_index: index,
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let p = types(b.m)?;
    let arity = match op {
        Op::New => 0,
        Op::FulfillVoid
        | Op::IsRejected
        | Op::Number
        | Op::Reference
        | Op::Value
        | Op::Reason
        | Op::State
        | Op::Pair
        | Op::IsPromise => 1,
        Op::FulfillTagged => 3,
        _ => 2,
    };
    if args.len() != arity {
        return Err(format!("promise helper {op:?} arity mismatch").into());
    }
    if !matches!(op, Op::New | Op::IsPromise | Op::EnqueueJob) {
        contract::nonnull(b, args[0], "a method of a null promise")?;
    }
    match op {
        Op::New => {
            let descriptor = objects::descriptor(b.m, p.descriptor)?;
            b.global_get(descriptor);
            b.instructions_from(&[
                objects::UNHASHED,
                I::I32Const(PENDING),
                I::RefNull(HeapType::ANY),
                I::I32Const(0),
                I::I32Const(0),
                I::RefNull(HeapType::Concrete(p.tasks)),
                I::I32Const(0),
                I::StructNew(p.promise),
            ]);
        }
        Op::FulfillVoid
        | Op::FulfillNumber
        | Op::FulfillReference
        | Op::FulfillTagged
        | Op::FulfillValue
        | Op::Reject
        | Op::RejectValue
        | Op::RejectWith => settle_call(b, op, p, args)?,
        Op::IsRejected => {
            b.load(args[0])?;
            b.instructions_from(&[field(p, p.state()), I::I32Const(REJECTED), I::I32Eq]);
        }
        Op::State => {
            b.load(args[0])?;
            b.instructions_from(&[field(p, p.state()), I::F64ConvertI32U]);
            numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())?;
        }
        Op::Number | Op::Reference | Op::Value | Op::Reason => read(b, result, op, args[0])?,
        Op::Claim => claim(b, p, args)?,
        Op::Pair => {
            b.load(args[0])?;
            b.instruction(&field(p, p.resolutions()));
            numeric::convert(b, &U32, &b.ty(result).clone())?;
        }
        Op::Adopt => {
            let adopt = callee(b.m, Helper::Adopt)?;
            contract::nonnull(b, args[1], "adopting a null promise")?;
            b.load(args[0])?;
            b.load(args[1])?;
            b.call(adopt);
        }
        Op::ResolveValue => {
            let resolve = callee(b.m, Helper::Resolve)?;
            b.load(args[0])?;
            settlement(b, args[1])?;
            b.call(resolve);
        }
        Op::EnqueueJob => {
            let OpKind::DispatchSlot(slot) = b.func.value(args[1]).kind else {
                return Err("a job whose call slot is not a constant".into());
            };
            contract::nonnull(b, args[0], "queueing a null job")?;
            let task = closure_task(b, args[0], slot)?;
            let enqueue = callee(b.m, Helper::Enqueue(Queue::Micro))?;
            b.call_task(task)?;
            b.call(enqueue);
        }
        Op::IsPromise => {
            b.load(args[0])?;
            b.instruction(&I::RefTestNonNull(HeapType::Concrete(p.promise)));
        }
    }
    Ok(())
}

/// A fulfilment or a rejection: the promise settled with its operand erased,
/// or, for `reject_with`, with another rejected promise's reason.
fn settle_call(
    b: &mut Body<'_, '_>,
    op: Op,
    p: PromiseTypes,
    args: &[ValueId],
) -> Result<(), Failure> {
    let settle = callee(b.m, Helper::Settle)?;
    if op == Op::RejectWith {
        contract::nonnull(b, args[1], "forwarding the rejection of a null promise")?;
        b.load(args[1])?;
        b.instruction(&field(p, p.state()));
        b.instruction(&I::I32Const(REJECTED));
        b.instruction(&I::I32Eq);
        contract::require(b, "forwarding a rejection from a promise that has none")?;
        b.load(args[0])?;
        b.instruction(&I::I32Const(REJECTED));
        b.load(args[1])?;
        b.instruction(&field(p, p.value()));
        b.call(settle);
        return Ok(());
    }
    let state = if matches!(op, Op::Reject | Op::RejectValue) {
        REJECTED
    } else {
        FULFILLED
    };
    b.load(args[0])?;
    b.instruction(&I::I32Const(state));
    if op == Op::FulfillVoid {
        let undefined = erased::singleton(b.m, Singleton::Undefined)?;
        b.global_get(undefined);
    } else {
        settlement(b, args[1])?;
    }
    b.call(settle);
    Ok(())
}

/// `claim`: the pair numbered `resolutions` may resolve the promise, once.
fn claim(b: &mut Body<'_, '_>, p: PromiseTypes, args: &[ValueId]) -> Result<(), Failure> {
    // The pair numbered `resolutions` may resolve it, once.
    let pair = args[1];
    b.load(args[0])?;
    b.instruction(&field(p, p.resolutions()));
    b.load(pair)?;
    numeric::convert(b, &b.ty(pair).clone(), &U32)?;
    b.instruction(&I::I32Eq);
    b.instruction(&I::If(BlockType::Result(ValType::I32)));
    b.load(args[0])?;
    b.load(pair)?;
    numeric::convert(b, &b.ty(pair).clone(), &U32)?;
    b.instructions_from(&[
        I::I32Const(1),
        I::I32Add,
        store(p, p.resolutions()),
        I::I32Const(1),
        I::Else,
        I::I32Const(0),
        I::End,
    ]);
    Ok(())
}

const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

/// A settlement operand, erased: a value the compiler typed is erased as its
/// type says; an erased one is stored as it is.
fn settlement(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    let ty = b.ty(value).clone();
    if ty == HirType::Erased {
        return b.load(value);
    }
    erased::erase(b, value, nts_core::hir::Absent::Impossible)
}

/// A read of a settled promise's settlement, refused by name where the C
/// runtime aborts: a reason of a promise not rejected, a value of one not
/// fulfilled, a number of a settlement that is not one.
fn read(b: &mut Body<'_, '_>, result: ValueId, op: Op, promise: ValueId) -> Result<(), Failure> {
    let state = if op == Op::Reason {
        REJECTED
    } else {
        FULFILLED
    };
    let ty = b.ty(result).clone();
    let kind = match (op, &ty) {
        (Op::Value | Op::Reason, _) | (_, HirType::Erased) => Read::Erased,
        (_, HirType::Float { bits: 64 }) => Read::Number,
        (_, HirType::Bool) => Read::Boolean,
        (_, HirType::Managed(ManagedType::String)) => Read::String,
        (_, HirType::Managed(_)) => match b.types().value_slot(&ty)? {
            Physical::Reference(RefType {
                heap_type: HeapType::Concrete(index),
                ..
            }) => Read::Reference(index),
            _ => return Err(format!("a promise's settlement read as {ty:?}").into()),
        },
        _ => return Err(format!("a promise's settlement read as {ty:?}").into()),
    };
    let reader = callee(b.m, Helper::Read(state, kind))?;
    b.load(promise)?;
    strings::constant(b, &b.func.name.clone());
    b.call(reader);
    Ok(())
}

/// The operations that belong to promises: a closure's call slot (a value only
/// the call taking it reads), a suspension, and a reaction's subscription.
pub(crate) fn operation(b: &mut Body<'_, '_>, kind: &OpKind) -> Result<(), Failure> {
    match kind {
        OpKind::DispatchSlot(slot) => {
            b.instruction(&I::F64Const(f64::from(*slot).into()));
            Ok(())
        }
        OpKind::Suspend {
            promise,
            frame,
            resume,
        } => suspend(b, *promise, *frame, resume),
        OpKind::PromiseSubscribe {
            promise,
            reaction,
            slot,
        } => subscribe(b, *promise, *reaction, *slot),
        _ => Err(Failure::Invariant(format!(
            "{kind:?} is not a promise operation"
        ))),
    }
}

/// `Suspend`: the frame's resumption, queued when the promise settles.
fn suspend(
    b: &mut Body<'_, '_>,
    promise: ValueId,
    frame: ValueId,
    resume: &str,
) -> Result<(), Failure> {
    let p = types(b.m)?;
    contract::nonnull(b, promise, "awaiting a null promise")?;
    let thunk = thunk(b.m, Thunk::Resume(resume.to_owned()))?;
    let subscribe = callee(b.m, Helper::Subscribe)?;
    b.load(promise)?;
    b.code.ref_func(thunk);
    b.load(frame)?;
    b.instruction(&I::StructNew(p.task));
    b.call(subscribe);
    Ok(())
}

/// `PromiseSubscribe`: a reaction closure, called with nothing when the
/// promise settles.
fn subscribe(
    b: &mut Body<'_, '_>,
    promise: ValueId,
    reaction: ValueId,
    slot: u32,
) -> Result<(), Failure> {
    contract::nonnull(b, promise, "subscribing to a null promise")?;
    contract::nonnull(b, reaction, "subscribing a null reaction")?;
    let subscribe = callee(b.m, Helper::Subscribe)?;
    b.load(promise)?;
    let task = closure_task(b, reaction, slot)?;
    b.call_task(task)?;
    b.call(subscribe);
    Ok(())
}

/// The task that calls `closure` through `slot`.
pub(crate) fn closure_task(
    b: &mut Body<'_, '_>,
    closure: ValueId,
    slot: u32,
) -> Result<Task, Failure> {
    let HirType::Managed(ManagedType::Object(class)) = *b.ty(closure) else {
        return Err(format!("a task of a non-closure {:?}", b.ty(closure)).into());
    };
    let thunk = thunk(b.m, Thunk::Closure(class, slot))?;
    Ok(Task {
        thunk,
        state: closure,
    })
}

/// A task to build at a call site.
#[derive(Clone, Copy)]
pub(crate) struct Task {
    thunk: Func,
    state: ValueId,
}

/// A task built at a call site, on the stack.
pub(crate) fn push_task(b: &mut Body<'_, '_>, task: Task) -> Result<(), Failure> {
    b.call_task(task)
}

impl Body<'_, '_> {
    fn call_task(&mut self, task: Task) -> Result<(), Failure> {
        let p = types(self.m)?;
        self.code.ref_func(task.thunk);
        self.load(task.state)?;
        self.instruction(&I::StructNew(p.task));
        Ok(())
    }
    fn instructions_from(&mut self, instructions: &[I<'static>]) {
        for instruction in instructions {
            self.instruction(instruction);
        }
    }
}

/// A task's `run`, typed `(anyref) -> ()`.
fn thunk(m: &mut Builder<'_>, thunk: Thunk) -> Result<Func, Failure> {
    let p = types(m)?;
    let key = FuncKey::Task(thunk.clone());
    let name = format!("task.{thunk:?}");
    m.helper_typed(key, name, p.run, move |m| {
        let mut f = Function::default();
        match &thunk {
            Thunk::Resume(resume) => {
                let target = m.program_func(resume)?;
                let frame = m
                    .hir_func(resume)
                    .and_then(|func| func.params.first())
                    .map(|param| param.ty.clone())
                    .ok_or_else(|| Failure::Invariant(format!("resumption `{resume}`")))?;
                let storage = m.types.objects.object(&frame)?.physical;
                f.instructions(&[
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(storage)),
                ]);
                f.call(target);
            }
            Thunk::Closure(class, slot) => {
                let (base, field, signature, result) =
                    crate::callables::closure_entry(m, *class, *slot)?;
                f.instructions(&[
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(base)),
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(base)),
                    I::StructGet {
                        struct_type_index: base,
                        field_index: field,
                    },
                    I::CallRef(signature),
                ]);
                if result {
                    f.instruction(&I::Drop);
                }
            }
            Thunk::AdoptBegin => {
                let subscribe = callee(m, Helper::Subscribe)?;
                let settled = thunk_ref(m, Thunk::AdoptSettled)?;
                f.instructions(&[
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(p.adoption)),
                    I::StructGet {
                        struct_type_index: p.adoption,
                        field_index: 1,
                    },
                ]);
                f.ref_func(settled);
                f.instructions(&[I::LocalGet(0), I::StructNew(p.task)]);
                f.call(subscribe);
            }
            Thunk::Watch => {
                let settled = m.import(
                    FuncKey::PromiseSettled,
                    "nts:host/v1",
                    "promiseSettled",
                    vec![Physical::Scalar(Slot::I32)],
                    None,
                    false,
                );
                f.instructions(&[I::LocalGet(0), I::RefCastNonNull(HeapType::I31), I::I31GetS]);
                f.call(settled);
            }
            Thunk::AdoptSettled => {
                // The inner settlement, forwarded as it is.
                let settle = callee(m, Helper::Settle)?;
                let adoption = |f: &mut Function, at: u32| {
                    f.instructions(&[
                        I::LocalGet(0),
                        I::RefCastNonNull(HeapType::Concrete(p.adoption)),
                        I::StructGet {
                            struct_type_index: p.adoption,
                            field_index: at,
                        },
                    ]);
                };
                adoption(&mut f, 0);
                adoption(&mut f, 1);
                f.instruction(&field(p, p.state()));
                adoption(&mut f, 1);
                f.instruction(&field(p, p.value()));
                f.call(settle);
            }
        }
        f.instruction(&I::End);
        Ok(f)
    })
}
fn thunk_ref(m: &mut Builder<'_>, which: Thunk) -> Result<Func, Failure> {
    thunk(m, which)
}

/// A mutable module global of the checkpoint's state.
pub(crate) fn state(m: &mut Builder<'_>, which: State) -> Result<Global, Failure> {
    let p = types(m)?;
    m.global(GlobalKey::Promise(which), |_| {
        let mut init = ir::Code::default();
        let ty = match which {
            State::Queue(_) => {
                init.instruction(&I::RefNull(HeapType::Concrete(p.tasks)));
                ValType::Ref(concrete(p.tasks, true))
            }
            State::Rejected => {
                init.instruction(&I::RefNull(HeapType::Concrete(p.promises)));
                ValType::Ref(concrete(p.promises, true))
            }
            _ => {
                init.instruction(&I::I32Const(0));
                ValType::I32
            }
        };
        Ok((
            GlobalType {
                val_type: ty,
                mutable: true,
                shared: false,
            },
            init,
        ))
    })
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let p = types(m)?;
    let promise = Physical::Reference(concrete(p.promise, true));
    let task = Physical::Reference(concrete(p.task, false));
    let anyref = Physical::Reference(RefType::ANYREF);
    let i32 = Physical::Scalar(Slot::I32);
    let params = match helper {
        Helper::Enqueue(_) => vec![task],
        Helper::Subscribe => vec![promise, task],
        Helper::Settle => vec![promise, i32, anyref],
        Helper::Adopt => vec![promise, promise],
        Helper::Resolve => vec![promise, anyref],
        Helper::Drain | Helper::Leave => vec![],
        Helper::Candidate => vec![promise],
        Helper::Read(..) => vec![promise, strings::STRING],
    };
    let result = match helper {
        Helper::Read(_, read) => Some(match read {
            Read::Erased => anyref,
            Read::Number => Physical::Scalar(Slot::F64),
            Read::Boolean => i32,
            Read::String => strings::STRING,
            Read::Reference(index) => Physical::Reference(concrete(index, true)),
        }),
        _ => None,
    };
    m.helper(
        FuncKey::Promise(helper),
        format!("promise.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Enqueue(queue) => enqueue(m, queue),
            Helper::Subscribe => subscribe_body(m),
            Helper::Settle => settle(m),
            Helper::Adopt => adopt(m),
            Helper::Resolve => resolve(m),
            Helper::Drain => drain(m),
            Helper::Leave => leave(m),
            Helper::Candidate => candidate(m),
            Helper::Read(state, read) => read_body(m, state, read),
        },
    )
}

/// Append a task to a queue, a ring of `head..tail` in a growable array:
/// compacted to the front when full and started late, else doubled.
///
/// Params: task. Locals: queue, length, grown.
fn enqueue(m: &mut Builder<'_>, which: Queue) -> Result<Function, Failure> {
    let p = types(m)?;
    let queue = state(m, State::Queue(which))?;
    let head = state(m, State::Head(which))?;
    let tail = state(m, State::Tail(which))?;
    let tasks = ValType::Ref(concrete(p.tasks, true));
    let (array, length, grown) = (1, 2, 3);
    let mut f = Function::new([tasks, ValType::I32, tasks]);
    f.global_get(queue);
    f.instructions(&[
        I::LocalTee(array),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::I32Const(8),
        I::ArrayNewDefault(p.tasks),
        I::LocalTee(array),
    ]);
    f.global_set(queue);
    f.instructions(&[I::End, I::LocalGet(array), I::ArrayLen, I::LocalSet(length)]);
    f.global_get(tail);
    f.instructions(&[I::LocalGet(length), I::I32Eq, I::If(BlockType::Empty)]);
    // Full: room at the front moves the live run there, else double.
    f.instructions(&[
        I::LocalGet(length),
        I::I32Const(1),
        I::I32Shl,
        I::LocalGet(length),
        I::LocalGet(length),
    ]);
    f.global_get(head);
    f.instructions(&[I::I32Const(2), I::I32Mul, I::I32GeU, I::Select]);
    f.instructions(&[
        I::ArrayNewDefault(p.tasks),
        I::LocalTee(grown),
        I::I32Const(0),
        I::LocalGet(array),
    ]);
    f.global_get(head);
    f.global_get(tail);
    f.global_get(head);
    f.instructions(&[
        I::I32Sub,
        I::ArrayCopy {
            array_type_index_dst: p.tasks,
            array_type_index_src: p.tasks,
        },
        I::LocalGet(grown),
    ]);
    f.global_set(queue);
    f.global_get(tail);
    f.global_get(head);
    f.instruction(&I::I32Sub);
    f.global_set(tail);
    f.instruction(&I::I32Const(0));
    f.global_set(head);
    f.instruction(&I::End);
    f.global_get(queue);
    f.global_get(tail);
    f.instructions(&[I::LocalGet(0), I::ArraySet(p.tasks)]);
    f.global_get(tail);
    f.instructions(&[I::I32Const(1), I::I32Add]);
    f.global_set(tail);
    f.instruction(&I::End);
    Ok(f)
}

/// Subscribe a task: the promise is handled from now on; a settled promise
/// queues the task, a pending one appends it to its reactions.
///
/// Params: promise, task. Locals: reactions, count, grown.
fn subscribe_body(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = types(m)?;
    let enqueue = callee(m, Helper::Enqueue(Queue::Micro))?;
    let tasks = ValType::Ref(concrete(p.tasks, true));
    let (reactions, count, grown) = (2, 3, 4);
    let mut f = Function::new([tasks, ValType::I32, tasks]);
    f.instructions(&[
        I::LocalGet(0),
        I::I32Const(1),
        store(p, p.handled()),
        I::LocalGet(0),
        field(p, p.state()),
        I::If(BlockType::Empty),
        I::LocalGet(1),
    ]);
    f.call(enqueue);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(0),
        field(p, p.reactions()),
        I::LocalSet(reactions),
        I::LocalGet(0),
        field(p, p.count()),
        I::LocalSet(count),
        // No list, or a full one: one twice as long, or four.
        I::LocalGet(reactions),
        I::RefIsNull,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(1),
        I::Else,
        I::LocalGet(count),
        I::LocalGet(reactions),
        I::ArrayLen,
        I::I32Eq,
        I::End,
        I::If(BlockType::Empty),
        I::LocalGet(count),
        I::I32Const(1),
        I::I32Shl,
        I::I32Const(4),
        I::LocalGet(count),
        I::I32Const(2),
        I::I32GeU,
        I::Select,
        I::ArrayNewDefault(p.tasks),
        I::LocalSet(grown),
        I::LocalGet(reactions),
        I::RefIsNull,
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(grown),
        I::I32Const(0),
        I::LocalGet(reactions),
        I::I32Const(0),
        I::LocalGet(count),
        I::ArrayCopy {
            array_type_index_dst: p.tasks,
            array_type_index_src: p.tasks,
        },
        I::End,
        I::LocalGet(0),
        I::LocalGet(grown),
        store(p, p.reactions()),
        I::LocalGet(grown),
        I::LocalSet(reactions),
        I::End,
        I::LocalGet(reactions),
        I::LocalGet(count),
        I::LocalGet(1),
        I::ArraySet(p.tasks),
        I::LocalGet(0),
        I::LocalGet(count),
        I::I32Const(1),
        I::I32Add,
        store(p, p.count()),
        I::End,
    ]);
    Ok(f)
}

/// Settle a pending promise and queue its reactions in subscription order; a
/// settled one stays as it is. A rejection nothing listened to becomes a
/// candidate for the unhandled report.
///
/// Params: promise, state, value. Locals: listened, at, count, reactions.
fn settle(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = types(m)?;
    let enqueue = callee(m, Helper::Enqueue(Queue::Micro))?;
    let candidate = callee(m, Helper::Candidate)?;
    let tasks = ValType::Ref(concrete(p.tasks, true));
    let (listened, at, count, reactions) = (3, 4, 5, 6);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32, tasks]);
    f.instructions(&[
        I::LocalGet(0),
        field(p, p.state()),
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(0),
        field(p, p.count()),
        I::LocalGet(0),
        field(p, p.handled()),
        I::I32Or,
        I::LocalSet(listened),
        I::LocalGet(0),
        I::LocalGet(2),
        store(p, p.value()),
        I::LocalGet(0),
        I::LocalGet(1),
        store(p, p.state()),
        I::LocalGet(0),
        field(p, p.reactions()),
        I::LocalSet(reactions),
        I::LocalGet(0),
        field(p, p.count()),
        I::LocalSet(count),
        I::LocalGet(0),
        I::RefNull(HeapType::Concrete(p.tasks)),
        store(p, p.reactions()),
        I::LocalGet(0),
        I::I32Const(0),
        store(p, p.count()),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
        I::LocalGet(count),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(reactions),
        I::LocalGet(at),
        I::ArrayGet(p.tasks),
        I::RefAsNonNull,
    ]);
    f.call(enqueue);
    f.instructions(&[
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(1),
        I::I32Const(REJECTED),
        I::I32Eq,
        I::LocalGet(listened),
        I::I32Eqz,
        I::I32And,
        I::If(BlockType::Empty),
        I::LocalGet(0),
    ]);
    f.call(candidate);
    f.instructions(&[I::End, I::End]);
    Ok(f)
}

fn adopt(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = types(m)?;
    let begin = thunk(m, Thunk::AdoptBegin)?;
    let enqueue = callee(m, Helper::Enqueue(Queue::Micro))?;
    let mut f = Function::default();
    f.ref_func(begin);
    f.instructions(&[
        I::LocalGet(0),
        I::RefAsNonNull,
        I::LocalGet(1),
        I::RefAsNonNull,
        I::StructNew(p.adoption),
        I::StructNew(p.task),
    ]);
    f.call(enqueue);
    f.instruction(&I::End);
    Ok(f)
}

/// Resolve with a value whose kind is known only at run time: a promise is
/// adopted, anything else fulfils.
fn resolve(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = types(m)?;
    let adopt = callee(m, Helper::Adopt)?;
    let settle = callee(m, Helper::Settle)?;
    let mut f = Function::default();
    f.instructions(&[
        I::LocalGet(1),
        I::RefTestNonNull(HeapType::Concrete(p.promise)),
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::LocalGet(1),
        I::RefCastNonNull(HeapType::Concrete(p.promise)),
    ]);
    f.call(adopt);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(0),
        I::I32Const(FULFILLED),
        I::LocalGet(1),
    ]);
    f.call(settle);
    f.instruction(&I::End);
    Ok(f)
}

/// Run tasks to a fixpoint, ticks to empty and then microtasks to empty while
/// ticks remain, then, at the outermost checkpoint, throw a rejection still
/// unhandled uncaught. A task that leaves a raise pending throws it uncaught.
///
/// Locals: previous, task.
fn drain(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = types(m)?;
    let active = state(m, State::Active)?;
    let (previous, task) = (0, 1);
    let mut f = Function::new([ValType::I32, ValType::Ref(concrete(p.task, true))]);
    f.global_get(active);
    f.instruction(&I::LocalSet(previous));
    f.instruction(&I::I32Const(1));
    f.global_set(active);
    f.instructions(&[I::Loop(BlockType::Empty)]);
    for queue in [Queue::Tick, Queue::Micro] {
        run_queue(&mut f, m, p, queue, task)?;
    }
    let tick_head = state(m, State::Head(Queue::Tick))?;
    let tick_tail = state(m, State::Tail(Queue::Tick))?;
    f.global_get(tick_tail);
    f.global_get(tick_head);
    f.instructions(&[I::I32GtU, I::BrIf(0), I::End, I::LocalGet(previous)]);
    f.global_set(active);
    f.instructions(&[I::LocalGet(previous), I::I32Eqz, I::If(BlockType::Empty)]);
    report_unhandled(&mut f, m, p)?;
    f.instructions(&[I::End, I::End]);
    Ok(f)
}

/// Run one queue's tasks until it is empty, reading its bounds on every step
/// so a task queued meanwhile runs too; then reset it to empty.
fn run_queue(
    f: &mut Function,
    m: &mut Builder<'_>,
    p: PromiseTypes,
    queue: Queue,
    task: u32,
) -> Result<(), Failure> {
    let tasks = state(m, State::Queue(queue))?;
    let head = state(m, State::Head(queue))?;
    let tail = state(m, State::Tail(queue))?;
    f.instructions(&[I::Block(BlockType::Empty), I::Loop(BlockType::Empty)]);
    f.global_get(head);
    f.global_get(tail);
    f.instructions(&[I::I32GeU, I::BrIf(1)]);
    f.global_get(tasks);
    f.global_get(head);
    f.instructions(&[I::ArrayGet(p.tasks), I::LocalSet(task)]);
    f.global_get(tasks);
    f.global_get(head);
    f.instructions(&[I::RefNull(HeapType::Concrete(p.task)), I::ArraySet(p.tasks)]);
    f.global_get(head);
    f.instructions(&[I::I32Const(1), I::I32Add]);
    f.global_set(head);
    f.instructions(&[
        I::LocalGet(task),
        I::StructGet {
            struct_type_index: p.task,
            field_index: 1,
        },
        I::LocalGet(task),
        I::StructGet {
            struct_type_index: p.task,
            field_index: 0,
        },
        I::CallRef(p.run),
    ]);
    if m.raises {
        // A task cannot leave a raise behind: it is thrown uncaught.
        let flag = crate::raising::state(m, crate::raising::Slot::Flag)?;
        let take = crate::raising::callee(m, crate::raising::Helper::Take)?;
        let uncaught = crate::raising::callee(m, crate::raising::Helper::Uncaught)?;
        let name = m.literal("a promise task");
        f.global_get(flag);
        f.instruction(&I::If(BlockType::Empty));
        f.call(take);
        f.global_get(name);
        f.call(uncaught);
        f.instructions(&[I::Unreachable, I::End]);
    }
    f.instructions(&[I::Br(0), I::End, I::End, I::I32Const(0)]);
    f.global_set(head);
    f.instruction(&I::I32Const(0));
    f.global_set(tail);
    Ok(())
}

/// Every candidate still rejected and unhandled is thrown uncaught, the first
/// one ending the turn as `nts_uncaught` ends the process; the list empties
/// first, so a later turn does not report it again.
fn report_unhandled(f: &mut Function, m: &mut Builder<'_>, p: PromiseTypes) -> Result<(), Failure> {
    let rejected = state(m, State::Rejected)?;
    let rejected_count = state(m, State::RejectedCount)?;
    let uncaught = crate::raising::callee(m, crate::raising::Helper::Uncaught)?;
    let name = m.literal("an unhandled rejection");
    let (list, count, at, promise) = (2, 3, 4, 5);
    f.locals.extend([
        ValType::Ref(concrete(p.promises, true)),
        ValType::I32,
        ValType::I32,
        ValType::Ref(concrete(p.promise, true)),
    ]);
    f.global_get(rejected);
    f.instruction(&I::LocalSet(list));
    f.global_get(rejected_count);
    f.instruction(&I::LocalSet(count));
    f.instruction(&I::I32Const(0));
    f.global_set(rejected_count);
    f.instructions(&[
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
        I::LocalGet(count),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(list),
        I::LocalGet(at),
        I::ArrayGet(p.promises),
        I::LocalTee(promise),
        field(p, p.state()),
        I::I32Const(REJECTED),
        I::I32Eq,
        I::LocalGet(promise),
        field(p, p.handled()),
        I::I32Eqz,
        I::I32And,
        I::If(BlockType::Empty),
        I::LocalGet(promise),
        field(p, p.value()),
    ]);
    f.global_get(name);
    f.call(uncaught);
    f.instructions(&[
        I::Unreachable,
        I::End,
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
    ]);
    Ok(())
}

/// Append a rejection nothing listened to, to a growable list.
///
/// Params: promise. Locals: list, count, grown.
fn candidate(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = types(m)?;
    let rejected = state(m, State::Rejected)?;
    let rejected_count = state(m, State::RejectedCount)?;
    let promises = ValType::Ref(concrete(p.promises, true));
    let (list, count, grown) = (1, 2, 3);
    let mut f = Function::new([promises, ValType::I32, promises]);
    f.global_get(rejected);
    f.instruction(&I::LocalSet(list));
    f.global_get(rejected_count);
    f.instructions(&[
        I::LocalSet(count),
        I::LocalGet(list),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::I32Const(4),
        I::ArrayNewDefault(p.promises),
        I::LocalSet(list),
        I::Else,
        I::LocalGet(count),
        I::LocalGet(list),
        I::ArrayLen,
        I::I32Eq,
        I::If(BlockType::Empty),
        I::LocalGet(count),
        I::I32Const(1),
        I::I32Shl,
        I::ArrayNewDefault(p.promises),
        I::LocalTee(grown),
        I::I32Const(0),
        I::LocalGet(list),
        I::I32Const(0),
        I::LocalGet(count),
        I::ArrayCopy {
            array_type_index_dst: p.promises,
            array_type_index_src: p.promises,
        },
        I::LocalGet(grown),
        I::LocalSet(list),
        I::End,
        I::End,
        I::LocalGet(list),
        I::LocalGet(count),
        I::LocalGet(0),
        I::ArraySet(p.promises),
        I::LocalGet(list),
    ]);
    f.global_set(rejected);
    f.instructions(&[I::LocalGet(count), I::I32Const(1), I::I32Add]);
    f.global_set(rejected_count);
    f.instruction(&I::End);
    Ok(f)
}

/// A settlement read as a string or a nullable reference: an absent one reads
/// as null, and anything else must be one.
fn read_reference(
    f: &mut Function,
    m: &mut Builder<'_>,
    read: Read,
    value: u32,
    tag: Func,
) -> Result<(), Failure> {
    // An absent settlement reads as null; anything else must be one.
    let (heap, test) = match read {
        Read::String => (HeapType::EXTERN, None),
        Read::Reference(index) => (HeapType::Concrete(index), Some(HeapType::Concrete(index))),
        _ => unreachable!("a reference read"),
    };
    f.instruction(&I::LocalGet(value));
    f.call(tag);
    f.instructions(&[I::I32Const(erased::NULL), I::I32Eq, I::LocalGet(value)]);
    f.call(tag);
    f.instructions(&[
        I::I32Const(erased::UNDEFINED),
        I::I32Eq,
        I::I32Or,
        I::If(BlockType::Empty),
        I::RefNull(heap),
        I::Return,
        I::End,
    ]);
    if let Some(heap) = test {
        f.instructions(&[I::LocalGet(value), I::RefTestNonNull(heap)]);
    } else {
        f.instruction(&I::LocalGet(value));
        f.call(tag);
        f.instructions(&[I::I32Const(erased::STRING), I::I32Eq]);
    }
    f.instructions(&[I::I32Eqz, I::If(BlockType::Empty)]);
    contract::refuse_in(f, m, 1, "a settlement read as a type it is not")?;
    f.instructions(&[I::End, I::LocalGet(value)]);
    match test {
        Some(heap) => f.instruction(&I::RefCastNonNull(heap)),
        None => erased::string_payload(f),
    }
    Ok(())
}

/// A settlement read as `read`, from a promise in `state`.
///
/// Params: promise, name. Locals: value.
fn read_body(m: &mut Builder<'_>, expected: i32, read: Read) -> Result<Function, Failure> {
    let p = types(m)?;
    let value = 2;
    let mut f = Function::new([ValType::Ref(RefType::ANYREF)]);
    let why = if expected == REJECTED {
        "a rejection reason from a promise that has none"
    } else {
        "a value from a promise that has none"
    };
    f.instructions(&[
        I::LocalGet(0),
        field(p, p.state()),
        I::I32Const(expected),
        I::I32Ne,
        I::If(BlockType::Empty),
    ]);
    contract::refuse_in(&mut f, m, 1, why)?;
    f.instructions(&[
        I::End,
        I::LocalGet(0),
        field(p, p.value()),
        I::LocalSet(value),
    ]);
    let erased_types = m
        .types
        .erased
        .ok_or_else(|| Failure::Invariant("unplanned erased types".into()))?;
    let tag = erased::callee(m, erased::Helper::Tag)?;
    match read {
        Read::Erased => f.instruction(&I::LocalGet(value)),
        Read::Number => {
            let number = erased::callee(m, erased::Helper::Number)?;
            f.instructions(&[
                I::LocalGet(value),
                I::RefTestNonNull(HeapType::I31),
                I::LocalGet(value),
                I::RefTestNonNull(HeapType::Concrete(erased_types.number)),
                I::I32Or,
                I::I32Eqz,
                I::If(BlockType::Empty),
            ]);
            contract::refuse_in(
                &mut f,
                m,
                1,
                "a number from a promise holding something else",
            )?;
            f.instructions(&[I::End, I::LocalGet(value)]);
            f.call(number);
        }
        Read::Boolean => {
            let boolean = erased::callee(m, erased::Helper::Boolean)?;
            f.instructions(&[
                I::LocalGet(value),
                I::RefTestNonNull(HeapType::Concrete(erased_types.boolean)),
                I::I32Eqz,
                I::If(BlockType::Empty),
            ]);
            contract::refuse_in(
                &mut f,
                m,
                1,
                "a boolean from a promise holding something else",
            )?;
            f.instructions(&[I::End, I::LocalGet(value)]);
            f.call(boolean);
        }
        Read::String | Read::Reference(_) => read_reference(&mut f, m, read, value, tag)?,
    }
    f.instruction(&I::End);
    Ok(f)
}

/// A host entry around `target`, in a module that plans promises: the
/// checkpoint's analogue of `nts_enter`/`nts_leave`. Depth counts the exports
/// running one inside another; the outermost one's return drains the queues,
/// however it returns: an exception is caught, the queues drained, and it is
/// rethrown. A module without promises exports `target` itself and pays
/// nothing.
pub(crate) fn entry(
    m: &mut Builder<'_>,
    target: Func,
    func: &nts_core::hir::Func,
) -> Result<Func, Failure> {
    if m.types.promise.is_none() {
        return Ok(target);
    }
    let depth = state(m, State::Depth)?;
    let leave = callee(m, Helper::Leave)?;
    let pending = Pending::of(m)?;
    let ty = m.func_type(target);
    let params = u32::try_from(func.params.len())
        .map_err(|_| Failure::Invariant("too many parameters".into()))?;
    let result = m.types.slot(&func.return_type)?.map(Physical::wasm);
    let answers_promise = matches!(func.return_type, HirType::Managed(ManagedType::Promise(_)));
    let p = types(m)?;
    m.helper_typed(
        FuncKey::Entry(target),
        format!("entry.{}", func.name),
        ty,
        move |_| {
            let mut f = Function::new(result.filter(|_| answers_promise));
            f.global_get(depth);
            f.instructions(&[I::I32Const(1), I::I32Add]);
            f.global_set(depth);
            f.instructions(&[
                I::Block(BlockType::Result(ValType::EXNREF)),
                I::TryTable(
                    result.map_or(BlockType::Empty, BlockType::Result),
                    vec![wasm_encoder::Catch::AllRef { label: 0 }].into(),
                ),
            ]);
            for at in 0..params {
                f.instruction(&I::LocalGet(at));
            }
            f.call(target);
            f.instruction(&I::End);
            if answers_promise {
                // The host takes this promise, so its rejection is handled:
                // the JS promise the glue makes is what reports one, as node
                // reports a rejection its caller leaves unhandled.
                f.instructions(&[
                    I::LocalTee(params),
                    I::RefCastNullable(HeapType::Concrete(p.promise)),
                ]);
                f.instructions(&[I::I32Const(1), store(p, p.handled()), I::LocalGet(params)]);
            }
            // The common return, inline: a call that queued nothing drains
            // nothing, and pays no call for it.
            pending.leave(&mut f);
            f.instructions(&[I::Return, I::End]);
            f.call(leave);
            f.instructions(&[I::ThrowRef, I::End]);
            Ok(f)
        },
    )
}

/// The globals the way out of a host entry reads.
#[derive(Clone, Copy)]
struct Pending {
    depth: Global,
    host: Global,
    ticks: Global,
    micro: Global,
    rejected: Global,
    drain: Func,
    decline: Func,
    name: Global,
    why: Global,
}

impl Pending {
    fn of(m: &mut Builder<'_>) -> Result<Self, Failure> {
        Ok(Self {
            depth: state(m, State::Depth)?,
            host: state(m, State::HostOwned)?,
            ticks: state(m, State::Tail(Queue::Tick))?,
            micro: state(m, State::Tail(Queue::Micro))?,
            rejected: state(m, State::RejectedCount)?,
            drain: callee(m, Helper::Drain)?,
            decline: contract::decline(m)?,
            name: m.literal("the checkpoint"),
            why: m.literal("an unbalanced leave"),
        })
    }
    /// One level out. An unbalanced leave is refused by name; at the outermost,
    /// unless the host owns the queue, the checkpoint runs if anything waits
    /// for it: a queued task (a drained queue's tail is zero) or a rejection.
    fn leave(self, f: &mut Function) {
        f.global_get(self.depth);
        f.instructions(&[I::I32Eqz, I::If(BlockType::Empty)]);
        f.global_get(self.name);
        f.global_get(self.why);
        f.call(self.decline);
        f.instructions(&[I::Unreachable, I::End]);
        f.global_get(self.depth);
        f.instructions(&[I::I32Const(1), I::I32Sub]);
        f.global_set(self.depth);
        f.global_get(self.depth);
        f.instructions(&[I::I32Eqz, I::If(BlockType::Empty)]);
        f.global_get(self.ticks);
        f.global_get(self.micro);
        f.instruction(&I::I32Or);
        f.global_get(self.rejected);
        // A count, made a truth before it meets one.
        f.instructions(&[I::I32Or, I::I32Const(0), I::I32Ne]);
        f.global_get(self.host);
        f.instructions(&[I::I32Eqz, I::I32And, I::If(BlockType::Empty)]);
        f.call(self.drain);
        f.instructions(&[I::End, I::End]);
    }
}

/// Leaving a host entry on its exceptional path, as the inline common one.
fn leave(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let pending = Pending::of(m)?;
    let mut f = Function::default();
    pending.leave(&mut f);
    f.instruction(&I::End);
    Ok(f)
}

/// The exports the glue reads a promise an export answered through: its state,
/// its settlement, a watch whose task tells the host when it settles, and the
/// readers that take an erased settlement to JS.
pub(crate) fn boundary(m: &mut Builder<'_>) -> Result<(), Failure> {
    let p = types(m)?;
    let anyref = Physical::Reference(RefType::ANYREF);
    let i32 = Physical::Scalar(Slot::I32);
    for (name, field_index) in [
        ("$nts.promise.state", p.state()),
        ("$nts.promise.settlement", p.value()),
    ] {
        let result = if field_index == p.state() {
            i32
        } else {
            anyref
        };
        let reader = m.helper(
            FuncKey::PromiseBoundary(field_index),
            name,
            vec![anyref],
            Some(result),
            move |_| {
                let mut f = Function::default();
                f.instructions(&[
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(p.promise)),
                    field(p, field_index),
                    I::End,
                ]);
                Ok(f)
            },
        )?;
        m.export_func(name, reader);
    }
    let subscribe = callee(m, Helper::Subscribe)?;
    let watch_task = thunk(m, Thunk::Watch)?;
    let watch = m.helper(
        FuncKey::PromiseBoundary(u32::MAX),
        "$nts.promise.watch",
        vec![anyref, i32],
        None,
        move |_| {
            let mut f = Function::default();
            f.instructions(&[
                I::LocalGet(0),
                I::RefCastNonNull(HeapType::Concrete(p.promise)),
            ]);
            f.ref_func(watch_task);
            f.instructions(&[I::LocalGet(1), I::RefI31, I::StructNew(p.task)]);
            f.call(subscribe);
            f.instruction(&I::End);
            Ok(f)
        },
    )?;
    m.export_func("$nts.promise.watch", watch);
    for (name, helper) in [
        ("$nts.erased.tag", erased::Helper::Tag),
        ("$nts.erased.number", erased::Helper::Number),
        ("$nts.erased.boolean", erased::Helper::Boolean),
    ] {
        let reader = erased::callee(m, helper)?;
        m.export_func(name, reader);
    }
    let text = m.helper(
        FuncKey::PromiseBoundary(u32::MAX - 1),
        "$nts.erased.string",
        vec![anyref],
        Some(strings::STRING),
        |_| {
            let mut f = Function::default();
            f.instruction(&I::LocalGet(0));
            erased::string_payload(&mut f);
            f.instruction(&I::End);
            Ok(f)
        },
    )?;
    m.export_func("$nts.erased.string", text);
    Ok(())
}

/// Run the task in local `task` as a host entry does: one level in, the task,
/// and on the way out the checkpoint, however it leaves. A raise it leaves
/// pending is thrown uncaught.
pub(crate) fn run_task_in_checkpoint(
    f: &mut Function,
    m: &mut Builder<'_>,
    task: u32,
) -> Result<(), Failure> {
    let p = types(m)?;
    let depth = state(m, State::Depth)?;
    let leave = callee(m, Helper::Leave)?;
    let pending = Pending::of(m)?;
    f.global_get(depth);
    f.instructions(&[I::I32Const(1), I::I32Add]);
    f.global_set(depth);
    f.instructions(&[
        I::Block(BlockType::Result(ValType::EXNREF)),
        I::TryTable(
            BlockType::Empty,
            vec![wasm_encoder::Catch::AllRef { label: 0 }].into(),
        ),
        I::LocalGet(task),
        I::StructGet {
            struct_type_index: p.task,
            field_index: 1,
        },
        I::LocalGet(task),
        I::StructGet {
            struct_type_index: p.task,
            field_index: 0,
        },
        I::CallRef(p.run),
    ]);
    if m.raises {
        let flag = crate::raising::state(m, crate::raising::Slot::Flag)?;
        let take = crate::raising::callee(m, crate::raising::Helper::Take)?;
        let uncaught = crate::raising::callee(m, crate::raising::Helper::Uncaught)?;
        let name = m.literal("a timer");
        f.global_get(flag);
        f.instruction(&I::If(BlockType::Empty));
        f.call(take);
        f.global_get(name);
        f.call(uncaught);
        f.instructions(&[I::Unreachable, I::End]);
    }
    f.instruction(&I::End);
    pending.leave(f);
    f.instructions(&[I::Return, I::End]);
    f.call(leave);
    f.instruction(&I::ThrowRef);
    Ok(())
}
