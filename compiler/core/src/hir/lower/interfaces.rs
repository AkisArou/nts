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
    // Optional methods retain `undefined` in their property type even after
    // the caller has checked presence. Absence decides availability, not the
    // dispatch ABI. Only one callable plus absences proves that ABI; multiple
    // callables and noncallable union arms do not.
    let ty = match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Union(members) => {
            let mut present = members.iter().filter(|member| {
                !matches!(
                    snapshot
                        .types
                        .get(member.0 as usize)
                        .map(|record| &record.kind),
                    Some(TypeKind::Null | TypeKind::Undefined)
                )
            });
            let only = *present.next()?;
            if present.next().is_some() {
                return None;
            }
            only
        }
        _ => ty,
    };
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
/// A class body may also have an owned written optional erased tail. Literal
/// supplies retain `fits_contracts`, whose uniform adapters have a separate ABI.
pub(super) fn fits(
    probe: &FuncBuilder,
    hierarchy: &Hierarchy,
    mine: &PropertyRecord,
    wanted: &PropertyRecord,
) -> bool {
    let property = mine;
    let (Some(mine), Some(wanted)) = (contract(probe, mine), contract(probe, wanted)) else {
        return false;
    };
    (mine.params.len() <= wanted.params.len()
        || optional_tail(probe, property, &mine, wanted.params.len()).is_some())
        && fits_prefix(probe.snapshot, hierarchy, &mine, &wanted)
}

pub(super) fn fits_contracts(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    mine: &Contract,
    wanted: &Contract,
) -> bool {
    mine.params.len() <= wanted.params.len() && fits_prefix(snapshot, hierarchy, mine, wanted)
}

fn fits_prefix(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    mine: &Contract,
    wanted: &Contract,
) -> bool {
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

/// Permission to fill a class implementation's missing arguments. The body
/// and every parameter are bound to owned written nodes, not optional bits on
/// a signature. This is intentionally unavailable to literal-method admission.
#[derive(Debug)]
pub(super) struct OptionalTail {
    body: super::Location,
    params: Vec<Param>,
    first: usize,
}

impl OptionalTail {
    pub(super) fn matches(&self, target: &super::Func, supplied: usize) -> bool {
        supplied == self.first + 1
            && target.origin.generated.is_none()
            && target.origin.location == self.body
            && target.params.len() == self.params.len() + 1
            && target
                .params
                .iter()
                .skip(1)
                .zip(&self.params)
                .all(|(actual, written)| {
                    actual.ty == written.ty
                        && actual.shape == written.shape
                        && actual.written == written.written
                        && actual.origin.generated.is_none()
                        && actual.origin.location == written.origin.location
                })
    }
}

fn class_body(probe: &FuncBuilder, property: &PropertyRecord, declaration: super::NodeId) -> bool {
    let Some(parent) = probe.syntactic_parent(declaration) else {
        return false;
    };
    if !probe.kind_of(parent).is_some_and(super::declares_a_class)
        || probe.kind_of(declaration) != Some(super::syntax::METHOD_DECLARATION)
        || probe.origin(declaration).generated.is_some()
        || probe
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        || probe
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::GENERATOR)
        || probe.children(declaration).iter().any(|child| {
            matches!(
                probe.kind_of(*child),
                Some(super::syntax::TYPE_PARAMETER | super::syntax::ASTERISK_TOKEN)
            )
        })
    {
        return false;
    }
    let implementations: Vec<_> = probe
        .children(parent)
        .into_iter()
        .filter(|child| {
            probe.kind_of(*child) == Some(super::syntax::METHOD_DECLARATION)
                && probe.member_key(*child).as_ref() == Some(&property.name)
                && probe.has_a_body(*child)
        })
        .collect();
    implementations.as_slice() == [declaration]
}

fn written_params(
    probe: &FuncBuilder,
    declaration: super::NodeId,
    expected: &[Param],
    supplied: usize,
) -> Option<Vec<Param>> {
    let nodes = super::parameters_of(probe, declaration);
    if nodes.len() != expected.len() || supplied >= expected.len() {
        return None;
    }
    let mut params = expected.to_vec();
    for (at, (parameter, param)) in nodes.iter().zip(&mut params).enumerate() {
        let name = probe.name_node(*parameter)?;
        let source = probe.snapshot.node_types.get(&name)?;
        if probe.kind_of(name) != Some(super::syntax::IDENTIFIER)
            || probe.origin(name).generated.is_some()
            || param.ty != in_a_slot(probe.represent(*source)?)
            || param.written != probe.written_kind(name)
            || param.shape != written_shape(probe, *parameter)
        {
            return None;
        }
        param.origin = probe.origin(name);
        if at >= supplied && !written_omittable(probe, *parameter, param) {
            return None;
        }
    }
    Some(params)
}

fn written_shape(probe: &FuncBuilder, node: super::NodeId) -> ParamShape {
    let children = probe.children(node);
    if children
        .iter()
        .any(|child| probe.kind_of(*child) == Some(super::syntax::DOT_DOT_DOT_TOKEN))
    {
        ParamShape::Rest
    } else if probe.default_of(node).is_some() {
        ParamShape::Defaulted
    } else if children
        .iter()
        .any(|child| probe.kind_of(*child) == Some(super::syntax::QUESTION_TOKEN))
    {
        ParamShape::Optional
    } else {
        ParamShape::Ordinary
    }
}

fn optional_tail(
    probe: &FuncBuilder,
    property: &PropertyRecord,
    contract: &Contract,
    supplied: usize,
) -> Option<OptionalTail> {
    let declaration = property.declaration?;
    if !class_body(probe, property, declaration)
        || probe.implementation_of(declaration) != declaration
    {
        return None;
    }
    Some(OptionalTail {
        body: probe.location(declaration),
        params: written_params(probe, declaration, &contract.params, supplied)?,
        first: supplied,
    })
}

fn written_omittable(probe: &FuncBuilder, node: super::NodeId, param: &Param) -> bool {
    param.ty == HirType::Erased
        && param.shape == ParamShape::Optional
        && param.written.is_none()
        && probe.default_of(node).is_none()
        && probe
            .children(node)
            .iter()
            .any(|child| probe.kind_of(*child) == Some(super::syntax::QUESTION_TOKEN))
        && !probe
            .children(node)
            .iter()
            .any(|child| probe.kind_of(*child) == Some(super::syntax::DOT_DOT_DOT_TOKEN))
}

/// Join the actual receiver property to its unique owned implementation body.
/// An overloaded callable's primary signature is NOT that body's contract.
fn bound_body(
    probe: &FuncBuilder,
    property: &PropertyRecord,
    target: &super::Func,
) -> Option<super::NodeId> {
    let declaration = property.declaration?;
    let symbol = probe.node(declaration).symbol.or_else(|| {
        probe
            .name_node(declaration)
            .and_then(|name| probe.node(name).symbol)
    });
    let mut candidates: Vec<_> = symbol
        .and_then(|symbol| probe.snapshot.symbols.get(symbol.0 as usize))
        .into_iter()
        .flat_map(|symbol| &symbol.declarations)
        .copied()
        .chain(std::iter::once(declaration))
        .filter(|node| {
            probe.location(*node) == target.origin.location && class_body(probe, property, *node)
        })
        .collect();
    candidates.sort_unstable();
    candidates.dedup();
    let [body] = candidates.as_slice() else {
        return None;
    };
    Some(*body)
}

/// Recheck a previously bound target using written body/parameter provenance,
/// independently of generic/overloaded property signatures. CLASS inference
/// still uses `contract` and keeps all of its existing exclusions.
pub(super) fn target_optional_tail(
    probe: &FuncBuilder,
    member: &super::MemberKey,
    target: &super::Func,
    supplied: usize,
) -> Option<OptionalTail> {
    if target.params.len() <= supplied {
        return None;
    }
    let HirType::Managed(ManagedType::Object(receiver)) = &target.params.first()?.ty else {
        return None;
    };
    let TypeKind::Object { properties } = &probe.snapshot.types.get(receiver.0 as usize)?.kind
    else {
        return None;
    };
    let mut properties = properties
        .iter()
        .filter(|property| property.name == member.key);
    let property = properties.next()?;
    if properties.next().is_some() {
        return None;
    }
    let body = bound_body(probe, property, target)?;
    let first = supplied.checked_sub(1)?;
    let tail = OptionalTail {
        body: probe.location(body),
        params: written_params(probe, body, &target.params[1..], first)?,
        first,
    };
    tail.matches(target, supplied).then_some(tail)
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
        TypeKind::Symbol | TypeKind::UniqueSymbol => 16,
        TypeKind::Null => 32,
        TypeKind::Undefined | TypeKind::Void => 64,
        TypeKind::Union(arms) => arms.iter().try_fold(0, |found, arm| {
            Some(found | primitive_families(snapshot, *arm, depth + 1)?)
        })?,
        // `never` fits every result; intersections can be branded primitives.
        // Neither is evidence that this candidate cannot reach the face.
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive => return None,
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

/// A field write must preserve both the implementation's semantic input facts
/// and its storage ABI. Equal machine types alone do not license narrowing.
pub(super) fn stores(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    from: TypeId,
    to: TypeId,
    from_storage: &HirType,
    to_storage: &HirType,
) -> bool {
    widens(snapshot, hierarchy, from, to, 0)
        && converts(snapshot, hierarchy, from_storage, to_storage)
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
        | (TypeKind::Symbol | TypeKind::UniqueSymbol, TypeKind::Symbol)
        | (TypeKind::Undefined, TypeKind::Undefined)
        | (TypeKind::Null, TypeKind::Null)
        | (TypeKind::Void, TypeKind::Void) => true,
        (TypeKind::Literal(one), TypeKind::Literal(other)) => one == other,
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        (TypeKind::UniqueSymbol, TypeKind::UniqueSymbol) => false,
        // A unique symbol can widen to symbol above; object is a supertype of
        // reference values, not a new generated hierarchy node here.
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        (TypeKind::NonPrimitive, _) | (_, TypeKind::NonPrimitive) => false,
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

pub(super) use super::super::native::schema::property_key as property;

/// A declaration belongs to the interface, including every parameter value
/// op. Materialize its referenced layouts before completing callable entries.
pub(super) fn declaration(
    builder: &mut FuncBuilder,
    root: TypeId,
    member: &super::MemberKey,
    body: &super::Func,
    name: &str,
) -> Option<super::Func> {
    let property = property(builder.snapshot, root, &member.key)?;
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
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => Vec::new(),
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

#[cfg(test)]
mod tests {
    use nts_semantic_schema::{SignatureId, TypeRecord};

    use super::*;

    #[test]
    fn optional_callable_projection_does_not_prove_other_unions() {
        let mut snapshot = SemanticSnapshot::default();
        let signature = |returned| SignatureRecord {
            parameters: Vec::new(),
            return_type: TypeId(returned),
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        snapshot.signatures = vec![signature(2), signature(0)];
        let union =
            |members: &[u32]| TypeKind::Union(members.iter().copied().map(TypeId).collect());
        snapshot.types = vec![
            TypeKind::Undefined,
            TypeKind::Null,
            TypeKind::Number,
            TypeKind::Function(SignatureId(0)),
            TypeKind::Function(SignatureId(1)),
            union(&[0, 3]),
            union(&[1, 3, 0]),
            union(&[3, 4]),
            union(&[3, 2]),
            union(&[0, 1]),
            union(&[10, 3]),
            union(&[3, 99]),
        ]
        .into_iter()
        .map(|kind| TypeRecord { kind, symbol: None })
        .collect();
        for ty in [3, 5, 6] {
            assert_eq!(signature_of(&snapshot, ty), snapshot.signatures.first());
        }
        for ty in [7, 8, 9, 10, 11] {
            assert!(signature_of(&snapshot, ty).is_none(), "unproved type {ty}");
        }
    }

    fn signature_of(snapshot: &SemanticSnapshot, ty: u32) -> Option<&SignatureRecord> {
        super::signature(snapshot, TypeId(ty))
    }
}
