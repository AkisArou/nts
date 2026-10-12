//! Real functions and table rows for the source field-family plan.

use super::{
    Absent, Callee, Func, FuncBuilder, Hierarchy, HirType, ManagedType, Naming, OpKind, Origin,
    Param, ParamShape, Program, SemanticSnapshot, Terminator, ValueId,
    access_families::{Family, Reader, Supply},
};
use crate::hir::{
    facts::Facts,
    fields::{LayoutIndex, shares_storage},
    interface_access,
};

struct Context<'a> {
    snapshot: &'a SemanticSnapshot,
    hierarchy: &'a Hierarchy,
    naming: &'a Naming,
    by_name: rustc_hash::FxHashMap<String, usize>,
    bodies: rustc_hash::FxHashMap<BodyKey, String>,
}

/// Shared bodies have the same concrete storage and convention. Their input
/// facts are TOP, the meet valid for every face that may enter the body.
#[derive(PartialEq, Eq, Hash)]
struct BodyKey {
    owner: super::TypeId,
    /// Constant missing-field reads do not depend on a member. Their owner is
    /// still one exact canonical layout, so the JVM receiver type also agrees.
    member: Option<String>,
    writes: bool,
    raising: bool,
    input: Option<HirType>,
    written_input: Option<crate::hir::native::Scalar>,
    returns: HirType,
    input_absent: Absent,
    result_absent: Absent,
}

pub(super) fn declare(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    naming: &Naming,
    program: &mut Program,
) {
    note_native_views(hierarchy, program);
    for ((face, key), slot) in &hierarchy.slots {
        if hierarchy.access_families.for_key(*face, key).is_some() {
            program.interface_access.note_selector(*slot);
        }
    }
    // Preserved stored operations never call native family helpers. Construct
    // only families already called by source lowering, so unused bodies cannot
    // demand extra layouts before reachability has a chance to discard them.
    let used = if hierarchy.preserve_field_layouts {
        used_selectors(program)
    } else {
        rustc_hash::FxHashSet::default()
    };
    let mut context = Context {
        snapshot,
        hierarchy,
        naming,
        bodies: rustc_hash::FxHashMap::default(),
        by_name: program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, function)| (function.name.clone(), at))
            .collect(),
    };
    let layouts = LayoutIndex::build(program);
    let mut functions = Vec::new();
    for family in &hierarchy.access_families.licensed {
        let Some(face) = layouts.of_class(family.face) else {
            continue;
        };
        let field = program.layouts[face].index_of(&family.member);
        let dispatch = family.eager
            || family.supplies.iter().any(|supply| {
                let Some(owner) = layouts.of_class(supply.owner) else {
                    return false;
                };
                field.is_none_or(|field| {
                    !shares_storage(&program.layouts[face], &program.layouts[owner], field)
                })
            });
        let plan = interface_access::Family {
            face: family.face,
            member: family.member.clone(),
            field,
            getter: entry(hierarchy, family, false, false),
            setter: family
                .writes
                .as_ref()
                .map(|_| entry(hierarchy, family, true, false)),
            raising: raising_entries(hierarchy, family),
            owners: family.supplies.iter().map(|supply| supply.owner).collect(),
            pending: dispatch && !family.eager,
            stored_dispatch: dispatch && !family.eager,
        };
        if !hierarchy.preserve_field_layouts
            || plan.entries().any(|entry| used.contains(&entry.slot))
        {
            declare_functions(
                &mut context,
                program,
                &layouts,
                family,
                &plan,
                &mut functions,
            );
        }
        program.interface_access.push(plan);
    }
    program.funcs.extend(functions);
}

fn used_selectors(program: &Program) -> rustc_hash::FxHashSet<u32> {
    program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter_map(|op| match op.kind {
            OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                ..
            } => Some(slot),
            _ => None,
        })
        .collect()
}

fn declare_functions(
    context: &mut Context<'_>,
    program: &mut Program,
    layouts: &LayoutIndex,
    family: &Family,
    plan: &interface_access::Family,
    functions: &mut Vec<Func>,
) {
    functions.push(shell(
        context.snapshot,
        family,
        plan.getter.declared.clone(),
        false,
    ));
    if let Some(setter) = &plan.setter {
        functions.push(shell(
            context.snapshot,
            family,
            setter.declared.clone(),
            true,
        ));
    }
    for writes in [false, true] {
        if writes && plan.setter.is_none() {
            continue;
        }
        if has_raising_entry(context.hierarchy, family, writes) {
            functions.push(shell(
                context.snapshot,
                family,
                entry(context.hierarchy, family, writes, true).declared,
                writes,
            ));
        }
    }
    for supply in &family.supplies {
        let Some(owner) = layouts.of_class(supply.owner) else {
            continue;
        };
        for writes in [false, true] {
            if writes && plan.setter.is_none() {
                continue;
            }
            fill(
                context,
                program,
                family,
                supply,
                (owner, writes, false),
                functions,
            );
            if has_raising_entry(context.hierarchy, family, writes) {
                fill(
                    context,
                    program,
                    family,
                    supply,
                    (owner, writes, true),
                    functions,
                );
            }
        }
    }
}

fn note_native_views(hierarchy: &Hierarchy, program: &mut Program) {
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::FieldView { source, face, .. } = op.kind
                && hierarchy.access_families.carries(source, face)
            {
                program.interface_access.native_views.insert((source, face));
            }
        }
    }
}

fn raising_entries(hierarchy: &Hierarchy, family: &Family) -> Vec<interface_access::Entry> {
    [false, true]
        .into_iter()
        .filter(|writes| !writes || family.writes.is_some())
        .filter(|writes| has_raising_entry(hierarchy, family, *writes))
        .map(|writes| entry(hierarchy, family, writes, true))
        .collect()
}

fn has_raising_entry(hierarchy: &Hierarchy, family: &Family, writes: bool) -> bool {
    hierarchy.slots.contains_key(&(
        family.face,
        format!("{}{}", family.key(writes), super::RAISING_SUFFIX),
    ))
}

pub(super) fn entry(
    hierarchy: &Hierarchy,
    family: &Family,
    writes: bool,
    raising: bool,
) -> interface_access::Entry {
    let suffix = if raising { super::RAISING_SUFFIX } else { "" };
    let key = format!("{}{suffix}", family.key(writes));
    interface_access::Entry {
        slot: hierarchy.slots[&(family.face, key.clone())],
        declared: format!(
            "{}#{}{suffix}",
            hierarchy.name[&family.face],
            declaration_key(family, writes)
        ),
    }
}

fn declaration_key(family: &Family, writes: bool) -> String {
    format!("{}@interface{}", family.key(writes), family.face.0)
}

/// Pure stored rows are identical on equal physical layouts. Their reservation
/// must permit the ordinary structural merge; user-code rows keep their owner.
pub(super) fn placeholder(
    hierarchy: &Hierarchy,
    family: &Family,
    supply: &Supply,
    writes: bool,
    raising: bool,
) -> String {
    let entry = entry(hierarchy, family, writes, false);
    let owner = if matches!(supply.reader, Reader::Stored) && supply.setter.is_none() {
        format!("storage{:?}", supply.absent)
    } else if matches!(supply.reader, Reader::Undefined) {
        // A missing-field reader has no owner storage to read. Equal complete
        // layouts may merge before its receiver type is fixed, just as stored
        // readers may; keep the two reader roles distinct in the reservation.
        format!("undefined{:?}", supply.absent)
    } else {
        supply.owner.0.to_string()
    };
    format!(
        "{}@{owner}{}",
        entry.declared,
        if raising { super::RAISING_SUFFIX } else { "" }
    )
}

fn body_key(
    snapshot: &SemanticSnapshot,
    family: &Family,
    supply: &Supply,
    writes: bool,
    raising: bool,
) -> BodyKey {
    BodyKey {
        owner: supply.owner,
        member: (!matches!(supply.reader, Reader::Undefined)).then(|| family.member.clone()),
        writes,
        raising,
        input: if writes { family.writes.clone() } else { None },
        written_input: if writes { family.written_input } else { None },
        returns: if writes {
            HirType::Void
        } else {
            family.returns.clone()
        },
        input_absent: if writes {
            super::interfaces::property(snapshot, family.face, &family.member)
                .map_or(Absent::Impossible, |property| {
                    super::absent_of_result(snapshot, property.ty)
                })
        } else {
            Absent::Impossible
        },
        result_absent: if writes {
            Absent::Impossible
        } else {
            supply.absent
        },
    }
}

fn origin(snapshot: &SemanticSnapshot, family: &Family) -> Origin {
    let source = super::interfaces::property(snapshot, family.face, &family.member)
        .and_then(|property| property.declaration)
        .and_then(|at| snapshot.nodes.get(at.0 as usize))
        .map_or_else(
            || super::Location {
                file: nts_diagnostics::SourceId(0),
                span: nts_diagnostics::Span::new(0, 0),
            },
            |node| node.origin.location,
        );
    Origin::generated(source, nts_semantic_schema::GeneratedReason::AbiProjection)
}

fn parameters(
    family: &Family,
    receiver: super::TypeId,
    writes: bool,
    origin: &Origin,
) -> Vec<Param> {
    let mut params = vec![Param {
        name: "this".to_owned(),
        ty: HirType::Managed(ManagedType::Object(receiver)),
        shape: ParamShape::Ordinary,
        origin: origin.clone(),
        known: Facts::TOP,
        written: None,
    }];
    if writes {
        params.push(Param {
            name: "value".to_owned(),
            ty: family.writes.clone().unwrap_or(HirType::Erased),
            shape: ParamShape::Ordinary,
            origin: origin.clone(),
            known: Facts::TOP,
            written: family.written_input,
        });
    }
    params
}

fn shell(snapshot: &SemanticSnapshot, family: &Family, name: String, writes: bool) -> Func {
    let origin = origin(snapshot, family);
    let params = parameters(family, family.face, writes, &origin);
    let mut builder = FuncBuilder::probe(snapshot);
    for (at, param) in params.iter().enumerate() {
        builder.push(
            OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX)),
            param.ty.clone(),
            origin.clone(),
        );
    }
    let returns = if writes {
        HirType::Void
    } else {
        family.returns.clone()
    };
    let mut function = builder.finish(name, params, returns, origin, false);
    function.abstract_declaration = true;
    function
}

fn fill(
    context: &mut Context<'_>,
    program: &mut Program,
    family: &Family,
    supply: &Supply,
    (owner, writes, raising): (usize, bool, bool),
    functions: &mut Vec<Func>,
) {
    // The source owner may have joined an equivalent structural layout. One
    // body and receiver convention serve all of that layout's stored rows.
    let mut supply = supply.clone();
    if (matches!(supply.reader, Reader::Stored) && supply.setter.is_none())
        || matches!(supply.reader, Reader::Undefined)
    {
        supply.owner = *program.layouts[owner]
            .types
            .first()
            .unwrap_or(&supply.owner);
    }
    let supply = &supply;
    let key = body_key(context.snapshot, family, supply, writes, raising);
    let entry = entry(context.hierarchy, family, writes, raising);
    if let Some(name) = context.bodies.get(&key) {
        program.layouts[owner].methods[entry.slot as usize] = Some(name.clone());
        return;
    }
    let ordinary = self::entry(context.hierarchy, family, writes, false);
    let base = format!("{}@{}", ordinary.declared, supply.owner.0);
    let ordinary_key = body_key(context.snapshot, family, supply, writes, false);
    let base = context.bodies.get(&ordinary_key).cloned().unwrap_or(base);
    let name = format!("{base}{}", if raising { super::RAISING_SUFFIX } else { "" });
    let function = body(
        context,
        program,
        family,
        supply,
        (&name, owner, writes, raising),
    );
    program.layouts[owner].methods[entry.slot as usize] = Some(name.clone());
    context.bodies.insert(key, name.clone());
    let Some(function) = function else {
        // Keep the unavailable target until the existing family dependency
        // cascade has named every virtual reader. An initial lowering failure
        // has the same contract as one discovered while settling: neither
        // grants permission to emit a runtime refusal stub for the row.
        program.uncompiled.push((
            name,
            refusal_reason(context, program, family, supply, writes, raising),
        ));
        return;
    };
    if matches!(supply.reader, Reader::Stored) && supply.setter.is_none() {
        program
            .interface_access
            .storage_bodies
            .insert(name.clone(), supply.owner);
    }
    if matches!(supply.reader, Reader::Undefined) && !writes {
        program
            .interface_access
            .default_bodies
            .insert(name.clone(), raising);
    }
    functions.push(function);
}

fn user_accessor(supply: &Supply, writes: bool) -> Option<super::access_families::Accessor> {
    if writes {
        supply.setter
    } else if let Reader::Getter(accessor) = supply.reader {
        Some(accessor)
    } else {
        None
    }
}

fn accessor_name(
    context: &Context<'_>,
    family: &Family,
    accessor: super::access_families::Accessor,
    writes: bool,
    raising: bool,
) -> Option<String> {
    let suffix = if raising && context.naming.raising.contains(&accessor.declaration) {
        super::RAISING_SUFFIX
    } else {
        ""
    };
    Some(format!(
        "{}#{} {}{suffix}",
        context.hierarchy.name.get(&accessor.owner)?,
        if writes { "set" } else { "get" },
        family.member
    ))
}

fn refusal_reason(
    context: &Context<'_>,
    program: &Program,
    family: &Family,
    supply: &Supply,
    writes: bool,
    raising: bool,
) -> String {
    let owner = context
        .hierarchy
        .name
        .get(&supply.owner)
        .map_or("a literal", String::as_str);
    let cause = if let Some(accessor) = user_accessor(supply, writes) {
        match accessor_name(context, family, accessor, writes, raising) {
            Some(target) => program
                .uncompiled
                .iter()
                .find(|(name, _)| *name == target)
                .map_or_else(
                    || format!("the accessor `{target}` has no lowered body"),
                    |(_, reason)| format!("the accessor `{target}` was refused: {reason}"),
                ),
            None => "the accessor's declaring class has no lowered identity".to_owned(),
        }
    } else {
        "the stored property has no physical field in its concrete layout".to_owned()
    };
    format!(
        "interface field `{}` on `{owner}` cannot dispatch: {cause}",
        family.member
    )
}

fn body(
    context: &Context<'_>,
    program: &Program,
    family: &Family,
    supply: &Supply,
    (name, owner, writes, raising): (&str, usize, bool, bool),
) -> Option<Func> {
    let snapshot = context.snapshot;
    let origin = origin(snapshot, family);
    let params = parameters(family, supply.owner, writes, &origin);
    let mut builder = FuncBuilder::probe(snapshot);
    for (at, param) in params.iter().enumerate() {
        builder.push(
            OpKind::Param(u32::try_from(at).ok()?),
            param.ty.clone(),
            origin.clone(),
        );
    }
    let answer = if let Some(accessor) = user_accessor(supply, writes) {
        let target = accessor_name(context, family, accessor, writes, raising)?;
        let target = program.funcs.get(*context.by_name.get(&target)?)?;
        let receiver = converted(
            &mut builder,
            ValueId(0),
            &target.params.first()?.ty,
            Absent::Impossible,
            &origin,
        );
        let mut args = vec![receiver];
        if writes {
            let absent = super::interfaces::property(snapshot, family.face, &family.member)
                .map_or(Absent::Impossible, |property| {
                    super::absent_of_result(snapshot, property.ty)
                });
            args.push(converted(
                &mut builder,
                ValueId(1),
                &supply.write_ty,
                absent,
                &origin,
            ));
        }
        builder.push(
            OpKind::Call {
                callee: Callee::Direct(target.name.clone()),
                args,
                frame: None,
            },
            target.return_type.clone(),
            origin.clone(),
        )
    } else if matches!(supply.reader, Reader::Undefined) {
        builder.push(OpKind::ConstUndefined, HirType::Erased, origin.clone())
    } else {
        stored(&mut builder, program, family, owner, writes, &origin)?
    };
    let returns = if writes {
        HirType::Void
    } else {
        family.returns.clone()
    };
    let answer = if writes {
        None
    } else {
        Some(converted(
            &mut builder,
            answer,
            &returns,
            supply.absent,
            &origin,
        ))
    };
    builder.terminate(Terminator::Return(answer));
    Some(builder.finish(name.to_owned(), params, returns, origin, false))
}

fn stored(
    builder: &mut FuncBuilder<'_>,
    program: &Program,
    family: &Family,
    owner: usize,
    writes: bool,
    origin: &Origin,
) -> Option<ValueId> {
    let field = program.layouts[owner].index_of(&family.member)?;
    let ty = &program.layouts[owner].fields[field as usize].ty;
    if writes {
        let absent = super::interfaces::property(builder.snapshot, family.face, &family.member)
            .map_or(Absent::Impossible, |property| {
                super::absent_of_result(builder.snapshot, property.ty)
            });
        let value = converted(builder, ValueId(1), ty, absent, origin);
        Some(builder.push(
            OpKind::FieldSet {
                object: ValueId(0),
                field,
                value,
            },
            HirType::Void,
            origin.clone(),
        ))
    } else {
        Some(builder.push(
            OpKind::FieldGet {
                object: ValueId(0),
                field,
            },
            ty.clone(),
            origin.clone(),
        ))
    }
}

fn converted(
    builder: &mut FuncBuilder<'_>,
    value: ValueId,
    to: &HirType,
    absent: Absent,
    origin: &Origin,
) -> ValueId {
    let from = &builder.values[value.0 as usize].ty;
    if from == to {
        return value;
    }
    if matches!(from, HirType::Void | HirType::Never) {
        return builder.push(OpKind::ConstUndefined, HirType::Erased, origin.clone());
    }
    let kind = if *to == HirType::Erased {
        OpKind::Erase { value, absent }
    } else {
        OpKind::Convert(value)
    };
    builder.push(kind, to.clone(), origin.clone())
}
