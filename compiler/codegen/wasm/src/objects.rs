//! Class allocation, typed fields and nominal tests consume the resolved plan.

use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    gc,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    numeric,
    object_plan::Object,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, ClassId, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) const INSTANCE: &str = "object.instanceOf";
/// A class or array descriptor: identity, runtime kind, ancestry and the
/// class's dispatch entries. Built once, on the first allocation that needs it.
pub(crate) fn descriptor(m: &mut Builder<'_>, at: u32) -> Result<Global, Failure> {
    m.global(GlobalKey::Descriptor(at), |m| {
        let plan = m.types;
        let root = plan
            .root
            .ok_or_else(|| Failure::Invariant("unplanned object root".into()))?;
        let descriptor = plan
            .objects
            .descriptors
            .get(at as usize)
            .ok_or_else(|| Failure::Invariant(format!("unplanned descriptor {at}")))?;
        let mut code = ir::Code::default();
        code.instructions(&[
            I::I32Const(descriptor.identity.cast_signed()),
            I::I32Const(descriptor.kind.cast_signed()),
        ]);
        for id in &descriptor.ancestry {
            code.instruction(&I::I32Const(id.cast_signed()));
        }
        code.instruction(&I::ArrayNewFixed {
            array_type_index: root.ancestry,
            array_size: u32::try_from(descriptor.ancestry.len())
                .map_err(|_| Failure::Invariant("too many class ancestors".into()))?,
        });
        crate::callables::dispatch(m, &mut code, descriptor.class)?;
        code.instruction(&I::StructNew(root.descriptor));
        Ok((crate::module::constant_type(root.descriptor), code))
    })
}
fn object<'p>(b: &Body<'_, 'p>, value: ValueId) -> Result<&'p Object, Failure> {
    b.types().objects.object(b.ty(value))
}
pub(crate) fn new(b: &mut Body<'_, '_>, result: ValueId, frame: bool) -> Result<(), Failure> {
    if frame {
        return Err(Failure::Invariant(
            "frame allocation survived HostGc preparation".into(),
        ));
    }
    let HirType::Managed(ManagedType::Object(class)) = *b.ty(result) else {
        return Err(Failure::Invariant("ObjectNew of a non-object type".into()));
    };
    let storage = object(b, result)?;
    let descriptor = descriptor(b.m, storage.descriptor)?;
    b.global_get(descriptor);
    for entry in crate::callables::entries(b.m, class, storage)? {
        b.code.ref_func(entry);
    }
    for field in storage.fields.iter() {
        default(b, &field.ty)?;
    }
    b.instruction(&I::StructNew(storage.physical));
    Ok(())
}
pub(crate) fn default(b: &mut Body<'_, '_>, ty: &HirType) -> Result<(), Failure> {
    push_default(b.m, &mut b.code, ty)
}
/// The zero value of a storage slot. An erased slot starts undefined, never
/// as a null reference that no erased operation accepts.
pub(crate) fn push_default(
    m: &mut Builder<'_>,
    f: &mut Function,
    ty: &HirType,
) -> Result<(), Failure> {
    match m.types.value_slot(ty)? {
        Physical::Scalar(Slot::I32) => f.instruction(&I::I32Const(0)),
        Physical::Scalar(Slot::I64) => f.instruction(&I::I64Const(0)),
        Physical::Scalar(Slot::F32) => f.instruction(&I::F32Const(0.0.into())),
        Physical::Scalar(Slot::F64) => f.instruction(&I::F64Const(0.0.into())),
        Physical::Reference(_) if ty == &HirType::Erased => {
            let undefined = erased::singleton(m, erased::Singleton::Undefined)?;
            f.global_get(undefined);
        }
        Physical::Reference(reference) => f.instruction(&I::RefNull(reference.heap_type)),
    }
    Ok(())
}
fn field(storage: &Object, at: u32) -> Result<&nts_core::hir::Field, Failure> {
    storage
        .fields
        .get(at as usize)
        .ok_or_else(|| Failure::Invariant(format!("class `{}` has no field {at}", storage.name)))
}
fn field_index(storage: &Object, at: u32) -> Result<u32, Failure> {
    at.checked_add(storage.field_base)
        .ok_or_else(|| Failure::Invariant("too many object fields".into()))
}
fn get_instruction(ty: &HirType, physical: u32, field: u32) -> Result<I<'static>, Failure> {
    Ok(match ty {
        HirType::Int {
            bits: 8 | 16,
            signed: true,
        } => I::StructGetS {
            struct_type_index: physical,
            field_index: field,
        },
        HirType::Int {
            bits: 8 | 16,
            signed: false,
        } => I::StructGetU {
            struct_type_index: physical,
            field_index: field,
        },
        HirType::Bool
        | HirType::Int { bits: 32 | 64, .. }
        | HirType::Float { bits: 32 | 64 }
        | HirType::Erased
        | HirType::Managed(_) => I::StructGet {
            struct_type_index: physical,
            field_index: field,
        },
        HirType::Void
        | HirType::Never
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::BigInt
        | HirType::NativePointer(_) => return Err(format!("field read from {ty:?}").into()),
    })
}
pub(crate) fn get(
    b: &mut Body<'_, '_>,
    result: ValueId,
    receiver: ValueId,
    at: u32,
) -> Result<(), Failure> {
    let storage = object(b, receiver)?;
    let field = field(storage, at)?;
    contract::nonnull(b, receiver)?;
    b.load(receiver)?;
    b.instruction(&get_instruction(
        &field.ty,
        storage.physical,
        field_index(storage, at)?,
    )?);
    adapt(b, &field.ty, &b.ty(result).clone())
}
pub(crate) fn set(
    b: &mut Body<'_, '_>,
    result: ValueId,
    receiver: ValueId,
    at: u32,
    value: ValueId,
) -> Result<(), Failure> {
    if b.ty(result) != &HirType::Void {
        return Err(Failure::Invariant("non-void FieldSet result".into()));
    }
    let storage = object(b, receiver)?;
    let field = field(storage, at)?;
    contract::nonnull(b, receiver)?;
    b.load(receiver)?;
    b.load(value)?;
    adapt(b, &b.ty(value).clone(), &field.ty)?;
    b.instruction(&I::StructSet {
        struct_type_index: storage.physical,
        field_index: field_index(storage, at)?,
    });
    Ok(())
}
pub(crate) fn adapt(b: &mut Body<'_, '_>, from: &HirType, to: &HirType) -> Result<(), Failure> {
    if from == to {
        return Ok(());
    }
    if from.is_scalar() && to.is_scalar() {
        return numeric::convert(b, from, to);
    }
    if let (HirType::Managed(ManagedType::Object(_)), HirType::Managed(ManagedType::Object(_))) =
        (from, to)
    {
        let plan = &b.types().objects;
        if plan.subtype(plan.object(from)?.physical, plan.object(to)?.physical) {
            return Ok(());
        }
    }
    Err(format!(
        "typed storage conversion from {from:?} to {to:?} lacks a physical subtype contract"
    )
    .into())
}
pub(crate) fn binary(
    b: &mut Body<'_, '_>,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if !matches!(op, BinOp::Eq | BinOp::Ne) {
        return Err(format!("reference binary {op:?}").into());
    }
    for value in [lhs, rhs] {
        if !is_reference(b.ty(value)) {
            return Err("reference equality with a different operand kind".into());
        }
        b.load(value)?;
    }
    b.instruction(&I::RefEq);
    if op == BinOp::Ne {
        b.instruction(&I::I32Eqz);
    }
    Ok(())
}
pub(crate) fn is_reference(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_))
    )
}
pub(crate) fn truthy(b: &mut Body<'_, '_>, op: UnOp, value: ValueId) -> Result<(), Failure> {
    if !matches!(op, UnOp::Truthy | UnOp::Not) {
        return Err(format!("reference unary {op:?}").into());
    }
    b.load(value)?;
    b.instruction(&I::RefIsNull);
    if op == UnOp::Truthy {
        b.instruction(&I::I32Eqz);
    }
    Ok(())
}
pub(crate) fn instance(
    b: &mut Body<'_, '_>,
    value: ValueId,
    classes: &[ClassId],
) -> Result<(), Failure> {
    if classes.is_empty() {
        return Err("instanceof without a class".into());
    }
    let identities = classes
        .iter()
        .map(|ty| b.types().objects.class(*ty))
        .collect::<Result<Vec<_>, _>>()?;
    if b.ty(value) != &HirType::Erased && !is_reference(b.ty(value)) {
        b.instruction(&I::I32Const(0));
        return Ok(());
    }
    let callee = instance_of(b.m)?;
    for (at, identity) in identities.iter().enumerate() {
        b.load(value)?;
        b.instruction(&I::I32Const(identity.cast_signed()));
        b.call(callee);
        if at != 0 {
            b.instruction(&I::I32Or);
        }
    }
    Ok(())
}
fn instance_of(m: &mut Builder<'_>) -> Result<Func, Failure> {
    let root = m
        .types
        .root
        .ok_or_else(|| Failure::Invariant("missing object root".into()))?;
    m.helper(
        FuncKey::InstanceOf,
        INSTANCE,
        vec![
            Physical::Reference(RefType::ANYREF),
            Physical::Scalar(Slot::I32),
        ],
        Some(Physical::Scalar(Slot::I32)),
        |_| Ok(instance_body(root)),
    )
}
fn instance_body(root: gc::RootTypes) -> Function {
    let mut f = Function::new([
        ValType::Ref(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(root.ancestry),
        }),
        ValType::I32,
    ]);
    for i in [
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::Concrete(root.object)),
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
        I::LocalGet(0),
        I::RefCastNonNull(HeapType::Concrete(root.object)),
        I::StructGet {
            struct_type_index: root.object,
            field_index: 0,
        },
        I::StructGet {
            struct_type_index: root.descriptor,
            field_index: 2,
        },
        I::LocalSet(2),
        I::Loop(BlockType::Empty),
        I::LocalGet(3),
        I::LocalGet(2),
        I::ArrayLen,
        I::I32GeU,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
        I::LocalGet(2),
        I::LocalGet(3),
        I::ArrayGet(root.ancestry),
        I::LocalGet(1),
        I::I32Eq,
        I::If(BlockType::Empty),
        I::I32Const(1),
        I::Return,
        I::End,
        I::LocalGet(3),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(3),
        I::Br(0),
        I::End,
        I::Unreachable,
        I::End,
    ] {
        f.instruction(&i);
    }
    f
}
