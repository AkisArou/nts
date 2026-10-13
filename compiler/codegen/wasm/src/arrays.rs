//! Array wrappers keep identity while typed backing storage grows.

use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    gc,
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, objects,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, OpKind, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
const F64: HirType = HirType::Float { bits: 64 };

pub(crate) fn operation(
    b: &mut Body<'_, '_>,
    result: ValueId,
    kind: &OpKind,
) -> Result<(), Failure> {
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
fn storage<'p>(b: &Body<'_, 'p>, array: ValueId) -> Result<&'p gc::Array, Failure> {
    b.types().array(b.ty(array))
}
pub(crate) fn number(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &F64)
}
pub(crate) fn index(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &U32)
}
pub(crate) fn whole_nonnegative(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    match b.ty(value) {
        HirType::Int {
            bits: 8 | 16 | 32,
            signed: true,
        } => {
            b.load(value)?;
            b.instruction(&I::I32Const(0));
            b.instruction(&I::I32GeS);
        }
        HirType::Int {
            bits: 64,
            signed: true,
        } => {
            b.load(value)?;
            b.instruction(&I::I64Const(0));
            b.instruction(&I::I64GeS);
        }
        HirType::Int {
            bits: 8 | 16 | 32 | 64,
            signed: false,
        } => b.instruction(&I::I32Const(1)),
        HirType::Float { bits: 32 | 64 } => {
            number(b, value)?;
            b.instruction(&I::F64Const(0.0.into()));
            b.instruction(&I::F64Ge);
            number(b, value)?;
            number(b, value)?;
            b.instruction(&I::F64Trunc);
            b.instruction(&I::F64Eq);
            b.instruction(&I::I32And);
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
pub(crate) fn logical_length(b: &mut Body<'_, '_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: ty,
        field_index: crate::gc::ARRAY_LENGTH,
    });
    Ok(())
}
pub(crate) fn valid_index(
    b: &mut Body<'_, '_>,
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
            b.instruction(&if append { I::I32LeU } else { I::I32LtU });
        }
        HirType::Int { bits: 64, .. } => {
            b.load(value)?;
            logical_length(b, array, ty)?;
            b.instruction(&I::I64ExtendI32U);
            b.instruction(&if append { I::I64LeU } else { I::I64LtU });
        }
        HirType::Float { bits: 32 | 64 } => {
            number(b, value)?;
            logical_length(b, array, ty)?;
            b.instruction(&I::F64ConvertI32U);
            b.instruction(&if append { I::F64Le } else { I::F64Lt });
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
    b.instruction(&I::I32And);
    Ok(())
}
pub(crate) fn new(b: &mut Body<'_, '_>, result: ValueId, length: ValueId) -> Result<(), Failure> {
    let array = storage(b, result)?;
    whole_nonnegative(b, length)?;
    number(b, length)?;
    b.instruction(&I::F64Const(f64::from(u32::MAX).into()));
    b.instruction(&I::F64Le);
    b.instruction(&I::I32And);
    contract::require(
        b,
        "an array length that is not a whole number up to 2^32 - 1",
    )?;
    let descriptor = objects::descriptor(b.m, array.descriptor)?;
    b.global_get(descriptor);
    index(b, length)?;
    objects::default(b, &array.element)?;
    index(b, length)?;
    b.instruction(&I::ArrayNew(array.backing));
    b.instruction(&I::StructNew(array.wrapper));
    Ok(())
}
pub(crate) fn length(b: &mut Body<'_, '_>, result: ValueId, array: ValueId) -> Result<(), Failure> {
    let ty = storage(b, array)?.wrapper;
    contract::nonnull(b, array, "the length of a null array")?;
    logical_length(b, array, ty)?;
    numeric::convert(b, &U32, &b.ty(result).clone())
}
pub(crate) fn backing(b: &mut Body<'_, '_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: ty,
        field_index: crate::gc::ARRAY_BACKING,
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
    b: &mut Body<'_, '_>,
    result: ValueId,
    array: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    let shape = storage(b, array)?;
    contract::nonnull(b, array, "reading an element of a null array")?;
    valid_index(b, array, at, false)?;
    let absent = checked && shape.element == HirType::Erased;
    if absent {
        if b.ty(result) != &HirType::Erased {
            return Err(Failure::Invariant(
                "non-erased checked value-array read".into(),
            ));
        }
        b.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    } else {
        contract::require(
            b,
            "an index past the end, whose undefined this element type cannot hold",
        )?;
    }
    backing(b, array, shape.wrapper)?;
    index(b, at)?;
    b.instruction(&get_instruction(shape)?);
    objects::adapt(b, &shape.element, &b.ty(result).clone())?;
    if absent {
        b.instruction(&I::Else);
        let undefined = erased::singleton(b.m, erased::Singleton::Undefined)?;
        b.global_get(undefined);
        b.instruction(&I::End);
    }
    Ok(())
}
pub(crate) fn set(
    b: &mut Body<'_, '_>,
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
    contract::nonnull(b, array, "writing an element of a null array")?;
    let append = checked && nts_core::hir::array_write_may_grow(b.func, array);
    valid_index(b, array, at, append)?;
    contract::require(
        b,
        "a write past the end, which would leave holes this array cannot hold",
    )?;
    if append {
        append_slot(b, array, at, shape.wrapper)?;
    }
    backing(b, array, shape.wrapper)?;
    index(b, at)?;
    b.load(value)?;
    objects::adapt(b, &b.ty(value).clone(), &shape.element)?;
    b.instruction(&I::ArraySet(shape.backing));
    Ok(())
}
fn append_slot(b: &mut Body<'_, '_>, array: ValueId, at: ValueId, ty: u32) -> Result<(), Failure> {
    let shape = b
        .types()
        .arrays
        .get(&ty)
        .ok_or_else(|| Failure::Invariant(format!("unplanned array growth for type {ty}")))?;
    let helper = grow(b.m, shape)?;
    index(b, at)?;
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Eq);
    b.instruction(&I::If(BlockType::Empty));
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Const(-1));
    b.instruction(&I::I32LtU);
    contract::require(b, "an array longer than 2^32 - 1 elements")?;
    b.load(array)?;
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.call(helper);
    b.load(array)?;
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.instruction(&I::StructSet {
        struct_type_index: ty,
        field_index: crate::gc::ARRAY_LENGTH,
    });
    b.instruction(&I::End);
    Ok(())
}
/// The helper that grows an array's backing to at least a capacity,
/// preserving the wrapper and therefore every alias of it.
pub(crate) fn grow(m: &mut Builder<'_>, shape: &gc::Array) -> Result<Func, Failure> {
    m.helper(
        FuncKey::ArrayGrow(shape.wrapper),
        format!("array.grow<{:?}>", shape.element),
        vec![
            Physical::Reference(RefType {
                nullable: true,
                heap_type: HeapType::Concrete(shape.wrapper),
            }),
            Physical::Scalar(Slot::I32),
        ],
        None,
        |m| grow_body(shape, m),
    )
}
fn grow_body(shape: &gc::Array, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let mut f = Function::new([
        ValType::I32,
        ValType::Ref(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(shape.backing),
        }),
    ]);
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_BACKING,
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
    ]);
    objects::push_default(m, &mut f, &shape.element)?;
    f.instructions(&[
        I::LocalGet(2),
        I::ArrayNew(shape.backing),
        I::LocalSet(3),
        I::LocalGet(3),
        I::I32Const(0),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_BACKING,
        },
        I::I32Const(0),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_LENGTH,
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
            field_index: crate::gc::ARRAY_BACKING,
        },
        I::End,
    ]);
    Ok(f)
}
