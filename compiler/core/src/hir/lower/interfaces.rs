//! Structural method contracts, shared by inference and table adaptation.
//!
//! TypeScript's bivariant method parameters permit narrowing an input. That
//! would require an unchecked unerase or downcast, so it deliberately does not
//! fit here. Free object conversions follow `extends` only: an interface edge
//! contributes no storage and cannot promise a compatible field prefix.
use nts_semantic_schema::{ParameterRecord, SignatureRecord};

use super::{FuncBuilder, Hierarchy, PropertyRecord, SemanticSnapshot, TypeId, TypeKind};
use super::{HirType, ManagedType, Param, ParamShape, in_a_slot};

/// Callable faces share the uniform ABI. This equivalence is shared by
/// direct-body projections and stored-literal adapters.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) enum AbiType {
    Callable,
    Concrete(HirType),
}

pub(super) fn abi_type(snapshot: &SemanticSnapshot, ty: &HirType) -> AbiType {
    if let HirType::Managed(ManagedType::Object(id)) = ty
        && signature(snapshot, *id).is_some()
    {
        return AbiType::Callable;
    }
    AbiType::Concrete(ty.clone())
}

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
    contract_at(probe, member.ty, member.declaration)
}

/// A concrete literal supply keeps its own signature and parameter nodes.
/// Its contextual owner's signature can hide bivariant parameter narrowing.
pub(super) fn contract_at(
    probe: &FuncBuilder,
    ty: TypeId,
    declaration: Option<super::NodeId>,
) -> Option<Contract> {
    let snapshot = probe.snapshot;
    let signature = signature(snapshot, ty)?;
    if !signature.type_parameters.is_empty() || signature.parameters.iter().any(|p| p.rest) {
        return None;
    }
    if declaration.is_some_and(|at| probe.implementation_of(at) != at) {
        return None;
    }
    let nodes = declaration.map(|at| super::parameters_of(probe, at));
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
    fits_contracts(probe.snapshot, hierarchy, &mine, &wanted)
}

pub(super) fn fits_contracts(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    mine: &Contract,
    wanted: &Contract,
) -> bool {
    if mine.params.len() > wanted.params.len() {
        return false;
    }
    let inputs =
        mine.params
            .iter()
            .zip(&wanted.params)
            .enumerate()
            .all(|(at, (mine_param, slot))| {
                widens(snapshot, hierarchy, wanted.sources[at], mine.sources[at], 0)
                    && converts(snapshot, hierarchy, &slot.ty, &mine_param.ty)
            });
    inputs
        && (wanted.returns == HirType::Void
            || (widens(snapshot, hierarchy, mine.result, wanted.result, 0)
                && converts(snapshot, hierarchy, &mine.returns, &wanted.returns)))
}

/// Could TypeScript pass this method as the wanted one, even under parameter
/// bivariance? Only provably disjoint primitive families exclude a candidate.
/// Objects, unknown contracts and narrowing inputs still participate in the
/// all-or-none check. Classes and literals use this same candidacy predicate.
pub(super) fn candidate(
    probe: &FuncBuilder,
    mine: &PropertyRecord,
    wanted: &PropertyRecord,
) -> bool {
    let (Some(mine), Some(wanted)) = (contract(probe, mine), contract(probe, wanted)) else {
        return true;
    };
    let disjoint = |one, other| match (
        primitive_families(probe.snapshot, one, 0),
        primitive_families(probe.snapshot, other, 0),
    ) {
        (Some(one), Some(other)) => one & other == 0,
        _ => false,
    };
    (wanted.returns == HirType::Void || !disjoint(mine.result, wanted.result))
        && mine
            .sources
            .iter()
            .zip(&wanted.sources)
            .all(|(mine, wanted)| !disjoint(*mine, *wanted))
}

fn primitive_families(snapshot: &SemanticSnapshot, ty: TypeId, depth: u32) -> Option<u8> {
    use super::LiteralValue;
    if depth >= 16 {
        return None;
    }
    Some(match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => 1,
        TypeKind::String
        | TypeKind::Literal(LiteralValue::String(_))
        | TypeKind::TemplateLiteral { .. } => 2,
        TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => 4,
        TypeKind::BigInt | TypeKind::Literal(LiteralValue::BigInt(_)) => 8,
        TypeKind::Symbol => 16,
        TypeKind::Null => 32,
        TypeKind::Undefined | TypeKind::Void => 64,
        TypeKind::Union(arms) => arms.iter().try_fold(0, |found, arm| {
            Some(found | primitive_families(snapshot, *arm, depth + 1)?)
        })?,
        // `never` fits every result; intersections can be branded primitives.
        // Neither is evidence that this candidate cannot reach the face.
        _ => return None,
    })
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
