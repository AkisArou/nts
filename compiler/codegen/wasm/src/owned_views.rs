//! Typed arrays whose kind owns its buffers (`hir::views::owned_view_kinds`):
//! their elements in an array of their own type, so an element is one
//! `array.get` and a bulk method one `array.copy` or `array.fill`.
//!
//! The core proves, per kind and program-wide, that nothing but views of that
//! kind ever reaches such a buffer: no `.buffer`, no second kind, no erasure,
//! no host. Such a buffer comes from `nts_buffer_new` and is never resized,
//! transferred or detached. So it holds its elements' array in place of bytes,
//! made when it is, and a view over it is a window in elements -- a start and
//! a length that never change. The buffer itself still answers its own
//! queries (`byteLength` and the rest) from its fields.
//!
//! An owned view and a byte-backed one are unrelated struct types, so a flow
//! from one to the other is refused by name by `transfer`, not converted.
use crate::{
    arrays,
    body::Body,
    buffer_methods,
    buffers::{self, BYTES, LENGTH, TYPED},
    contract,
    error::Failure,
    gc::{BufferTypes, OwnedView, ROOT_FIELDS},
    helpers, host, indexing,
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, objects, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{Callee, HirType, ManagedType, OpKind, ValueId, builtin::element_kind};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

// An owned view's fields after the root, in elements.
const STORE: u32 = ROOT_FIELDS;
const START: u32 = ROOT_FIELDS + 1;
const COUNT: u32 = ROOT_FIELDS + 2;

/// The element type of runtime kind `kind`: the inverse of the core's
/// `element_kind`, which the core does not provide.
fn element_of(kind: u32) -> Option<HirType> {
    let int = |bits, signed| HirType::Int { bits, signed };
    Some(match kind {
        0 => int(8, true),
        1 => int(8, false),
        3 => int(16, true),
        4 => int(16, false),
        5 => int(32, true),
        6 => int(32, false),
        7 => HirType::Float { bits: 32 },
        8 => HirType::Float { bits: 64 },
        _ => return None,
    })
}

/// The owned storage of a value of type `ty`, if it is a view of an owned kind.
pub(crate) fn of<'p>(b: &Body<'_, 'p>, ty: &HirType) -> Option<&'p OwnedView> {
    match ty {
        HirType::Managed(ManagedType::View(element)) => b.types().owned_views.get(&**element),
        _ => None,
    }
}

fn owned(m: &Builder<'_>, kind: u32) -> Result<OwnedView, Failure> {
    let element = element_of(kind).ok_or_else(|| Failure::Invariant(format!("kind {kind}")))?;
    m.types
        .owned_views
        .get(&element)
        .cloned()
        .ok_or_else(|| Failure::Invariant(format!("unplanned owned view of {element:?}")))
}

fn width(element: &HirType) -> i32 {
    match element {
        HirType::Int { bits, .. } | HirType::Float { bits } => i32::from(*bits / 8),
        _ => 1,
    }
}

/// The kind of the owned views a fresh buffer is made for: the kind of a view
/// built over it in this function. The core's proof is that every view over
/// it is that kind, so one is enough.
pub(crate) fn private_kind(b: &Body<'_, '_>, buffer: ValueId) -> Option<u32> {
    b.func.values.iter().find_map(|op| match &op.kind {
        OpKind::Call {
            callee: Callee::External(name),
            args,
            ..
        } if name == "nts_view_new" && args.first() == Some(&buffer) => {
            of(b, &op.ty).and_then(|view| element_kind(&view.element))
        }
        _ => None,
    })
}

/// A module helper, by the kinds it is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(length) -> buffer`, holding `length / width` elements and no bytes.
    Buffer(u32),
    /// `(buffer, offset, length, tracking) -> view`.
    View(u32),
    Subarray(u32),
    Slice(u32),
    Fill(u32),
    CopyWithin(u32),
    Join(u32),
    /// Element by element, converting: either side may be byte-backed.
    Set {
        target: Side,
        source: Side,
    },
}

/// One side of a `set`: an owned kind, or a byte-backed view read and written
/// by its run-time kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Side {
    Owned(u32),
    Bytes,
}

/// A fresh buffer for an owned kind, in place of `nts_buffer_new`'s bytes.
pub(crate) fn buffer(b: &mut Body<'_, '_>, kind: u32, length: ValueId) -> Result<(), Failure> {
    let make = callee(b.m, Helper::Buffer(kind))?;
    arrays::number(b, length)?;
    b.call(make);
    Ok(())
}

/// `nts_view_new` of an owned kind.
pub(crate) fn view(
    b: &mut Body<'_, '_>,
    view: &OwnedView,
    args: &[ValueId],
) -> Result<(), Failure> {
    let &[buffer, offset, length, _kind, tracking] = args else {
        return Err(Failure::Invariant(
            "a view built from other than 5 values".into(),
        ));
    };
    let kind = element_kind(&view.element)
        .ok_or_else(|| Failure::Invariant(format!("owned {:?}", view.element)))?;
    contract::nonnull(b, buffer, "a view over a null buffer")?;
    let make = callee(b.m, Helper::View(kind))?;
    b.load(buffer)?;
    arrays::number(b, offset)?;
    arrays::number(b, length)?;
    b.load(tracking)?;
    b.call(make);
    Ok(())
}

/// The store and the element's place in it, after a bounds test if checked.
fn place(
    b: &mut Body<'_, '_>,
    view: &OwnedView,
    subject: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    contract::nonnull(b, subject, "an element of a null typed array")?;
    let ty = view.view;
    if checked {
        arrays::within(b, at, false, |b| {
            b.load(subject)?;
            b.instruction(&I::StructGet {
                struct_type_index: ty,
                field_index: COUNT,
            });
            Ok(())
        })?;
        contract::require(b, "a typed-array index outside the view")?;
    }
    b.load(subject)?;
    b.instruction(&I::StructGet {
        struct_type_index: ty,
        field_index: STORE,
    });
    b.load(subject)?;
    b.instruction(&I::StructGet {
        struct_type_index: ty,
        field_index: START,
    });
    arrays::index(b, at)?;
    b.instruction(&I::I32Add);
    Ok(())
}

/// The instruction reading one element of an owned store.
fn get_instruction(view: &OwnedView) -> I<'static> {
    match view.element {
        HirType::Int {
            bits: 8 | 16,
            signed: true,
        } => I::ArrayGetS(view.store),
        HirType::Int {
            bits: 8 | 16,
            signed: false,
        } => I::ArrayGetU(view.store),
        _ => I::ArrayGet(view.store),
    }
}

pub(crate) fn get(
    b: &mut Body<'_, '_>,
    result: ValueId,
    view: &OwnedView,
    subject: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    place(b, view, subject, at, checked)?;
    b.instruction(&get_instruction(view));
    numeric::convert(b, &view.element, &b.ty(result).clone())
}

pub(crate) fn set(
    b: &mut Body<'_, '_>,
    view: &OwnedView,
    subject: ValueId,
    at: ValueId,
    value: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    place(b, view, subject, at, checked)?;
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &view.element)?;
    b.instruction(&I::ArraySet(view.store));
    Ok(())
}

/// `length`, `byteLength` or `byteOffset` of an owned view, as an `i32`.
pub(crate) fn property(
    b: &mut Body<'_, '_>,
    view: &OwnedView,
    subject: ValueId,
    op: buffers::Op,
) -> Result<(), Failure> {
    let field = match op {
        buffers::Op::ViewByteOffset => START,
        buffers::Op::ViewLength | buffers::Op::ViewByteLength => COUNT,
        other => {
            return Err(format!(
                "{other:?} of an owned typed array, which the core said nothing asks"
            )
            .into());
        }
    };
    b.load(subject)?;
    b.instruction(&I::StructGet {
        struct_type_index: view.view,
        field_index: field,
    });
    if op != buffers::Op::ViewLength {
        b.instructions(&[I::I32Const(width(&view.element)), I::I32Mul]);
    }
    Ok(())
}

/// A method whose receiver, or whose `set` source, is an owned view.
pub(crate) fn method(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: buffer_methods::Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let side = |b: &Body<'_, '_>, value: ValueId| -> Result<Side, Failure> {
        match of(b, b.ty(value)) {
            Some(view) => Ok(Side::Owned(
                element_kind(&view.element)
                    .ok_or_else(|| Failure::Invariant("owned kind".into()))?,
            )),
            None => match b.ty(value) {
                HirType::Managed(ManagedType::View(_) | ManagedType::AnyView) => Ok(Side::Bytes),
                other => Err(format!("a typed-array method on a {other:?}").into()),
            },
        }
    };
    let target = side(b, args[0])?;
    let helper = match (op, target) {
        (buffer_methods::Op::Set, target) => Helper::Set {
            target,
            source: side(b, args[1])?,
        },
        (buffer_methods::Op::Subarray, Side::Owned(k)) => Helper::Subarray(k),
        (buffer_methods::Op::Slice, Side::Owned(k)) => Helper::Slice(k),
        (buffer_methods::Op::Fill, Side::Owned(k)) => Helper::Fill(k),
        (buffer_methods::Op::CopyWithin, Side::Owned(k)) => Helper::CopyWithin(k),
        (buffer_methods::Op::Join, Side::Owned(k)) => Helper::Join(k),
        (op, side) => {
            return Err(Failure::Invariant(format!(
                "{op:?} of {side:?} routed to owned views"
            )));
        }
    };
    contract::nonnull(b, args[0], "a method of a null typed array")?;
    if op == buffer_methods::Op::Set {
        contract::nonnull(b, args[1], "`set` from a null typed array")?;
    }
    let target = callee(b.m, helper)?;
    b.load(args[0])?;
    match op {
        buffer_methods::Op::Set => {
            b.load(args[1])?;
            arrays::number(b, args[2])?;
        }
        buffer_methods::Op::Join => {
            if !strings::is_string(b.ty(args[1])) {
                return Err(format!("join separator {:?}", b.ty(args[1])).into());
            }
            contract::nonnull(
                b,
                args[1],
                "a null separator, which may stand for undefined or for null",
            )?;
            b.load(args[1])?;
        }
        _ => {
            for &arg in &args[1..] {
                arrays::number(b, arg)?;
            }
        }
    }
    b.call(target);
    if op == buffer_methods::Op::Join {
        objects::adapt(
            b,
            &HirType::Managed(ManagedType::String),
            &b.ty(result).clone(),
        )?;
    }
    Ok(())
}

/// Whether a method has an owned side, so `method` answers it.
pub(crate) fn involved(b: &Body<'_, '_>, op: buffer_methods::Op, args: &[ValueId]) -> bool {
    let owned = |value: &ValueId| of(b, b.ty(*value)).is_some();
    args.first().is_some_and(owned)
        || (op == buffer_methods::Op::Set && args.get(1).is_some_and(owned))
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let t = buffers::types(m)?;
    let i32 = Physical::Scalar(Slot::I32);
    let f64 = Physical::Scalar(Slot::F64);
    let reference = |ty, nullable| Physical::Reference(buffers::reference(ty, nullable));
    let side = |m: &Builder<'_>, side: Side| -> Result<Physical, Failure> {
        Ok(match side {
            Side::Owned(k) => reference(owned(m, k)?.view, true),
            Side::Bytes => reference(t.view, true),
        })
    };
    let (params, result) = match helper {
        Helper::Buffer(_) => (vec![f64], Some(reference(t.buffer, true))),
        Helper::View(k) => (
            vec![reference(t.buffer, true), f64, f64, i32],
            Some(reference(owned(m, k)?.view, false)),
        ),
        Helper::Subarray(k) | Helper::Slice(k) => {
            let view = owned(m, k)?.view;
            (
                vec![reference(view, true), f64, f64],
                Some(reference(view, false)),
            )
        }
        Helper::Fill(k) | Helper::CopyWithin(k) => (
            vec![reference(owned(m, k)?.view, true), f64, f64, f64],
            None,
        ),
        Helper::Join(k) => (
            vec![reference(owned(m, k)?.view, true), strings::STRING],
            Some(strings::STRING),
        ),
        Helper::Set { target, source } => (vec![side(m, target)?, side(m, source)?, f64], None),
    };
    m.helper(
        FuncKey::OwnedView(helper),
        format!("owned.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Buffer(k) => make_buffer(m, t, &owned(m, k)?),
            Helper::View(k) => make_view(m, t, &owned(m, k)?),
            Helper::Subarray(k) => window(m, &owned(m, k)?, false),
            Helper::Slice(k) => window(m, &owned(m, k)?, true),
            Helper::Fill(k) => fill(m, &owned(m, k)?),
            Helper::CopyWithin(k) => Ok(copy_within(&owned(m, k)?)),
            Helper::Join(k) => join(m, &owned(m, k)?),
            Helper::Set { target, source } => set_helper(m, t, target, source),
        },
    )
}

/// A fresh buffer for an owned kind: no bytes, and its elements' array in the
/// typed field. Null past `MAX_BYTES`, as `nts_buffer_new`.
///
/// Params: length. Locals: bytes.
fn make_buffer(m: &mut Builder<'_>, t: BufferTypes, view: &OwnedView) -> Result<Function, Failure> {
    let descriptor = objects::descriptor(m, t.buffer_descriptor)?;
    let bytes = 1;
    let mut f = Function::new([ValType::I32]);
    buffers::index_of(&mut f, 0);
    f.instructions(&[
        I::F64Const(f64::from(buffers::MAX_BYTES).into()),
        I::F64Gt,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::Concrete(t.buffer)),
        I::Return,
        I::End,
    ]);
    buffers::index_of(&mut f, 0);
    f.instruction(&I::I32TruncSatF64U);
    f.instruction(&I::LocalSet(bytes));
    f.global_get(descriptor);
    f.instructions(&[
        objects::UNHASHED,
        I::LocalGet(bytes),
        I::LocalGet(bytes),
        I::I32Const(0),
        // Empty but present: a null array is what detached means.
        I::I32Const(0),
        I::ArrayNewDefault(t.bytes),
        I::LocalGet(bytes),
        I::I32Const(width(&view.element)),
        I::I32DivU,
        I::ArrayNewDefault(view.store),
        I::StructNew(t.buffer),
        I::End,
    ]);
    Ok(f)
}

/// `nts_view_new` over a private buffer: its store, and a window in elements.
/// The buffer is never resized, so a tracking view's length is fixed now.
///
/// Params: buffer, offset, length, tracking. Locals: start.
fn make_view(m: &mut Builder<'_>, t: BufferTypes, view: &OwnedView) -> Result<Function, Failure> {
    let descriptor = objects::descriptor(m, t.view_descriptor)?;
    let shift = width(&view.element).trailing_zeros().cast_signed();
    let start = 4;
    let mut f = Function::new([ValType::I32]);
    f.global_get(descriptor);
    f.instructions(&[
        objects::UNHASHED,
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: t.buffer,
            field_index: TYPED,
        },
        I::RefCastNonNull(HeapType::Concrete(view.store)),
    ]);
    buffers::index_of(&mut f, 1);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::I32Const(shift),
        I::I32ShrU,
        I::LocalTee(start),
        // Tracking: what lies past the start; else the stated length.
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: t.buffer,
            field_index: LENGTH,
        },
        I::I32Const(shift),
        I::I32ShrU,
        I::LocalGet(start),
        I::I32Sub,
    ]);
    buffers::index_of(&mut f, 2);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::LocalGet(3),
        I::Select,
        I::StructNew(view.view),
        I::End,
    ]);
    Ok(f)
}

fn field(view: &OwnedView, field_index: u32) -> I<'static> {
    I::StructGet {
        struct_type_index: view.view,
        field_index,
    }
}

/// `subarray`, sharing the store, or `slice`, copying it.
///
/// Params: view, from, to. Locals: length, start, end, scratch, count, store.
fn window(m: &mut Builder<'_>, view: &OwnedView, copy: bool) -> Result<Function, Failure> {
    let t = buffers::types(m)?;
    let descriptor = objects::descriptor(m, t.view_descriptor)?;
    let (len, start, end, scratch, n, store) = (3, 4, 5, 6, 7, 8);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
        ValType::Ref(buffers::reference(view.store, true)),
    ]);
    f.instructions(&[I::LocalGet(0), field(view, COUNT), I::LocalSet(len)]);
    indexing::clamp(&mut f, 1, start, true, len, scratch);
    indexing::clamp(&mut f, 2, end, true, len, scratch);
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32Sub,
        I::I32Const(0),
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32GtU,
        I::Select,
        I::LocalSet(n),
    ]);
    if copy {
        f.instructions(&[
            I::LocalGet(n),
            I::ArrayNewDefault(view.store),
            I::LocalTee(store),
            I::I32Const(0),
            I::LocalGet(0),
            field(view, STORE),
            I::LocalGet(0),
            field(view, START),
            I::LocalGet(start),
            I::I32Add,
            I::LocalGet(n),
            I::ArrayCopy {
                array_type_index_dst: view.store,
                array_type_index_src: view.store,
            },
        ]);
    }
    f.global_get(descriptor);
    f.instruction(&objects::UNHASHED);
    if copy {
        f.instructions(&[I::LocalGet(store), I::RefAsNonNull, I::I32Const(0)]);
    } else {
        f.instructions(&[
            I::LocalGet(0),
            field(view, STORE),
            I::LocalGet(0),
            field(view, START),
            I::LocalGet(start),
            I::I32Add,
        ]);
    }
    f.instructions(&[I::LocalGet(n), I::StructNew(view.view), I::End]);
    Ok(f)
}

/// The number on the stack as an owned element: `ToInt32`'s low bits for an
/// integer (a packed store keeps the low ones), rounded for a float32.
fn narrow(f: &mut Function, to_int32: Func, element: &HirType) {
    match element {
        HirType::Float { bits: 64 } => {}
        HirType::Float { .. } => f.instruction(&I::F32DemoteF64),
        _ => f.call(to_int32),
    }
}

/// The owned element on the stack, read with `get_instruction`, as a number.
fn widen(f: &mut Function, element: &HirType) {
    match element {
        HirType::Float { bits: 64 } => {}
        HirType::Float { .. } => f.instruction(&I::F64PromoteF32),
        HirType::Int { signed: false, .. } => f.instruction(&I::F64ConvertI32U),
        _ => f.instruction(&I::F64ConvertI32S),
    }
}

/// `fill`: one `array.fill` of the converted value.
///
/// Params: view, value, from, to. Locals: length, start, end, scratch.
fn fill(m: &mut Builder<'_>, view: &OwnedView) -> Result<Function, Failure> {
    let to_int32 = helpers::callee(m, helpers::Helper::ToInt32)?;
    let (len, start, end, scratch) = (4, 5, 6, 7);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32, ValType::F64]);
    f.instructions(&[I::LocalGet(0), field(view, COUNT), I::LocalSet(len)]);
    indexing::clamp(&mut f, 2, start, true, len, scratch);
    indexing::clamp(&mut f, 3, end, true, len, scratch);
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32LeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(0),
        field(view, STORE),
        I::LocalGet(0),
        field(view, START),
        I::LocalGet(start),
        I::I32Add,
        I::LocalGet(1),
    ]);
    narrow(&mut f, to_int32, &view.element);
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32Sub,
        I::ArrayFill(view.store),
        I::End,
    ]);
    Ok(f)
}

/// `copyWithin`: one `array.copy`, which moves as `memmove` does.
///
/// Params: view, target, from, to. Locals: length, at, start, end, scratch,
/// count.
fn copy_within(view: &OwnedView) -> Function {
    let (len, at, start, end, scratch, n) = (4, 5, 6, 7, 8, 9);
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::I32,
    ]);
    f.instructions(&[I::LocalGet(0), field(view, COUNT), I::LocalSet(len)]);
    indexing::clamp(&mut f, 1, at, true, len, scratch);
    indexing::clamp(&mut f, 2, start, true, len, scratch);
    indexing::clamp(&mut f, 3, end, true, len, scratch);
    // count = min(max(end - start, 0), length - at)
    f.instructions(&[
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32Sub,
        I::I32Const(0),
        I::LocalGet(end),
        I::LocalGet(start),
        I::I32GtU,
        I::Select,
        I::LocalTee(n),
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
        I::LocalGet(0),
        field(view, STORE),
        I::LocalGet(0),
        field(view, START),
        I::LocalGet(at),
        I::I32Add,
        I::LocalGet(0),
        field(view, STORE),
        I::LocalGet(0),
        field(view, START),
        I::LocalGet(start),
        I::I32Add,
        I::LocalGet(n),
        I::ArrayCopy {
            array_type_index_dst: view.store,
            array_type_index_src: view.store,
        },
        I::End,
    ]);
    f
}

/// `join`: each element's number text, the separator between.
///
/// Params: view, separator. Locals: length, index, the text so far.
fn join(m: &mut Builder<'_>, view: &OwnedView) -> Result<Function, Failure> {
    let concat = strings::callee(m, strings::Helper::Concat)?;
    let empty = m.literal("");
    let text = host::external("nts_number_to_string")
        .ok_or_else(|| Failure::Invariant("number text service".into()))?
        .callee(m);
    let (len, index, out) = (2, 3, 4);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::Ref(RefType::EXTERNREF)]);
    f.instructions(&[I::LocalGet(0), field(view, COUNT), I::LocalSet(len)]);
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
        field(view, STORE),
        I::LocalGet(0),
        field(view, START),
        I::LocalGet(index),
        I::I32Add,
        get_instruction(view),
    ]);
    widen(&mut f, &view.element);
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

/// A side's element count now, into `local`.
fn side_length(
    m: &mut Builder<'_>,
    f: &mut Function,
    side: Side,
    param: u32,
    local: u32,
) -> Result<(), Failure> {
    match side {
        Side::Owned(k) => {
            let view = owned(m, k)?;
            f.instructions(&[I::LocalGet(param), field(&view, COUNT), I::LocalSet(local)]);
        }
        Side::Bytes => {
            let length = buffers::callee(m, buffers::Helper::Length)?;
            f.instruction(&I::LocalGet(param));
            f.call(length);
            f.instruction(&I::LocalSet(local));
        }
    }
    Ok(())
}

/// `set` with an owned side, as C's `nts_view_set`: as many of the source's
/// elements as fit from element `offset`. One owned kind on both sides is one
/// `array.copy`, overlapping or not. Otherwise each value converts through
/// both kinds; no snapshot is needed, since an owned buffer has no view of
/// another kind, so the two cannot share bytes.
///
/// Params: target, source, offset. Locals: at, count, room, index.
fn set_helper(
    m: &mut Builder<'_>,
    t: BufferTypes,
    target: Side,
    source: Side,
) -> Result<Function, Failure> {
    let (at, count, room, index) = (3, 4, 5, 6);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32, ValType::I32]);
    // A detached byte-backed side reads as empty, as C's `nts_view_bytes`.
    for (side, param) in [(target, 0), (source, 1)] {
        if side == Side::Bytes {
            f.instructions(&[
                I::LocalGet(param),
                I::StructGet {
                    struct_type_index: t.view,
                    field_index: buffers::BUFFER,
                },
                I::StructGet {
                    struct_type_index: t.buffer,
                    field_index: BYTES,
                },
                I::RefIsNull,
                I::If(BlockType::Empty),
                I::Return,
                I::End,
            ]);
        }
    }
    buffers::index_of(&mut f, 2);
    f.instructions(&[I::I32TruncSatF64U, I::LocalSet(at)]);
    side_length(m, &mut f, source, 1, count)?;
    side_length(m, &mut f, target, 0, room)?;
    f.instructions(&[
        I::LocalGet(at),
        I::LocalGet(room),
        I::I32GeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(count),
        I::LocalGet(room),
        I::LocalGet(at),
        I::I32Sub,
        I::LocalGet(count),
        I::LocalGet(room),
        I::LocalGet(at),
        I::I32Sub,
        I::I32LeU,
        I::Select,
        I::LocalSet(count),
    ]);
    if let (Side::Owned(written), Side::Owned(read)) = (target, source)
        && written == read
    {
        let view = owned(m, written)?;
        f.instructions(&[
            I::LocalGet(0),
            field(&view, STORE),
            I::LocalGet(0),
            field(&view, START),
            I::LocalGet(at),
            I::I32Add,
            I::LocalGet(1),
            field(&view, STORE),
            I::LocalGet(1),
            field(&view, START),
            I::LocalGet(count),
            I::ArrayCopy {
                array_type_index_dst: view.store,
                array_type_index_src: view.store,
            },
            I::End,
        ]);
        return Ok(f);
    }
    convert_each(m, &mut f, target, source, (at, count, index))?;
    f.instruction(&I::End);
    Ok(f)
}

/// `target[at + i] = source[i]` for each `i` below `count`, by value through
/// both kinds, each owned or byte-backed.
fn convert_each(
    m: &mut Builder<'_>,
    f: &mut Function,
    target: Side,
    source: Side,
    (at, count, index): (u32, u32, u32),
) -> Result<(), Failure> {
    let to_int32 = helpers::callee(m, helpers::Helper::ToInt32)?;
    let get = buffer_methods::callee(m, buffer_methods::Helper::Get)?;
    let put = buffer_methods::callee(m, buffer_methods::Helper::Put)?;
    f.instructions(&[
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(count),
        I::I32GeU,
        I::BrIf(1),
    ]);
    // The target and its element's place: owned, its store and index;
    // byte-backed, the view and index `put` takes.
    let target_view = match target {
        Side::Owned(kind) => {
            let view = owned(m, kind)?;
            f.instructions(&[
                I::LocalGet(0),
                field(&view, STORE),
                I::LocalGet(0),
                field(&view, START),
                I::LocalGet(at),
                I::I32Add,
                I::LocalGet(index),
                I::I32Add,
            ]);
            Some(view)
        }
        Side::Bytes => {
            f.instructions(&[
                I::LocalGet(0),
                I::LocalGet(at),
                I::LocalGet(index),
                I::I32Add,
            ]);
            None
        }
    };
    // The source's element, as a number.
    match source {
        Side::Owned(kind) => {
            let view = owned(m, kind)?;
            f.instructions(&[
                I::LocalGet(1),
                field(&view, STORE),
                I::LocalGet(1),
                field(&view, START),
                I::LocalGet(index),
                I::I32Add,
                get_instruction(&view),
            ]);
            widen(f, &view.element);
        }
        Side::Bytes => {
            f.instructions(&[I::LocalGet(1), I::LocalGet(index)]);
            f.call(get);
        }
    }
    match target_view {
        Some(view) => {
            narrow(f, to_int32, &view.element);
            f.instruction(&I::ArraySet(view.store));
        }
        None => f.call(put),
    }
    f.instructions(&[
        I::LocalGet(index),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(index),
        I::Br(0),
        I::End,
        I::End,
    ]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `element_of` inverts the core's numbering for every kind it names.
    #[test]
    fn element_of_inverts_the_cores_numbering() {
        for kind in 0..16 {
            if let Some(element) = element_of(kind) {
                assert_eq!(element_kind(&element), Some(kind), "{element:?}");
            }
        }
        let named = (0..16).filter(|kind| element_of(*kind).is_some()).count();
        assert_eq!(named, 8);
    }
}
