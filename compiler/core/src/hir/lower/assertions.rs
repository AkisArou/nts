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
}

/// The check an `as` needs before its payload is read. `x!` has none: it is a
/// claim about the type, and `digits().at(99)!` is `undefined` in node, which
/// the program goes on to use; only a read whose slot cannot hold the absence
/// traps (see `lower_element_access`).
fn check(probe: &FuncBuilder<'_>, id: NodeId) -> Option<Check> {
    if probe.kind_of(id) != Some(syntax::AS_EXPRESSION) {
        return None;
    }
    let target = probe.type_of(id)?;
    let tag = match &target {
        HirType::Bool => tags::BOOLEAN,
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

fn is_nominal_class(probe: &FuncBuilder<'_>, ty: TypeId) -> bool {
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
    // Widening to unknown keeps the value's own representation, as every
    // unchecked assertion does: `strings as unknown as string[]` must still
    // meet the refusal between a template object and an array, which erasing
    // here would launder into an unchecked unerase.
    if builder.type_of(id) == Some(HirType::Erased) {
        if actual_is_unerasable(builder, value) {
            return Err(builder.unsupported(
                id,
                "an assertion to unknown from a value with no erased representation",
            ));
        }
        return builder.narrowed(id, value);
    }
    if check(builder, id).is_some() && actual_is_unerasable(builder, value) {
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
            builder.refuse_when(
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
            builder.refuse_when(
                id,
                mismatch,
                "TypeError",
                "The asserted native class does not match the value",
            )?;
            return Ok(builder.push(OpKind::Unerase { value: erased }, target, origin));
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
            builder.refuse_when(
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
