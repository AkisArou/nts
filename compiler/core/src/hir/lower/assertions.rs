//! Native safety checks for explicit source assertions.
//!
//! A checker narrowing has already tested its value. An `as` has not: both
//! paths may read the same payload, but only the assertion needs to establish
//! the licence first. The plan is shared with synchronous-effect analysis.

use super::{
    Absent, BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, TypeId, ValueId,
    syntax,
};
use crate::hir::tags;

#[derive(Debug, Clone)]
enum Check {
    Primitive { target: HirType, tag: u32 },
    Class(TypeId),
    Present,
}

/// The check an assertion needs before its payload is read.
///
/// `x!` is checked only where its target is a reference: after it the program
/// trusts the pointer, folds its own `=== null` guards away and dereferences
/// it, so a null that got through is a crash rather than a JavaScript answer.
/// A scalar target has no pointer to trust -- `digits().at(99)!` unerases
/// `undefined` to NaN, which is what node's `undefined` becomes as a number --
/// so it stays the type-only claim it is in JavaScript.
fn check(probe: &FuncBuilder<'_>, id: NodeId) -> Option<Check> {
    if probe.kind_of(id) == Some(syntax::NON_NULL_EXPRESSION) {
        return probe
            .type_of(id)
            .is_some_and(|target| target.is_managed() || matches!(target, HirType::NativePointer(_)))
            .then_some(Check::Present);
    }
    if probe.kind_of(id) != Some(syntax::AS_EXPRESSION) {
        return None;
    }
    let target = probe.type_of(id)?;
    let tag = match &target {
        HirType::Bool => tags::BOOLEAN,
        HirType::BigInt => tags::BIGINT,
        HirType::Float { bits: 64 } => tags::NUMBER,
        HirType::Managed(ManagedType::String) => tags::STRING,
        HirType::Managed(ManagedType::Symbol) => tags::SYMBOL,
        HirType::Managed(ManagedType::Object(class)) if is_nominal_class(probe, *class) => {
            return Some(Check::Class(*class));
        }
        _ => return None,
    };
    Some(Check::Primitive { target, tag })
}

pub(super) fn is_nominal_class(probe: &FuncBuilder<'_>, ty: TypeId) -> bool {
    probe
        .snapshot
        .types
        .get(ty.0 as usize)
        .and_then(|record| record.symbol)
        .and_then(|symbol| probe.snapshot.symbols.get(symbol.0 as usize))
        .is_some_and(|record| {
            record.declarations.iter().any(|declaration| {
                probe
                    .kind_of(*declaration)
                    .is_some_and(super::declares_a_class)
            })
        })
        || crate::hir::is_provided_error_type(ty)
        || probe
            .name_of_type(ty)
            .is_some_and(crate::hir::builtin::is_error)
}

/// The same checks that lowering emits, before any payload is read.
/// This is conservative when a contextual copy later proves the operand.
pub(super) fn can_throw(probe: &FuncBuilder<'_>, id: NodeId) -> bool {
    let Some(inner) = probe.children(id).first().copied() else {
        return false;
    };
    match check(probe, id) {
        Some(Check::Primitive { target, .. }) => {
            probe.type_of(inner) != Some(target) || removes_absence(probe, inner, id)
        }
        Some(Check::Class(class)) => {
            probe.type_of(inner) != Some(HirType::Managed(ManagedType::Object(class)))
                || removes_absence(probe, inner, id)
        }
        Some(Check::Present) => {
            probe.type_of(inner).is_some_and(|ty| ty == HirType::Erased)
                || probe.snapshot.node_types.get(&inner).is_some_and(|ty| {
                    super::holds_only_absences(probe.snapshot, *ty)
                        || probe.snapshot.types.get(ty.0 as usize).is_some_and(|record| {
                            matches!(&record.kind, super::TypeKind::Union(members)
                                if members.iter().any(|member| super::absence_of_member(probe.snapshot, *member).is_some()))
                        })
                })
        }
        None => false,
    }
}

fn removes_absence(probe: &FuncBuilder<'_>, source: NodeId, target: NodeId) -> bool {
    let allowed = probe.absences_of(target).unwrap_or_default();
    probe
        .absences_of(source)
        .unwrap_or_default()
        .iter()
        .any(|tag| !allowed.contains(tag))
}

pub(super) fn lower(
    builder: &mut FuncBuilder<'_>,
    id: NodeId,
    value: ValueId,
) -> Result<ValueId, Diagnostic> {
    if builder.kind_of(id) == Some(syntax::SATISFIES_EXPRESSION) {
        return Ok(value);
    }
    let source = builder.children(id).first().copied().unwrap_or(id);
    // Widening to unknown preserves the runtime type instead of using the
    // assertion's checker type as evidence for a later cast.
    if builder.type_of(id) == Some(HirType::Erased) {
        if actual_is_unerasable(builder, value) {
            return Err(builder.unsupported(
                id,
                "an assertion to unknown from a value with no erased representation",
            ));
        }
        return builder.coerce(value, &HirType::Erased, source);
    }
    // Only a check that reads the value's tag needs it erased. A non-null
    // assertion tests the value's own absence -- for a host handle, a pointer
    // compared with NULL -- and a handle has no erased form to refuse over
    // (blockers/a-non-null-assertion-on-a-host-handle-is-refused).
    if matches!(check(builder, id), Some(Check::Primitive { .. } | Check::Class(_)))
        && actual_is_unerasable(builder, value)
    {
        return Err(builder.unsupported(
            id,
            "a checked assertion from a value with no erased representation",
        ));
    }
    let plan = check(builder, id);
    let allowed = builder.absences_of(id).unwrap_or_default();
    let target = match &plan {
        Some(Check::Primitive { target, .. }) => Some(target.clone()),
        Some(Check::Class(class)) => Some(HirType::Managed(ManagedType::Object(*class))),
        _ => None,
    };
    if let Some(target) = target
        && let Some(recovered) = recover_matching(builder, id, source, value, &target, &allowed)
    {
        return recovered;
    }
    match plan {
        Some(Check::Primitive { target, tag }) => {
            let origin = builder.origin(id);
            let erased = builder.coerce(value, &HirType::Erased, source)?;
            let matches = tag_matches(builder, id, erased, tag);
            let mismatch = disallowed(builder, id, erased, matches, &allowed);
            reject_when(
                builder,
                id,
                mismatch,
                "TypeError",
                "The asserted native representation does not match the value",
            )?;
            return Ok(builder.push(OpKind::Unerase { value: erased }, target, origin));
        }
        Some(Check::Class(class)) => {
            let target = HirType::Managed(ManagedType::Object(class));
            builder.materialize(id, &target)?;
            let origin = builder.origin(id);
            let erased = builder.coerce(value, &HirType::Erased, source)?;
            let matches = builder.push(
                OpKind::InstanceOf {
                    value: erased,
                    classes: builder.classes_under(class),
                },
                HirType::Bool,
                origin.clone(),
            );
            let mismatch = disallowed(builder, id, erased, matches, &allowed);
            reject_when(
                builder,
                id,
                mismatch,
                "TypeError",
                "The asserted native class does not match the value",
            )?;
            return Ok(builder.push(OpKind::Unerase { value: erased }, target, origin));
        }
        Some(Check::Present) if can_throw(builder, id) => {
            if let Some(absent) = builder.absence_of(id, value) {
                reject_when(
                    builder,
                    id,
                    absent,
                    "TypeError",
                    "A non-null assertion received null or undefined",
                )?;
            }
        }
        _ => {}
    }
    builder.narrowed(id, value)
}

fn recover_matching(
    builder: &mut FuncBuilder<'_>,
    id: NodeId,
    source: NodeId,
    value: ValueId,
    target: &HirType,
    allowed: &[u32],
) -> Option<Result<ValueId, Diagnostic>> {
    // Recover only an existing representation, never the assertion's claim.
    // This also removes a proved erasure round trip before any guard or ABI
    // conversion is emitted. Absence remains a separate proof obligation.
    let (concrete, absent) = match builder.values[value.0 as usize].kind {
        OpKind::Erase { value, absent } => (
            value,
            match absent {
                Absent::Impossible => None,
                Absent::Null => Some(tags::NULL),
                Absent::Undefined => Some(tags::UNDEFINED),
            },
        ),
        _ => (value, None),
    };
    let have = &builder.values[concrete.0 as usize].ty;
    let compatible = *have == *target
        || matches!((have, target),
        (HirType::Managed(ManagedType::Object(from)), HirType::Managed(ManagedType::Object(to)))
            if builder.descends_from(*from, *to));
    if !compatible {
        return None;
    }
    Some((|| {
        let needs_presence = if concrete == value {
            removes_absence(builder, source, id)
        } else {
            absent.is_some_and(|tag| !allowed.contains(&tag))
        };
        if needs_presence && let Some(absent) = builder.absence_of(id, concrete) {
            reject_when(
                builder,
                id,
                absent,
                "TypeError",
                "The asserted native representation requires a present value",
            )?;
        }
        builder.coerce(concrete, target, id)
    })())
}

fn disallowed(
    builder: &mut FuncBuilder<'_>,
    id: NodeId,
    value: ValueId,
    mut matches: ValueId,
    allowed: &[u32],
) -> ValueId {
    let origin = builder.origin(id);
    for tag in allowed {
        let absent = tag_matches(builder, id, value, *tag);
        matches = builder.push(
            OpKind::Binary {
                op: BinOp::BitOr,
                lhs: matches,
                rhs: absent,
            },
            HirType::Bool,
            origin.clone(),
        );
    }
    builder.push(
        OpKind::Unary {
            op: super::UnOp::Not,
            operand: matches,
        },
        HirType::Bool,
        origin,
    )
}

fn tag_matches(builder: &mut FuncBuilder<'_>, id: NodeId, value: ValueId, tag: u32) -> ValueId {
    let origin = builder.origin(id);
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

fn actual_is_unerasable(builder: &FuncBuilder<'_>, value: ValueId) -> bool {
    let ty = &builder.values[value.0 as usize].ty;
    ty != &HirType::Erased && !super::erasable(ty)
}

/// A getter read the checker narrowed by assignment, dereferenced where it
/// stands: checked first, since that narrowing tested nothing.
///
/// After `div.nodeValue = "x"` the checker types `div.nodeValue` as `string`,
/// but the getter answers what it answers -- an element's `nodeValue` is null
/// whatever is assigned. JavaScript then throws a `TypeError` reading
/// `div.nodeValue.length`; trusting the narrowing read through a null pointer.
/// Only a dereference is checked: an absence question about the read (`+`,
/// `=== null`, `??`) is answered from its declaration (`read_type`) instead,
/// and gives JavaScript's answer rather than a throw.
pub(super) fn dereferenced_getter_read(builder: &mut FuncBuilder<'_>, id: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
    if !builder.dereferenced(id) || !builder.narrowed_past_absence(id) {
        return Ok(value);
    }
    if let Some(absent) = builder.absence_of(id, value) {
        reject_when(
            builder,
            id,
            absent,
            "TypeError",
            "A getter the program had assigned to answered null or undefined, and its result was dereferenced",
        )?;
    }
    Ok(value)
}

/// A native safety failure is a checked `TypeError` where the program can
/// handle it. At an unhandled entry, decline the case by name rather than
/// presenting an added native assertion failure as JavaScript's result.
fn reject_when(
    builder: &mut FuncBuilder<'_>,
    id: NodeId,
    condition: ValueId,
    class: &str,
    message: &str,
) -> Result<(), Diagnostic> {
    if builder.raises
        || builder.a_handler_in_this_function_would_catch()
        || builder.async_result.is_some()
    {
        return builder.refuse_when(id, condition, class, message);
    }
    let rejected = builder.new_block();
    let accepted = builder.new_block();
    builder.terminate(super::super::Terminator::Branch {
        cond: condition,
        then_target: rejected,
        then_args: Vec::new(),
        else_target: accepted,
        else_args: Vec::new(),
    });
    builder.switch_to(rejected);
    builder.run_finallys_to(0)?;
    if !builder.is_terminated() {
        let origin = builder.origin(id);
        let reason = builder.push(
            OpKind::ConstString(message.to_owned()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        builder.runtime_call("nts_assertion_failed", vec![reason], HirType::Void, origin);
        builder.terminate(super::super::Terminator::Unreachable);
    }
    builder.switch_to(accepted);
    Ok(())
}
