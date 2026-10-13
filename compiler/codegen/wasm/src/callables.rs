//! Typed immutable entries call the body HIR puts in each slot.

use crate::{
    body::Body,
    callable_plan::{Resolved, ResolvedEntry},
    contract,
    error::Failure,
    gc,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, GlobalKey},
    object_plan::Object,
    objects,
};
use nts_core::hir::{ClassId, HirType, ManagedType, Program, ValueId};
use std::collections::BTreeMap;
use wasm_encoder::{HeapType, Instruction as I};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Face {
    Closure,
    Virtual,
}
impl Face {
    fn root(self, storage: &Object) -> Option<usize> {
        match self {
            Self::Closure => storage.callable,
            Self::Virtual => storage.virtual_,
        }
    }
    fn groups(self, types: &gc::Plan) -> &BTreeMap<usize, crate::callable_plan::Resolved> {
        match self {
            Self::Closure => &types.callables,
            Self::Virtual => &types.virtuals,
        }
    }
    const fn label(self) -> &'static str {
        match self {
            Self::Closure => "closure",
            Self::Virtual => "class",
        }
    }
}

/// The entry for one slot of one concrete layout: it casts the shared
/// receiver to the layout's own storage and calls the body HIR put there.
#[derive(Debug)]
struct Thunk {
    face: Face,
    physical: u32,
    slot: u32,
    signature: u32,
    target: String,
    receiver: HirType,
    params: usize,
}

/// The group holding `slot` for a receiver stored as `storage`, and its entry:
/// the callable root for a uniform closure slot, which every function value
/// extends, or the receiver's own dispatch group.
fn entry<'p>(
    types: &'p gc::Plan,
    storage: &Object,
    slot: u32,
    face: Face,
) -> Result<(&'p Resolved, &'p ResolvedEntry), Failure> {
    if face == Face::Closure
        && let Some(uniform) = &types.uniform
        && let Some(entry) = uniform.entries.get(&slot)
    {
        return Ok((uniform, entry));
    }
    // A value of a function type is stored as the callable root, which holds
    // only the uniform entries; a typed entry belongs to a closure's group.
    if face == Face::Closure
        && types
            .uniform
            .as_ref()
            .is_some_and(|root| root.base == storage.physical)
    {
        return Err(format!(
            "a typed call to slot {slot} through the function type `{}`: only its uniform entries are callable",
            storage.name
        )
        .into());
    }
    let root = face.root(storage).ok_or_else(|| {
        format!(
            "{} `{}` has no HIR-proven dispatch contract",
            face.label(),
            storage.name
        )
    })?;
    let group = face.groups(types).get(&root);
    group
        .and_then(|g| Some((g, g.entries.get(&slot)?)))
        .ok_or_else(|| {
            Failure::Invariant(format!(
                "unplanned callable slot {slot} of `{}`",
                storage.name
            ))
        })
}

fn thunk(
    program: &Program,
    types: &gc::Plan,
    layout: &nts_core::hir::Layout,
    storage: &Object,
    entry: &ResolvedEntry,
    face: Face,
) -> Result<Thunk, Failure> {
    let target = layout
        .methods
        .get(entry.slot as usize)
        .and_then(Option::as_ref)
        .ok_or_else(|| {
            format!(
                "{} `{}` has unfilled slot {}",
                face.label(),
                layout.name,
                entry.slot
            )
        })?;
    let func = program
        .funcs
        .iter()
        .find(|f| &f.name == target)
        .ok_or_else(|| Failure::Invariant(format!("unresolved closure body `{target}`")))?;
    if func.abstract_declaration {
        return Err(format!("abstract closure `{target}` cannot be allocated").into());
    }
    let Some(receiver) = func.params.first() else {
        return Err(Failure::Invariant(format!(
            "closure `{target}` has no receiver"
        )));
    };
    let body = types.objects.object(&receiver.ty)?;
    if !types.objects.subtype(storage.physical, body.physical)
        || !func
            .params
            .iter()
            .skip(1)
            .map(|p| &p.ty)
            .eq(entry.params.iter())
        || !result_widens(types, &func.return_type, &entry.result)?
    {
        return Err(format!(
            "{} `{target}` is incompatible with slot {} of `{}`",
            face.label(),
            entry.slot,
            layout.name
        )
        .into());
    }
    Ok(Thunk {
        face,
        physical: storage.physical,
        slot: entry.slot,
        signature: entry.signature,
        target: target.clone(),
        receiver: receiver.ty.clone(),
        params: func.params.len(),
    })
}

fn result_widens(types: &gc::Plan, from: &HirType, to: &HirType) -> Result<bool, Failure> {
    if from == to {
        return Ok(true);
    }
    if matches!(from, HirType::Managed(ManagedType::Object(_)))
        && matches!(to, HirType::Managed(ManagedType::Object(_)))
    {
        return Ok(types.objects.subtype(
            types.objects.object(from)?.physical,
            types.objects.object(to)?.physical,
        ));
    }
    Ok(false)
}

/// The typed entry function for one slot of an allocated class, validated
/// against the slot's shared contract before it exists.
fn thunk_func(m: &mut Builder<'_>, face: Face, class: ClassId, slot: u32) -> Result<Func, Failure> {
    let types = m.types;
    let storage = types
        .objects
        .object(&HirType::Managed(ManagedType::Object(class)))?;
    let (_, resolved) = entry(types, storage, slot, face)?;
    let layout = m
        .program
        .layout(class)
        .ok_or_else(|| Failure::Invariant(format!("unplanned allocation {class:?}")))?;
    if face == Face::Closure
        && crate::callable_plan::is_uniform(m.program, slot)
        && layout
            .methods
            .get(slot as usize)
            .and_then(Option::as_ref)
            .is_none()
    {
        return unfilled(m, resolved);
    }
    let thunk = thunk(m.program, types, layout, storage, resolved, face)?;
    m.helper_typed(
        FuncKey::Thunk(face, thunk.physical, thunk.slot),
        format!(
            "{}.entry<{},{}>",
            thunk.face.label(),
            thunk.physical,
            thunk.slot
        ),
        thunk.signature,
        |m| thunk_body(&thunk, m),
    )
}

fn thunk_body(thunk: &Thunk, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let receiver = m.types.objects.object(&thunk.receiver)?;
    let target = m.program_func(&thunk.target)?;
    let mut f = Function::default();
    f.instruction(&I::LocalGet(0));
    f.instruction(&I::RefCastNonNull(HeapType::Concrete(receiver.physical)));
    for at in 1..thunk.params {
        f.instruction(&I::LocalGet(crate::module::index(at)));
    }
    f.call(target);
    f.instruction(&I::End);
    Ok(f)
}

/// A uniform entry for a function value whose class does not fill it: a
/// closure no call could reach by its signature. Like the JVM backend's stub,
/// it refuses by name if a call ever does, rather than declining the
/// allocation.
fn unfilled(m: &mut Builder<'_>, entry: &ResolvedEntry) -> Result<Func, Failure> {
    m.helper_typed(
        FuncKey::UnfilledUniform(entry.slot),
        format!("closure.unfilled<{}>", entry.slot),
        entry.signature,
        |m| {
            let decline = crate::contract::decline(m)?;
            let name = m.literal("a function value");
            let why = m.literal("called through a signature it has no entry for");
            let mut f = Function::default();
            f.global_get(name);
            f.global_get(why);
            f.call(decline);
            f.instructions(&[I::Unreachable, I::End]);
            Ok(f)
        },
    )
}

/// The entries an allocation of `class` stores, in field order: the uniform
/// entries every function value carries, then its group's typed entries.
pub(crate) fn entries(
    m: &mut Builder<'_>,
    class: ClassId,
    storage: &Object,
) -> Result<Vec<Func>, Failure> {
    let types = m.types;
    let layout = m
        .program
        .layout(class)
        .ok_or_else(|| Failure::Invariant(format!("unplanned allocation {class:?}")))?;
    if !crate::callable_plan::is_callable_storage(m.program, layout) {
        return Ok(Vec::new());
    }
    let mut slots: Vec<u32> = types
        .uniform
        .iter()
        .flat_map(|uniform| uniform.entries.keys().copied())
        .collect();
    if let Some(root) = storage.callable {
        slots.extend(types.callables[&root].entries.keys().copied());
    }
    slots
        .into_iter()
        .map(|slot| thunk_func(m, Face::Closure, class, slot))
        .collect()
}

/// A descriptor's vtable entries, pushed after its header, for an allocated
/// class with virtual slots: the vtable type they complete, or none for a
/// plain descriptor.
pub(crate) fn dispatch(
    m: &mut Builder<'_>,
    code: &mut ir::Code,
    class: Option<ClassId>,
) -> Result<Option<u32>, Failure> {
    let types = m.types;
    let virtual_root = class
        .map(|class| {
            types
                .objects
                .object(&HirType::Managed(ManagedType::Object(class)))
                .map(|storage| storage.virtual_)
        })
        .transpose()?
        .flatten();
    let (Some(class), Some(root)) = (class, virtual_root) else {
        return Ok(None);
    };
    let group = &types.virtuals[&root];
    for &slot in group.entries.keys() {
        let entry = thunk_func(m, Face::Virtual, class, slot)?;
        code.ref_func(entry);
    }
    Ok(Some(group.base))
}

/// A closure's no-argument call entry through `slot`, for a task that calls
/// it: the group's base type, the entry's field and function type, and whether
/// it answers something the task drops.
pub(crate) fn closure_entry(
    m: &Builder<'_>,
    class: ClassId,
    slot: u32,
) -> Result<(u32, u32, u32, bool), Failure> {
    let types = m.types;
    let storage = types
        .objects
        .object(&HirType::Managed(ManagedType::Object(class)))?;
    let (group, entry) = entry(types, storage, slot, Face::Closure)?;
    if !entry.params.is_empty() {
        return Err(format!(
            "a task calling `{}` through slot {slot}, which takes arguments",
            storage.name
        )
        .into());
    }
    let answers = types.slot(&entry.result)?.is_some();
    Ok((group.base, entry.field, entry.signature, answers))
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    slot: u32,
    args: &[ValueId],
    face: Face,
) -> Result<(), Failure> {
    let Some((&receiver, params)) = args.split_first() else {
        return Err("closure call has no receiver".into());
    };
    let types = b.types();
    let storage = types.objects.object(b.ty(receiver))?;
    let (group, entry) = entry(types, storage, slot, face)?;
    if params.len() != entry.params.len() {
        return Err(format!(
            "closure `{}` slot {slot} argument count mismatch",
            storage.name
        )
        .into());
    }
    contract::nonnull(b, receiver, "calling null")?;
    b.load(receiver)?;
    for (&arg, ty) in params.iter().zip(&entry.params) {
        b.load(arg)?;
        objects::adapt(b, &b.ty(arg).clone(), ty)?;
    }
    b.load(receiver)?;
    if face == Face::Virtual {
        // The receiver's class holds its hierarchy's exact vtable type.
        b.instruction(&I::StructGet {
            struct_type_index: storage.physical,
            field_index: 0,
        });
    }
    b.instruction(&I::StructGet {
        struct_type_index: group.base,
        field_index: entry.field,
    });
    b.instruction(&I::CallRef(entry.signature));
    objects::adapt(b, &entry.result, &b.ty(result).clone())
}

/// A capture-free named function: one immutable instance whose identity
/// every use shares.
pub(crate) fn static_value(b: &mut Body<'_, '_>, result: ValueId) -> Result<(), Failure> {
    let HirType::Managed(ManagedType::Object(class)) = *b.ty(result) else {
        return Err(Failure::Invariant(
            "static closure of a non-object type".into(),
        ));
    };
    let types = b.types();
    let storage = types.objects.object(b.ty(result))?;
    if !storage.fields.is_empty() {
        return Err(format!("static closure `{}` has captures", storage.name).into());
    }
    let global = b.m.global(GlobalKey::StaticClosure(class), |m| {
        let descriptor = objects::descriptor(m, storage.descriptor)?;
        let mut code = ir::Code::default();
        code.global_get(descriptor);
        code.instruction(&objects::UNHASHED);
        for entry in entries(m, class, storage)? {
            code.ref_func(entry);
        }
        code.instruction(&I::StructNew(storage.physical));
        Ok((crate::module::constant_type(storage.physical), code))
    })?;
    b.global_get(global);
    Ok(())
}
