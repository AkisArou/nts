//! Typed immutable entries call the body HIR puts in each slot.

use crate::{
    body::Body,
    callable_plan::ResolvedEntry,
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

fn entry<'p>(
    types: &'p gc::Plan,
    storage: &Object,
    slot: u32,
    face: Face,
) -> Result<&'p ResolvedEntry, Failure> {
    let root = face.root(storage).ok_or_else(|| {
        format!(
            "{} `{}` has no HIR-proven dispatch contract",
            face.label(),
            storage.name
        )
    })?;
    face.groups(types)
        .get(&root)
        .and_then(|g| g.entries.get(&slot))
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
    let resolved = entry(types, storage, slot, face)?;
    let layout = m
        .program
        .layout(class)
        .ok_or_else(|| Failure::Invariant(format!("unplanned allocation {class:?}")))?;
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

/// The closure entries an allocation of `class` stores, in field order.
pub(crate) fn entries(
    m: &mut Builder<'_>,
    class: ClassId,
    storage: &Object,
) -> Result<Vec<Func>, Failure> {
    let Some(root) = storage.callable else {
        return Ok(Vec::new());
    };
    let slots: Vec<u32> = m.types.callables[&root].entries.keys().copied().collect();
    slots
        .into_iter()
        .map(|slot| thunk_func(m, Face::Closure, class, slot))
        .collect()
}

/// A descriptor's dispatch object: the class entries for an allocated class
/// with virtual slots, otherwise a null reference.
pub(crate) fn dispatch(
    m: &mut Builder<'_>,
    code: &mut ir::Code,
    class: Option<ClassId>,
) -> Result<(), Failure> {
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
        code.instruction(&I::RefNull(HeapType::ANY));
        return Ok(());
    };
    let group = &types.virtuals[&root];
    for &slot in group.entries.keys() {
        let entry = thunk_func(m, Face::Virtual, class, slot)?;
        code.ref_func(entry);
    }
    code.instruction(&I::StructNew(group.base));
    Ok(())
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
    let entry = entry(types, storage, slot, face)?;
    let group = &face.groups(types)[&face
        .root(storage)
        .ok_or_else(|| Failure::Invariant("missing callable base".into()))?];
    if params.len() != entry.params.len() {
        return Err(format!(
            "closure `{}` slot {slot} argument count mismatch",
            storage.name
        )
        .into());
    }
    contract::nonnull(b, receiver)?;
    b.load(receiver)?;
    for (&arg, ty) in params.iter().zip(&entry.params) {
        b.load(arg)?;
        objects::adapt(b, &b.ty(arg).clone(), ty)?;
    }
    b.load(receiver)?;
    if face == Face::Virtual {
        let root = types
            .root
            .ok_or_else(|| Failure::Invariant("unplanned class root".into()))?;
        b.instruction(&I::StructGet {
            struct_type_index: root.object,
            field_index: 0,
        });
        b.instruction(&I::StructGet {
            struct_type_index: root.descriptor,
            field_index: 3,
        });
        b.instruction(&I::RefCastNonNull(HeapType::Concrete(group.base)));
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
    if !nts_core::hir::has_a_closure_body(class) || !storage.fields.is_empty() {
        return Err(format!(
            "static closure `{}` has captures or no closure body",
            storage.name
        )
        .into());
    }
    let global = b.m.global(GlobalKey::StaticClosure(class), |m| {
        let descriptor = objects::descriptor(m, storage.descriptor)?;
        let mut code = ir::Code::default();
        code.global_get(descriptor);
        for entry in entries(m, class, storage)? {
            code.ref_func(entry);
        }
        code.instruction(&I::StructNew(storage.physical));
        Ok((crate::module::constant_type(storage.physical), code))
    })?;
    b.global_get(global);
    Ok(())
}
