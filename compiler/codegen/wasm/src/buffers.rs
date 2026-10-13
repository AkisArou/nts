//! `ArrayBuffer`, the typed arrays over one, and `DataView`, as the C
//! runtime's `NtsBuffer`, `NtsView` and `NtsDataView` (`runtime/c`).
//!
//! A buffer is an object holding a GC byte array the size of what it reserved
//! and the length it reports. Every view over it reads and writes that one
//! array, so two views of different widths alias exactly, as they do in node.
//! An element wider than a byte is assembled little-endian from its bytes, and
//! a store takes it apart again. A detached buffer's array is null, and it,
//! and every view over it, reports length 0.
//!
//! Byte counts are `i32`s no larger than [`MAX_BYTES`]. A request past that
//! answers null, which the lowering turns into node's "Array buffer allocation
//! failed" `RangeError`: the contract of C's failed `calloc`, a length the
//! language allows and the machine does not. The ceiling is V8's largest byte
//! array (1,073,741,799 on node v24.20, measured), less room for its header to
//! grow.
use crate::{
    arrays,
    body::Body,
    contract,
    error::Failure,
    gc::{BufferTypes, ROOT_FIELDS},
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, objects,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) const MAX_BYTES: u32 = (1 << 30) - 64;

// A buffer's fields after the object root.
pub(crate) const LENGTH: u32 = ROOT_FIELDS;
pub(crate) const RESERVED: u32 = ROOT_FIELDS + 1;
pub(crate) const RESIZABLE: u32 = ROOT_FIELDS + 2;
pub(crate) const BYTES: u32 = ROOT_FIELDS + 3;
// A view's. A DataView has the first three, then its tracking flag.
pub(crate) const BUFFER: u32 = ROOT_FIELDS;
pub(crate) const OFFSET: u32 = ROOT_FIELDS + 1;
/// Elements, when the view does not track its buffer.
pub(crate) const ELEMENTS: u32 = ROOT_FIELDS + 2;
pub(crate) const KIND: u32 = ROOT_FIELDS + 3;
pub(crate) const WIDTH: u32 = ROOT_FIELDS + 4;
pub(crate) const TRACKING: u32 = ROOT_FIELDS + 5;

/// Which of the runtime's element kinds (`NTS_ELEMENT_*`) a view's element
/// is. The numbering is `nts_core::hir::builtin::element_kind`'s, which the
/// lowering's `nts_view_new` and `nts_is_view_kind` constants carry; kind 2,
/// `Uint8ClampedArray`, has no element type the lowering accepts.
pub(crate) const fn kind(element: &HirType) -> Option<u32> {
    Some(match element {
        HirType::Int {
            bits: 8,
            signed: true,
        } => 0,
        HirType::Int {
            bits: 8,
            signed: false,
        } => 1,
        HirType::Int {
            bits: 16,
            signed: true,
        } => 3,
        HirType::Int {
            bits: 16,
            signed: false,
        } => 4,
        HirType::Int {
            bits: 32,
            signed: true,
        } => 5,
        HirType::Int {
            bits: 32,
            signed: false,
        } => 6,
        HirType::Float { bits: 32 } => 7,
        HirType::Float { bits: 64 } => 8,
        _ => return None,
    })
}

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    BufferNew,
    BufferNewResizable,
    BufferByteLength,
    BufferMaxByteLength,
    BufferResizable,
    BufferResize,
    BufferDetached,
    ViewNew,
    ViewLength,
    ViewByteLength,
    ViewByteOffset,
    ViewBuffer,
    IsBuffer,
    /// `ArrayBuffer.isView`: a typed array or a `DataView`.
    IsView,
    IsViewKind,
    IsDataView,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_buffer_new" => Op::BufferNew,
        "nts_buffer_new_resizable" => Op::BufferNewResizable,
        "nts_buffer_byte_length" => Op::BufferByteLength,
        "nts_buffer_max_byte_length" => Op::BufferMaxByteLength,
        "nts_buffer_resizable" => Op::BufferResizable,
        "nts_buffer_resize" => Op::BufferResize,
        "nts_buffer_detached" => Op::BufferDetached,
        "nts_view_new" => Op::ViewNew,
        "nts_view_length" => Op::ViewLength,
        "nts_view_byte_length" => Op::ViewByteLength,
        "nts_view_byte_offset" => Op::ViewByteOffset,
        "nts_view_buffer" => Op::ViewBuffer,
        "nts_is_buffer" => Op::IsBuffer,
        "nts_value_is_view" => Op::IsView,
        "nts_is_view_kind" => Op::IsViewKind,
        "nts_is_data_view" => Op::IsDataView,
        _ => return None,
    })
}

impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        !matches!(
            self,
            Self::BufferNew
                | Self::BufferNewResizable
                | Self::BufferResize
                | Self::ViewNew
                | Self::ViewLength
                | Self::ViewByteLength
        )
    }
}

/// A module helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(length, reserved, resizable) -> buffer`, or null past [`MAX_BYTES`].
    Make,
    /// `(buffer, length)`: C's `nts_buffer_resize`, zeroing what it grows by.
    Resize,
    /// `(buffer, offset, length, kind, tracking) -> view`.
    View,
    /// `(view) -> elements`: C's `nts_view_length`, computed on every read.
    Length,
    /// `(bytes, at) -> value`, little-endian.
    Load16,
    Load32,
    Load64,
    /// `(bytes, at, value)`, little-endian.
    Store16,
    Store32,
    Store64,
}

pub(crate) const fn is_view(ty: &HirType) -> bool {
    matches!(ty, HirType::Managed(ManagedType::View(_)))
}

pub(crate) fn types(m: &Builder<'_>) -> Result<BufferTypes, Failure> {
    m.types
        .buffers
        .ok_or_else(|| Failure::Invariant("unplanned buffer types".into()))
}

pub(crate) const fn reference(ty: u32, nullable: bool) -> RefType {
    RefType {
        nullable,
        heap_type: HeapType::Concrete(ty),
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let arity = match op {
        Op::ViewNew => 5,
        Op::IsViewKind | Op::BufferNewResizable | Op::BufferResize => 2,
        _ => 1,
    };
    if args.len() != arity {
        return Err(format!("buffer helper {op:?} arity mismatch").into());
    }
    let subject = args[0];
    match op {
        Op::IsBuffer | Op::IsView | Op::IsViewKind | Op::IsDataView => test(b, op, args),
        Op::BufferNew | Op::BufferNewResizable | Op::BufferResize | Op::ViewNew => {
            construct(b, op, args)
        }
        Op::BufferDetached => {
            // A null buffer is detached, as C's `!buffer || !buffer->bytes`.
            let t = types(b.m)?;
            b.load(subject)?;
            b.instruction(&I::RefIsNull);
            b.instruction(&I::If(BlockType::Result(ValType::I32)));
            b.instruction(&I::I32Const(1));
            b.instruction(&I::Else);
            b.load(subject)?;
            b.instruction(&I::StructGet {
                struct_type_index: t.buffer,
                field_index: BYTES,
            });
            b.instruction(&I::RefIsNull);
            b.instruction(&I::End);
            numeric::convert(b, &HirType::Bool, &b.ty(result).clone())
        }
        Op::BufferByteLength
        | Op::BufferMaxByteLength
        | Op::BufferResizable
        | Op::ViewLength
        | Op::ViewByteLength
        | Op::ViewByteOffset
        | Op::ViewBuffer => property(b, result, op, subject),
    }
}

/// A new buffer or view, or a buffer's new length.
fn construct(b: &mut Body<'_, '_>, op: Op, args: &[ValueId]) -> Result<(), Failure> {
    let subject = args[0];
    match op {
        Op::BufferNew | Op::BufferNewResizable => {
            // A fixed buffer reserves exactly its length.
            let make = callee(b.m, Helper::Make)?;
            let reserved = if op == Op::BufferNew {
                subject
            } else {
                args[1]
            };
            arrays::number(b, subject)?;
            arrays::number(b, reserved)?;
            b.instruction(&I::I32Const(i32::from(op == Op::BufferNewResizable)));
            b.call(make);
        }
        Op::BufferResize => {
            contract::nonnull(b, subject, "resizing a null buffer")?;
            let resize = callee(b.m, Helper::Resize)?;
            b.load(subject)?;
            arrays::number(b, args[1])?;
            b.call(resize);
        }
        Op::ViewNew => {
            let &[buffer, offset, length, kind, tracking] = args else {
                return Err(Failure::Invariant(
                    "a view built from other than 5 values".into(),
                ));
            };
            if b.ty(tracking) != &HirType::Bool {
                return Err("a view's tracking flag that is not a boolean".into());
            }
            contract::nonnull(b, buffer, "a view over a null buffer")?;
            let view = callee(b.m, Helper::View)?;
            b.load(buffer)?;
            arrays::number(b, offset)?;
            arrays::number(b, length)?;
            arrays::number(b, kind)?;
            b.load(tracking)?;
            b.call(view);
        }
        _ => return Err(Failure::Invariant(format!("{op:?} constructs nothing"))),
    }
    Ok(())
}

/// A buffer's or a view's own property.
fn property(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    subject: ValueId,
) -> Result<(), Failure> {
    let t = types(b.m)?;
    let why = match op {
        Op::BufferByteLength | Op::BufferMaxByteLength | Op::BufferResizable => {
            "a property of a null buffer"
        }
        Op::ViewBuffer => "the buffer of a null view",
        _ => "a property of a null typed array",
    };
    contract::nonnull(b, subject, why)?;
    match op {
        // Detaching zeroes all three, as C's transfer does. A fixed buffer
        // reserved its length, which is its `maxByteLength`.
        Op::BufferByteLength | Op::BufferMaxByteLength | Op::BufferResizable => {
            b.load(subject)?;
            b.instruction(&I::StructGet {
                struct_type_index: t.buffer,
                field_index: match op {
                    Op::BufferByteLength => LENGTH,
                    Op::BufferMaxByteLength => RESERVED,
                    _ => RESIZABLE,
                },
            });
            if op == Op::BufferResizable {
                return numeric::convert(b, &HirType::Bool, &b.ty(result).clone());
            }
        }
        Op::ViewLength => length(b, subject)?,
        Op::ViewByteLength => {
            length(b, subject)?;
            b.load(subject)?;
            b.instruction(&I::StructGet {
                struct_type_index: t.view,
                field_index: WIDTH,
            });
            b.instruction(&I::I32Mul);
        }
        Op::ViewByteOffset => {
            // Zero once detached, as a detached buffer's length is.
            b.load(subject)?;
            b.instructions(&[
                I::StructGet {
                    struct_type_index: t.view,
                    field_index: BUFFER,
                },
                I::StructGet {
                    struct_type_index: t.buffer,
                    field_index: BYTES,
                },
                I::RefIsNull,
                I::If(BlockType::Result(ValType::I32)),
                I::I32Const(0),
                I::Else,
            ]);
            b.load(subject)?;
            b.instructions(&[
                I::StructGet {
                    struct_type_index: t.view,
                    field_index: OFFSET,
                },
                I::End,
            ]);
        }
        Op::ViewBuffer => {
            b.load(subject)?;
            b.instruction(&I::StructGet {
                struct_type_index: t.view,
                field_index: BUFFER,
            });
            return Ok(());
        }
        _ => unreachable!("answered above"),
    }
    numeric::convert(b, &arrays::U32, &b.ty(result).clone())
}

/// What an erased value is: answered by its struct type, which since every
/// non-leaf type shares one rec group is this module's own. A program that
/// never made a buffer has none to find.
fn test(b: &mut Body<'_, '_>, op: Op, args: &[ValueId]) -> Result<(), Failure> {
    let value = args[0];
    if b.ty(value) != &HirType::Erased {
        return Err(format!("buffer test {op:?} of a {:?}", b.ty(value)).into());
    }
    let Some(t) = b.types().buffers else {
        b.instruction(&I::I32Const(0));
        return Ok(());
    };
    let is = |ty| I::RefTestNonNull(HeapType::Concrete(ty));
    b.load(value)?;
    match op {
        Op::IsBuffer => b.instruction(&is(t.buffer)),
        Op::IsDataView => b.instruction(&is(t.dataview)),
        Op::IsView => {
            b.instruction(&is(t.view));
            b.load(value)?;
            b.instruction(&is(t.dataview));
            b.instruction(&I::I32Or);
        }
        Op::IsViewKind => {
            b.instruction(&is(t.view));
            b.instruction(&I::If(BlockType::Result(ValType::I32)));
            b.load(value)?;
            b.instructions(&[
                I::RefCastNonNull(HeapType::Concrete(t.view)),
                I::StructGet {
                    struct_type_index: t.view,
                    field_index: KIND,
                },
            ]);
            b.load(args[1])?;
            numeric::convert(b, &b.ty(args[1]).clone(), &arrays::U32)?;
            b.instructions(&[I::I32Eq, I::Else, I::I32Const(0), I::End]);
        }
        _ => return Err(Failure::Invariant(format!("{op:?} is not a test"))),
    }
    Ok(())
}

/// That an erased value known to be a view holds `element`s: a `Uint8Array`
/// read as a `Float64Array` would read its bytes at the wrong width.
pub(crate) fn kind_guard(
    b: &mut Body<'_, '_>,
    value: ValueId,
    element: &HirType,
) -> Result<(), Failure> {
    let t = types(b.m)?;
    let kind = kind(element).ok_or_else(|| format!("a view of {element:?}"))?;
    b.load(value)?;
    b.instructions(&[
        I::RefCastNonNull(HeapType::Concrete(t.view)),
        I::StructGet {
            struct_type_index: t.view,
            field_index: KIND,
        },
        I::I32Const(kind.cast_signed()),
        I::I32Eq,
    ]);
    contract::require(b, "an erased typed array read at another element type")
}

/// A view's element count, now, as an `i32`: inline where the element type
/// says the width, a call for an `ArrayBufferView`.
fn length(b: &mut Body<'_, '_>, view: ValueId) -> Result<(), Failure> {
    if let Ok(element) = element(b, view) {
        let t = types(b.m)?;
        let shift = width(&element)?.trailing_zeros().cast_signed();
        return inline_length(b, t, view, shift);
    }
    let helper = callee(b.m, Helper::Length)?;
    b.load(view)?;
    b.call(helper);
    Ok(())
}

fn element(b: &Body<'_, '_>, view: ValueId) -> Result<HirType, Failure> {
    match b.ty(view) {
        HirType::Managed(ManagedType::View(element)) if kind(element).is_some() => {
            Ok((**element).clone())
        }
        other => Err(format!("an element of a {other:?}").into()),
    }
}

/// `view_length` at an access, where the width is known: no call, and both
/// cases computed and chosen between, so a bounds test in a loop has no branch
/// to predict. A view's fields are immutable and its buffer's length is one
/// load, which the engine can keep across iterations.
fn inline_length(
    b: &mut Body<'_, '_>,
    t: BufferTypes,
    view: ValueId,
    shift: i32,
) -> Result<(), Failure> {
    let field = |field_index| I::StructGet {
        struct_type_index: t.view,
        field_index,
    };
    let bytes = |b: &mut Body<'_, '_>| -> Result<(), Failure> {
        b.load(view)?;
        b.instructions(&[
            field(BUFFER),
            I::StructGet {
                struct_type_index: t.buffer,
                field_index: LENGTH,
            },
        ]);
        Ok(())
    };
    let get = |b: &mut Body<'_, '_>, index| -> Result<(), Failure> {
        b.load(view)?;
        b.instruction(&field(index));
        Ok(())
    };
    // Tracking: what is past the offset, in elements, or none.
    bytes(b)?;
    get(b, OFFSET)?;
    b.instructions(&[I::I32Sub, I::I32Const(shift), I::I32ShrU, I::I32Const(0)]);
    bytes(b)?;
    get(b, OFFSET)?;
    b.instructions(&[I::I32GtU, I::Select]);
    // Fixed: the window's elements while it fits, or none.
    get(b, ELEMENTS)?;
    b.instruction(&I::I32Const(0));
    get(b, OFFSET)?;
    get(b, ELEMENTS)?;
    b.instructions(&[I::I32Const(shift), I::I32Shl, I::I32Add]);
    bytes(b)?;
    b.instructions(&[I::I32LeU, I::Select]);
    get(b, TRACKING)?;
    b.instruction(&I::Select);
    Ok(())
}

/// Bytes per element: `nts_element_width`, which the static element decides.
fn width(element: &HirType) -> Result<i32, Failure> {
    match element {
        HirType::Int { bits, .. } | HirType::Float { bits } => Ok(i32::from(*bits / 8)),
        other => Err(format!("an element of type {other:?}").into()),
    }
}

/// The bytes and the element's first byte: an array and an index. Out of
/// range traps, as an access the core proved in bounds never is.
fn place(
    b: &mut Body<'_, '_>,
    view: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<HirType, Failure> {
    let element = element(b, view)?;
    let t = types(b.m)?;
    contract::nonnull(b, view, "an element of a null typed array")?;
    if checked {
        let shift = width(&element)?.trailing_zeros().cast_signed();
        arrays::within(b, at, false, |b| inline_length(b, t, view, shift))?;
        // `nts_bounds`, which C's `nts_view_index` calls.
        contract::require(b, "a typed-array index outside the view")?;
    }
    b.load(view)?;
    b.instructions(&[
        I::StructGet {
            struct_type_index: t.view,
            field_index: BUFFER,
        },
        I::StructGet {
            struct_type_index: t.buffer,
            field_index: BYTES,
        },
    ]);
    b.load(view)?;
    b.instruction(&I::StructGet {
        struct_type_index: t.view,
        field_index: OFFSET,
    });
    arrays::index(b, at)?;
    let width = width(&element)?;
    if width > 1 {
        b.instructions(&[I::I32Const(width), I::I32Mul]);
    }
    b.instruction(&I::I32Add);
    Ok(element)
}

/// `view[index]`.
pub(crate) fn get(
    b: &mut Body<'_, '_>,
    result: ValueId,
    view: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    let element = place(b, view, at, checked)?;
    let t = types(b.m)?;
    match element {
        HirType::Int { bits: 8, signed } => b.instruction(&if signed {
            I::ArrayGetS(t.bytes)
        } else {
            I::ArrayGetU(t.bytes)
        }),
        HirType::Int { bits: 16, signed } => {
            call_helper(b, Helper::Load16)?;
            if signed {
                b.instruction(&I::I32Extend16S);
            }
        }
        HirType::Int { bits: 32, .. } => call_helper(b, Helper::Load32)?,
        HirType::Float { bits: 32 } => {
            call_helper(b, Helper::Load32)?;
            b.instruction(&I::F32ReinterpretI32);
        }
        HirType::Float { bits: 64 } => {
            call_helper(b, Helper::Load64)?;
            b.instruction(&I::F64ReinterpretI64);
        }
        other => return Err(format!("a typed-array read of {other:?}").into()),
    }
    numeric::convert(b, &element, &b.ty(result).clone())
}

/// `view[index] = value`, the value already converted to the element by the
/// lowering's `nts_to_*` call.
pub(crate) fn set(
    b: &mut Body<'_, '_>,
    result: ValueId,
    view: ValueId,
    at: ValueId,
    value: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    if b.ty(result) != &HirType::Void {
        return Err(Failure::Invariant("non-void ArraySet result".into()));
    }
    let element = place(b, view, at, checked)?;
    let t = types(b.m)?;
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &element)?;
    match element {
        HirType::Int { bits: 8, .. } => b.instruction(&I::ArraySet(t.bytes)),
        HirType::Int { bits: 16, .. } => call_helper(b, Helper::Store16)?,
        HirType::Int { bits: 32, .. } => call_helper(b, Helper::Store32)?,
        HirType::Float { bits: 32 } => {
            b.instruction(&I::I32ReinterpretF32);
            call_helper(b, Helper::Store32)?;
        }
        HirType::Float { bits: 64 } => {
            b.instruction(&I::I64ReinterpretF64);
            call_helper(b, Helper::Store64)?;
        }
        other => return Err(format!("a typed-array write of {other:?}").into()),
    }
    Ok(())
}

fn call_helper(b: &mut Body<'_, '_>, helper: Helper) -> Result<(), Failure> {
    let target = callee(b.m, helper)?;
    b.call(target);
    Ok(())
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let t = types(m)?;
    let i32 = Physical::Scalar(Slot::I32);
    let i64 = Physical::Scalar(Slot::I64);
    let f64 = Physical::Scalar(Slot::F64);
    let bytes = Physical::Reference(reference(t.bytes, true));
    let view = Physical::Reference(reference(t.view, true));
    let (params, result) = match helper {
        Helper::Make => (
            vec![f64, f64, i32],
            Some(Physical::Reference(reference(t.buffer, true))),
        ),
        Helper::Resize => (
            vec![Physical::Reference(reference(t.buffer, true)), f64],
            None,
        ),
        Helper::View => (
            vec![
                Physical::Reference(reference(t.buffer, true)),
                f64,
                f64,
                f64,
                i32,
            ],
            Some(Physical::Reference(reference(t.view, false))),
        ),
        Helper::Length => (vec![view], Some(i32)),
        Helper::Load16 | Helper::Load32 => (vec![bytes, i32], Some(i32)),
        Helper::Load64 => (vec![bytes, i32], Some(i64)),
        Helper::Store16 | Helper::Store32 => (vec![bytes, i32, i32], None),
        Helper::Store64 => (vec![bytes, i32, i64], None),
    };
    m.helper(
        FuncKey::Buffer(helper),
        format!("buffer.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Make => make(m, t),
            Helper::Resize => Ok(resize(t)),
            Helper::View => view_new(m, t),
            Helper::Length => Ok(view_length(t)),
            Helper::Load16 => Ok(load(t, 2)),
            Helper::Load32 => Ok(load(t, 4)),
            Helper::Load64 => load64(m),
            Helper::Store16 => Ok(store(t, 2)),
            Helper::Store32 => Ok(store(t, 4)),
            Helper::Store64 => store64(m),
        },
    )
}

/// `nts_to_index` of a parameter: `!(v >= 1) ? 0 : trunc(v)`, so NaN and
/// everything below one is zero.
pub(crate) fn index_of(f: &mut Function, param: u32) {
    f.instructions(&[
        I::LocalGet(param),
        I::F64Trunc,
        I::F64Const(0.0.into()),
        I::LocalGet(param),
        I::F64Const(1.0.into()),
        I::F64Ge,
        I::Select,
    ]);
}

/// C's `nts_buffer_make`: zeroed bytes for what it reserves.
///
/// Params: length, reserved, resizable. Locals: reserved bytes.
fn make(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let descriptor = objects::descriptor(m, t.buffer_descriptor)?;
    let reserved = 3;
    let mut f = Function::new([ValType::I32]);
    index_of(&mut f, 1);
    f.instructions(&[
        I::F64Const(f64::from(MAX_BYTES).into()),
        I::F64Gt,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::Concrete(t.buffer)),
        I::Return,
        I::End,
    ]);
    f.global_get(descriptor);
    f.instruction(&objects::UNHASHED);
    index_of(&mut f, 0);
    f.instruction(&I::I32TruncSatF64U);
    index_of(&mut f, 1);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::LocalTee(reserved),
        I::LocalGet(2),
        I::LocalGet(reserved),
        I::ArrayNewDefault(t.bytes),
        I::StructNew(t.buffer),
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_buffer_resize`: nothing once detached, and the bytes it grows by
/// zeroed, since a shrink left the old ones behind. The lowering has checked
/// the length against what the buffer reserved.
///
/// Params: buffer, length. Locals: new length, bytes.
fn resize(t: BufferTypes) -> Function {
    let field = |field_index| I::StructGet {
        struct_type_index: t.buffer,
        field_index,
    };
    let (length, bytes) = (2, 3);
    let mut f = Function::new([ValType::I32, ValType::Ref(reference(t.bytes, true))]);
    f.instructions(&[
        I::LocalGet(0),
        field(BYTES),
        I::LocalTee(bytes),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
    ]);
    index_of(&mut f, 1);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::LocalTee(length),
        I::LocalGet(0),
        field(LENGTH),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::LocalGet(bytes),
        I::LocalGet(0),
        field(LENGTH),
        I::I32Const(0),
        I::LocalGet(length),
        I::LocalGet(0),
        field(LENGTH),
        I::I32Sub,
        I::ArrayFill(t.bytes),
        I::End,
        I::LocalGet(0),
        I::LocalGet(length),
        I::StructSet {
            struct_type_index: t.buffer,
            field_index: LENGTH,
        },
        I::End,
    ]);
    f
}

/// C's `nts_view_new`, with the width the kind decides.
///
/// Params: buffer, offset, length, kind, tracking. Locals: kind.
fn view_new(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let descriptor = objects::descriptor(m, t.view_descriptor)?;
    let kind = 5;
    let mut f = Function::new([ValType::I32]);
    f.global_get(descriptor);
    f.instructions(&[objects::UNHASHED, I::LocalGet(0), I::RefAsNonNull]);
    for param in 1..=3 {
        index_of(&mut f, param);
        f.instruction(&I::I32TruncSatF64U);
    }
    // 1 below kind 3, 2 below 5, 4 below 8, else 8.
    f.instructions(&[
        I::LocalTee(kind),
        I::I32Const(1),
        I::I32Const(2),
        I::I32Const(4),
        I::I32Const(8),
        I::LocalGet(kind),
        I::I32Const(8),
        I::I32LtU,
        I::Select,
        I::LocalGet(kind),
        I::I32Const(5),
        I::I32LtU,
        I::Select,
        I::LocalGet(kind),
        I::I32Const(3),
        I::I32LtU,
        I::Select,
        I::LocalGet(4),
        I::StructNew(t.view),
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_view_length`. A tracking view follows its buffer through a
/// resize; a fixed one reads zero while its window does not fit, and is back
/// when the buffer grows again: a test, not a latch.
///
/// Params: view. Locals: buffer length.
fn view_length(t: BufferTypes) -> Function {
    let field = |field_index| I::StructGet {
        struct_type_index: t.view,
        field_index,
    };
    let bytes = 1;
    let mut f = Function::new([ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        field(BUFFER),
        I::StructGet {
            struct_type_index: t.buffer,
            field_index: LENGTH,
        },
        I::LocalSet(bytes),
        I::LocalGet(0),
        field(TRACKING),
        I::If(BlockType::Result(ValType::I32)),
        I::LocalGet(bytes),
        I::LocalGet(0),
        field(OFFSET),
        I::I32LeU,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(0),
        I::Else,
        I::LocalGet(bytes),
        I::LocalGet(0),
        field(OFFSET),
        I::I32Sub,
        I::LocalGet(0),
        field(WIDTH),
        I::I32DivU,
        I::End,
        I::Else,
        I::LocalGet(0),
        field(OFFSET),
        I::LocalGet(0),
        field(ELEMENTS),
        I::LocalGet(0),
        field(WIDTH),
        I::I32Mul,
        I::I32Add,
        I::LocalGet(bytes),
        I::I32GtU,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(0),
        I::Else,
        I::LocalGet(0),
        field(ELEMENTS),
        I::End,
        I::End,
        I::End,
    ]);
    f
}

/// `width` bytes from `at`, little-endian, into an `i32`.
///
/// Params: bytes, at.
fn load(t: BufferTypes, width: i32) -> Function {
    let mut f = Function::new([]);
    f.instructions(&[I::LocalGet(0), I::LocalGet(1), I::ArrayGetU(t.bytes)]);
    for byte in 1..width {
        f.instructions(&[
            I::LocalGet(0),
            I::LocalGet(1),
            I::I32Const(byte),
            I::I32Add,
            I::ArrayGetU(t.bytes),
            I::I32Const(byte * 8),
            I::I32Shl,
            I::I32Or,
        ]);
    }
    f.instruction(&I::End);
    f
}

/// Eight bytes from `at`: two four-byte halves, low first.
///
/// Params: bytes, at.
fn load64(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let half = callee(m, Helper::Load32)?;
    let mut f = Function::new([]);
    f.instructions(&[I::LocalGet(0), I::LocalGet(1)]);
    f.call(half);
    f.instructions(&[
        I::I64ExtendI32U,
        I::LocalGet(0),
        I::LocalGet(1),
        I::I32Const(4),
        I::I32Add,
    ]);
    f.call(half);
    f.instructions(&[
        I::I64ExtendI32U,
        I::I64Const(32),
        I::I64Shl,
        I::I64Or,
        I::End,
    ]);
    Ok(f)
}

/// The low `width` bytes of an `i32` from `at`, little-endian.
///
/// Params: bytes, at, value.
fn store(t: BufferTypes, width: i32) -> Function {
    let mut f = Function::new([]);
    for byte in 0..width {
        f.instructions(&[I::LocalGet(0), I::LocalGet(1)]);
        if byte > 0 {
            f.instructions(&[I::I32Const(byte), I::I32Add]);
        }
        f.instruction(&I::LocalGet(2));
        if byte > 0 {
            f.instructions(&[I::I32Const(byte * 8), I::I32ShrU]);
        }
        f.instruction(&I::ArraySet(t.bytes));
    }
    f.instruction(&I::End);
    f
}

/// Eight bytes from `at`: two four-byte halves, low first.
///
/// Params: bytes, at, value.
fn store64(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let half = callee(m, Helper::Store32)?;
    let mut f = Function::new([]);
    f.instructions(&[
        I::LocalGet(0),
        I::LocalGet(1),
        I::LocalGet(2),
        I::I32WrapI64,
    ]);
    f.call(half);
    f.instructions(&[
        I::LocalGet(0),
        I::LocalGet(1),
        I::I32Const(4),
        I::I32Add,
        I::LocalGet(2),
        I::I64Const(32),
        I::I64ShrU,
        I::I32WrapI64,
    ]);
    f.call(half);
    f.instruction(&I::End);
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The numbering is the core's and the runtime's, by value.
    #[test]
    fn kinds_are_the_runtimes() {
        let int = |bits, signed| HirType::Int { bits, signed };
        let kinds = [
            (int(8, true), 0),
            (int(8, false), 1),
            (int(16, true), 3),
            (int(16, false), 4),
            (int(32, true), 5),
            (int(32, false), 6),
            (HirType::Float { bits: 32 }, 7),
            (HirType::Float { bits: 64 }, 8),
        ];
        for (element, number) in kinds {
            assert_eq!(kind(&element), Some(number), "{element:?}");
        }
        assert_eq!(kind(&int(64, true)), None);
        assert_eq!(kind(&HirType::Erased), None);
    }
}
