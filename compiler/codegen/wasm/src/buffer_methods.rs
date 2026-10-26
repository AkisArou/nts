//! The methods of a typed array and a buffer that copy, cut or convert:
//! `subarray`, `slice`, `set`, `fill`, `copyWithin`, `join`, and a buffer's
//! `slice` and `transfer`, as the C runtime's `nts_view_*` and `nts_buffer_*`
//! (`runtime/c`). Each is a module helper over `buffers.rs`'s representation.
//!
//! Endpoints clamp as C's `nts_str_clamp` does, relative to the length now
//! (`indexing::clamp`). A copy within one byte array is `array.copy`, which
//! moves as `memmove` does, so overlapping ranges are right. Where two kinds
//! differ, `set` converts values, not bytes, through the run-time kind.
use crate::{
    body::Body,
    buffers::{self, BUFFER, BYTES, KIND, LENGTH, OFFSET, RESERVED, RESIZABLE, WIDTH},
    contract,
    error::Failure,
    gc::BufferTypes,
    host, indexing,
    ir::Function,
    module::{Builder, Func, FuncKey},
    objects, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    Subarray,
    Slice,
    Set,
    Fill,
    CopyWithin,
    Join,
    BufferSlice,
    Transfer,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_view_subarray" => Op::Subarray,
        "nts_view_slice" => Op::Slice,
        "nts_view_set" => Op::Set,
        "nts_view_fill" => Op::Fill,
        "nts_view_copy_within" => Op::CopyWithin,
        "nts_view_join" => Op::Join,
        "nts_buffer_slice" => Op::BufferSlice,
        "nts_buffer_transfer" => Op::Transfer,
        _ => return None,
    })
}

/// A module helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(view, index) -> number`, by the run-time kind: C's `nts_view_get`.
    Get,
    /// `(view, index, number)`, by the run-time kind: C's `nts_view_put`.
    Put,
    Subarray,
    Slice,
    Set,
    Fill,
    CopyWithin,
    Join,
    BufferSlice,
    Transfer,
}

const fn helper(op: Op) -> Helper {
    match op {
        Op::Subarray => Helper::Subarray,
        Op::Slice => Helper::Slice,
        Op::Set => Helper::Set,
        Op::Fill => Helper::Fill,
        Op::CopyWithin => Helper::CopyWithin,
        Op::Join => Helper::Join,
        Op::BufferSlice => Helper::BufferSlice,
        Op::Transfer => Helper::Transfer,
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let arity = match op {
        Op::Join => 2,
        Op::Fill | Op::CopyWithin => 4,
        _ => 3,
    };
    if args.len() != arity {
        return Err(format!("typed-array method {op:?} arity mismatch").into());
    }
    if crate::owned_views::involved(b, op, args) {
        return crate::owned_views::method(b, result, op, args);
    }
    let receiver = args[0];
    let buffer = matches!(op, Op::BufferSlice | Op::Transfer);
    let wanted = if buffer {
        matches!(b.ty(receiver), HirType::Managed(ManagedType::Buffer))
    } else {
        matches!(
            b.ty(receiver),
            HirType::Managed(ManagedType::View(_) | ManagedType::AnyView)
        )
    };
    if !wanted {
        return Err(format!("{op:?} of a {:?}", b.ty(receiver)).into());
    }
    contract::nonnull(
        b,
        receiver,
        if buffer {
            "a method of a null buffer"
        } else {
            "a method of a null typed array"
        },
    )?;
    let target = callee(b.m, helper(op))?;
    b.load(receiver)?;
    match op {
        Op::Set => {
            let source = args[1];
            if !matches!(
                b.ty(source),
                HirType::Managed(ManagedType::View(_) | ManagedType::AnyView)
            ) {
                return Err(format!("`set` from a {:?}", b.ty(source)).into());
            }
            contract::nonnull(b, source, "`set` from a null typed array")?;
            b.load(source)?;
            crate::arrays::number(b, args[2])?;
            // The function's name, for a refusal inside the helper.
            strings::constant(b, b.func.name.clone());
        }
        Op::Join => {
            let separator = args[1];
            if !strings::is_string(b.ty(separator)) {
                return Err(format!("join separator {:?}", b.ty(separator)).into());
            }
            contract::nonnull(
                b,
                separator,
                "a null separator, which may stand for undefined or for null",
            )?;
            b.load(separator)?;
        }
        Op::Transfer => {
            crate::arrays::number(b, args[1])?;
            if b.ty(args[2]) != &HirType::Bool {
                return Err("a transfer's fixed flag that is not a boolean".into());
            }
            b.load(args[2])?;
        }
        Op::Subarray | Op::Slice | Op::Fill | Op::CopyWithin | Op::BufferSlice => {
            for &arg in &args[1..] {
                crate::arrays::number(b, arg)?;
            }
        }
    }
    b.call(target);
    match op {
        Op::Join => objects::adapt(
            b,
            &HirType::Managed(ManagedType::String),
            &b.ty(result).clone(),
        ),
        _ => Ok(()),
    }
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let t = buffers::types(m)?;
    let i32 = Physical::Scalar(Slot::I32);
    let f64 = Physical::Scalar(Slot::F64);
    let view = Physical::Reference(buffers::reference(t.view, true));
    let buffer = Physical::Reference(buffers::reference(t.buffer, true));
    let (params, result) = match helper {
        Helper::Get => (vec![view, i32], Some(f64)),
        Helper::Put => (vec![view, i32, f64], None),
        Helper::Subarray => (
            vec![view, f64, f64],
            Some(Physical::Reference(buffers::reference(t.view, false))),
        ),
        Helper::Slice => (vec![view, f64, f64], Some(view)),
        Helper::Set => (vec![view, view, f64, strings::STRING], None),
        Helper::Fill | Helper::CopyWithin => (vec![view, f64, f64, f64], None),
        Helper::Join => (vec![view, strings::STRING], Some(strings::STRING)),
        Helper::BufferSlice => (vec![buffer, f64, f64], Some(buffer)),
        Helper::Transfer => (vec![buffer, f64, i32], Some(buffer)),
    };
    m.helper(
        FuncKey::BufferMethod(helper),
        format!("view.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Get => get(m, t),
            Helper::Put => put(m, t),
            Helper::Subarray => subarray(m, t),
            Helper::Slice => slice(m, t),
            Helper::Set => set(m, t),
            Helper::Fill => fill(m, t),
            Helper::CopyWithin => copy_within(m, t),
            Helper::Join => join(m, t),
            Helper::BufferSlice => buffer_slice(m, t),
            Helper::Transfer => transfer(m, t),
        },
    )
}

fn view_field(t: BufferTypes, field_index: u32) -> I<'static> {
    I::StructGet {
        struct_type_index: t.view,
        field_index,
    }
}

fn buffer_field(t: BufferTypes, field_index: u32) -> I<'static> {
    I::StructGet {
        struct_type_index: t.buffer,
        field_index,
    }
}

fn bytes_type(t: BufferTypes) -> ValType {
    ValType::Ref(buffers::reference(t.bytes, true))
}

/// A view's bytes, null once its buffer is detached.
fn bytes(f: &mut Function, t: BufferTypes, view: u32) {
    f.instructions(&[
        I::LocalGet(view),
        view_field(t, BUFFER),
        buffer_field(t, BYTES),
    ]);
}

/// The byte where element `index` (an `i32` local) of `view` starts.
fn place(f: &mut Function, t: BufferTypes, view: u32, index: u32) {
    f.instructions(&[
        I::LocalGet(view),
        view_field(t, OFFSET),
        I::LocalGet(index),
        I::LocalGet(view),
        view_field(t, WIDTH),
        I::I32Mul,
        I::I32Add,
    ]);
}

/// A view's element count now, into `local`.
fn length(m: &mut Builder<'_>, f: &mut Function, view: u32, local: u32) -> Result<(), Failure> {
    let length = buffers::callee(m, buffers::Helper::Length)?;
    f.instruction(&I::LocalGet(view));
    f.call(length);
    f.instruction(&I::LocalSet(local));
    Ok(())
}

/// Return early, with `value` if the helper answers, while `view`'s buffer is
/// detached: every method reads as an empty view then.
fn unless_attached(f: &mut Function, t: BufferTypes, view: u32, value: Option<I<'static>>) {
    bytes(f, t, view);
    f.instructions(&[I::RefIsNull, I::If(BlockType::Empty)]);
    if let Some(value) = value {
        f.instruction(&value);
    }
    f.instructions(&[I::Return, I::End]);
}

/// `end - start`, or 0 when the range is empty, into `count`.
fn count(f: &mut Function, start: u32, end: u32, count: u32) {
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32Sub,
        I::I32Const(0),
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32GtU,
        I::Select,
        I::LocalSet(count),
    ]);
}

/// C's `nts_view_get`. Params: view, index. Locals: bytes, at.
fn get(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let load = |m: &mut Builder<'_>, helper| buffers::callee(m, helper);
    let (load16, load32, load64) = (
        load(m, buffers::Helper::Load16)?,
        load(m, buffers::Helper::Load32)?,
        load(m, buffers::Helper::Load64)?,
    );
    let (store, at) = (2, 3);
    let mut f = Function::new([bytes_type(t), ValType::I32]);
    bytes(&mut f, t, 0);
    f.instruction(&I::LocalSet(store));
    place(&mut f, t, 0, 1);
    f.instruction(&I::LocalSet(at));
    // One block per case, innermost first: 0, 1 (and 2), 3, 4, 5, 6, 7, 8.
    for _ in 0..8 {
        f.instruction(&I::Block(BlockType::Empty));
    }
    f.instructions(&[
        I::LocalGet(0),
        view_field(t, KIND),
        I::BrTable(vec![0, 1, 1, 2, 3, 4, 5, 6].into(), 7),
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
        I::ArrayGetS(t.bytes),
        I::F64ConvertI32S,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
        I::ArrayGetU(t.bytes),
        I::F64ConvertI32U,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
    ]);
    f.call(load16);
    f.instructions(&[
        I::I32Extend16S,
        I::F64ConvertI32S,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
    ]);
    f.call(load16);
    f.instructions(&[
        I::F64ConvertI32U,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
    ]);
    f.call(load32);
    f.instructions(&[
        I::F64ConvertI32S,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
    ]);
    f.call(load32);
    f.instructions(&[
        I::F64ConvertI32U,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
    ]);
    f.call(load32);
    f.instructions(&[
        I::F32ReinterpretI32,
        I::F64PromoteF32,
        I::Return,
        I::End,
        I::LocalGet(store),
        I::LocalGet(at),
    ]);
    f.call(load64);
    f.instructions(&[I::F64ReinterpretI64, I::End]);
    Ok(f)
}

/// C's `nts_view_put`: an integer kind stores `ToInt32`'s low bytes, a
/// clamped one rounds half to even into [0, 255], a float its bits.
///
/// Params: view, index, value. Locals: bytes, at.
fn put(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let store = |m: &mut Builder<'_>, helper| buffers::callee(m, helper);
    let (store16, store32, store64) = (
        store(m, buffers::Helper::Store16)?,
        store(m, buffers::Helper::Store32)?,
        store(m, buffers::Helper::Store64)?,
    );
    let to_int32 = crate::helpers::callee(m, crate::helpers::Helper::ToInt32)?;
    let (target, at) = (3, 4);
    let mut f = Function::new([bytes_type(t), ValType::I32]);
    bytes(&mut f, t, 0);
    f.instruction(&I::LocalSet(target));
    place(&mut f, t, 0, 1);
    f.instruction(&I::LocalSet(at));
    // 0 and 1, 2, 3 and 4, 5 and 6, 7, then 8: innermost first.
    for _ in 0..6 {
        f.instruction(&I::Block(BlockType::Empty));
    }
    f.instructions(&[
        I::LocalGet(0),
        view_field(t, KIND),
        I::BrTable(vec![0, 0, 1, 2, 2, 3, 3, 4].into(), 5),
        I::End,
        // An 8-bit integer: the low byte of ToInt32.
        I::LocalGet(target),
        I::LocalGet(at),
        I::LocalGet(2),
    ]);
    f.call(to_int32);
    f.instructions(&[
        I::ArraySet(t.bytes),
        I::Return,
        I::End,
        // Clamped: NaN and below zero are 0, 255 and above are 255.
        I::LocalGet(target),
        I::LocalGet(at),
        I::LocalGet(2),
        I::F64Nearest,
        I::I32TruncSatF64U,
        I::I32Const(255),
        I::LocalGet(2),
        I::F64Const(255.0.into()),
        I::F64Lt,
        I::Select,
        I::ArraySet(t.bytes),
        I::Return,
        I::End,
        I::LocalGet(target),
        I::LocalGet(at),
        I::LocalGet(2),
    ]);
    f.call(to_int32);
    f.call(store16);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(target),
        I::LocalGet(at),
        I::LocalGet(2),
    ]);
    f.call(to_int32);
    f.call(store32);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(target),
        I::LocalGet(at),
        I::LocalGet(2),
        I::F32DemoteF64,
        I::I32ReinterpretF32,
    ]);
    f.call(store32);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(target),
        I::LocalGet(at),
        I::LocalGet(2),
        I::I64ReinterpretF64,
    ]);
    f.call(store64);
    f.instruction(&I::End);
    Ok(f)
}

/// A view over `view`'s buffer, `count` elements from element `start`: no
/// copy and no tracking, as C's subarray. Pushes the new view.
fn window(
    m: &mut Builder<'_>,
    f: &mut Function,
    t: BufferTypes,
    view: u32,
    start: u32,
    count: u32,
) -> Result<(), Failure> {
    let descriptor = objects::descriptor(m, t.view_descriptor)?;
    f.global_get(descriptor);
    f.instructions(&[objects::UNHASHED, I::LocalGet(view), view_field(t, BUFFER)]);
    place(f, t, view, start);
    f.instructions(&[
        I::LocalGet(count),
        I::LocalGet(view),
        view_field(t, KIND),
        I::LocalGet(view),
        view_field(t, WIDTH),
        I::I32Const(0),
        I::StructNew(t.view),
    ]);
    Ok(())
}

/// C's `nts_view_subarray`. Params: view, from, to. Locals: length, start,
/// end, scratch, count.
fn subarray(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let (len, start, end, scratch, n) = (3, 4, 5, 6, 7);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
    ]);
    length(m, &mut f, 0, len)?;
    indexing::clamp(&mut f, 1, start, true, len, scratch);
    indexing::clamp(&mut f, 2, end, true, len, scratch);
    count(&mut f, start, end, n);
    window(m, &mut f, t, 0, start, n)?;
    f.instruction(&I::End);
    Ok(f)
}

/// A fresh fixed buffer of `bytes` (an `i32` local), or a return of null when
/// it cannot be had, into `local`.
fn fresh(m: &mut Builder<'_>, f: &mut Function, bytes: u32, local: u32) -> Result<(), Failure> {
    let make = buffers::callee(m, buffers::Helper::Make)?;
    let t = buffers::types(m)?;
    f.instructions(&[
        I::LocalGet(bytes),
        I::F64ConvertI32U,
        I::LocalGet(bytes),
        I::F64ConvertI32U,
        I::I32Const(0),
    ]);
    f.call(make);
    f.instructions(&[
        I::LocalTee(local),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::Concrete(t.buffer)),
        I::Return,
        I::End,
    ]);
    Ok(())
}

/// C's `nts_view_slice`: a copy into a fresh buffer, null if none can be had.
///
/// Params: view, from, to. Locals: length, start, end, scratch, count, bytes,
/// the new buffer.
fn slice(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let (len, start, end, scratch, n, size, out) = (3, 4, 5, 6, 7, 8, 9);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
        ValType::I32,
        ValType::Ref(buffers::reference(t.buffer, true)),
    ]);
    length(m, &mut f, 0, len)?;
    indexing::clamp(&mut f, 1, start, true, len, scratch);
    indexing::clamp(&mut f, 2, end, true, len, scratch);
    count(&mut f, start, end, n);
    f.instructions(&[
        I::LocalGet(n),
        I::LocalGet(0),
        view_field(t, WIDTH),
        I::I32Mul,
        I::LocalSet(size),
    ]);
    // The view's result type is nullable, so the null return types check.
    let make = buffers::callee(m, buffers::Helper::Make)?;
    f.instructions(&[
        I::LocalGet(size),
        I::F64ConvertI32U,
        I::LocalGet(size),
        I::F64ConvertI32U,
        I::I32Const(0),
    ]);
    f.call(make);
    f.instructions(&[
        I::LocalTee(out),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::Concrete(t.view)),
        I::Return,
        I::End,
        I::LocalGet(size),
        I::If(BlockType::Empty),
        I::LocalGet(out),
        buffer_field(t, BYTES),
        I::I32Const(0),
    ]);
    bytes(&mut f, t, 0);
    place(&mut f, t, 0, start);
    f.instructions(&[
        I::LocalGet(size),
        I::ArrayCopy {
            array_type_index_dst: t.bytes,
            array_type_index_src: t.bytes,
        },
        I::End,
    ]);
    let descriptor = objects::descriptor(m, t.view_descriptor)?;
    f.global_get(descriptor);
    f.instructions(&[
        objects::UNHASHED,
        I::LocalGet(out),
        I::RefAsNonNull,
        I::I32Const(0),
        I::LocalGet(n),
        I::LocalGet(0),
        view_field(t, KIND),
        I::LocalGet(0),
        view_field(t, WIDTH),
        I::I32Const(0),
        I::StructNew(t.view),
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_view_set`: the source's elements from element `offset`, as many
/// as fit. One kind is a byte move; two kinds convert values, reading a
/// snapshot when both views share a buffer, since a wider destination would
/// overwrite elements not yet read.
///
/// Params: view, source, offset, the caller's name. Locals: at, count, room,
/// index, reading.
fn set(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let get = callee(m, Helper::Get)?;
    let put = callee(m, Helper::Put)?;
    let snapshot = callee(m, Helper::Slice)?;
    let (at, n, room, index, reading) = (4, 5, 6, 7, 8);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::Ref(buffers::reference(t.view, true)),
    ]);
    unless_attached(&mut f, t, 0, None);
    unless_attached(&mut f, t, 1, None);
    buffers::index_of(&mut f, 2);
    f.instructions(&[I::I32TruncSatF64U, I::LocalSet(at)]);
    length(m, &mut f, 1, n)?;
    length(m, &mut f, 0, room)?;
    f.instructions(&[
        I::LocalGet(at),
        I::LocalGet(room),
        I::I32GeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        // At most what fits after `at`.
        I::LocalGet(n),
        I::LocalGet(room),
        I::LocalGet(at),
        I::I32Sub,
        I::LocalGet(n),
        I::LocalGet(room),
        I::LocalGet(at),
        I::I32Sub,
        I::I32LeU,
        I::Select,
        I::LocalSet(n),
        I::LocalGet(0),
        view_field(t, KIND),
        I::LocalGet(1),
        view_field(t, KIND),
        I::I32Eq,
        I::If(BlockType::Empty),
    ]);
    bytes(&mut f, t, 0);
    place(&mut f, t, 0, at);
    bytes(&mut f, t, 1);
    f.instructions(&[
        I::LocalGet(1),
        view_field(t, OFFSET),
        I::LocalGet(n),
        I::LocalGet(0),
        view_field(t, WIDTH),
        I::I32Mul,
        I::ArrayCopy {
            array_type_index_dst: t.bytes,
            array_type_index_src: t.bytes,
        },
        I::Return,
        I::End,
        I::LocalGet(1),
        I::LocalSet(reading),
        I::LocalGet(0),
        view_field(t, BUFFER),
        I::LocalGet(1),
        view_field(t, BUFFER),
        I::RefEq,
        I::If(BlockType::Empty),
        I::LocalGet(1),
        I::F64Const(0.0.into()),
        I::LocalGet(n),
        I::F64ConvertI32U,
    ]);
    f.call(snapshot);
    // A snapshot that cannot be had is refused, as C's failed slice is loud: a
    // `set` silently dropped would be a wrong answer.
    f.instructions(&[I::LocalTee(reading), I::RefIsNull, I::If(BlockType::Empty)]);
    contract::refuse_in(
        &mut f,
        m,
        3,
        "a typed array's `set` whose snapshot of its source could not be allocated",
    )?;
    f.instructions(&[I::End, I::End]);
    convert(&mut f, (get, put), at, n, index, reading);
    f.instruction(&I::End);
    Ok(f)
}

/// `view[at + i] = reading[i]` for each `i` below `n`, by value through the
/// run-time kinds of both.
fn convert(f: &mut Function, (get, put): (Func, Func), at: u32, n: u32, index: u32, reading: u32) {
    f.instructions(&[
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(n),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        I::LocalGet(at),
        I::LocalGet(index),
        I::I32Add,
        I::LocalGet(reading),
        I::LocalGet(index),
    ]);
    f.call(get);
    f.call(put);
    f.instructions(&[
        I::LocalGet(index),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(index),
        I::Br(0),
        I::End,
        I::End,
    ]);
}

/// C's `nts_view_fill`. A one-byte integer kind fills the converted byte at
/// once; any other kind puts each element.
///
/// Params: view, value, from, to. Locals: length, start, end, scratch, index.
fn fill(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let put = callee(m, Helper::Put)?;
    let to_int32 = crate::helpers::callee(m, crate::helpers::Helper::ToInt32)?;
    let (len, start, end, scratch, index) = (4, 5, 6, 7, 8);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
    ]);
    unless_attached(&mut f, t, 0, None);
    length(m, &mut f, 0, len)?;
    indexing::clamp(&mut f, 2, start, true, len, scratch);
    indexing::clamp(&mut f, 3, end, true, len, scratch);
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32LeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        // Kinds 0 and 1: every byte is the same byte.
        I::LocalGet(0),
        view_field(t, KIND),
        I::I32Const(2),
        I::I32LtU,
        I::If(BlockType::Empty),
    ]);
    bytes(&mut f, t, 0);
    place(&mut f, t, 0, start);
    f.instruction(&I::LocalGet(1));
    f.call(to_int32);
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32Sub,
        I::ArrayFill(t.bytes),
        I::Return,
        I::End,
        I::LocalGet(start),
        I::LocalSet(index),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(end),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        I::LocalGet(index),
        I::LocalGet(1),
    ]);
    f.call(put);
    f.instructions(&[
        I::LocalGet(index),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(index),
        I::Br(0),
        I::End,
        I::End,
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_view_copy_within`, one `array.copy`.
///
/// Params: view, target, from, to. Locals: length, at, start, end, scratch,
/// count.
fn copy_within(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let (len, at, start, end, scratch, n) = (4, 5, 6, 7, 8, 9);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
    ]);
    unless_attached(&mut f, t, 0, None);
    length(m, &mut f, 0, len)?;
    indexing::clamp(&mut f, 1, at, true, len, scratch);
    indexing::clamp(&mut f, 2, start, true, len, scratch);
    indexing::clamp(&mut f, 3, end, true, len, scratch);
    count(&mut f, start, end, n);
    f.instructions(&[
        I::LocalGet(n),
        I::LocalGet(len),
        I::LocalGet(at),
        I::I32Sub,
        I::LocalGet(n),
        I::LocalGet(len),
        I::LocalGet(at),
        I::I32Sub,
        I::I32LeU,
        I::Select,
        I::LocalSet(n),
    ]);
    bytes(&mut f, t, 0);
    place(&mut f, t, 0, at);
    bytes(&mut f, t, 0);
    place(&mut f, t, 0, start);
    f.instructions(&[
        I::LocalGet(n),
        I::LocalGet(0),
        view_field(t, WIDTH),
        I::I32Mul,
        I::ArrayCopy {
            array_type_index_dst: t.bytes,
            array_type_index_src: t.bytes,
        },
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_view_join`: each element's number text, the separator between.
///
/// Params: view, separator. Locals: length, index, the text so far.
fn join(m: &mut Builder<'_>, _t: BufferTypes) -> Result<Function, Failure> {
    let get = callee(m, Helper::Get)?;
    let concat = strings::callee(m, strings::Helper::Concat)?;
    let empty = m.literal("");
    let text = host::external("nts_number_to_string")
        .ok_or_else(|| Failure::Invariant("number text service".into()))?
        .callee(m);
    let (len, index, out) = (2, 3, 4);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::Ref(RefType::EXTERNREF)]);
    length(m, &mut f, 0, len)?;
    f.global_get(empty);
    f.instructions(&[
        I::LocalSet(out),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(len),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(index),
        I::If(BlockType::Empty),
        I::LocalGet(out),
        I::LocalGet(1),
    ]);
    f.call(concat);
    f.instructions(&[
        I::LocalSet(out),
        I::End,
        I::LocalGet(out),
        I::LocalGet(0),
        I::LocalGet(index),
    ]);
    f.call(get);
    f.call(text);
    f.call(concat);
    f.instructions(&[
        I::LocalSet(out),
        I::LocalGet(index),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(index),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(out),
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_buffer_slice`: the bytes between the clamped endpoints, in a new
/// fixed buffer, or null if none can be had.
///
/// Params: buffer, from, to. Locals: length, start, end, scratch, count, the
/// new buffer.
fn buffer_slice(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let (len, start, end, scratch, n, out) = (3, 4, 5, 6, 7, 8);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
        ValType::Ref(buffers::reference(t.buffer, true)),
    ]);
    // A detached buffer's length is zero, so the copy is empty.
    f.instructions(&[I::LocalGet(0), buffer_field(t, LENGTH), I::LocalSet(len)]);
    indexing::clamp(&mut f, 1, start, true, len, scratch);
    indexing::clamp(&mut f, 2, end, true, len, scratch);
    count(&mut f, start, end, n);
    fresh(m, &mut f, n, out)?;
    f.instructions(&[
        I::LocalGet(n),
        I::If(BlockType::Empty),
        I::LocalGet(out),
        buffer_field(t, BYTES),
        I::I32Const(0),
        I::LocalGet(0),
        buffer_field(t, BYTES),
        I::LocalGet(start),
        I::LocalGet(n),
        I::ArrayCopy {
            array_type_index_dst: t.bytes,
            array_type_index_src: t.bytes,
        },
        I::End,
        I::LocalGet(out),
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_buffer_transfer`: a new buffer of `length` bytes holding as many
/// of the old one's as fit. It keeps the old one's maximum only where both
/// are resizable; a fixed one, or one transferred from a fixed buffer, holds
/// exactly its length, which may exceed the old maximum. A resizable one
/// past its maximum answers null, which the caller raises as a `RangeError`.
/// The old one is detached, its lengths zeroed, as every accessor then reads.
///
/// Params: buffer, length, fixed. Locals: length, the new buffer, carried.
fn transfer(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let make = buffers::callee(m, buffers::Helper::Make)?;
    let (n, out, carried) = (3, 4, 5);
    let mut f = Function::new([
        ValType::I32,
        ValType::Ref(buffers::reference(t.buffer, true)),
        ValType::I32,
    ]);
    let set = |field_index| I::StructSet {
        struct_type_index: t.buffer,
        field_index,
    };
    buffers::index_of(&mut f, 1);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::LocalSet(n),
        // Resizable on both sides, and past the maximum it keeps.
        I::LocalGet(2),
        I::I32Eqz,
        I::LocalGet(0),
        buffer_field(t, RESIZABLE),
        I::I32And,
        I::LocalGet(n),
        I::LocalGet(0),
        buffer_field(t, RESERVED),
        I::I32GtU,
        I::I32And,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::Concrete(t.buffer)),
        I::Return,
        I::End,
        I::LocalGet(n),
        I::F64ConvertI32U,
        // A fixed one reserves its length, else the old maximum.
        I::LocalGet(n),
        I::LocalGet(0),
        buffer_field(t, RESERVED),
        I::LocalGet(2),
        I::LocalGet(0),
        buffer_field(t, RESIZABLE),
        I::I32Eqz,
        I::I32Or,
        I::Select,
        I::F64ConvertI32U,
        I::LocalGet(2),
        I::I32Eqz,
        I::LocalGet(0),
        buffer_field(t, RESIZABLE),
        I::I32And,
    ]);
    f.call(make);
    f.instructions(&[
        I::LocalTee(out),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::Concrete(t.buffer)),
        I::Return,
        I::End,
        I::LocalGet(0),
        buffer_field(t, BYTES),
        I::RefIsNull,
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        buffer_field(t, LENGTH),
        I::LocalGet(n),
        I::LocalGet(0),
        buffer_field(t, LENGTH),
        I::LocalGet(n),
        I::I32LeU,
        I::Select,
        I::LocalTee(carried),
        I::If(BlockType::Empty),
        I::LocalGet(out),
        buffer_field(t, BYTES),
        I::I32Const(0),
        I::LocalGet(0),
        buffer_field(t, BYTES),
        I::I32Const(0),
        I::LocalGet(carried),
        I::ArrayCopy {
            array_type_index_dst: t.bytes,
            array_type_index_src: t.bytes,
        },
        I::End,
        I::LocalGet(0),
        I::RefNull(HeapType::Concrete(t.bytes)),
        set(BYTES),
        I::LocalGet(0),
        I::I32Const(0),
        set(LENGTH),
        I::LocalGet(0),
        I::I32Const(0),
        set(RESERVED),
        I::LocalGet(0),
        I::I32Const(0),
        set(RESIZABLE),
        I::End,
        I::LocalGet(out),
        I::End,
    ]);
    Ok(f)
}
