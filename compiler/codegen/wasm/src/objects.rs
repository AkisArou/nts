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
use nts_core::hir::{BinOp, ClassId, HirType, ManagedType, OpKind, UnOp, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) const INSTANCE: &str = "object.instanceOf";
/// A new object's identity hash, after its descriptor: none given out yet.
pub(crate) const UNHASHED: I<'static> = I::I32Const(0);

/// An object's identity hash, given out on first use and fixed after: a
/// Weyl sequence over the golden ratio, whose low bits a power-of-two mask
/// spreads evenly, and never zero, which marks an unhashed object.
///
/// Params: the object, as the root.
pub(crate) fn identity(m: &mut Builder<'_>) -> Result<Func, Failure> {
    let root = m
        .types
        .root
        .ok_or_else(|| Failure::Invariant("unplanned object root".into()))?;
    let counter = m.global(GlobalKey::IdentityCounter, |_| {
        let mut init = ir::Code::default();
        init.instruction(&I::I32Const(0));
        Ok((
            wasm_encoder::GlobalType {
                val_type: ValType::I32,
                mutable: true,
                shared: false,
            },
            init,
        ))
    })?;
    m.helper(
        FuncKey::IdentityHash,
        "object.identityHash",
        vec![Physical::Reference(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(root.object),
        })],
        Some(Physical::Scalar(Slot::I32)),
        |_| {
            let hash = 1;
            let mut f = Function::new([ValType::I32]);
            let field = I::StructGet {
                struct_type_index: root.object,
                field_index: crate::gc::IDENTITY_HASH,
            };
            f.instructions(&[
                I::LocalGet(0),
                field,
                I::LocalTee(hash),
                I::If(BlockType::Empty),
                I::LocalGet(hash),
                I::Return,
                I::End,
            ]);
            f.global_get(counter);
            f.instructions(&[I::I32Const(0x9e37_79b9_u32.cast_signed()), I::I32Add]);
            f.global_set(counter);
            f.global_get(counter);
            f.instructions(&[
                I::LocalTee(hash),
                I::LocalGet(hash),
                I::I32Eqz,
                I::I32Or,
                I::LocalSet(hash),
                I::LocalGet(0),
                I::LocalGet(hash),
                I::StructSet {
                    struct_type_index: root.object,
                    field_index: crate::gc::IDENTITY_HASH,
                },
                I::LocalGet(hash),
                I::End,
            ]);
            Ok(f)
        },
    )
}
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
        let class = descriptor.class;
        if root.rows.is_some() {
            crate::rows::row(m, &mut code, class)?;
        }
        let ty =
            crate::callables::dispatch(m, &mut code, descriptor.class)?.unwrap_or(root.descriptor);
        code.instruction(&I::StructNew(ty));
        Ok((crate::module::constant_type(ty), code))
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
    b.instruction(&UNHASHED);
    for entry in crate::callables::entries(b.m, class, storage)? {
        b.code.ref_func(entry);
    }
    // No optional property written yet: construction records its own.
    if storage.presence.is_some() {
        b.instruction(&I::I32Const(0));
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
        Physical::Scalar(Slot::V128) => f.instruction(&I::V128Const(0)),
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
        | HirType::BigInt
        | HirType::Erased
        | HirType::Managed(_) => I::StructGet {
            struct_type_index: physical,
            field_index: field,
        },
        HirType::Void
        | HirType::Never
        | HirType::Int { .. }
        | HirType::Float { .. }
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
    contract::nonnull(b, receiver, "reading a field of null")?;
    load_storage(b, receiver, storage.physical)?;
    b.instruction(&get_instruction(
        &field.ty,
        storage.physical,
        field_index(storage, at)?,
    )?);
    adapt(b, &field.ty, &b.ty(result).clone())
}
/// The receiver, as its storage: an interface whose values are the root (other
/// owners reach it) is cast to the interface's storage, which every receiver
/// a positional access reaches extends.
pub(crate) fn load_storage(
    b: &mut Body<'_, '_>,
    receiver: ValueId,
    physical: u32,
) -> Result<(), Failure> {
    b.load(receiver)?;
    let held = match b.types().value_slot(b.ty(receiver))? {
        Physical::Reference(RefType {
            heap_type: HeapType::Concrete(held),
            ..
        }) => Some(held),
        Physical::Reference(_) | Physical::Scalar(_) => None,
    };
    if held != Some(physical) {
        b.instruction(&I::RefCastNonNull(HeapType::Concrete(physical)));
    }
    Ok(())
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
    contract::nonnull(b, receiver, "writing a field of null")?;
    load_storage(b, receiver, storage.physical)?;
    b.load(value)?;
    adapt(b, &b.ty(value).clone(), &field.ty)?;
    b.instruction(&I::StructSet {
        struct_type_index: storage.physical,
        field_index: field_index(storage, at)?,
    });
    Ok(())
}
/// Push the semantic identity of the object root held in local `value`, which
/// the caller has tested to be one.
pub(crate) fn push_identity(f: &mut Function, root: gc::RootTypes, value: u32) {
    f.instructions(&[
        I::LocalGet(value),
        I::RefCastNonNull(HeapType::Concrete(root.object)),
        I::StructGet {
            struct_type_index: root.object,
            field_index: 0,
        },
        I::StructGet {
            struct_type_index: root.descriptor,
            field_index: 0,
        },
    ]);
}

/// Jump on the identity in local `identity` to the case naming it: one
/// `br_table`, each case's code emitted by `answer`, which must not fall
/// through (it returns or refuses). Any other identity continues after it.
pub(crate) fn identity_switch<C>(
    f: &mut Function,
    identity: u32,
    cases: &[(u32, C)],
    mut answer: impl FnMut(&mut Function, &C) -> Result<(), Failure>,
) -> Result<(), Failure> {
    // One block per case inside one for the fallthrough: the table branches to
    // the end of a case's block, where its code is.
    let past = u32::try_from(cases.len()).map_err(|_| "too many identity cases")?;
    let mut targets = Vec::new();
    for (case, (id, _)) in cases.iter().enumerate() {
        let id = usize::try_from(*id).map_err(|_| "identity")?;
        if targets.len() <= id {
            targets.resize(id + 1, past);
        }
        targets[id] = u32::try_from(case).map_err(|_| "too many identity cases")?;
    }
    f.instruction(&I::Block(BlockType::Empty));
    for _ in cases {
        f.instruction(&I::Block(BlockType::Empty));
    }
    f.instructions(&[
        I::LocalGet(identity),
        I::BrTable(targets.into(), past),
        I::End,
    ]);
    for (case, (_, value)) in cases.iter().enumerate() {
        answer(f, value)?;
        if case + 1 < cases.len() {
            f.instruction(&I::End);
        }
    }
    if !cases.is_empty() {
        f.instruction(&I::End);
    }
    Ok(())
}

/// What a value matching no arm of an open read is refused as. The
/// core's contract is that the arms over-approximate what arrives, so this is
/// a program the checker should have rejected.
const NO_ARM: &str = "a member reached through a slot whose value is none of the layouts it names";

/// One layout an open slot's value can have, and that layout's index for the
/// member.
struct Arm<'p> {
    storage: &'p Object,
    at: u32,
}

/// The arms' storage, each layout once: several class types share one
/// layout, and a test already taken would never match again.
fn arms<'p>(
    b: &Body<'_, 'p>,
    value: ValueId,
    arms: impl Iterator<Item = (ClassId, u32)>,
) -> Result<Vec<Arm<'p>>, Failure> {
    if !matches!(b.types().value_slot(b.ty(value))?, Physical::Reference(_)) {
        return Err(format!("a member of a {:?} through an open slot", b.ty(value)).into());
    }
    let objects = &b.types().objects;
    let mut seen = std::collections::BTreeSet::new();
    let mut found = Vec::new();
    for (ty, at) in arms {
        let storage = objects.object(&HirType::Managed(ManagedType::Object(ty)))?;
        if seen.insert(storage.physical) {
            field(storage, at)?;
            found.push(Arm { storage, at });
        }
    }
    if found.is_empty() {
        return Err(Failure::Invariant(
            "an open member access with no arm".into(),
        ));
    }
    Ok(found)
}

/// Test `value` against one arm's storage and, inside the arm, push it cast
/// to that storage. Types share one rec group, so the test is nominal: a
/// same-shape layout of another class does not pass it, and a subclass's
/// does, whose inherited members keep their base's indices.
fn enter(b: &mut Body<'_, '_>, value: ValueId, arm: &Arm<'_>) -> Result<(), Failure> {
    let storage = HeapType::Concrete(arm.storage.physical);
    b.load(value)?;
    b.instructions(&[I::RefTestNonNull(storage), I::If(BlockType::Empty)]);
    b.load(value)?;
    b.instruction(&I::RefCastNonNull(storage));
    Ok(())
}

/// A member through a slot several layouts reach: `SharedFieldGet` and
/// `OpenFieldGet` read it. `OpenFieldSet`, which no lowering produces yet,
/// has nothing to test it against and is refused by name until one does.
pub(crate) fn open_member(
    b: &mut Body<'_, '_>,
    result: ValueId,
    kind: &OpKind,
) -> Result<(), Failure> {
    match kind {
        OpKind::SharedFieldGet { value, arms, field } => {
            arm_get(b, result, *value, arms.iter().map(|ty| (*ty, *field)))
        }
        OpKind::OpenFieldGet { object, arms } => arm_get(
            b,
            result,
            *object,
            arms.iter().map(|arm| (arm.ty, arm.field)),
        ),
        OpKind::OpenFieldSet { .. } => {
            Err("a member stored through an open slot, which no lowering produces yet".into())
        }
        other => Err(Failure::Invariant(format!("open member access {other:?}"))),
    }
}

/// A member read through a slot several layouts reach, one test per arm in
/// the core's order and that arm's own index, as the JVM reads it. The C
/// pointer read has no Wasm counterpart: a struct read names its type, so
/// even arms that agree about the index are told apart first.
fn arm_get(
    b: &mut Body<'_, '_>,
    result: ValueId,
    value: ValueId,
    members: impl Iterator<Item = (ClassId, u32)>,
) -> Result<(), Failure> {
    let arms = arms(b, value, members)?;
    let wanted = b.ty(result).clone();
    let out = b.types().value_slot(&wanted)?.wasm();
    b.instruction(&I::Block(BlockType::Result(out)));
    for arm in &arms {
        let member = field(arm.storage, arm.at)?;
        enter(b, value, arm)?;
        b.instruction(&get_instruction(
            &member.ty,
            arm.storage.physical,
            field_index(arm.storage, arm.at)?,
        )?);
        adapt(b, &member.ty, &wanted)?;
        b.instructions(&[I::Br(1), I::End]);
    }
    contract::refuse(b, NO_ARM)?;
    b.instruction(&I::End);
    Ok(())
}

/// A field, element or call-slot move, or a `Convert`: a scalar converts;
/// a reference transfers.
pub(crate) fn adapt(b: &mut Body<'_, '_>, from: &HirType, to: &HirType) -> Result<(), Failure> {
    if from != to && from.is_scalar() && to.is_scalar() {
        return numeric::convert(b, from, to);
    }
    b.transfer(from, to)
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
/// Whether a value is a reference to an object root's descendant: an object,
/// an array, a collection, a promise, a buffer or a view. It compares by
/// identity, is truthy when present, and erases as itself.
pub(crate) fn is_reference(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Managed(
            ManagedType::Object(_)
                | ManagedType::Array(_)
                | ManagedType::Map(..)
                | ManagedType::Table(..)
                | ManagedType::Set(_)
                | ManagedType::Promise(_)
                | ManagedType::Buffer
                | ManagedType::View(_)
                | ManagedType::AnyView
                | ManagedType::DataView
                | ManagedType::Symbol
                | ManagedType::Template
        )
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
    let objects = &b.types().objects;
    // Each listed type's identity, once: a class's, or a structural type's
    // record shape's. `instanceof` lists classes; `in`, a narrowing and a
    // `this:` layout test list whatever the core admits, as C reads them.
    let mut identities = std::collections::BTreeSet::new();
    for ty in classes {
        identities.insert(objects.identity(*ty)?);
    }
    let tests: Vec<(u32, Option<u32>)> = identities
        .into_iter()
        .map(|identity| (identity, objects.depth(identity)))
        .collect();
    if b.ty(value) != &HirType::Erased && !is_reference(b.ty(value)) {
        b.instruction(&I::I32Const(0));
        return Ok(());
    }
    for (at, &(identity, depth)) in tests.iter().enumerate() {
        b.load(value)?;
        b.instruction(&I::I32Const(identity.cast_signed()));
        // One display read where the class sits at one depth everywhere;
        // otherwise the scan.
        if let Some(depth) = depth {
            b.instruction(&I::I32Const(depth.cast_signed()));
            let callee = instance_at(b.m)?;
            b.call(callee);
        } else {
            let callee = instance_of(b.m)?;
            b.call(callee);
        }
        if at != 0 {
            b.instruction(&I::I32Or);
        }
    }
    Ok(())
}

/// `value instanceof` the class `identity` at display position `depth`.
fn instance_at(m: &mut Builder<'_>) -> Result<Func, Failure> {
    let root = m
        .types
        .root
        .ok_or_else(|| Failure::Invariant("missing object root".into()))?;
    m.helper(
        FuncKey::InstanceAt,
        "object.instanceAt",
        vec![
            Physical::Reference(RefType::ANYREF),
            Physical::Scalar(Slot::I32),
            Physical::Scalar(Slot::I32),
        ],
        Some(Physical::Scalar(Slot::I32)),
        |_| Ok(instance_at_body(root)),
    )
}
fn instance_at_body(root: gc::RootTypes) -> Function {
    let mut f = Function::new([ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(root.ancestry),
    })]);
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
        I::LocalTee(3),
        I::ArrayLen,
        I::LocalGet(2),
        I::I32LeU,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
        I::LocalGet(3),
        I::LocalGet(2),
        I::ArrayGet(root.ancestry),
        I::LocalGet(1),
        I::I32Eq,
        I::End,
    ] {
        f.instruction(&i);
    }
    f
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
