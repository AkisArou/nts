//! Field-reading table bodies at the target interface's complete ABI.
use rustc_hash::FxHashMap;
use std::collections::BTreeMap;

use super::super::{
    Absent, BinOp, Callee, ClosureEntry, Copy, Func, FuncBuilder, HirType, Lowered,
    LoweringSnapshot, ManagedType, NodeId, OpKind, Param, ParamShape, SemanticSnapshot, Shared,
    Terminator, TypeId, ValueId, interfaces,
};
use super::{TableTarget, target};

#[derive(Debug, PartialEq, Eq, Hash)]
struct Key {
    owner: TypeId,
    field: u32,
    uniform_slot: u32,
    params: Vec<interfaces::AbiType>,
    returns: HirType,
    arguments_absent: Vec<Absent>,
    result_absent: Absent,
}

/// Make the concrete witnesses before interface shells and closure relations.
/// New layouts demanded by a contract join the worklist. Logical rows retain
/// their targets; equivalent field bodies share the meet of their input facts.
pub(in crate::hir::lower) fn declare(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    lowered: &mut Lowered,
    layout_collector: &mut super::super::LayoutCollector,
) {
    let asking = shared.builder(snapshot, foreign, Copy::default());
    let mut pending = BTreeMap::new();
    collect_requests(&asking, layout_collector.layouts(), &mut pending);
    let mut renamed = FxHashMap::default();
    let mut interned: FxHashMap<Key, usize> = FxHashMap::default();
    let mut failed = FxHashMap::default();
    while let Some((name, target)) = pending.pop_first() {
        if renamed.contains_key(&name) {
            continue;
        }
        #[cfg(test)]
        super::super::collection_tests::note(|counts| counts.adapter_contracts += 1);
        let mut builder = shared.builder(snapshot, foreign, Copy::default());
        let existing = layout_collector.layouts().len();
        builder.layouts = super::super::BuilderLayouts::Collected(std::mem::take(layout_collector));
        let built = build(&mut builder, &target);
        let demanded = builder.layouts.split_off(existing);
        *layout_collector = std::mem::take(&mut builder.layouts).into_collector();
        layout_collector.collect(&mut lowered.program, demanded);
        collect_requests(
            &asking,
            &layout_collector.layouts()[existing..],
            &mut pending,
        );
        if let Some((key, mut func)) = built {
            if let Some(&at) = interned.get(&key) {
                let existing = &mut lowered.program.funcs[at];
                for (param, incoming) in existing.params.iter_mut().zip(&func.params) {
                    param.known = param.known.join(incoming.known);
                }
                renamed.insert(name, existing.name.clone());
            } else {
                // A field load is never an identity projection, even when
                // another interface shares its calling convention.
                func.name.clone_from(&name);
                interned.insert(key, lowered.program.funcs.len());
                lowered.program.funcs.push(func);
                renamed.insert(name.clone(), name);
            }
        } else {
            lowered
                .program
                .uncompiled
                .push(crate::hir::Uncompiled::refused(
                    name.clone(),
                    "a stored literal method whose forwarding contract could not be materialized"
                        .to_owned(),
                ));
            for layout in layout_collector.layouts() {
                for (slot, entry) in layout.methods.iter().enumerate() {
                    if entry.as_ref() == Some(&name) {
                        failed.insert(u32::try_from(slot).unwrap_or(u32::MAX), name.clone());
                    }
                }
            }
            renamed.insert(name.clone(), name);
        }
    }
    for at in 0..layout_collector.layouts().len() {
        if layout_collector.layouts()[at]
            .methods
            .iter()
            .flatten()
            .any(|entry| renamed.get(entry).is_some_and(|name| name != entry))
        {
            layout_collector.refine(at, |layout| {
                for entry in layout.methods.iter_mut().flatten() {
                    if let Some(name) = renamed.get(entry) {
                        entry.clone_from(name);
                    }
                }
            });
        }
    }
    // An incomplete row cannot license a call. Naming its missing body lets
    // the normal refusal cascade drop callers before verification and pruning.
    for func in &mut lowered.program.funcs {
        for op in &mut func.values {
            if let OpKind::Call { callee, .. } = &mut op.kind
                && let Callee::Virtual { slot, .. } = callee
                && let Some(missing) = failed.get(slot)
            {
                *callee = Callee::Direct(missing.clone());
            }
        }
    }
}

/// Only these result families have a guard before concrete payload decoding.
/// Unsupported managed families block the inferred edge, rather than creating
/// an adapter which could reinterpret an unrelated erased value.
pub(super) fn can_check_result(snapshot: &SemanticSnapshot, ty: &HirType) -> bool {
    matches!(ty, HirType::Void | HirType::Never | HirType::Erased)
        || result_guard(snapshot, ty).is_some()
}

enum ResultGuard {
    Tag(u32),
    Instance(TypeId),
    Runtime(&'static str),
}

fn result_guard(snapshot: &SemanticSnapshot, ty: &HirType) -> Option<ResultGuard> {
    use crate::hir::tags;
    let tag = match ty {
        HirType::Int { .. } | HirType::Float { .. } => tags::NUMBER,
        HirType::Bool => tags::BOOLEAN,
        HirType::BigInt | HirType::Managed(ManagedType::BoxedBigInt) => tags::BIGINT,
        HirType::Managed(ManagedType::String) => tags::STRING,
        HirType::Managed(ManagedType::Symbol) => tags::SYMBOL,
        HirType::NativePointer(pointee) => tags::erased_handle_tag(pointee)?,
        HirType::Managed(ManagedType::Object(class)) => {
            if interfaces::signature(snapshot, *class).is_some()
                || crate::hir::is_closure_type(*class)
            {
                tags::FUNCTION
            } else {
                return Some(ResultGuard::Instance(*class));
            }
        }
        HirType::Managed(managed) => {
            let helper = match managed {
                ManagedType::Array(_) => "nts_is_array",
                ManagedType::Buffer => "nts_is_buffer",
                ManagedType::DataView => "nts_is_data_view",
                ManagedType::Date => "nts_is_date",
                ManagedType::Map(_, _) => "nts_is_map",
                ManagedType::Set(_) => "nts_is_set",
                ManagedType::Promise(_) => "nts_is_promise",
                _ => return None,
            };
            return Some(ResultGuard::Runtime(helper));
        }
        _ => return None,
    };
    Some(ResultGuard::Tag(tag))
}

fn collect_requests(
    builder: &FuncBuilder,
    layouts: &[crate::hir::Layout],
    pending: &mut BTreeMap<String, TableTarget>,
) {
    for layout in layouts {
        for &owner in &layout.types {
            if !builder.hierarchy.literal_methods.contains(owner) {
                continue;
            }
            for ((root, member, raising), &slot) in &builder.hierarchy.slots {
                if !builder.hierarchy.descends_from(owner, *root) {
                    continue;
                }
                let Some(target @ TableTarget::StoredLiteral { .. }) =
                    target(builder, owner, *root, member, *raising, &layout.fields)
                else {
                    continue;
                };
                let name = target.name(builder);
                if layout.methods.get(slot as usize).and_then(Option::as_ref) == Some(&name) {
                    pending.entry(name).or_insert(target);
                }
            }
        }
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "keep semantic text and key projection beside its existing dispatch"
)]
fn build(builder: &mut FuncBuilder, target: &TableTarget) -> Option<(Key, Func)> {
    let TableTarget::StoredLiteral {
        owner,
        root,
        field,
        member,
        raising,
    } = target
    else {
        return None;
    };
    let property = interfaces::property(builder.snapshot, *root, &member.key)?;
    let contract = interfaces::contract(builder, property)?;
    let at = property.declaration.unwrap_or(NodeId(0));
    let uniform_slot = if *raising {
        builder.raises = true;
        builder.hierarchy.raising_call_slot?
    } else {
        builder.hierarchy.erased_call_slot?
    };
    let field_ty = builder
        .layouts
        .iter()
        .find(|layout| layout.types.contains(owner))?
        .fields
        .get(*field as usize)?
        .ty
        .clone();
    if !matches!(field_ty, HirType::Managed(ManagedType::Object(_))) {
        return None;
    }
    let key = Key {
        owner: *owner,
        field: *field,
        uniform_slot,
        params: contract
            .params
            .iter()
            .map(|p| interfaces::abi_type(builder.snapshot, &p.ty))
            .collect(),
        returns: contract.returns.clone(),
        arguments_absent: contract
            .sources
            .iter()
            .map(|ty| super::super::absent_of_result(builder.snapshot, *ty))
            .collect(),
        result_absent: super::super::absent_of_result(builder.snapshot, contract.result),
    };
    let origin = nts_semantic_schema::Origin::generated(
        builder.origin(at).location,
        nts_semantic_schema::GeneratedReason::AbiProjection,
    );
    let (params, inputs) = parameters(builder, at, *owner, contract.params, &origin)?;
    builder.materialize(at, &contract.returns).ok()?;
    let closure = builder.push(
        OpKind::FieldGet {
            object: inputs[0],
            field: *field,
        },
        field_ty,
        origin.clone(),
    );
    let mut args = vec![closure];
    for (&value, &absent) in inputs.iter().skip(1).zip(&key.arguments_absent) {
        args.push(erase(builder, value, absent, &origin));
    }
    let this = erase(builder, inputs[0], Absent::Impossible, &origin);
    builder.returns = contract.returns.clone();
    let answered = builder
        .call_a_closure_entry(
            at,
            ClosureEntry(uniform_slot),
            Some(this),
            args,
            &HirType::Erased,
        )
        .ok()?;
    if *raising {
        builder.emit_the_raise_test(&origin);
    }
    let face = format!(
        "{}#{}",
        builder.hierarchy.name.get(root)?,
        member.emitted_name()
    );
    let result = match &contract.returns {
        HirType::Void | HirType::Never => None,
        _ => Some(checked_result(
            builder,
            at,
            answered,
            &contract.returns,
            key.result_absent,
            &face,
        )?),
    };
    builder.terminate(Terminator::Return(result));
    let name = target.name(builder);
    Some((
        key,
        builder.finish(name, params, contract.returns, origin, false),
    ))
}

fn parameters(
    builder: &mut FuncBuilder,
    at: NodeId,
    owner: TypeId,
    incoming: Vec<Param>,
    origin: &nts_semantic_schema::Origin,
) -> Option<(Vec<Param>, Vec<ValueId>)> {
    let mut params = vec![Param {
        name: "this".to_owned(),
        ty: HirType::Managed(ManagedType::Object(owner)),
        origin: origin.clone(),
        shape: ParamShape::Ordinary,
        known: crate::hir::facts::Facts::TOP,
        written: None,
    }];
    params.extend(incoming);
    for param in &mut params {
        param.written = None;
        param.shape = ParamShape::Ordinary;
        builder.materialize(at, &param.ty).ok()?;
    }
    let inputs: Vec<_> = params
        .iter()
        .enumerate()
        .map(|(i, p)| {
            builder.push(
                OpKind::Param(u32::try_from(i).unwrap_or(u32::MAX)),
                p.ty.clone(),
                p.origin.clone(),
            )
        })
        .collect();
    Some((params, inputs))
}

fn erase(
    builder: &mut FuncBuilder,
    value: ValueId,
    absent: Absent,
    origin: &nts_semantic_schema::Origin,
) -> ValueId {
    if builder.values[value.0 as usize].ty == HirType::Erased {
        return value;
    }
    builder.push(
        OpKind::Erase {
            value,
            absent,
            slots: crate::hir::Absent::Impossible,
        },
        HirType::Erased,
        origin.clone(),
    )
}

fn checked_result(
    builder: &mut FuncBuilder,
    at: NodeId,
    value: ValueId,
    ty: &HirType,
    absent: Absent,
    face: &str,
) -> Option<ValueId> {
    if *ty == HirType::Erased {
        return Some(value);
    }
    let origin = builder.origin(at);
    let mut fits = kind_test(builder, at, value, ty)?;
    let absent_tag = match absent {
        Absent::Null => Some(crate::hir::tags::NULL),
        Absent::Undefined => Some(crate::hir::tags::UNDEFINED),
        Absent::Impossible => None,
    };
    if let Some(tag) = absent_tag {
        let missing = tag_test(builder, at, value, tag);
        fits = builder.push(
            OpKind::Binary {
                op: BinOp::BitOr,
                lhs: fits,
                rhs: missing,
            },
            HirType::Bool,
            origin.clone(),
        );
    }
    let valid = builder.new_block();
    let invalid = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: fits,
        then_target: valid,
        then_args: Vec::new(),
        else_target: invalid,
        else_args: Vec::new(),
    });
    builder.switch_to(invalid);
    let message = builder.push(
        OpKind::ConstString(
            format!(
                "a literal method called through `{face}` returned a value of an unexpected kind"
            )
            .into(),
        ),
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    builder.runtime_call("nts_refused", vec![message], HirType::Void, origin.clone());
    builder.terminate(Terminator::Unreachable);
    builder.switch_to(valid);
    Some(builder.push(OpKind::unerase(value), ty.clone(), origin))
}

fn tag_test(builder: &mut FuncBuilder, at: NodeId, value: ValueId, tag: u32) -> ValueId {
    let origin = builder.origin(at);
    let unsigned = HirType::Int {
        bits: 32,
        signed: false,
    };
    let found = builder.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
    let wanted = builder.push(OpKind::ConstInt(i128::from(tag)), unsigned, origin.clone());
    builder.push(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: found,
            rhs: wanted,
        },
        HirType::Bool,
        origin,
    )
}

fn kind_test(
    builder: &mut FuncBuilder,
    at: NodeId,
    value: ValueId,
    ty: &HirType,
) -> Option<ValueId> {
    let origin = builder.origin(at);
    Some(match result_guard(builder.snapshot, ty)? {
        ResultGuard::Tag(tag) => tag_test(builder, at, value, tag),
        ResultGuard::Instance(class) => builder.push(
            OpKind::InstanceOf {
                value,
                classes: builder.classes_under(class),
                by_layout: false,
            },
            HirType::Bool,
            origin,
        ),
        ResultGuard::Runtime(helper) => {
            builder.runtime_call(helper, vec![value], HirType::Bool, origin)
        }
    })
}
