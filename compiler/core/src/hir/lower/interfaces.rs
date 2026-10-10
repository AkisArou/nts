//! Structural method contracts, shared by inference and table adaptation.
//!
//! TypeScript's bivariant method parameters permit narrowing an input. That
//! would require an unchecked unerase or downcast, so it deliberately does not
//! fit here. Free object conversions follow `extends` only: an interface edge
//! contributes no storage and cannot promise a compatible field prefix.
use nts_semantic_schema::{ParameterRecord, SignatureRecord};

use super::{FuncBuilder, Hierarchy, PropertyRecord, SemanticSnapshot, TypeId, TypeKind};
use super::{HirType, ManagedType, Param, ParamShape, in_a_slot};

/// The actual parameter storage, together with the types licensing conversion.
#[derive(Debug)]
pub(super) struct Contract {
    pub params: Vec<Param>,
    pub sources: Vec<TypeId>,
    pub result: TypeId,
    pub returns: HirType,
}

pub(super) fn signature(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&SignatureRecord> {
    let TypeKind::Function(at) = snapshot.types.get(ty.0 as usize)?.kind else {
        return None;
    };
    snapshot.signatures.get(at.0 as usize)
}

/// An overload, generic method or rest expansion needs a different contract.
pub(super) fn contract(probe: &FuncBuilder, member: &PropertyRecord) -> Option<Contract> {
    let snapshot = probe.snapshot;
    let signature = signature(snapshot, member.ty)?;
    if !signature.type_parameters.is_empty() || signature.parameters.iter().any(|p| p.rest) {
        return None;
    }
    if member
        .declaration
        .is_some_and(|at| probe.implementation_of(at) != at)
    {
        return None;
    }
    let nodes = member.declaration.map(|at| super::parameters_of(probe, at));
    if nodes
        .as_ref()
        .is_some_and(|nodes| nodes.len() != signature.parameters.len())
    {
        return None;
    }
    let mut params = Vec::new();
    let mut sources = Vec::new();
    for (at, parameter) in signature.parameters.iter().enumerate() {
        let node = nodes.as_ref().and_then(|nodes| nodes.get(at)).copied();
        let (param, source) = parameter_contract(probe, parameter, node)?;
        params.push(param);
        sources.push(source);
    }
    Some(Contract {
        params,
        sources,
        result: signature.return_type,
        returns: probe.represent(signature.return_type)?,
    })
}

fn parameter_contract(
    probe: &FuncBuilder,
    parameter: &ParameterRecord,
    node: Option<super::NodeId>,
) -> Option<(Param, TypeId)> {
    // A name's type includes the absence of an optional parameter; the call
    // signature may omit it. A defaulted parameter's name excludes it instead.
    let name = node.and_then(|node| {
        probe.children(node).into_iter().find(|child| {
            matches!(
                probe.kind_of(*child),
                Some(
                    super::syntax::IDENTIFIER
                        | super::syntax::OBJECT_BINDING_PATTERN
                        | super::syntax::ARRAY_BINDING_PATTERN
                )
            )
        })
    });
    let source = name
        .and_then(|name| probe.snapshot.node_types.get(&name).copied())
        .filter(|ty| probe.represent(*ty).is_some())
        .unwrap_or(parameter.ty);
    let ty = in_a_slot(probe.represent(source)?);
    let shape = if node.is_some_and(|node| probe.default_of(node).is_some()) {
        ParamShape::Defaulted
    } else if parameter.optional {
        ParamShape::Optional
    } else {
        ParamShape::Ordinary
    };
    let origin = node.map_or_else(
        || {
            nts_semantic_schema::Origin::generated(
                super::Location {
                    file: nts_diagnostics::SourceId(0),
                    span: nts_diagnostics::Span::new(0, 0),
                },
                nts_semantic_schema::GeneratedReason::AbiProjection,
            )
        },
        |node| probe.origin(node),
    );
    Some((
        Param {
            name: parameter.name.clone(),
            ty,
            origin,
            shape,
            known: super::known_values(probe.snapshot, source, 0),
            written: super::super::native::present_scalar(probe.snapshot, source),
        },
        source,
    ))
}

/// Whether every input can widen into the body and its answer into the slot.
/// Additional optional implementation parameters remain a future relaxation:
/// they need explicit undefined arguments, which this contract never invents.
pub(super) fn fits(
    probe: &FuncBuilder,
    hierarchy: &Hierarchy,
    mine: &PropertyRecord,
    wanted: &PropertyRecord,
) -> bool {
    let (Some(mine), Some(wanted)) = (contract(probe, mine), contract(probe, wanted)) else {
        return false;
    };
    if mine.params.len() > wanted.params.len() {
        return false;
    }
    let inputs =
        mine.params
            .iter()
            .zip(&wanted.params)
            .enumerate()
            .all(|(at, (mine_param, slot))| {
                widens(
                    probe.snapshot,
                    hierarchy,
                    wanted.sources[at],
                    mine.sources[at],
                    0,
                ) && converts(probe.snapshot, hierarchy, &slot.ty, &mine_param.ty)
            });
    inputs
        && (wanted.returns == HirType::Void
            || (widens(probe.snapshot, hierarchy, mine.result, wanted.result, 0)
                && converts(probe.snapshot, hierarchy, &mine.returns, &wanted.returns)))
}

/// A representation conversion with no test and no structural storage guess.
pub(super) fn converts(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    from: &HirType,
    to: &HirType,
) -> bool {
    if from == to || *to == HirType::Void {
        return true;
    }
    if *to == HirType::Erased {
        return super::result_crosses(from);
    }
    match (from, to) {
        (
            HirType::Managed(ManagedType::Object(one)),
            HirType::Managed(ManagedType::Object(other)),
        ) => {
            hierarchy.descends(*one, *other)
                || (signature(snapshot, *one).is_some() && signature(snapshot, *other).is_some())
        }
        _ => false,
    }
}

/// Conservative semantic widening, rather than equality of machine types.
/// `3` and `number` both represent as f64, but only one direction preserves the
/// parameter facts which the optimizer is entitled to trust inside the body.
fn widens(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    from: TypeId,
    to: TypeId,
    depth: u32,
) -> bool {
    if from == to {
        return true;
    }
    if depth >= 32 {
        return false;
    }
    let kind = |ty: TypeId| snapshot.types.get(ty.0 as usize).map(|record| &record.kind);
    let (Some(from_kind), Some(to_kind)) = (kind(from), kind(to)) else {
        return false;
    };
    let next = |from, to| widens(snapshot, hierarchy, from, to, depth + 1);
    match (from_kind, to_kind) {
        (TypeKind::Union(members), _) => members.iter().all(|member| next(*member, to)),
        (_, TypeKind::Union(members)) => members.iter().any(|member| next(from, *member)),
        (_, TypeKind::Intersection(members)) => members.iter().all(|member| next(from, *member)),
        (TypeKind::Intersection(members), _) => members.iter().any(|member| next(*member, to)),
        (TypeKind::Object { .. }, TypeKind::Object { .. }) => hierarchy.descends(from, to),
        (TypeKind::Function(_), TypeKind::Function(_)) => {
            callable_widens(snapshot, hierarchy, from, to, depth + 1)
        }
        (_, TypeKind::Unknown)
        | (TypeKind::Never, _)
        | (
            TypeKind::Literal(super::LiteralValue::Number(_)) | TypeKind::Number,
            TypeKind::Number,
        )
        | (
            TypeKind::Literal(super::LiteralValue::Boolean(_)) | TypeKind::Boolean,
            TypeKind::Boolean,
        )
        | (
            TypeKind::Literal(super::LiteralValue::String(_)) | TypeKind::String,
            TypeKind::String,
        )
        | (
            TypeKind::Literal(super::LiteralValue::BigInt(_)) | TypeKind::BigInt,
            TypeKind::BigInt,
        )
        | (TypeKind::Symbol, TypeKind::Symbol)
        | (TypeKind::Undefined, TypeKind::Undefined)
        | (TypeKind::Null, TypeKind::Null)
        | (TypeKind::Void, TypeKind::Void) => true,
        (TypeKind::Literal(one), TypeKind::Literal(other)) => one == other,
        _ => false,
    }
}

fn callable_widens(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    from: TypeId,
    to: TypeId,
    depth: u32,
) -> bool {
    let (Some(from), Some(to)) = (signature(snapshot, from), signature(snapshot, to)) else {
        return false;
    };
    from.type_parameters.is_empty()
        && to.type_parameters.is_empty()
        && from.parameters.len() <= to.parameters.len()
        && from
            .parameters
            .iter()
            .zip(&to.parameters)
            .all(|(from, to)| {
                !from.rest
                    && !to.rest
                    && from.optional == to.optional
                    && widens(snapshot, hierarchy, to.ty, from.ty, depth)
            })
        && (snapshot
            .types
            .get(to.return_type.0 as usize)
            .is_some_and(|record| record.kind == TypeKind::Void)
            || widens(snapshot, hierarchy, from.return_type, to.return_type, depth))
}

pub(super) fn property<'a>(
    snapshot: &'a SemanticSnapshot,
    owner: TypeId,
    member: &str,
) -> Option<&'a PropertyRecord> {
    let TypeKind::Object { properties } = &snapshot.types.get(owner.0 as usize)?.kind else {
        return None;
    };
    properties.iter().find(|property| property.name == member)
}

/// Literal owners come from the same contextual-type decision as their bodies.
/// Anonymous owners already registered as concrete candidates have table rows.
/// A literal lowered under a named interface needs Part 1c's separate plan;
/// admitting a class beside it must not open a slot that its value cannot fill.
pub(super) fn uncovered_literals(hierarchy: &Hierarchy, classes: &[TypeId]) -> Vec<TypeId> {
    let mut owners: Vec<_> = hierarchy
        .literal_owners
        .iter()
        .copied()
        .filter(|owner| {
            classes
                .binary_search_by_key(&owner.0, |class| class.0)
                .is_err()
        })
        .collect();
    owners.sort_unstable_by_key(|owner| owner.0);
    owners
}

pub(super) fn literal_blocks(
    snapshot: &SemanticSnapshot,
    owners: &[TypeId],
    wanted: &[PropertyRecord],
) -> bool {
    owners.iter().any(|owner| {
        wanted
            .iter()
            .all(|member| member.optional || property(snapshot, *owner, &member.name).is_some())
    })
}

/// A declaration belongs to the interface, including every parameter value
/// op. Materialize its referenced layouts before completing callable entries.
pub(super) fn declaration(
    builder: &mut FuncBuilder,
    root: TypeId,
    member: &str,
    body: &super::Func,
    name: &str,
) -> Option<super::Func> {
    let property = property(
        builder.snapshot,
        root,
        super::without_the_raising_suffix(member).0,
    )?;
    let contract = contract(builder, property)?;
    let at = property.declaration.unwrap_or(super::NodeId(0));
    for param in &contract.params {
        builder.materialize(at, &param.ty).ok()?;
    }
    builder.materialize(at, &contract.returns).ok()?;
    let mut shell =
        super::declaration_shell(body, name, HirType::Managed(ManagedType::Object(root)));
    shell.params.truncate(1);
    shell.params.extend(contract.params);
    shell.return_type = contract.returns;
    shell.written_return = super::super::native::present_scalar(builder.snapshot, contract.result);
    shell.written_return_elements = match builder
        .snapshot
        .types
        .get(contract.result.0 as usize)
        .map(|record| &record.kind)
    {
        Some(TypeKind::Tuple(elements)) => elements
            .iter()
            .map(|ty| super::super::native::present_scalar(builder.snapshot, *ty))
            .collect(),
        _ => Vec::new(),
    };
    shell.values = shell
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| super::Op {
            kind: super::OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX)),
            ty: param.ty.clone(),
            origin: param.origin.clone(),
        })
        .collect();
    Some(shell)
}
