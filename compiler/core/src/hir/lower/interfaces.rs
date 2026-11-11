//! Structural method contracts, shared by inference and table adaptation.
//!
//! TypeScript's bivariant method parameters permit narrowing an input. That
//! would require an unchecked unerase or downcast, so it deliberately does not
//! fit here. Free object conversions follow `extends` only: an interface edge
//! contributes no storage and cannot promise a compatible field prefix.
use super::{
    Block, BuilderLayouts, Func, LayoutCollector, MemberKey, NodeId, NodeKind, Program,
    RAISING_SUFFIX, SymbolId, Terminator, cast_descriptions, collect_carried_protocols,
    declares_a_class, instance_type_of, instantiation_suffix, is_anonymous_shape,
    member_dispatch_key, named, nominal_or_stand_in, syntax, the_function_of,
};
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
            .elements
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

#[expect(
    clippy::too_many_lines,
    reason = "keep semantic text and key projection beside its existing dispatch"
)]
pub(super) fn collect_interfaces(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &mut Hierarchy,
    instantiations: &rustc_hash::FxHashMap<SymbolId, Vec<crate::hir::generics::Instantiation>>,
) {
    let carried = collect_carried_protocols(snapshot, hierarchy);
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::INTERFACE_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(ty) = snapshot.node_types.get(&id).copied() else {
            continue;
        };
        if let Some(name) = probe
            .children(id)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| {
                probe
                    .node(child)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
        {
            hierarchy.name.entry(ty).or_insert(name);
        }
        let declared: Vec<MemberKey> = probe
            .children(id)
            .into_iter()
            .filter_map(|child| {
                // A `PROPERTY_SIGNATURE` whose type is a function is a field
                // holding a closure rather than a method, and is not a dispatch
                // root: it is read and called, which the closure path handles.
                if probe.kind_of(child) != Some(syntax::METHOD_SIGNATURE) {
                    return None;
                }
                member_dispatch_key(probe, child)
            })
            .collect();
        hierarchy.faces.insert(ty);
        if let Some(instances) = snapshot
            .types
            .get(ty.0 as usize)
            .and_then(|record| record.symbol)
            .and_then(|symbol| instantiations.get(&symbol))
        {
            let name = hierarchy.name.get(&ty).cloned();
            for instance in instances {
                if instance.ty != ty {
                    hierarchy.face_instances.insert(instance.ty, ty);
                    if let Some(name) = &name {
                        hierarchy.name.entry(instance.ty).or_insert_with(|| {
                            format!("{name}{}", instantiation_suffix(snapshot, instance.ty))
                        });
                    }
                }
            }
        }
        if !declared.is_empty() {
            hierarchy.declares.entry(ty).or_insert(declared);
        }
        // An interface that extends others: the same edge, so a slot can be
        // numbered against the highest one.
        if let Some(bases) = snapshot.base_types.get(&ty) {
            hierarchy.implements.insert(ty, bases.clone());
        }
    }
    collect_cast_faces(snapshot, probe, hierarchy);
    // Every class's `implements` list, read from the heritage clause.
    //
    // NOT from `base_types`, whose documentation says "`extends` first, then
    // `implements`" and which in fact carries neither for a class that only
    // implements: `class Counting implements Sink` has no entry at all. That
    // was measured rather than assumed, after the slot it should have produced
    // did not appear.
    //
    // The keyword is not read either. A heritage target that is a known
    // interface is an `implements` edge and one that is a class is an
    // `extends`, and which it is has already been decided by the pass above --
    // so this asks the question the compiler can answer rather than the one the
    // token spells.
    let interfaces: rustc_hash::FxHashSet<TypeId> = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.kind == NodeKind::Syntax(syntax::INTERFACE_DECLARATION))
        .filter_map(|(index, _)| {
            snapshot
                .node_types
                .get(&NodeId(u32::try_from(index).unwrap_or(u32::MAX)))
                .copied()
        })
        .collect();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if !matches!(node.kind, NodeKind::Syntax(kind) if declares_a_class(kind)) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(ty) = instance_type_of(snapshot, id) else {
            continue;
        };
        // **A carried protocol counts as a known interface.** `interfaces` is
        // the set of types some `INTERFACE_DECLARATION` node declares, and
        // `Iterable<T>` has no node -- so `class BatchSyncSource implements
        // SyncByteStream`, where the alias is `Iterable<ByteBatch>`, recorded
        // no edge at all. The class said what it implements, in the source,
        // and the compiler dropped it for want of a node to point at.
        //
        // Thirty-one classes in `runtime/node` and `runtime/web-platform`
        // write one of these, directly or through an alias, and each is a
        // dispatch table that could not be filled: the interface's method had
        // no implementer to take a body from, so `declare_interface_methods`
        // declared nothing and every call through the interface reported the
        // shell missing.
        let faces: Vec<TypeId> = probe
            .children(id)
            .into_iter()
            .filter(|child| probe.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE))
            .flat_map(|clause| probe.children(clause))
            .filter_map(|target| snapshot.node_types.get(&target).copied())
            .flat_map(|target| {
                let carried = carried.resolve(snapshot, target);
                if carried.is_empty() {
                    vec![target]
                } else {
                    carried.to_vec()
                }
            })
            .filter(|target| interfaces.contains(target) || hierarchy.declares.contains_key(target))
            .collect();
        if !faces.is_empty() {
            hierarchy.implements.insert(ty, faces);
        }
    }
}

/// Only a target whose existing representation is Managed(Object(target))
/// can become a cast face. Native brands and other managed kinds keep their
/// own representation; an assertion can never erase their safety checks.
fn collect_cast_faces(snapshot: &SemanticSnapshot, probe: &FuncBuilder, hierarchy: &mut Hierarchy) {
    let mut descriptions = cast_descriptions::Descriptions::new(snapshot);
    // **And an anonymous object type a cast reads an erased value as.** `caught
    // as { stack?: string }` checks nothing at run time, so the object that
    // arrives may be laid out any way at all -- an unrelated class, a literal
    // without the field -- and a read at the type's own index took whatever sat
    // there: a wrong answer, and since a class lays its parameter properties out
    // first, a SIGSEGV (`tests/programs/a-structural-cast-of-an-erased-object-
    // reads-another-field`). As a face its reads go through a field family,
    // dispatched by the object's own layout, with `undefined` where the object
    // has no such field, which is what JavaScript reads. Only a cast of an
    // erased value: a cast between two representations the checker relates is
    // a conversion `narrowed` makes or refuses, and reads its own layout.
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let operand_at = match node.kind {
            NodeKind::Syntax(syntax::AS_EXPRESSION) => 0,
            NodeKind::Syntax(syntax::TYPE_ASSERTION_EXPRESSION) => 1,
            _ => continue,
        };
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(target) = snapshot.node_types.get(&id).copied() else {
            continue;
        };
        let anonymous = matches!(
            snapshot
                .types
                .get(target.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Object { .. })
        ) && (named(snapshot, target).is_none()
            || is_anonymous_shape(snapshot, target));
        if !anonymous
            || hierarchy.faces.contains(&target)
            || probe.represent(target) != Some(HirType::Managed(ManagedType::Object(target)))
        {
            continue;
        }
        let erased = probe
            .children(id)
            .get(operand_at)
            .and_then(|operand| snapshot.node_types.get(operand))
            .is_some_and(|operand| probe.represent(*operand) == Some(HirType::Erased));
        if erased {
            hierarchy
                .name
                .entry(target)
                .or_insert_with(|| nominal_or_stand_in(snapshot, target));
            hierarchy.faces.insert(target);
            hierarchy.cast_faces.insert(target);
            hierarchy.cast_descriptions.insert(
                target,
                std::sync::Arc::from(descriptions.describe(probe, id, operand_at, target)),
            );
        }
    }
}

/// Every class that has an interface's methods, with signatures one dispatch
/// slot can carry, implements it (`docs/records/notebooks/interfaces-by-shape.md`, Part 1).
///
/// TypeScript is structurally typed: `class C { go(): number }` satisfies
/// `interface S { go(): number }` without writing `implements S`, and a call
/// through `S` on a `C` is ordinary. Dispatch here is by edge -- the slot is
/// numbered against `S` and every implementer fills it (record 0201) -- and the
/// edge came from the heritage clause alone, so `take(s: S) { return s.go() }`
/// was refused whenever no class *wrote* `implements S`: `S#go` had no body to
/// declare (`tests/programs/a-method-through-a-structural-interface`).
///
/// Inferred for the whole program before any slot is numbered, so everything
/// after -- `overridden`, the slot loop, the tables, `Layout::interfaces` and so
/// the JVM's `implements` list and `interface_fields`' guard -- sees an inferred
/// edge as it sees a written one. Every declared member must be present,
/// including optional methods. Each method either carries the slot's ABI or
/// admits a projection: fewer inputs, widening into erased storage, an
/// `extends` upcast, a narrower result, or void becoming undefined. The slot
/// keeps the interface's signature; `virtual_returns` fills it with an adapter.
/// A candidate needing an unchecked narrowing or a structural storage cast
/// blocks inference for the whole interface, for the reason the loop below
/// gives: otherwise dispatch on that candidate could reach an empty entry.
///
/// A literal's inferred row is licensed by every actual initial supply and
/// possible write. Mixed method-value and invocation faces retain the previous
/// class candidate set and source-copy behavior until an accessor can return
/// the original closure. The classification is shared with call routing.
///
/// Literal implementations in external host programs (`URLParser`, `RandomSource`
/// and `CancelHandle`) cannot fill a row in this compilation; inference only
/// considers allocations and declarations present in the whole program.
pub(super) fn infer_implements(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &mut Hierarchy,
) {
    let properties = |ty: TypeId| match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Object { properties } => Some(properties),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
        _ => None,
    };
    // Sorted, so one compiler on one input infers in one order.
    let mut faces: Vec<TypeId> = hierarchy
        .faces
        .iter()
        .filter(|face| {
            hierarchy
                .declares
                .get(face)
                .is_some_and(|methods| !methods.is_empty())
        })
        .copied()
        .collect();
    faces.sort_unstable_by_key(|face| face.0);
    let (legacy_classes, classes) = structural_candidates(hierarchy);
    let mut inferred: Vec<(TypeId, TypeId)> = Vec::new();
    for face in faces {
        let Some(wanted) = properties(face) else {
            continue;
        };
        // Which members are methods is what the hierarchy says, not the
        // member's kind: an optional method, `destroy?(): void`, is recorded as
        // a property, and judging it by kind let `Readable#destroy(error,
        // callback): this` fill a `destroy(error): void` slot.
        let methods = hierarchy.declares.get(&face).cloned().unwrap_or_default();
        let legacy = hierarchy.literal_methods.is_legacy(face);
        let mut fitting: Vec<TypeId> = Vec::new();
        let mut a_misfit = legacy
            && hierarchy
                .literal_methods
                .legacy_blocks(probe, &legacy_classes, wanted);
        for class in &classes {
            if legacy
                && legacy_classes
                    .binary_search_by_key(&class.0, |class| class.0)
                    .is_err()
            {
                continue;
            }
            let literal = !legacy && hierarchy.literal_methods.contains(*class);
            if hierarchy.descends_from(*class, face) && !literal {
                continue;
            }
            let Some(has) = properties(*class) else {
                continue;
            };
            let found = |member: &PropertyRecord| {
                has.iter().find(|candidate| candidate.name == member.name)
            };
            // **Only a class with every member the interface requires counts**:
            // anything else never reaches a slot of it without a lie the
            // checker was told. By name, which is wider than what TypeScript
            // would accept -- a `size(): string` counts against `size():
            // number` -- and so errs toward inferring nothing.
            if !wanted
                .iter()
                .all(|member| member.optional || found(member).is_some())
            {
                continue;
            }
            if !legacy
                && wanted.iter().any(|member| {
                    methods.contains(&MemberKey::method(member.name.clone()))
                        && found(member).is_some_and(|mine| !self::candidate(probe, mine, member))
                })
            {
                continue;
            }
            let fits = wanted.iter().all(|member| match found(member) {
                // An optional *method* the class lacks is not one it can be
                // excused: the edge is inherited, and a subclass that declares
                // the method then fills the interface's slot with whatever
                // signature it chose. `EventEmitter` "fitted"
                // `LegacyDestroyable` on `emit` alone, and `Readable` and
                // `Writable` became two disagreeing implementations of its
                // `destroy?()`.
                None => !methods.contains(&MemberKey::method(member.name.clone())),
                Some(found) if methods.contains(&MemberKey::method(member.name.clone())) => {
                    if literal {
                        hierarchy
                            .literal_methods
                            .fits(probe, hierarchy, *class, member)
                    } else {
                        hierarchy
                            .declaring(*class, &MemberKey::method(member.name.clone()))
                            .is_some()
                            && self::fits(probe, hierarchy, found, member)
                    }
                }
                Some(_) => true,
            });
            if fits {
                if !hierarchy.descends_from(*class, face) {
                    fitting.push(*class);
                }
            } else {
                a_misfit = true;
            }
        }
        // **All or none.** Inferring edges gives the interface dispatch slots,
        // and a class TypeScript accepts as one that did not fit -- `take(x:
        // number | string)` where the slot is `take(x: number)` -- has no
        // entry in them, so a call through the interface on it, once its class
        // is lost in an array or a field, jumped through a null pointer. Main
        // does that today wherever a class *declares* the interface beside such
        // a class (`outcomes/a-structural-misfit-dispatched-through-an-interface`);
        // inferring edges must not make it reachable from interfaces that had
        // no slots. So one misfit leaves the interface as it was: a call
        // through it refused until something writes `implements`.
        if !a_misfit {
            inferred.extend(fitting.into_iter().map(|class| (class, face)));
        }
    }
    for (class, face) in inferred {
        hierarchy.implements.entry(class).or_default().push(face);
    }
}

/// Keep the original candidate list for faces whose method values still need
/// source copies, alongside the complete literal candidate list.
fn structural_candidates(hierarchy: &Hierarchy) -> (Vec<TypeId>, Vec<TypeId>) {
    let mut classes: Vec<TypeId> = hierarchy
        .declares
        .keys()
        .filter(|class| !hierarchy.faces.contains(class))
        .copied()
        .collect();
    classes.sort_unstable_by_key(|class| class.0);
    let declared = classes.clone();
    classes.extend(hierarchy.literal_methods.owners());
    classes.sort_unstable_by_key(|class| class.0);
    classes.dedup();
    (declared, classes)
}

/// The `(interface, member)` a call dispatches through, where its receiver is typed at a
/// face this hierarchy knows.
///
/// **One spelling, two readers**, which is the whole reason it is a function:
/// [`FuncBuilder::an_interface_member_that_can_raise`] asks it to decide whether a `try`
/// must do something about the call, and [`raising_member_slots`](super::raising_member_slots) asks it to decide which
/// family to number a raising slot for. Those two disagreeing is a site that dispatches at
/// a slot nobody numbered, or a slot numbered for a site that refuses anyway.
///
/// The receiver's type comes from `node_types` rather than from the checker's callee,
/// because the callee is the *signature* -- which is the whole defect
/// `blockers/a-try-around-a-call-on-an-interface-typed-receiver` records.
pub(super) fn interface_member_of(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &Hierarchy,
    call: NodeId,
) -> Option<(TypeId, MemberKey)> {
    let callee = probe.children(call).first().copied()?;
    let children = probe.children(callee);
    let (receiver, member) = (children.first()?, children.last()?);
    if receiver == member {
        return None;
    }
    let ty = snapshot.node_types.get(receiver).copied()?;
    if !hierarchy.faces.contains(&ty) {
        return None;
    }
    Some((ty, MemberKey::method(probe.access_key(callee, "")?)))
}

/// Every member declaration that would fill `root`'s `key` slot: the one each class at
/// or below `root` declares for it.
///
/// By walking the class declarations rather than a reverse map, because the map from a
/// type back to the class node is not one this file keeps and a second derivation of it
/// would be a third place that answers "which class is this".
pub(super) fn members_filling(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &Hierarchy,
    root: TypeId,
    key: &MemberKey,
) -> Vec<NodeId> {
    if let Some((family, writes)) = hierarchy.access_families.for_key(root, key) {
        return family.accessors_for(writes);
    }
    let mut found = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let NodeKind::Syntax(kind) = node.kind else {
            continue;
        };
        if !declares_a_class(kind) {
            continue;
        }
        let class = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(ty) = instance_type_of(snapshot, class) else {
            continue;
        };
        if !hierarchy.descends_from(ty, root) {
            continue;
        }
        for member in probe.children(class) {
            if member_dispatch_key(probe, member).as_ref() == Some(key) {
                // Normalised the way `raising_copies` normalises what it puts in
                // `Naming::copyable`, because the caller asks that set about these nodes.
                // An **overloaded** member declares several nodes for one dispatch key and
                // only the implementation is ever in the set, so comparing the raw nodes
                // would reject every such family -- conservative, and a second spelling of
                // one normalisation, which is the defect this file has had four of.
                found.push(probe.implementation_of(the_function_of(probe, member)));
            }
        }
    }
    found
}

/// Give a closure's layout the function type it is a value of as its base, and
/// give that function type an abstract declaration to dispatch through.
///
/// # Why the base alone is not enough
///
/// `closure_layout` builds `Closure{index}` with the closure's `call` in the
/// shared closure slot; the function-type arm of `layout_of` builds `Fn{ty}`
/// with **no fields and no methods**, because a function type is a signature
/// rather than a class. Relating them by `base` alone therefore produces a
/// base that declares nothing, and a call through an `Fn{ty}`-typed value has
/// no method to reach -- on a machine with a vtable that is a null slot, and on
/// the JVM it is a class that will not verify.
///
/// So the function type also gets an [`Func::abstract_declaration`], which is
/// exactly what that field means: a signature the program declares, that
/// nothing calls directly, and that every reachable receiver overrides. It was
/// added for `abstract` methods and it turns out to name the same concept here.
///
/// # The signature is taken from the closure rather than from the checker
///
/// Every closure that is a value of one function type must agree with the
/// others about the descriptor, or dispatch through the base is meaningless --
/// which is the same requirement an override already has. Taking the signature
/// from the first closure makes that agreement *checkable* rather than assumed:
/// a backend comparing an override against what it overrides sees a real
/// disagreement, where a signature synthesized from the checker would have
/// quietly been a third opinion neither closure held.
///
/// One result is not the first closure's: generators returning different
/// frames, which agree only about the generator the frames extend. See
/// [`shared_generator_result`](super::shared_generator_result).
///
/// # Named function types only
///
/// An inline `(x: number) => number` written in two places can be two type ids
/// for one structural type, and two closures would then extend two different
/// bases for the same signature. A type with no symbol is left alone, which
/// leaves those programs exactly as they are today rather than differently
/// wrong.
/// Give every interface method a declaration to dispatch through.
///
/// A call on an interface-typed receiver is virtual: the slot is numbered
/// against the interface, and each implementer fills it. But the *callee* named
/// at the call site is `Sink#write`, and nothing declares one -- an interface
/// has no bodies. Without this the call reached a name the program does not
/// define, which `drop_callers_of_refused` then read as calling something
/// refused and dropped every caller.
///
/// [`Func::abstract_declaration`] is exactly what this is, which is the same
/// observation `relate_closures_to_signatures` makes about a function type: a
/// signature the program declares, that nothing calls directly, and that every
/// reachable receiver overrides.
///
/// The interface declares the signature. A body supplies the receiver and
/// provenance used by the existing shell builder; adapters reconcile its ABI
/// afterward. Referenced callable layouts must be materialized before callable
/// entries are completed. Existing rest/generic declarations retain their
/// previous shell path; those contracts never enable structural inference.
pub(super) fn declare_interface_methods(
    layout_collector: &mut LayoutCollector,
    hierarchy: &Hierarchy,
    builder: &mut FuncBuilder,
    program: &mut Program,
) {
    // The filled table proves who serves a slot. An inherited body can serve
    // a subclass's interface even when its own receiver does not implement it.
    let by_name: rustc_hash::FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(at, func)| (func.name.as_str(), at))
        .collect();
    let mut bodies = rustc_hash::FxHashMap::default();
    for layout in layout_collector.layouts() {
        for (slot, entry) in layout.methods.iter().enumerate() {
            if let Some(at) = entry.as_deref().and_then(|name| by_name.get(name))
                && !program.funcs[*at].abstract_declaration
            {
                bodies.entry(slot).or_insert(*at);
            }
        }
    }
    let existing_layouts = layout_collector.layouts().len();
    builder.layouts = BuilderLayouts::Collected(std::mem::take(layout_collector));
    let mut declare: Vec<Func> = Vec::new();
    let mut slots: Vec<_> = hierarchy.slots.iter().collect();
    slots.sort_unstable_by_key(|(_, slot)| **slot);
    for ((root, member, raising), slot) in slots {
        if *raising {
            continue;
        }
        if hierarchy.access_families.for_key(*root, member).is_some() {
            continue;
        }
        let Some(owner) = hierarchy.name.get(root) else {
            continue;
        };
        let declared = format!("{owner}#{}", member.emitted_name());
        // **And the shells this loop has already made.** The check was against
        // `program.funcs` alone, and the shells go into `declare` until the
        // end -- so two roots that `hierarchy.name` spells the same way both
        // passed it and both were pushed, which `verify` reports as
        // `DuplicateFunction { name: "StreamTextEncoder#encode" }` and
        // `emit-c` turns into "refusing to emit code from invalid HIR": no
        // output, for six modules at once. Latent until something made two
        // roots of one name, which inferring `implements` structurally did.
        if program.funcs.iter().any(|func| func.name == declared)
            || declare.iter().any(|func| func.name == declared)
        {
            continue;
        }
        let Some(body) = bodies.get(&(*slot as usize)).map(|at| &program.funcs[*at]) else {
            // **Recorded, because the cascade cannot say it.** A call through
            // this interface lowers to a dispatch naming `Owner#member`, and
            // if nothing declares it the reader gets ``f` cannot be compiled
            // because it calls `Iterator<5>#next`, which was refused above` --
            // with no refusal above, because nothing refused anything. The
            // member exists on the interface and no class in the program
            // implements it, which is a sentence only this loop is in a
            // position to write and which has no source line to sit on.
            //
            // `uncompiled` is where a name with no function goes; `emit-c`
            // and the napi wrapper read it to explain an absent export
            // instead of reporting the effect.
            program.uncompiled.push(crate::hir::Uncompiled::explanation(
                declared,
                "no class in this program implements it, so its method has no body to declare"
                    .to_owned(),
            ));
            continue;
        };
        let shell =
            self::declaration(builder, *root, member, body, &declared).unwrap_or_else(|| {
                declaration_shell(
                    body,
                    &declared,
                    HirType::Managed(ManagedType::Object(*root)),
                )
            });
        declare.push(shell);
    }
    // Sorted, so one compiler on one input emits them in one order.
    declare.sort_by(|a, b| a.name.cmp(&b.name));
    program.funcs.extend(declare);
    let added = builder.layouts.split_off(existing_layouts);
    *layout_collector = std::mem::take(&mut builder.layouts).into_collector();
    layout_collector.collect(program, added);
    (*layout_collector, ()) = std::mem::take(layout_collector).with_program(program, |program| {
        record_unimplemented_interfaces(hierarchy, program);
    });
}

/// A method's declaration made from one of its bodies: its signature, named
/// `name`, taking a receiver of type `receiver`.
///
/// A declaration is its signature. The parameters keep their value ops
/// because those *are* the signature in this IR; everything the body computed
/// goes -- with the obligations the lowering recorded about those values,
/// which would name values the shell no longer has -- and the single block
/// says so.
pub(super) fn declaration_shell(body: &Func, name: &str, receiver: HirType) -> Func {
    let mut shell = body.clone();
    name.clone_into(&mut shell.name);
    if let Some(parameter) = shell.params.first_mut() {
        parameter.ty = receiver;
    }
    shell.values.truncate(shell.params.len());
    shell.blocks = vec![Block {
        params: Vec::new(),
        ops: Vec::new(),
        terminator: Terminator::Unreachable,
    }];
    shell.obligations = Vec::new();
    shell.exported = false;
    shell.initializes_receiver = false;
    shell.async_result = None;
    // **And no frame.** A generator's `#call` carries the frame its body
    // allocates, and `suspend` takes any function with a frame for one to
    // split: so a signature's declaration made from a generator closure's
    // `#call` became that generator's entry once anything reached it -- a body
    // storing the signature value into the frame's field for the closure,
    // which the JVM's verifier refused (NTS4001) and C stored unchecked
    // (tests/programs/a-generator-as-an-array-pattern-default-on-jvm). Typed
    // signatures made it reachable; a declaration is a signature whoever
    // reaches it, and `suspend`'s own shells clear the frame for the same
    // reason.
    shell.frame = None;
    shell.abstract_declaration = true;
    shell
}

/// Say why an interface's method has no function, for the members that never
/// reached a slot.
///
/// A slot is numbered only where something *overrides* -- which for an
/// interface means "at least one class implements it" -- so an interface
/// nothing implements has members, no slot, and therefore no shell from the
/// loop above. A call on such a receiver lowers to a direct call naming
/// `Owner#member`, the function is never emitted, and the reader gets
/// "`f` cannot be compiled because it calls `Iterator<5>#next`, which was
/// refused above" with no refusal above to find.
///
/// No shell is declared for these: the call is *direct*, so a shell would be
/// an abstract declaration something calls for real. What is recorded is the
/// reason, which `drop_callers_of_refused` reads to say what happened instead
/// of asserting a refusal that did not occur.
fn record_unimplemented_interfaces(hierarchy: &Hierarchy, program: &mut Program) {
    // **Which members this program holds a raising copy of**, because a call inside a
    // `try` names the suffixed spelling by the same route it names the plain one.
    // `has_a_raising_copy` asks about the *implementation* the checker resolved -- and
    // for `stream[kStreamAttachBYOB](this)` in `runtime/web-platform` that is
    // `ReadableStream`'s method, which has a copy -- while `callee_for` spells the name
    // of the type that **declares** the member. So the site emits
    // `ReadableStreamBYOBHost#__@kStreamAttachBYOB@1167@raises`, an interface nothing
    // implements has no body under either spelling, and the plain one was the only one
    // this loop answered for: `integrity` reported the cascade through the copy as one
    // with no root, which is the weaker of two sentences about one cause.
    //
    // By member key rather than for every declared member, because an entry for a name
    // nothing can ask about is noise in a list fourteen readers scan -- 423 of them in
    // `web-platform` alone.
    for face in &hierarchy.faces {
        let Some(owner) = hierarchy.name.get(face) else {
            continue;
        };
        for member in hierarchy.declares.get(face).into_iter().flatten() {
            let plain = format!("{owner}#{}", member.emitted_name());
            let raising = format!("{plain}{RAISING_SUFFIX}");
            let needs_raising = hierarchy
                .root_declaring(*face, member)
                .is_some_and(|root| hierarchy.slots.contains_key(&(root, member.clone(), true)));
            let spellings = if needs_raising {
                vec![plain, raising]
            } else {
                vec![plain]
            };
            for declared in spellings {
                if program.funcs.iter().any(|func| func.name == declared)
                    || program
                        .uncompiled
                        .iter()
                        .map(|entry| (&entry.name, &entry.reason))
                        .any(|(name, _)| *name == declared)
                {
                    continue;
                }
                program.uncompiled.push(crate::hir::Uncompiled::explanation(
                    declared,
                    "no class in this program implements it, so its method has no body to declare"
                        .to_owned(),
                ));
            }
        }
    }
    // Sorted, so one compiler on one input records them in one order.
    program.uncompiled.sort();
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
