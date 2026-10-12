//! Typed immutable entries call the body HIR puts in each slot.

use crate::{
    EmitError, body::Body, callable_plan::ResolvedEntry, contract, error::Failure, gc,
    module::Symbols, object_plan::Object, objects, requirements::Requirements,
};
use nts_core::hir::{ClassId, HirType, ManagedType, Program, ValueId};
use std::collections::{BTreeMap, BTreeSet};
use wasm_encoder::{
    ConstExpr, Function, GlobalSection, GlobalType, HeapType, Instruction as I, RefType, ValType,
};

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

#[derive(Debug)]
pub(crate) struct Thunk {
    pub(crate) face: Face,
    pub(crate) physical: u32,
    pub(crate) slot: u32,
    pub(crate) signature: u32,
    target: String,
    receiver: HirType,
    params: usize,
}
impl Thunk {
    pub(crate) const fn key(&self) -> (Face, u32, u32) {
        (self.face, self.physical, self.slot)
    }
    pub(crate) fn name(&self) -> String {
        format!(
            "{}.entry<{},{}>",
            self.face.label(),
            self.physical,
            self.slot
        )
    }
}
#[derive(Debug)]
pub(crate) struct Static {
    pub(crate) ty: ClassId,
    pub(crate) global: u32,
}
pub(crate) fn allocations(
    resources: &Requirements,
    plan: &gc::Plan,
) -> Result<BTreeSet<u32>, EmitError> {
    resources
        .allocations
        .iter()
        .map(|(&ty, use_)| {
            plan.objects
                .object(&HirType::Managed(ManagedType::Object(ty)))
                .map(|o| o.physical)
                .map_err(|e| e.at(&use_.function, &use_.origin))
        })
        .collect()
}
pub(crate) fn statics(
    resources: &Requirements,
    plan: &gc::Plan,
    base: u32,
) -> Result<BTreeMap<u32, Static>, EmitError> {
    let mut result = BTreeMap::new();
    for (&ty, use_) in &resources.static_closures {
        let storage = plan
            .objects
            .object(&HirType::Managed(ManagedType::Object(ty)))
            .map_err(|e| e.at(&use_.function, &use_.origin))?;
        if !nts_core::hir::has_a_closure_body(ty) || !storage.fields.is_empty() {
            return Err(Failure::Unsupported(format!(
                "static closure `{}` has captures or no closure body",
                storage.name
            ))
            .at(&use_.function, &use_.origin));
        }
        result
            .entry(storage.physical)
            .or_insert(Static { ty, global: 0 });
    }
    for (at, static_) in result.values_mut().enumerate() {
        static_.global = base + crate::module::index(at);
    }
    Ok(result)
}
fn entry<'a>(
    symbols: &'a Symbols<'_>,
    storage: &Object,
    slot: u32,
    face: Face,
) -> Result<&'a ResolvedEntry, Failure> {
    let root = face.root(storage).ok_or_else(|| {
        format!(
            "{} `{}` has no HIR-proven dispatch contract",
            face.label(),
            storage.name
        )
    })?;
    face.groups(symbols.types)
        .get(&root)
        .and_then(|g| g.entries.get(&slot))
        .ok_or_else(|| {
            Failure::Invariant(format!(
                "unplanned callable slot {slot} of `{}`",
                storage.name
            ))
        })
}
pub(crate) fn plan(
    program: &Program,
    types: &gc::Plan,
    resources: &Requirements,
) -> Result<Vec<Thunk>, EmitError> {
    let mut result = BTreeMap::new();
    for face in [Face::Closure, Face::Virtual] {
        for (&ty, use_) in &resources.allocations {
            let allocation = HirType::Managed(ManagedType::Object(ty));
            let storage = types
                .objects
                .object(&allocation)
                .map_err(|e| e.at(&use_.function, &use_.origin))?;
            let Some(root) = face.root(storage) else {
                continue;
            };
            let layout = program.layout(ty).ok_or_else(|| {
                Failure::Invariant(format!("unplanned allocation {ty:?}"))
                    .at(&use_.function, &use_.origin)
            })?;
            for e in face.groups(types)[&root].entries.values() {
                let thunk = thunk(program, types, layout, storage, e, face)
                    .map_err(|error| error.at(&use_.function, &use_.origin))?;
                result.entry(thunk.key()).or_insert(thunk);
            }
        }
    }
    Ok(result.into_values().collect())
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
pub(crate) fn thunk_body(thunk: &Thunk, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let mut f = Function::new([]);
    let receiver = symbols.types.objects.object(&thunk.receiver)?;
    f.instruction(&I::LocalGet(0));
    f.instruction(&I::RefCastNonNull(HeapType::Concrete(receiver.physical)));
    for at in 1..thunk.params {
        f.instruction(&I::LocalGet(crate::module::index(at)));
    }
    let target = symbols
        .functions
        .get(thunk.target.as_str())
        .copied()
        .ok_or_else(|| Failure::Invariant(format!("unresolved closure body `{}`", thunk.target)))?;
    f.instruction(&I::Call(target));
    f.instruction(&I::End);
    Ok(f)
}
pub(crate) fn entries(symbols: &Symbols<'_>, storage: &Object) -> Result<Vec<I<'static>>, Failure> {
    let Some(root) = storage.callable else {
        return Ok(Vec::new());
    };
    symbols.types.callables[&root]
        .entries
        .values()
        .map(|entry| {
            symbols
                .thunks
                .get(&(Face::Closure, storage.physical, entry.slot))
                .copied()
                .map(I::RefFunc)
                .ok_or_else(|| {
                    Failure::Invariant(format!(
                        "unplanned entry {} of `{}`",
                        entry.slot, storage.name
                    ))
                })
        })
        .collect()
}
pub(crate) fn dispatch(
    symbols: &Symbols<'_>,
    physical: Option<u32>,
) -> Result<Vec<I<'static>>, Failure> {
    let Some(physical) = physical.filter(|p| symbols.allocations.contains(p)) else {
        return Ok(vec![I::RefNull(HeapType::ANY)]);
    };
    let Some(root) = symbols.types.objects.virtual_group(physical) else {
        return Ok(vec![I::RefNull(HeapType::ANY)]);
    };
    let group = &symbols.types.virtuals[&root];
    let mut code = group
        .entries
        .values()
        .map(|entry| {
            symbols
                .thunks
                .get(&(Face::Virtual, physical, entry.slot))
                .copied()
                .map(I::RefFunc)
                .ok_or_else(|| {
                    Failure::Invariant(format!(
                        "unplanned class entry {} for physical type {physical}",
                        entry.slot
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    code.push(I::StructNew(group.base));
    Ok(code)
}
pub(crate) fn call(
    b: &mut Body<'_>,
    result: ValueId,
    slot: u32,
    args: &[ValueId],
    face: Face,
) -> Result<(), Failure> {
    let Some((&receiver, params)) = args.split_first() else {
        return Err("closure call has no receiver".into());
    };
    let storage = b.symbols.types.objects.object(b.ty(receiver))?;
    let entry = entry(b.symbols, storage, slot, face)?;
    let group = &face.groups(b.symbols.types)[&face
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
        let root = b
            .symbols
            .types
            .root
            .ok_or_else(|| Failure::Invariant("unplanned class root".into()))?;
        b.ins(&I::StructGet {
            struct_type_index: root.object,
            field_index: 0,
        });
        b.ins(&I::StructGet {
            struct_type_index: root.descriptor,
            field_index: 3,
        });
        b.ins(&I::RefCastNonNull(HeapType::Concrete(group.base)));
    }
    b.ins(&I::StructGet {
        struct_type_index: group.base,
        field_index: entry.field,
    });
    b.ins(&I::CallRef(entry.signature));
    objects::adapt(b, &entry.result, &b.ty(result).clone())
}
pub(crate) fn static_value(b: &mut Body<'_>, result: ValueId) -> Result<(), Failure> {
    let storage = b.symbols.types.objects.object(b.ty(result))?;
    let global = b
        .symbols
        .static_closures
        .get(&storage.physical)
        .ok_or_else(|| Failure::Invariant(format!("unplanned static closure `{}`", storage.name)))?
        .global;
    b.ins(&I::GlobalGet(global));
    Ok(())
}
pub(crate) fn globals(symbols: &Symbols<'_>, section: &mut GlobalSection) -> Result<(), Failure> {
    for static_ in symbols.static_closures.values() {
        let storage = symbols
            .types
            .objects
            .object(&HirType::Managed(ManagedType::Object(static_.ty)))?;
        let mut code = vec![I::GlobalGet(symbols.descriptor_base + storage.descriptor)];
        code.extend(entries(symbols, storage)?);
        section.global(
            GlobalType {
                val_type: ValType::Ref(RefType {
                    nullable: false,
                    heap_type: HeapType::Concrete(storage.physical),
                }),
                mutable: false,
                shared: false,
            },
            &ConstExpr::extended(code.into_iter().chain([I::StructNew(storage.physical)])),
        );
    }
    Ok(())
}
