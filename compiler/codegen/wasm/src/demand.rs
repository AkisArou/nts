//! Whole-program type demand: the facts the GC type plan needs before any
//! body is lowered.
//!
//! Recursive type groups need the complete type graph, so types are planned
//! up front from HIR alone. Everything else (helpers, imports, literals and
//! globals) is requested by lowering itself, so it is decided in one place.

use nts_core::hir::{Callee, ClassId, Func, HirType, ManagedType, OpKind, Program, ValueId};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug)]
pub(crate) struct ObjectUse {
    pub(crate) function: String,
    pub(crate) origin: nts_semantic_schema::Origin,
}

/// Runtime services a program's calls need planned up front.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Services {
    /// A body queues a task without a promise of its own: a job or a timer,
    /// which need the task types and the checkpoint.
    pub(crate) tasks: bool,
    /// A body calls `Symbol.for` or `Symbol.keyFor`, whose registry is a
    /// string-keyed table.
    pub(crate) symbol_registry: bool,
    /// A body calls `String.fromCharCode`, which reads a one-byte string from
    /// a table of all 256 built once.
    pub(crate) one_byte_strings: bool,
}

#[derive(Debug, Default)]
pub(crate) struct Demand {
    /// Whether any body uses the explicit raising convention, which needs the
    /// erased payload type and the pending raise state.
    pub(crate) raising: bool,
    /// Whether any body records a raise (`nts_raise`): only then can a raise
    /// be pending when a host entry returns.
    pub(crate) raises: bool,
    /// The runtime services calls need planned before any body is emitted.
    pub(crate) services: Services,
    /// Per raising-slot function, its erased returns: their adapter must pass
    /// a failed call's placeholder through without reading it.
    pub(crate) raising_results: BTreeMap<String, BTreeSet<ValueId>>,
    pub(crate) referenced_objects: BTreeMap<ClassId, ObjectUse>,
    pub(crate) closure_calls: BTreeMap<(ClassId, u32), ObjectUse>,
    pub(crate) virtual_calls: BTreeMap<(ClassId, u32), ObjectUse>,
    pub(crate) virtual_declarations: BTreeMap<(ClassId, u32, String), ObjectUse>,
    /// Calls whose receiver is typed as an interface, by slot, with the
    /// declaration the call names. No one dispatch hierarchy holds such a
    /// receiver, so these read its descriptor's row rather than a vtable.
    pub(crate) row_calls: BTreeMap<u32, (String, ObjectUse)>,
    /// Each object type an optional property's presence is recorded on or
    /// read from by type: its storage, and every storage it shares a prefix
    /// with, carries the presence word.
    pub(crate) presence: BTreeMap<ClassId, ObjectUse>,
}

/// Whether `ty` is an interface's type, as opposed to a class's or a literal's.
pub(crate) fn is_face(program: &Program, ty: ClassId) -> bool {
    program
        .interface_identities
        .iter()
        .any(|identity| identity.types.contains(&ty))
}

fn record<K: Ord>(map: &mut BTreeMap<K, ObjectUse>, key: K, func: &Func, id: ValueId) {
    map.entry(key).or_insert_with(|| ObjectUse {
        function: func.name.clone(),
        origin: func.value(id).origin.clone(),
    });
}

pub(crate) fn build(program: &Program) -> Demand {
    let mut demand = Demand::default();
    for func in program.funcs.iter().filter(|f| !f.abstract_declaration) {
        for block in nts_codegen_common::block_order(func) {
            for &id in &func.blocks[block.0 as usize].ops {
                operation(&mut demand, program, func, id);
            }
        }
    }
    if demand.raising {
        raising_results(program, &mut demand);
    }
    demand
}

/// Exhaustive, so a new operation kind is classified here before it compiles.
fn operation(demand: &mut Demand, program: &Program, func: &Func, id: ValueId) {
    match &func.value(id).kind {
        OpKind::InstanceOf { classes, .. } => {
            for ty in classes {
                record(&mut demand.referenced_objects, *ty, func, id);
            }
        }
        // Each arm is a layout the read tests against, allocated or not.
        OpKind::SharedFieldGet { arms, .. } => {
            for ty in arms {
                record(&mut demand.referenced_objects, *ty, func, id);
            }
        }
        OpKind::OpenFieldGet { arms, .. } => {
            for arm in arms {
                record(&mut demand.referenced_objects, arm.ty, func, id);
            }
        }
        OpKind::Call { callee, args, .. } => call(demand, program, func, id, callee, args),
        // A reaction closure is called, with nothing, when its promise settles.
        OpKind::PromiseSubscribe { reaction, slot, .. } => {
            if let HirType::Managed(ManagedType::Object(ty)) = func.value(*reaction).ty {
                record(&mut demand.closure_calls, (ty, *slot), func, id);
            }
        }
        OpKind::NativeLoad { .. }
        | OpKind::NativeStore { .. }
        | OpKind::NativeLocal { .. }
        | OpKind::ObjcClass { .. }
        | OpKind::ObjcSelector { .. }
        | OpKind::NativeSizeOf(_)
        | OpKind::ConstHandle(_)
        | OpKind::NativeMalloc { .. }
        | OpKind::NativeFree { .. }
        | OpKind::NativePointerBits { .. }
        | OpKind::NativeIndexAddress { .. }
        | OpKind::NativeFieldAddress { .. }
        | OpKind::NativeBitLoad { .. }
        | OpKind::NativeBitStore { .. }
        | OpKind::NativeCopy { .. }
        | OpKind::NativeBridge { .. }
        | OpKind::NativeBlock { .. }
        | OpKind::DelegateInvoke { .. }
        | OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::DispatchSlot(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::Erase { .. }
        | OpKind::TagOf { .. }
        | OpKind::Unerase { .. }
        | OpKind::Binary { .. }
        | OpKind::Unary { .. }
        | OpKind::Convert(_)
        | OpKind::Return(_)
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_)
        | OpKind::StringUnitAt { .. }
        | OpKind::GlobalGet(_)
        | OpKind::GlobalSet { .. }
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ObjectNew { .. }
        | OpKind::CellReady { .. }
        | OpKind::ClosureStatic
        | OpKind::FieldGet { .. }
        | OpKind::FieldView { .. }
        | OpKind::OpenFieldSet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::Await { .. }
        | OpKind::Yield { .. }
        | OpKind::Suspend { .. }
        | OpKind::ArraySet { .. } => {}
    }
}

fn call(
    demand: &mut Demand,
    program: &Program,
    func: &Func,
    id: ValueId,
    target: &Callee,
    args: &[ValueId],
) {
    match target {
        Callee::External(name) => {
            if let Some(source) = crate::raising::external(name) {
                demand.raising = true;
                demand.raises |= matches!(source, crate::raising::Source::Raise);
            }
            demand.services.symbol_registry |=
                matches!(name.as_str(), "nts_symbol_for" | "nts_symbol_key_for");
            demand.services.one_byte_strings |= name == "nts_string_from_char_code";
            if crate::presence::external(name).is_some_and(crate::presence::Op::typed)
                && let Some(receiver) = args.first()
                && let HirType::Managed(ManagedType::Object(ty)) = func.value(*receiver).ty
            {
                record(&mut demand.presence, ty, func, id);
            }
            // A job or a timer is a closure called, with nothing, from the
            // queue or the host.
            if matches!(name.as_str(), "nts_enqueue_job" | "nts_set_timeout")
                && let [closure, slot, ..] = args
                && let OpKind::DispatchSlot(slot) = func.value(*slot).kind
                && let HirType::Managed(ManagedType::Object(ty)) = func.value(*closure).ty
            {
                demand.services.tasks = true;
                record(&mut demand.closure_calls, (ty, slot), func, id);
            }
        }
        Callee::Closure { slot } | Callee::Virtual { slot, .. } => {
            let Some(receiver) = args.first() else {
                return;
            };
            let HirType::Managed(ManagedType::Object(ty)) = func.value(*receiver).ty else {
                return;
            };
            if let Callee::Virtual { declared, .. } = target {
                if is_face(program, ty) {
                    demand.row_calls.entry(*slot).or_insert_with(|| {
                        (
                            declared.clone(),
                            ObjectUse {
                                function: func.name.clone(),
                                origin: func.value(id).origin.clone(),
                            },
                        )
                    });
                    return;
                }
                record(
                    &mut demand.virtual_declarations,
                    (ty, *slot, declared.clone()),
                    func,
                    id,
                );
                record(&mut demand.virtual_calls, (ty, *slot), func, id);
            } else {
                record(&mut demand.closure_calls, (ty, *slot), func, id);
            }
        }
        Callee::Direct(_) | Callee::Native(_) => {}
    }
}

/// The declared uniform raising slot is the authority, never a suffix in a
/// function name. Its erased return adapter must propagate an ignored
/// placeholder without inspecting a failed call's value.
fn raising_results(program: &Program, demand: &mut Demand) {
    let Some(slot) = program.raising_call_slot else {
        return;
    };
    for name in program
        .layouts
        .iter()
        .filter_map(|layout| layout.methods.get(slot as usize).and_then(Option::as_ref))
    {
        let Some(func) = program.funcs.iter().find(|f| &f.name == name) else {
            continue;
        };
        for block in nts_codegen_common::block_order(func) {
            let block = &func.blocks[block.0 as usize];
            let returns = block
                .ops
                .iter()
                .filter_map(|id| {
                    if let OpKind::Return(Some(value)) = func.value(*id).kind {
                        Some(value)
                    } else {
                        None
                    }
                })
                .chain(
                    if let nts_core::hir::Terminator::Return(value) = block.terminator {
                        value
                    } else {
                        None
                    },
                );
            for returned in returns {
                if matches!(func.value(returned).kind, OpKind::Erase { .. }) {
                    demand
                        .raising_results
                        .entry(name.clone())
                        .or_default()
                        .insert(returned);
                }
            }
        }
    }
}
