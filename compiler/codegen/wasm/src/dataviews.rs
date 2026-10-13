//! `DataView`, as the C runtime's `NtsDataView` (`runtime/c`): a window on a
//! buffer's bytes with no element type, whose width and byte order each
//! access chooses.
//!
//! A view holds its buffer, byte offset, byte length and whether it tracks the
//! buffer. An access is assembled a byte at a time, as C's
//! `nts_dataview_read` is, so every offset is legal and either byte order is
//! one loop. The lowering has tested the index against `byteLength` (a
//! `RangeError` otherwise), so an access arrives in range; a detached buffer
//! reads 0 and ignores a write, as C's second answer to the same question.
use crate::{
    arrays,
    body::Body,
    buffers::{self, BUFFER, BYTES, LENGTH, OFFSET},
    contract,
    error::Failure,
    gc::{BufferTypes, ROOT_FIELDS},
    helpers,
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, objects,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ValueId};
use wasm_encoder::{BlockType, Instruction as I, ValType};

/// The byte length of a fixed view; a tracking one computes it.
const SPAN: u32 = ROOT_FIELDS + 2;
const TRACKS: u32 = ROOT_FIELDS + 3;

/// One element read or written: its width and how its bits are a number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Access {
    Int8,
    Uint8,
    Int16,
    Uint16,
    Int32,
    Uint32,
    Float32,
    Float64,
}

impl Access {
    const fn width(self) -> i32 {
        match self {
            Self::Int8 | Self::Uint8 => 1,
            Self::Int16 | Self::Uint16 => 2,
            Self::Int32 | Self::Uint32 | Self::Float32 => 4,
            Self::Float64 => 8,
        }
    }
}

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    /// A view to the buffer's end, tracking it.
    Over,
    /// A view of a fixed byte length.
    Part,
    ByteLength,
    ByteOffset,
    Buffer,
    Get(Access),
    Set(Access),
}

pub(crate) fn external(name: &str) -> Option<Op> {
    let access = |name: &str| {
        Some(match name {
            "int8" => Access::Int8,
            "uint8" => Access::Uint8,
            "int16" => Access::Int16,
            "uint16" => Access::Uint16,
            "int32" => Access::Int32,
            "uint32" => Access::Uint32,
            "float32" => Access::Float32,
            "float64" => Access::Float64,
            _ => return None,
        })
    };
    Some(match name {
        "nts_dataview_over" => Op::Over,
        "nts_dataview_part" => Op::Part,
        "nts_dataview_byte_length" => Op::ByteLength,
        "nts_dataview_byte_offset" => Op::ByteOffset,
        "nts_dataview_buffer" => Op::Buffer,
        _ => {
            if let Some(kind) = name.strip_prefix("nts_dataview_get_") {
                Op::Get(access(kind)?)
            } else {
                Op::Set(access(name.strip_prefix("nts_dataview_set_")?)?)
            }
        }
    })
}

impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        matches!(self, Self::ByteLength | Self::ByteOffset | Self::Buffer)
    }
}

/// A module helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(buffer, offset, length, tracks) -> view`.
    Make,
    /// `(view, at, width, little) -> bits`.
    Read,
    /// `(view, at, width, little, bits)`.
    Write,
}

fn field(t: BufferTypes, field_index: u32) -> I<'static> {
    I::StructGet {
        struct_type_index: t.dataview,
        field_index,
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let arity = match op {
        Op::Over => 2,
        Op::Part => 3,
        Op::ByteLength | Op::ByteOffset | Op::Buffer => 1,
        Op::Get(access) => 2 + usize::from(access.width() > 1),
        Op::Set(access) => 3 + usize::from(access.width() > 1),
    };
    if args.len() != arity {
        return Err(format!("DataView {op:?} arity mismatch").into());
    }
    let t = buffers::types(b.m)?;
    let subject = args[0];
    contract::nonnull(
        b,
        subject,
        if matches!(op, Op::Over | Op::Part) {
            "a DataView over a null buffer"
        } else {
            "a method of a null DataView"
        },
    )?;
    match op {
        Op::Over | Op::Part => {
            let make = callee(b.m, Helper::Make)?;
            b.load(subject)?;
            arrays::number(b, args[1])?;
            if op == Op::Part {
                arrays::number(b, args[2])?;
            } else {
                b.instruction(&I::F64Const(0.0.into()));
            }
            b.instruction(&I::I32Const(i32::from(op == Op::Over)));
            b.call(make);
            Ok(())
        }
        Op::ByteLength => {
            byte_length(b, t, subject)?;
            numeric::convert(b, &arrays::U32, &b.ty(result).clone())
        }
        // C answers the offset even once detached.
        Op::ByteOffset => {
            b.load(subject)?;
            b.instruction(&field(t, OFFSET));
            numeric::convert(b, &arrays::U32, &b.ty(result).clone())
        }
        Op::Buffer => {
            b.load(subject)?;
            b.instruction(&field(t, BUFFER));
            Ok(())
        }
        Op::Get(access) => {
            let read = callee(b.m, Helper::Read)?;
            place(b, access, args)?;
            b.call(read);
            b.instructions(&match access {
                Access::Int8 => vec![I::I32WrapI64, I::I32Extend8S, I::F64ConvertI32S],
                Access::Int16 => vec![I::I32WrapI64, I::I32Extend16S, I::F64ConvertI32S],
                Access::Int32 => vec![I::I32WrapI64, I::F64ConvertI32S],
                Access::Uint8 | Access::Uint16 | Access::Uint32 => {
                    vec![I::I32WrapI64, I::F64ConvertI32U]
                }
                Access::Float32 => vec![I::I32WrapI64, I::F32ReinterpretI32, I::F64PromoteF32],
                Access::Float64 => vec![I::F64ReinterpretI64],
            });
            numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())
        }
        Op::Set(access) => {
            let write = callee(b.m, Helper::Write)?;
            place(b, access, args)?;
            arrays::number(b, args[2])?;
            match access {
                Access::Float32 => {
                    b.instructions(&[I::F32DemoteF64, I::I32ReinterpretF32, I::I64ExtendI32U]);
                }
                Access::Float64 => b.instruction(&I::I64ReinterpretF64),
                _ => {
                    // C's `(uint32_t)nts_to_int32(value)`, whose low bytes go.
                    b.helper(helpers::Helper::ToInt32)?;
                    b.instruction(&I::I64ExtendI32U);
                }
            }
            b.call(write);
            Ok(())
        }
    }
}

/// The view, the index, the width and the byte order: what Read and Write
/// take before the bits. One byte has no order, so it reads as little-endian.
fn place(b: &mut Body<'_, '_>, access: Access, args: &[ValueId]) -> Result<(), Failure> {
    b.load(args[0])?;
    arrays::number(b, args[1])?;
    b.instruction(&I::I32Const(access.width()));
    if access.width() > 1 {
        let little = args[args.len() - 1];
        if b.ty(little) != &HirType::Bool {
            return Err("a DataView byte order that is not a boolean".into());
        }
        b.load(little)?;
    } else {
        b.instruction(&I::I32Const(1));
    }
    Ok(())
}

/// C's `nts_dataview_byte_length`: zero once detached; a tracking view what
/// is past its offset; a fixed one its length, refused by name when the buffer
/// has shrunk below it, where node throws a `TypeError`.
fn byte_length(b: &mut Body<'_, '_>, t: BufferTypes, view: ValueId) -> Result<(), Failure> {
    let buffer_length = |b: &mut Body<'_, '_>| -> Result<(), Failure> {
        b.load(view)?;
        b.instructions(&[
            field(t, BUFFER),
            I::StructGet {
                struct_type_index: t.buffer,
                field_index: LENGTH,
            },
        ]);
        Ok(())
    };
    let get = |b: &mut Body<'_, '_>, index| -> Result<(), Failure> {
        b.load(view)?;
        b.instruction(&field(t, index));
        Ok(())
    };
    b.load(view)?;
    b.instructions(&[
        field(t, BUFFER),
        I::StructGet {
            struct_type_index: t.buffer,
            field_index: BYTES,
        },
        I::RefIsNull,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(0),
        I::Else,
    ]);
    get(b, TRACKS)?;
    b.instruction(&I::If(BlockType::Result(ValType::I32)));
    buffer_length(b)?;
    get(b, OFFSET)?;
    b.instructions(&[I::I32Sub, I::I32Const(0)]);
    buffer_length(b)?;
    get(b, OFFSET)?;
    b.instructions(&[I::I32GtU, I::Select, I::Else]);
    get(b, OFFSET)?;
    get(b, SPAN)?;
    b.instruction(&I::I32Add);
    buffer_length(b)?;
    b.instruction(&I::I32LeU);
    contract::require(
        b,
        "byteLength of a fixed-length DataView whose buffer has shrunk below it, where node throws a TypeError",
    )?;
    get(b, SPAN)?;
    b.instructions(&[I::End, I::End]);
    Ok(())
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let t = buffers::types(m)?;
    let i32 = Physical::Scalar(Slot::I32);
    let i64 = Physical::Scalar(Slot::I64);
    let f64 = Physical::Scalar(Slot::F64);
    let view = Physical::Reference(buffers::reference(t.dataview, true));
    let (params, result) = match helper {
        Helper::Make => (
            vec![
                Physical::Reference(buffers::reference(t.buffer, true)),
                f64,
                f64,
                i32,
            ],
            Some(Physical::Reference(buffers::reference(t.dataview, false))),
        ),
        Helper::Read => (vec![view, f64, i32, i32], Some(i64)),
        Helper::Write => (vec![view, f64, i32, i32, i64], None),
    };
    m.helper(
        FuncKey::DataView(helper),
        format!("dataview.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Make => make(m, t),
            Helper::Read => Ok(access(t, false)),
            Helper::Write => Ok(access(t, true)),
        },
    )
}

/// C's `nts_dataview_make`. Params: buffer, offset, length, tracks.
fn make(m: &mut Builder<'_>, t: BufferTypes) -> Result<Function, Failure> {
    let descriptor = objects::descriptor(m, t.dataview_descriptor)?;
    let mut f = Function::new([]);
    f.global_get(descriptor);
    f.instructions(&[objects::UNHASHED, I::LocalGet(0), I::RefAsNonNull]);
    buffers::index_of(&mut f, 1);
    f.instruction(&I::I32TruncSatF64U);
    // A tracking view's length is computed, so its stored one is 0.
    f.instruction(&I::I32Const(0));
    buffers::index_of(&mut f, 2);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::LocalGet(3),
        I::Select,
        I::LocalGet(3),
        I::StructNew(t.dataview),
        I::End,
    ]);
    Ok(f)
}

/// C's `nts_dataview_read` and `nts_dataview_write` over `nts_dataview_at`:
/// byte `i` of the element is bits `8 * i` little-endian, else
/// `8 * (width - 1 - i)`. A detached buffer reads 0 and takes no write.
///
/// Params: view, at, width, little, and the bits to write. Locals: bytes,
/// position, the bits read, index.
fn access(t: BufferTypes, write: bool) -> Function {
    let first = if write { 5 } else { 4 };
    let (bytes, position, bits, index) = (first, first + 1, first + 2, first + 3);
    let mut f = Function::new([
        ValType::Ref(buffers::reference(t.bytes, true)),
        ValType::I32,
        ValType::I64,
        ValType::I32,
    ]);
    f.instructions(&[
        I::LocalGet(0),
        field(t, BUFFER),
        I::StructGet {
            struct_type_index: t.buffer,
            field_index: BYTES,
        },
        I::LocalTee(bytes),
        I::RefIsNull,
        I::If(BlockType::Empty),
    ]);
    if !write {
        f.instruction(&I::I64Const(0));
    }
    f.instructions(&[I::Return, I::End, I::LocalGet(0), field(t, OFFSET)]);
    buffers::index_of(&mut f, 1);
    f.instructions(&[
        I::I32TruncSatF64U,
        I::I32Add,
        I::LocalSet(position),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(2),
        I::I32GeU,
        I::BrIf(1),
    ]);
    // The byte's shift, in bits, as an i64.
    let shift = [
        I::LocalGet(index),
        I::LocalGet(2),
        I::I32Const(1),
        I::I32Sub,
        I::LocalGet(index),
        I::I32Sub,
        I::LocalGet(3),
        I::Select,
        I::I32Const(3),
        I::I32Shl,
        I::I64ExtendI32U,
    ];
    if write {
        f.instructions(&[
            I::LocalGet(bytes),
            I::LocalGet(position),
            I::LocalGet(index),
            I::I32Add,
            I::LocalGet(4),
        ]);
        f.instructions(&shift);
        f.instructions(&[I::I64ShrU, I::I32WrapI64, I::ArraySet(t.bytes)]);
    } else {
        f.instructions(&[
            I::LocalGet(bits),
            I::LocalGet(bytes),
            I::LocalGet(position),
            I::LocalGet(index),
            I::I32Add,
            I::ArrayGetU(t.bytes),
            I::I64ExtendI32U,
        ]);
        f.instructions(&shift);
        f.instructions(&[I::I64Shl, I::I64Or, I::LocalSet(bits)]);
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
    if !write {
        f.instruction(&I::LocalGet(bits));
    }
    f.instruction(&I::End);
    f
}
