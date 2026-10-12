//! Array wrappers keep identity while typed backing storage grows.

use crate::{body::Body, contract, erased, error::Failure, gc, module::Symbols, numeric, objects};
use nts_core::hir::{HirType, ManagedType, OpKind, ValueId};
use wasm_encoder::{BlockType, Function, HeapType, Instruction as I, RefType, ValType};

const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
const F64: HirType = HirType::Float { bits: 64 };

pub(crate) fn operation(b: &mut Body<'_>, result: ValueId, kind: &OpKind) -> Result<(), Failure> {
    match kind {
        OpKind::ArrayNew { length, .. } => new(b, result, *length),
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } => get(b, result, *array, *index, *checked),
        OpKind::ArraySet {
            array,
            index,
            value,
            checked,
        } => set(b, result, *array, *index, *value, *checked),
        other => Err(Failure::Invariant(format!(
            "non-array operation routed to arrays: {other:?}"
        ))),
    }
}

pub(crate) fn is_array(ty: &HirType) -> bool {
    matches!(ty, HirType::Managed(ManagedType::Array(_)))
}
fn storage<'a>(b: &Body<'a>, array: ValueId) -> Result<&'a gc::Array, Failure> {
    b.symbols.types.array(b.ty(array))
}
pub(crate) fn number(b: &mut Body<'_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &F64)
}
pub(crate) fn index(b: &mut Body<'_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &U32)
}
pub(crate) fn whole_nonnegative(b: &mut Body<'_>, value: ValueId) -> Result<(), Failure> {
    match b.ty(value) {
        HirType::Int {
            bits: 8 | 16 | 32,
            signed: true,
        } => {
            b.load(value)?;
            b.ins(&I::I32Const(0));
            b.ins(&I::I32GeS);
        }
        HirType::Int {
            bits: 64,
            signed: true,
        } => {
            b.load(value)?;
            b.ins(&I::I64Const(0));
            b.ins(&I::I64GeS);
        }
        HirType::Int {
            bits: 8 | 16 | 32 | 64,
            signed: false,
        } => b.ins(&I::I32Const(1)),
        HirType::Float { bits: 32 | 64 } => {
            number(b, value)?;
            b.ins(&I::F64Const(0.0.into()));
            b.ins(&I::F64Ge);
            number(b, value)?;
            number(b, value)?;
            b.ins(&I::F64Trunc);
            b.ins(&I::F64Eq);
            b.ins(&I::I32And);
        }
        HirType::Void
        | HirType::Never
        | HirType::Bool
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::Erased
        | HirType::Managed(_)
        | HirType::BigInt
        | HirType::NativePointer(_) => {
            return Err(format!("array index with type {:?}", b.ty(value)).into());
        }
    }
    Ok(())
}
pub(crate) fn logical_length(b: &mut Body<'_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    b.load(array)?;
    b.ins(&I::StructGet {
        struct_type_index: ty,
        field_index: 1,
    });
    Ok(())
}
fn valid_index(
    b: &mut Body<'_>,
    array: ValueId,
    value: ValueId,
    append: bool,
) -> Result<(), Failure> {
    let ty = storage(b, array)?.wrapper;
    whole_nonnegative(b, value)?;
    match b.ty(value) {
        HirType::Int {
            bits: 8 | 16 | 32, ..
        } => {
            index(b, value)?;
            logical_length(b, array, ty)?;
            b.ins(&if append { I::I32LeU } else { I::I32LtU });
        }
        HirType::Int { bits: 64, .. } => {
            b.load(value)?;
            logical_length(b, array, ty)?;
            b.ins(&I::I64ExtendI32U);
            b.ins(&if append { I::I64LeU } else { I::I64LtU });
        }
        HirType::Float { bits: 32 | 64 } => {
            number(b, value)?;
            logical_length(b, array, ty)?;
            b.ins(&I::F64ConvertI32U);
            b.ins(&if append { I::F64Le } else { I::F64Lt });
        }
        HirType::Void
        | HirType::Never
        | HirType::Bool
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::Erased
        | HirType::Managed(_)
        | HirType::BigInt
        | HirType::NativePointer(_) => {
            return Err(format!("array index with type {:?}", b.ty(value)).into());
        }
    }
    b.ins(&I::I32And);
    Ok(())
}
pub(crate) fn new(b: &mut Body<'_>, result: ValueId, length: ValueId) -> Result<(), Failure> {
    let array = storage(b, result)?;
    whole_nonnegative(b, length)?;
    number(b, length)?;
    b.ins(&I::F64Const(f64::from(u32::MAX).into()));
    b.ins(&I::F64Le);
    b.ins(&I::I32And);
    contract::require(b)?;
    b.ins(&I::GlobalGet(b.symbols.descriptor_base + array.descriptor));
    index(b, length)?;
    objects::default(b, &array.element)?;
    index(b, length)?;
    b.ins(&I::ArrayNew(array.backing));
    b.ins(&I::StructNew(array.wrapper));
    Ok(())
}
pub(crate) fn length(b: &mut Body<'_>, result: ValueId, array: ValueId) -> Result<(), Failure> {
    let ty = storage(b, array)?.wrapper;
    contract::nonnull(b, array)?;
    logical_length(b, array, ty)?;
    numeric::convert(b, &U32, &b.ty(result).clone())
}
pub(crate) fn backing(b: &mut Body<'_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    b.load(array)?;
    b.ins(&I::StructGet {
        struct_type_index: ty,
        field_index: 2,
    });
    Ok(())
}
pub(crate) fn get_instruction(array: &gc::Array) -> Result<I<'static>, Failure> {
    Ok(match &array.element {
        HirType::Int {
            bits: 8 | 16,
            signed: true,
        } => I::ArrayGetS(array.backing),
        HirType::Int {
            bits: 8 | 16,
            signed: false,
        } => I::ArrayGetU(array.backing),
        HirType::Bool
        | HirType::Int { bits: 32 | 64, .. }
        | HirType::Float { bits: 32 | 64 }
        | HirType::Erased
        | HirType::Managed(_) => I::ArrayGet(array.backing),
        HirType::Void
        | HirType::Never
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::BigInt
        | HirType::NativePointer(_) => {
            return Err(format!("array element read of {:?}", array.element).into());
        }
    })
}
pub(crate) fn get(
    b: &mut Body<'_>,
    result: ValueId,
    array: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    let shape = storage(b, array)?;
    contract::nonnull(b, array)?;
    valid_index(b, array, at, false)?;
    let absent = checked && shape.element == HirType::Erased;
    if absent {
        if b.ty(result) != &HirType::Erased {
            return Err(Failure::Invariant(
                "non-erased checked value-array read".into(),
            ));
        }
        b.ins(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    } else {
        contract::require(b)?;
    }
    backing(b, array, shape.wrapper)?;
    index(b, at)?;
    b.ins(&get_instruction(shape)?);
    objects::adapt(b, &shape.element, &b.ty(result).clone())?;
    if absent {
        b.ins(&I::Else);
        b.ins(&I::GlobalGet(
            erased::values(b.symbols)?.for_tag(erased::UNDEFINED)?,
        ));
        b.ins(&I::End);
    }
    Ok(())
}
pub(crate) fn set(
    b: &mut Body<'_>,
    result: ValueId,
    array: ValueId,
    at: ValueId,
    value: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    if b.ty(result) != &HirType::Void {
        return Err(Failure::Invariant("non-void ArraySet result".into()));
    }
    let shape = storage(b, array)?;
    contract::nonnull(b, array)?;
    let append = checked && nts_core::hir::array_write_may_grow(b.func, array);
    valid_index(b, array, at, append)?;
    contract::require(b)?;
    if append {
        append_slot(b, array, at, shape.wrapper)?;
    }
    backing(b, array, shape.wrapper)?;
    index(b, at)?;
    b.load(value)?;
    objects::adapt(b, &b.ty(value).clone(), &shape.element)?;
    b.ins(&I::ArraySet(shape.backing));
    Ok(())
}
fn append_slot(b: &mut Body<'_>, array: ValueId, at: ValueId, ty: u32) -> Result<(), Failure> {
    let helper = b
        .symbols
        .array_grow
        .get(&ty)
        .copied()
        .ok_or_else(|| Failure::Invariant(format!("unplanned array growth for type {ty}")))?;
    index(b, at)?;
    logical_length(b, array, ty)?;
    b.ins(&I::I32Eq);
    b.ins(&I::If(BlockType::Empty));
    logical_length(b, array, ty)?;
    b.ins(&I::I32Const(-1));
    b.ins(&I::I32LtU);
    contract::require(b)?;
    b.load(array)?;
    logical_length(b, array, ty)?;
    b.ins(&I::I32Const(1));
    b.ins(&I::I32Add);
    b.ins(&I::Call(helper));
    b.load(array)?;
    logical_length(b, array, ty)?;
    b.ins(&I::I32Const(1));
    b.ins(&I::I32Add);
    b.ins(&I::StructSet {
        struct_type_index: ty,
        field_index: 1,
    });
    b.ins(&I::End);
    Ok(())
}
pub(crate) fn grow_body(shape: &gc::Array, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let mut f = Function::new_with_locals_types([
        ValType::I32,
        ValType::Ref(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(shape.backing),
        }),
    ]);
    for i in [
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: 2,
        },
        I::ArrayLen,
        I::LocalTee(2),
        I::LocalGet(1),
        I::I32GeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(2),
        I::I32Const(i32::MAX),
        I::I32LeU,
        I::If(BlockType::Result(ValType::I32)),
        I::LocalGet(2),
        I::I32Const(1),
        I::I32Shl,
        I::Else,
        I::I32Const(-1),
        I::End,
        I::LocalSet(2),
        I::LocalGet(2),
        I::LocalGet(1),
        I::I32LtU,
        I::If(BlockType::Empty),
        I::LocalGet(1),
        I::LocalSet(2),
        I::End,
        I::LocalGet(2),
        I::I32Const(4),
        I::I32LtU,
        I::If(BlockType::Empty),
        I::I32Const(4),
        I::LocalSet(2),
        I::End,
        objects::default_instruction(symbols, &shape.element)?,
        I::LocalGet(2),
        I::ArrayNew(shape.backing),
        I::LocalSet(3),
        I::LocalGet(3),
        I::I32Const(0),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: 2,
        },
        I::I32Const(0),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: 1,
        },
        I::ArrayCopy {
            array_type_index_dst: shape.backing,
            array_type_index_src: shape.backing,
        },
        I::LocalGet(0),
        I::LocalGet(3),
        I::RefAsNonNull,
        I::StructSet {
            struct_type_index: shape.wrapper,
            field_index: 2,
        },
        I::End,
    ] {
        f.instruction(&i);
    }
    Ok(f)
}
