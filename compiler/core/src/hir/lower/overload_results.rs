//! Selected overload results belong to copies of their implementation body.
//!
//! A body node can carry the first OVERLOAD's function type even when its own
//! written result is unknown. Neither that alias nor the erased value kernel
//! identifies the result of a selected call. Keep that contract explicit; the
//! ordinary builder still materialises it and coerces every returned value.
use super::{
    DeclarationModifiers, FuncBuilder, HirType, LoweringSnapshot, ManagedType, NodeId, TypeId,
    TypeKind, representation, syntax,
};
use crate::hir::generics::GenericFunctions;
use nts_semantic_schema::{SignatureId, SignatureRecord};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Clone, Copy)]
pub(super) struct Contract {
    pub(super) selected: NodeId,
    /// Snapshot-local lookup only, NEVER a printed copy name or equality key.
    pub(super) resolved: SignatureId,
}

#[derive(Default)]
pub(super) struct Results(FxHashMap<NodeId, FxHashMap<String, Contract>>);

impl Results {
    pub(super) fn get(&self, body: NodeId, suffix: &str) -> Option<Contract> {
        self.0.get(&body)?.get(suffix).copied()
    }
}

// Equality uses the owned semantic contract, not pointer compatibility or the
// resolved signature's allocation ID. Distinct overload declarations remain
// distinct even when their result pointers happen to have the same width.
#[derive(Debug, Hash, PartialEq, Eq)]
struct Key {
    selected: NodeId,
    suffix: String,
    parameters: Vec<(TypeId, bool, bool)>,
    returned: TypeId,
    this: Option<TypeId>,
}

impl Key {
    fn new(selected: NodeId, suffix: &str, signature: &SignatureRecord) -> Self {
        Self {
            selected,
            suffix: suffix.to_owned(),
            parameters: signature
                .parameters
                .iter()
                .map(|p| (p.ty, p.optional, p.rest))
                .collect(),
            returned: signature.return_type,
            this: signature.this_type,
        }
    }
}

fn object_result(probe: &FuncBuilder<'_>, ty: TypeId) -> bool {
    matches!(
        probe.snapshot.types.get(ty.0 as usize).map(|r| &r.kind),
        Some(TypeKind::Object { .. })
    ) && matches!(
        representation(probe.snapshot, ty),
        Some(HirType::Managed(ManagedType::Object(_)))
    ) && probe.written_scalar(ty).is_none()
}

fn written_object_result(probe: &FuncBuilder<'_>, body: NodeId) -> bool {
    let annotations: Vec<_> = probe
        .children(body)
        .into_iter()
        .filter(|id| probe.kind_of(*id) == Some(syntax::TYPE_REFERENCE))
        .collect();
    let [annotation] = annotations.as_slice() else {
        return false;
    };
    probe
        .snapshot
        .node_types
        .get(annotation)
        .is_some_and(|ty| object_result(probe, *ty))
}

fn implementation_is_eligible(probe: &FuncBuilder<'_>, body: NodeId) -> bool {
    probe.kind_of(body) == Some(syntax::FUNCTION_DECLARATION)
        && probe.has_a_body(body)
        && probe.syntactic_parent(body).is_some_and(|parent| {
            probe.kind_of(parent) == Some(syntax::SOURCE_FILE)
        })
        && !probe.node(body).modifiers.contains(DeclarationModifiers::ASYNC)
        && !probe.node(body).modifiers.contains(DeclarationModifiers::GENERATOR)
        && written_object_result(probe, body)
        && probe.written_return(body).is_none()
        && probe.written_tuple_return(body).is_empty()
        // Use syntax, not declared_signature(body): the measured native body
        // aliases the overload's type parameters although it declares none.
        && !probe.children(body).iter().any(|child| {
            matches!(probe.kind_of(*child), Some(syntax::TYPE_PARAMETER | syntax::ASTERISK_TOKEN))
        })
        && !probe.declaration_reads_this(body)
}

struct Eligibility {
    contextual_calls: FxHashSet<NodeId>,
    contextual_bodies: FxHashSet<NodeId>,
    bodies: FxHashMap<NodeId, bool>,
    results: FxHashMap<TypeId, bool>,
}

impl Eligibility {
    fn new(found: &GenericFunctions) -> Self {
        Self {
            contextual_calls: found
                .at_call_in
                .values()
                .chain(found.at_call_in_copy.values())
                .flat_map(|calls| calls.keys().copied())
                .collect(),
            contextual_bodies: found
                .at_call_in_copy
                .keys()
                .map(|(body, _)| *body)
                .collect(),
            bodies: FxHashMap::default(),
            results: FxHashMap::default(),
        }
    }
}

struct Candidate {
    body: NodeId,
    source_copy: usize,
    key: Key,
    contract: Contract,
}

fn candidate(
    snapshot: &LoweringSnapshot<'_>,
    probe: &FuncBuilder<'_>,
    found: &GenericFunctions,
    call: NodeId,
    target: nts_semantic_schema::CallTarget,
    eligibility: &mut Eligibility,
) -> Option<Candidate> {
    if eligibility.contextual_calls.contains(&call) {
        return None;
    }
    let selected = target.callee?;
    let body = snapshot.implementation_of(selected);
    // Creating the FIRST body entry would suppress function_copies' plain
    // and structural branch. Only the measured existing-copy domain is
    // admitted; missing/empty body populations remain explicitly unresolved.
    if found.copies.get(&body).is_none_or(Vec::is_empty) {
        return None;
    }
    if body == selected
        || eligibility.contextual_bodies.contains(&body)
        || eligibility.contextual_bodies.contains(&selected)
        || !*eligibility
            .bodies
            .entry(body)
            .or_insert_with(|| implementation_is_eligible(probe, body))
    {
        return None;
    }
    let declared = crate::hir::generics::declared_signature(snapshot, selected)?;
    if declared.type_parameters.is_empty() {
        return None;
    }
    let signature = snapshot.signatures.get(target.signature.0 as usize)?;
    if signature.is_construct
        || signature.type_predicate.is_some()
        || !signature.type_parameters.is_empty()
        || !*eligibility
            .results
            .entry(signature.return_type)
            .or_insert_with(|| object_result(probe, signature.return_type))
    {
        return None;
    }
    let suffix = found.at_call.get(&call)?;
    // A value kernel is not renamed or republished as a typed result.
    if found
        .value_fallbacks
        .get(&selected)
        .is_some_and(|copy| &copy.suffix == suffix)
    {
        return None;
    }
    let mut matching = found
        .copies
        .get(&selected)?
        .iter()
        .enumerate()
        .filter(|(_, copy)| &copy.suffix == suffix);
    let (source_copy, _) = matching.next()?;
    if matching.next().is_some() {
        return None;
    }
    Some(Candidate {
        body,
        source_copy,
        key: Key::new(selected, suffix, signature),
        contract: Contract {
            selected,
            resolved: target.signature,
        },
    })
}

/// Wire only existing-copy, nonnullable object-result direct calls. Generic implementations, fallback
/// kernels, nested/deferred maps and non-module entries keep their old path.
/// No snapshot mutation, queries, new templates, or materialisation occurs.
pub(super) fn associate(snapshot: &LoweringSnapshot<'_>, found: &mut GenericFunctions) -> Results {
    let probe = FuncBuilder::probe(snapshot);
    let mut eligibility = Eligibility::new(found);
    let mut reserved: FxHashSet<_> = found
        .copies
        .iter()
        .flat_map(|(body, copies)| copies.iter().map(|copy| (*body, copy.suffix.clone())))
        .collect();
    let mut contracts: FxHashMap<Key, String> = FxHashMap::default();
    let mut next: FxHashMap<NodeId, u32> = FxHashMap::default();
    let mut results = Results::default();
    let mut calls: Vec<_> = snapshot.call_targets.iter().collect();
    calls.sort_by_key(|(call, _)| call.0);
    for (call, target) in calls {
        let Some(Candidate {
            body,
            source_copy,
            key,
            contract,
        }) = candidate(snapshot, &probe, found, *call, *target, &mut eligibility)
        else {
            continue;
        };
        let name = if let Some(name) = contracts.get(&key) {
            name.clone()
        } else {
            // One deterministic ordinal per implementation, assigned in call
            // source order. SignatureId is lookup provenance, not name identity.
            let mut copy = found.copies[&contract.selected][source_copy].clone();
            let ordinal = next.entry(body).or_default();
            let name = loop {
                let name = format!("{}@overload{ordinal}", copy.suffix);
                let Some(after) = ordinal.checked_add(1) else {
                    return results;
                };
                *ordinal = after;
                if reserved.insert((body, name.clone())) {
                    break name;
                }
            };
            copy.suffix.clone_from(&name);
            found.copies.entry(body).or_default().push(copy);
            results
                .0
                .entry(body)
                .or_default()
                .insert(name.clone(), contract);
            contracts.insert(key, name.clone());
            name
        };
        found.at_call.insert(*call, name);
    }
    results
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]
    use super::super::{
        Absent, Location, NodeData, NodeKind, Origin, Retyped, SemanticSnapshot, Structural,
        Substitution, TypeRecord, function_copies, parameters_of,
    };
    use super::*;
    use crate::hir::generics::FunctionInstance;
    use nts_diagnostics::{SourceId, Span};
    use nts_semantic_schema::{MemberKind, NodeRecord, ParameterRecord, PropertyRecord};

    fn node(
        snapshot: &mut SemanticSnapshot,
        kind: u16,
        parent: Option<NodeId>,
        text: Option<&str>,
    ) -> NodeId {
        let id = NodeId(u32::try_from(snapshot.nodes.len()).unwrap());
        snapshot.nodes.push(NodeRecord {
            kind: NodeKind::Syntax(kind),
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(id.0, id.0 + 1),
            }),
            parent,
            children: Vec::new(),
            symbol: None,
            flags: 0,
            modifiers: DeclarationModifiers::default(),
            native: None,
            data: NodeData::Children {
                present: 0,
                small: 0,
            },
            text: text.map(Into::into),
        });
        if let Some(parent) = parent {
            snapshot.nodes[parent.0 as usize].children.push(id);
        }
        id
    }

    fn declaration(snapshot: &mut SemanticSnapshot, root: NodeId, body: bool) -> NodeId {
        let id = node(snapshot, syntax::FUNCTION_DECLARATION, Some(root), None);
        node(snapshot, syntax::IDENTIFIER, Some(id), Some("pick"));
        if body {
            node(snapshot, syntax::BLOCK, Some(id), None);
        }
        id
    }

    fn signature(result: u32, generic: bool) -> SignatureRecord {
        SignatureRecord {
            parameters: vec![ParameterRecord {
                name: "n".into(),
                ty: TypeId(0),
                optional: false,
                rest: false,
            }],
            return_type: TypeId(result),
            type_parameters: if generic { vec![TypeId(3)] } else { Vec::new() },
            is_construct: false,
            type_predicate: None,
            this_type: None,
        }
    }

    fn result_record(value: TypeId) -> TypeKind {
        TypeKind::Object {
            properties: vec![PropertyRecord {
                name: "value".into(),
                ty: value,
                readonly: false,
                optional: false,
                declaration: None,
                kind: MemberKind::Field,
                own: true,
            }],
        }
    }

    // Every negative starts here BEFORE its one-change mutation. Empty
    // anonymous objects are erased; genuine nonempty records must reach the
    // object/body/candidate domain rather than make exclusions vacuous.
    fn assert_fixture_eligible(
        snapshot: &SemanticSnapshot,
        found: &GenericFunctions,
        body: NodeId,
        calls: [NodeId; 3],
    ) {
        let indexed = LoweringSnapshot::new(snapshot);
        let probe = FuncBuilder::probe(&indexed);
        for ty in [TypeId(4), TypeId(5)] {
            assert_eq!(
                representation(snapshot, ty),
                Some(HirType::Managed(ManagedType::Object(ty)))
            );
            assert!(
                object_result(&probe, ty),
                "baseline result {ty:?} must be eligible"
            );
        }
        assert!(
            implementation_is_eligible(&probe, body),
            "baseline body must be eligible"
        );
        let mut eligibility = Eligibility::new(found);
        for call in calls {
            assert!(
                candidate(
                    &indexed,
                    &probe,
                    found,
                    call,
                    snapshot.call_targets[&call],
                    &mut eligibility
                )
                .is_some(),
                "baseline selected call {call:?} must enter association"
            );
        }
    }

    fn fixture() -> (SemanticSnapshot, GenericFunctions, NodeId, [NodeId; 3]) {
        let mut snapshot = SemanticSnapshot {
            types: vec![
                TypeKind::Number,
                TypeKind::Unknown,
                TypeKind::String,
                TypeKind::TypeParameter {
                    name: "T".into(),
                    is_this: false,
                    constraint: None,
                },
                result_record(TypeId(1)),
                result_record(TypeId(2)),
                TypeKind::Function(SignatureId(0)),
                TypeKind::Function(SignatureId(1)),
                TypeKind::Null,
            ]
            .into_iter()
            .map(|kind| TypeRecord { kind, symbol: None })
            .collect(),
            signatures: vec![
                signature(4, true),
                signature(5, true),
                signature(4, false),
                signature(5, false),
                signature(4, false),
            ],
            ..SemanticSnapshot::default()
        };
        let root = node(&mut snapshot, syntax::SOURCE_FILE, None, None);
        let first = declaration(&mut snapshot, root, false);
        let second = declaration(&mut snapshot, root, false);
        let body = declaration(&mut snapshot, root, true);
        snapshot.node_types.insert(first, TypeId(6));
        snapshot.node_types.insert(second, TypeId(7));
        snapshot.node_types.insert(body, TypeId(6));
        let annotation = node(&mut snapshot, syntax::TYPE_REFERENCE, Some(body), None);
        snapshot.node_types.insert(annotation, TypeId(4));
        let parameter = node(&mut snapshot, syntax::PARAMETER, Some(body), None);
        node(
            &mut snapshot,
            syntax::IDENTIFIER,
            Some(parameter),
            Some("n"),
        );
        node(
            &mut snapshot,
            syntax::NUMERIC_LITERAL,
            Some(parameter),
            Some("7"),
        );
        snapshot.node_types.insert(parameter, TypeId(0));
        let calls =
            std::array::from_fn(|_| node(&mut snapshot, syntax::CALL_EXPRESSION, Some(root), None));
        for (call, selected, signature) in [
            (calls[0], first, 2),
            (calls[1], second, 3),
            (calls[2], first, 4),
        ] {
            snapshot.call_targets.insert(
                call,
                nts_semantic_schema::CallTarget {
                    signature: SignatureId(signature),
                    callee: Some(selected),
                    declaration: None,
                },
            );
        }
        let copy = FunctionInstance {
            substitution: Substitution::default(),
            sources: FxHashMap::default(),
            suffix: "<str>".into(),
        };
        let fallback = FunctionInstance {
            suffix: "<value-erased>".into(),
            ..copy.clone()
        };
        let mut found = GenericFunctions::default();
        found.copies.insert(first, vec![copy.clone()]);
        found.copies.insert(second, vec![copy]);
        found.copies.insert(body, vec![fallback.clone()]);
        found.value_fallbacks.insert(body, fallback);
        for call in calls {
            found.at_call.insert(call, "<str>".into());
        }
        assert_fixture_eligible(&snapshot, &found, body, calls);
        (snapshot, found, body, calls)
    }

    #[test]
    fn distinct_semantic_results_and_overloads_do_not_share_a_pointer_copy() {
        let (snapshot, mut found, body, calls) = fixture();
        let indexed = LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        let before = probe.parameters_declared_by(body);
        let parameter = parameters_of(&probe, body)[0];
        let default = probe
            .default_of(parameter)
            .expect("implementation default 7");
        assert_eq!(probe.declared_parameters(calls[0]), before);
        let result = associate(&indexed, &mut found);
        let first = &found.at_call[&calls[0]];
        let second = &found.at_call[&calls[1]];
        assert_ne!(first, second);
        assert_ne!(
            Key::new(
                snapshot.call_targets[&calls[0]].callee.unwrap(),
                "<str>",
                &snapshot.signatures[2]
            ),
            Key::new(
                snapshot.call_targets[&calls[0]].callee.unwrap(),
                "<str>",
                &snapshot.signatures[3]
            ),
        );
        // The third resolved signature has a DIFFERENT ID but equal content.
        assert_eq!(first, &found.at_call[&calls[2]]);
        assert_eq!(found.copies[&body].len(), 3);
        assert_eq!(result.get(body, first).unwrap().resolved, SignatureId(2));
        assert_eq!(result.get(body, second).unwrap().resolved, SignatureId(3));
        let unknown = representation(&snapshot, TypeId(4)).unwrap();
        let string = representation(&snapshot, TypeId(5)).unwrap();
        assert_ne!(unknown, string);
        assert!(crate::hir::verify::compatible(&unknown, &string));
        assert_eq!(found.value_fallbacks[&body].suffix, "<value-erased>");
        assert_eq!(found.copies[&body][0].suffix, "<value-erased>");
        let mut builder = FuncBuilder::probe(&indexed);
        builder.selected_result = Some((body, result.get(body, second).unwrap()));
        assert_eq!(builder.declared_result_type(body), Some(TypeId(5)));
        assert_eq!(
            builder.declared_return(body),
            representation(&snapshot, TypeId(5))
        );
        assert!(builder.written_return(body).is_none());
        assert!(
            builder.written_tuple_return(body).is_empty(),
            "unexpected tuple obligations: {:?}",
            builder.written_tuple_return(body)
        );
        assert_eq!(builder.result_absent(body), Absent::Impossible);

        assert_eq!(
            FuncBuilder::probe(&indexed).parameters_declared_by(body),
            before
        );
        assert_eq!(before, [(Some(TypeId(0)), true, false)]);
        assert_eq!(probe.default_of(parameter), Some(default));
        assert_eq!(probe.declared_parameters(calls[0]), before);
        let (_, mut repeat, _, _) = fixture();
        associate(&indexed, &mut repeat);
        assert_eq!(found.at_call, repeat.at_call);
    }

    #[test]
    fn generic_implementations_and_contextual_calls_keep_the_existing_path() {
        let (mut snapshot, mut found, body, _calls) = fixture();
        node(&mut snapshot, syntax::TYPE_PARAMETER, Some(body), None);
        let before = found.at_call.clone();
        let result = associate(&LoweringSnapshot::new(&snapshot), &mut found);
        assert_eq!(found.at_call, before);
        assert!(
            result.0.is_empty(),
            "unexpected selected contracts: {:?}",
            result.0
        );
        assert_eq!(found.copies[&body].len(), 1);
        let (snapshot, mut found, body, calls) = fixture();
        found.at_call_in.insert(
            TypeId(99),
            [(calls[0], "<nested>".into())].into_iter().collect(),
        );
        associate(&LoweringSnapshot::new(&snapshot), &mut found);
        assert_eq!(found.at_call[&calls[0]], "<str>");
        assert_eq!(found.at_call_in[&TypeId(99)][&calls[0]], "<nested>");
        assert!(
            found.copies[&body]
                .iter()
                .any(|copy| copy.suffix == "<value-erased>")
        );
    }
    #[test]
    fn a_value_fallback_or_ordinary_direct_body_is_not_republished() {
        let (mut snapshot, mut found, body, calls) = fixture();
        let selected = snapshot.call_targets[&calls[0]].callee.unwrap();
        let fallback = found.value_fallbacks[&body].clone();
        found
            .copies
            .get_mut(&selected)
            .unwrap()
            .push(fallback.clone());
        found.value_fallbacks.insert(selected, fallback);
        found.at_call.insert(calls[0], "<value-erased>".into());
        snapshot.call_targets.get_mut(&calls[1]).unwrap().callee = Some(body);
        let result = associate(&LoweringSnapshot::new(&snapshot), &mut found);
        assert_eq!(found.at_call[&calls[0]], "<value-erased>");
        assert_eq!(found.at_call[&calls[1]], "<str>");
        assert_eq!(found.value_fallbacks[&selected].suffix, "<value-erased>");
        assert!(result.get(body, "<value-erased>").is_none());
    }

    fn plain_population(
        snapshot: &SemanticSnapshot,
        found: &GenericFunctions,
        structural: &Structural,
        body: NodeId,
    ) -> Vec<(String, Retyped)> {
        let copies = function_copies(snapshot, found, structural, &FxHashSet::default(), body);
        assert!(copies.iter().all(|copy| {
            copy.declaration.is_none()
                && copy.instance.is_none()
                && !copy.raises
                && copy.substitution.is_empty()
                && copy.sources.is_empty()
        }));
        copies
            .into_iter()
            .map(|copy| (copy.suffix, copy.retyped))
            .collect()
    }

    #[test]
    fn absent_body_entry_keeps_real_plain_and_structural_copy_population() {
        let (mut snapshot, mut found, body, calls) = fixture();
        // First nongeneric overload, later selected generic overload: the body
        // aliases the nongeneric declaration, so it had real ordinary copies.
        let first = snapshot.call_targets[&calls[0]].callee.unwrap();
        let selected = snapshot.call_targets[&calls[1]].callee.unwrap();
        let nongeneric = TypeId(u32::try_from(snapshot.types.len()).unwrap());
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Function(SignatureId(2)),
            symbol: None,
        });
        snapshot.node_types.insert(first, nongeneric);
        snapshot.node_types.insert(body, nongeneric);
        found.copies.remove(&first);
        found.copies.remove(&body);
        found.value_fallbacks.remove(&body);
        for call in calls {
            snapshot.call_targets.get_mut(&call).unwrap().callee = Some(selected);
        }
        let root = snapshot.nodes[body.0 as usize].parent.unwrap();
        let ordinary = node(&mut snapshot, syntax::CALL_EXPRESSION, Some(root), None);
        let shaped = node(&mut snapshot, syntax::CALL_EXPRESSION, Some(root), None);
        for call in [ordinary, shaped] {
            snapshot.call_targets.insert(
                call,
                nts_semantic_schema::CallTarget {
                    signature: SignatureId(2),
                    callee: Some(first),
                    declaration: None,
                },
            );
        }
        let bindings: Retyped = [(0, HirType::Float { bits: 64 })].into_iter().collect();
        let mut structural = Structural::default();
        structural
            .copies
            .insert(body, vec![(bindings.clone(), "@shape".into())]);
        structural.at_call.insert(
            String::new(),
            [(shaped, ("@shape".into(), bindings.clone()))]
                .into_iter()
                .collect(),
        );
        let before = plain_population(&snapshot, &found, &structural, body);
        assert_eq!(
            before,
            [(String::new(), Retyped::new()), ("@shape".into(), bindings)]
        );
        let indexed = LoweringSnapshot::new(&snapshot);
        let before_calls = found.at_call.clone();
        let results = associate(&indexed, &mut found);
        assert!(
            results.0.is_empty(),
            "unexpected selected contracts: {:?}",
            results.0
        );
        assert!(!found.copies.contains_key(&body));
        assert_eq!(
            plain_population(&snapshot, &found, &structural, body),
            before
        );
        assert_eq!(found.at_call, before_calls);
        let mut builder = FuncBuilder::probe(&indexed);
        builder.generic_calls.clone_from(&found.at_call);
        structural.wire_calls(&mut builder, "");
        assert!(!builder.generic_calls.contains_key(&ordinary));
        assert_eq!(builder.generic_calls[&shaped], "@shape");
        assert_eq!(builder.generic_calls[&calls[0]], "<str>");
        // Empty authoritative entries also remain untouched, not populated.
        found.copies.insert(body, Vec::new());
        let results = associate(&indexed, &mut found);
        assert!(
            results.0.is_empty(),
            "unexpected selected contracts: {:?}",
            results.0
        );
        assert!(
            found.copies[&body].is_empty(),
            "empty body population changed: {:?}",
            found.copies[&body]
        );
    }

    #[test]
    fn generator_modifier_and_scalar_tuple_union_results_stay_unresolved() {
        let (mut snapshot, mut found, body, _calls) = fixture();
        snapshot.nodes[body.0 as usize].modifiers.0 |= DeclarationModifiers::GENERATOR.0;
        // No star child exists: the owned modifier must independently stop it.
        let before = found.at_call.clone();
        let results = associate(&LoweringSnapshot::new(&snapshot), &mut found);
        assert!(
            results.0.is_empty(),
            "unexpected selected contracts: {:?}",
            results.0
        );
        assert_eq!(found.at_call, before);
        for kind in [
            TypeKind::Number,
            TypeKind::Tuple(nts_semantic_schema::TupleType {
                elements: vec![TypeId(0)],
                element_flags: vec![nts_semantic_schema::TupleElementKind::Required],
                fixed_length: 1,
                readonly: false,
            }),
            TypeKind::Union(vec![TypeId(4), TypeId(8)]),
        ] {
            let (mut snapshot, found, body, calls) = fixture();
            let ty = TypeId(u32::try_from(snapshot.types.len()).unwrap());
            snapshot.types.push(TypeRecord { kind, symbol: None });
            // First the selected actual result, then the independently written
            // annotation. Both boundaries are required; neither is an alias.
            let mut selected_snapshot = snapshot.clone();
            selected_snapshot.signatures[2].return_type = ty;
            let mut selected_found = found;
            associate(
                &LoweringSnapshot::new(&selected_snapshot),
                &mut selected_found,
            );
            assert_eq!(selected_found.at_call[&calls[0]], "<str>");
            let indexed = LoweringSnapshot::new(&snapshot);
            let annotation = FuncBuilder::probe(&indexed)
                .children(body)
                .into_iter()
                .find(|id| {
                    indexed.nodes[id.0 as usize].kind == NodeKind::Syntax(syntax::TYPE_REFERENCE)
                })
                .unwrap();
            snapshot.node_types.insert(annotation, ty);
            let (_, mut written_found, _, _) = fixture();
            let before = written_found.at_call.clone();
            let results = associate(&LoweringSnapshot::new(&snapshot), &mut written_found);
            assert!(
                results.0.is_empty(),
                "unexpected selected contracts: {:?}",
                results.0
            );
            assert_eq!(written_found.at_call, before);
        }
    }
}
