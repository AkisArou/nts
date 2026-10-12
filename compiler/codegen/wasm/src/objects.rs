//! Class allocation, typed fields and nominal tests consume the resolved plan.

use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    gc, numeric,
    object_plan::Object,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, ClassId, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{
    BlockType, ConstExpr, Function, GlobalSection, GlobalType, HeapType, Instruction as I, RefType,
    ValType,
};

pub(crate) const INSTANCE: &str = "object.instanceOf";
pub(crate) fn globals(plan: &gc::Plan, section: &mut GlobalSection) -> Result<(), Failure> {
    if plan.objects.descriptors.is_empty() {
        return Ok(());
    }
    let root = plan
        .root
        .ok_or_else(|| Failure::Invariant("unplanned object root".into()))?;
    for descriptor in &plan.objects.descriptors {
        let mut code = vec![
            I::I32Const(descriptor.identity.cast_signed()),
            I::I32Const(descriptor.kind.cast_signed()),
        ];
        code.extend(
            descriptor
                .ancestry
                .iter()
                .map(|id| I::I32Const(id.cast_signed())),
        );
        code.extend([
            I::ArrayNewFixed {
                array_type_index: root.ancestry,
                array_size: u32::try_from(descriptor.ancestry.len())
                    .map_err(|_| Failure::Invariant("too many class ancestors".into()))?,
            },
            I::RefNull(HeapType::ANY),
            I::StructNew(root.descriptor),
        ]);
        section.global(
            GlobalType {
                val_type: ValType::Ref(RefType {
                    nullable: false,
                    heap_type: HeapType::Concrete(root.descriptor),
                }),
                mutable: false,
                shared: false,
            },
            &ConstExpr::extended(code),
        );
    }
    Ok(())
}
fn object<'a>(b: &Body<'a>, value: ValueId) -> Result<&'a Object, Failure> {
    b.symbols.types.objects.object(b.ty(value))
}
pub(crate) fn new(b: &mut Body<'_>, result: ValueId, frame: bool) -> Result<(), Failure> {
    if frame {
        return Err(Failure::Invariant(
            "frame allocation survived HostGc preparation".into(),
        ));
    }
    let storage = object(b, result)?;
    b.ins(&I::GlobalGet(
        b.symbols.descriptor_base + storage.descriptor,
    ));
    for i in crate::callables::entries(b.symbols, storage)? {
        b.ins(&i);
    }
    for field in storage.fields.iter() {
        default(b, &field.ty)?;
    }
    b.ins(&I::StructNew(storage.physical));
    Ok(())
}
pub(crate) fn default(b: &mut Body<'_>, ty: &HirType) -> Result<(), Failure> {
    b.ins(&default_instruction(b.symbols, ty)?);
    Ok(())
}
pub(crate) fn default_instruction(
    symbols: &crate::module::Symbols<'_>,
    ty: &HirType,
) -> Result<I<'static>, Failure> {
    Ok(match symbols.types.value_slot(ty)? {
        Physical::Scalar(Slot::I32) => I::I32Const(0),
        Physical::Scalar(Slot::I64) => I::I64Const(0),
        Physical::Scalar(Slot::F32) => I::F32Const(0.0.into()),
        Physical::Scalar(Slot::F64) => I::F64Const(0.0.into()),
        Physical::Reference(_) if ty == &HirType::Erased => {
            let values = erased::values(symbols)?;
            I::GlobalGet(values.for_tag(erased::UNDEFINED)?)
        }
        Physical::Reference(reference) => I::RefNull(reference.heap_type),
    })
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
    b: &mut Body<'_>,
    result: ValueId,
    receiver: ValueId,
    at: u32,
) -> Result<(), Failure> {
    let storage = object(b, receiver)?;
    let field = field(storage, at)?;
    contract::nonnull(b, receiver)?;
    b.load(receiver)?;
    b.ins(&get_instruction(
        &field.ty,
        storage.physical,
        field_index(storage, at)?,
    )?);
    adapt(b, &field.ty, &b.ty(result).clone())
}
pub(crate) fn set(
    b: &mut Body<'_>,
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
    b.ins(&I::StructSet {
        struct_type_index: storage.physical,
        field_index: field_index(storage, at)?,
    });
    Ok(())
}
pub(crate) fn adapt(b: &mut Body<'_>, from: &HirType, to: &HirType) -> Result<(), Failure> {
    if from == to {
        return Ok(());
    }
    if from.is_scalar() && to.is_scalar() {
        return numeric::convert(b, from, to);
    }
    if let (HirType::Managed(ManagedType::Object(_)), HirType::Managed(ManagedType::Object(_))) =
        (from, to)
    {
        let plan = &b.symbols.types.objects;
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
    b: &mut Body<'_>,
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
    b.ins(&I::RefEq);
    if op == BinOp::Ne {
        b.ins(&I::I32Eqz);
    }
    Ok(())
}
pub(crate) fn is_reference(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_))
    )
}
pub(crate) fn truthy(b: &mut Body<'_>, op: UnOp, value: ValueId) -> Result<(), Failure> {
    if !matches!(op, UnOp::Truthy | UnOp::Not) {
        return Err(format!("reference unary {op:?}").into());
    }
    b.load(value)?;
    b.ins(&I::RefIsNull);
    if op == UnOp::Truthy {
        b.ins(&I::I32Eqz);
    }
    Ok(())
}
pub(crate) fn instance(
    b: &mut Body<'_>,
    value: ValueId,
    classes: &[ClassId],
) -> Result<(), Failure> {
    if classes.is_empty() {
        return Err("instanceof without a class".into());
    }
    let identities = classes
        .iter()
        .map(|ty| b.symbols.types.objects.class(*ty))
        .collect::<Result<Vec<_>, _>>()?;
    if b.ty(value) != &HirType::Erased && !is_reference(b.ty(value)) {
        b.ins(&I::I32Const(0));
        return Ok(());
    }
    let callee = b
        .symbols
        .instance_of
        .ok_or_else(|| Failure::Invariant("unplanned instanceof helper".into()))?;
    for (at, identity) in identities.iter().enumerate() {
        b.load(value)?;
        b.ins(&I::I32Const(identity.cast_signed()));
        b.ins(&I::Call(callee));
        if at != 0 {
            b.ins(&I::I32Or);
        }
    }
    Ok(())
}
pub(crate) fn instance_body(root: gc::RootTypes) -> Function {
    let mut f = Function::new_with_locals_types([
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
