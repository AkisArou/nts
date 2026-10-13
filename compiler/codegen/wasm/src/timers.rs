//! `setTimeout`, `setInterval` and their clears, as the C runtime's
//! `nts_set_timeout` over the host's `post_delayed` (docs/async.md §2).
//!
//! A timer is a task in a table, under a numeric id from 1 (0 is never live,
//! so clearing it does nothing). The host's `setTimer` starts a JS timer whose
//! callback calls the program's `$nts.timer.fire`; that export runs the task
//! inside the checkpoint, as every export does, so the microtasks it queues
//! run before the next timer, as node runs them between timer callbacks. A
//! one-shot timer's slot empties as it fires; `clearTimer` empties one and
//! stops the host's timer. An id that names no live timer is ignored, as node
//! ignores it.
use crate::{
    body::Body,
    error::Failure,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    numeric,
    promises::{self, Task},
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, OpKind, ValueId};
use wasm_encoder::{BlockType, GlobalType, HeapType, Instruction as I, RefType, ValType};

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    Set,
    Clear,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    match name {
        "nts_set_timeout" => Some(Op::Set),
        "nts_clear_timeout" => Some(Op::Clear),
        _ => None,
    }
}

/// A module helper of the timer table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(task, delay, repeating) -> id`.
    Set,
    /// `(id)`.
    Clear,
    /// `(id, repeating)`: the export the host's timer calls.
    Fire,
}

/// The table's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum State {
    Table,
    Next,
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    match op {
        Op::Set => {
            let &[callback, slot, delay, repeating] = args else {
                return Err("setTimeout arity mismatch".into());
            };
            let OpKind::DispatchSlot(slot) = b.func.value(slot).kind else {
                return Err("a timer whose call slot is not a constant".into());
            };
            crate::contract::nonnull(b, callback, "a null timer callback")?;
            let task: Task = promises::closure_task(b, callback, slot)?;
            let set = callee(b.m, Helper::Set)?;
            if !b.m.exports_name("$nts.timer.fire") {
                export(b.m)?;
            }
            promises::push_task(b, task)?;
            b.load(delay)?;
            numeric::convert(b, &b.ty(delay).clone(), &HirType::NUMBER)?;
            b.load(repeating)?;
            if b.ty(repeating) != &HirType::Bool {
                return Err("a timer's repeat flag that is not a boolean".into());
            }
            b.call(set);
            b.instruction(&I::F64ConvertI32U);
            numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())?;
        }
        Op::Clear => {
            let &[id] = args else {
                return Err("clearTimeout arity mismatch".into());
            };
            let clear = callee(b.m, Helper::Clear)?;
            b.load(id)?;
            numeric::convert(b, &b.ty(id).clone(), &HirType::NUMBER)?;
            // A non-integer or negative id names no timer: -1 never does.
            b.instruction(&I::I32TruncSatF64S);
            b.call(clear);
        }
    }
    Ok(())
}

fn state(m: &mut Builder<'_>, which: State) -> Result<Global, Failure> {
    let p = promises::types(m)?;
    m.global(GlobalKey::Timer(which), |_| {
        let mut init = ir::Code::default();
        let ty = match which {
            State::Table => {
                init.instruction(&I::RefNull(HeapType::Concrete(p.tasks)));
                ValType::Ref(RefType {
                    nullable: true,
                    heap_type: HeapType::Concrete(p.tasks),
                })
            }
            State::Next => {
                init.instruction(&I::I32Const(1));
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

fn import(m: &mut Builder<'_>, name: &'static str) -> Func {
    let i32 = Physical::Scalar(Slot::I32);
    let params = if name == "setTimer" {
        vec![i32, Physical::Scalar(Slot::F64), i32]
    } else {
        vec![i32]
    };
    m.import(
        FuncKey::TimerHost(name),
        "nts:host/v1",
        name,
        params,
        None,
        false,
    )
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let p = promises::types(m)?;
    let i32 = Physical::Scalar(Slot::I32);
    let task = Physical::Reference(RefType {
        nullable: false,
        heap_type: HeapType::Concrete(p.task),
    });
    let (params, result) = match helper {
        Helper::Set => (vec![task, Physical::Scalar(Slot::F64), i32], Some(i32)),
        Helper::Clear => (vec![i32], None),
        Helper::Fire => (vec![i32, i32], None),
    };
    m.helper(
        FuncKey::Timer(helper),
        format!("timer.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Set => set(m),
            Helper::Clear => clear(m),
            Helper::Fire => fire(m),
        },
    )
}

/// The next id's slot, the table grown to hold it, and the host told.
///
/// Params: task, delay, repeating. Locals: id, table, grown.
fn set(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = promises::types(m)?;
    let table = state(m, State::Table)?;
    let next = state(m, State::Next)?;
    let host = import(m, "setTimer");
    let tasks = ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(p.tasks),
    });
    let (id, list, grown) = (3, 4, 5);
    let mut f = Function::new([ValType::I32, tasks, tasks]);
    f.global_get(next);
    f.instructions(&[I::LocalTee(id), I::I32Const(1), I::I32Add]);
    f.global_set(next);
    f.global_get(table);
    f.instructions(&[
        I::LocalTee(list),
        I::RefIsNull,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(1),
        I::Else,
        I::LocalGet(id),
        I::LocalGet(list),
        I::ArrayLen,
        I::I32GeU,
        I::End,
        I::If(BlockType::Empty),
        // Room for this id and as many again.
        I::LocalGet(id),
        I::I32Const(1),
        I::I32Shl,
        I::I32Const(8),
        I::I32Add,
        I::ArrayNewDefault(p.tasks),
        I::LocalSet(grown),
        I::LocalGet(list),
        I::RefIsNull,
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(grown),
        I::I32Const(0),
        I::LocalGet(list),
        I::I32Const(0),
        I::LocalGet(list),
        I::ArrayLen,
        I::ArrayCopy {
            array_type_index_dst: p.tasks,
            array_type_index_src: p.tasks,
        },
        I::End,
        I::LocalGet(grown),
        I::LocalSet(list),
        I::LocalGet(list),
    ]);
    f.global_set(table);
    f.instructions(&[
        I::End,
        I::LocalGet(list),
        I::LocalGet(id),
        I::LocalGet(0),
        I::ArraySet(p.tasks),
        I::LocalGet(id),
        I::LocalGet(1),
        I::LocalGet(2),
    ]);
    f.call(host);
    f.instructions(&[I::LocalGet(id), I::End]);
    Ok(f)
}

/// Empty a live id's slot and stop the host's timer; any other id does nothing.
///
/// Params: id. Locals: table.
fn clear(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = promises::types(m)?;
    let table = state(m, State::Table)?;
    let host = import(m, "clearTimer");
    let list = 1;
    let mut f = Function::new([ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(p.tasks),
    })]);
    f.global_get(table);
    f.instructions(&[
        I::LocalTee(list),
        I::RefIsNull,
        I::LocalGet(0),
        I::I32Const(1),
        I::I32LtS,
        I::I32Or,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(0),
        I::LocalGet(list),
        I::ArrayLen,
        I::I32GeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(list),
        I::LocalGet(0),
        I::ArrayGet(p.tasks),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(list),
        I::LocalGet(0),
        I::RefNull(HeapType::Concrete(p.task)),
        I::ArraySet(p.tasks),
        I::LocalGet(0),
    ]);
    f.call(host);
    f.instruction(&I::End);
    Ok(f)
}

/// What the host's timer calls: the task, inside the checkpoint. A one-shot
/// timer's slot empties first, so clearing it from its own callback is the
/// no-op it is in node.
///
/// Params: id, repeating. Locals: task.
fn fire(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let p = promises::types(m)?;
    let table = state(m, State::Table)?;
    let task = 2;
    let mut f = Function::new([ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(p.task),
    })]);
    f.global_get(table);
    f.instructions(&[
        I::LocalGet(0),
        I::ArrayGet(p.tasks),
        I::LocalTee(task),
        I::RefIsNull,
    ]);
    f.instructions(&[
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(1),
        I::I32Eqz,
    ]);
    f.instruction(&I::If(BlockType::Empty));
    f.global_get(table);
    f.instructions(&[
        I::LocalGet(0),
        I::RefNull(HeapType::Concrete(p.task)),
        I::ArraySet(p.tasks),
        I::End,
    ]);
    promises::run_task_in_checkpoint(&mut f, m, task)?;
    f.instruction(&I::End);
    Ok(f)
}

/// Export `$nts.timer.fire` when the program sets timers.
pub(crate) fn export(m: &mut Builder<'_>) -> Result<(), Failure> {
    let fire = callee(m, Helper::Fire)?;
    m.export_func("$nts.timer.fire", fire);
    Ok(())
}
