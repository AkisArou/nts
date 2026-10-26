//! Owned source permission and the complete missing-argument adapter plan.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::super::{FuncBuilder, Hierarchy, LoweringSnapshot, MemberKey, interfaces};
use super::{
    AdapterKey, Argument, Projection, interface_projection, intern_projection, projected_bridge,
};
use crate::hir::facts::Facts;
use crate::hir::{
    Absent, Block, Callee, Func, HirType, ManagedType, OpKind, Param, ParamShape, Program,
    Terminator,
};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, MemberKind, NodeData, NodeId, NodeKind, NodeRecord, Origin,
    ParameterRecord, PropertyRecord, SemanticSnapshot, SignatureId, SignatureRecord, TypeId,
    TypeKind, TypeRecord, syntax,
};
use rustc_hash::FxHashMap;

#[derive(Clone)]
struct Fixture {
    snapshot: SemanticSnapshot,
    mine: PropertyRecord,
    wanted: PropertyRecord,
    declaration: NodeId,
    tail: NodeId,
    name: NodeId,
    question: NodeId,
}

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
            span: Span::new(id.0 * 10, id.0 * 10 + 9),
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

fn property(signature: u32, declaration: Option<NodeId>) -> PropertyRecord {
    PropertyRecord {
        name: "count".into(),
        ty: TypeId(signature),
        readonly: false,
        optional: false,
        declaration,
        kind: MemberKind::Method,
        own: true,
    }
}

fn signature(tail: bool) -> SignatureRecord {
    let mut parameters = vec![ParameterRecord {
        name: "event".into(),
        ty: TypeId(0),
        optional: false,
        rest: false,
    }];
    if tail {
        parameters.push(ParameterRecord {
            name: "listener".into(),
            ty: TypeId(1),
            optional: true,
            rest: false,
        });
    }
    SignatureRecord {
        parameters,
        return_type: TypeId(0),
        type_parameters: Vec::new(),
        is_construct: false,
        type_predicate: None,
        this_type: None,
    }
}

fn fixture() -> Fixture {
    let mut snapshot = SemanticSnapshot {
        types: vec![
            TypeKind::Number,
            TypeKind::Unknown,
            TypeKind::String,
            TypeKind::Function(SignatureId(0)),
            TypeKind::Function(SignatureId(1)),
        ]
        .into_iter()
        .map(|kind| TypeRecord { kind, symbol: None })
        .collect(),
        signatures: vec![signature(true), signature(false)],
        ..SemanticSnapshot::default()
    };
    let class = node(&mut snapshot, syntax::CLASS_DECLARATION, None, None);
    let declaration = node(&mut snapshot, syntax::METHOD_DECLARATION, Some(class), None);
    node(
        &mut snapshot,
        syntax::IDENTIFIER,
        Some(declaration),
        Some("count"),
    );
    let first = node(&mut snapshot, syntax::PARAMETER, Some(declaration), None);
    let first_name = node(
        &mut snapshot,
        syntax::IDENTIFIER,
        Some(first),
        Some("event"),
    );
    let tail = node(&mut snapshot, syntax::PARAMETER, Some(declaration), None);
    let name = node(
        &mut snapshot,
        syntax::IDENTIFIER,
        Some(tail),
        Some("listener"),
    );
    let question = node(&mut snapshot, syntax::QUESTION_TOKEN, Some(tail), None);
    node(&mut snapshot, syntax::BLOCK, Some(declaration), None);
    snapshot.node_types.insert(first_name, TypeId(0));
    snapshot.node_types.insert(name, TypeId(1));
    let mine = property(3, Some(declaration));
    let wanted = property(4, None);
    for properties in [vec![mine.clone()], vec![wanted.clone()]] {
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object { properties },
            symbol: None,
        });
    }
    let fixture = Fixture {
        snapshot,
        mine,
        wanted,
        declaration,
        tail,
        name,
        question,
    };
    assert_baseline(&fixture);
    fixture
}

fn param(ty: HirType, origin: Origin) -> Param {
    Param {
        name: "this".into(),
        ty,
        origin,
        shape: ParamShape::Ordinary,
        known: Facts::TOP,
        written: None,
    }
}

fn function(params: Vec<Param>, origin: Origin) -> Func {
    Func {
        name: "Parent#count".into(),
        params,
        return_type: HirType::NUMBER,
        values: Vec::new(),
        blocks: vec![Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Return(None),
        }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: FxHashMap::default(),
        written_return: None,
        result_absent: Absent::Impossible,
        written_return_elements: Vec::new(),
    }
}

fn target(fixture: &Fixture) -> Func {
    let indexed = LoweringSnapshot::new(&fixture.snapshot);
    let probe = FuncBuilder::probe(&indexed);
    let mut params = vec![param(
        HirType::Managed(ManagedType::Object(TypeId(5))),
        probe.origin(fixture.declaration),
    )];
    let contract = interfaces::contract(&probe, &fixture.mine).unwrap();
    let nodes = super::super::parameters_of(&probe, fixture.declaration);
    params.extend(
        contract
            .params
            .into_iter()
            .zip(nodes)
            .map(|(mut param, node)| {
                param.origin = probe.origin(probe.name_node(node).unwrap());
                param
            }),
    );
    function(params, probe.origin(fixture.declaration))
}

fn assert_baseline(fixture: &Fixture) {
    let indexed = LoweringSnapshot::new(&fixture.snapshot);
    let probe = FuncBuilder::probe(&indexed);
    assert!(
        interfaces::fits(
            &probe,
            &Hierarchy::default(),
            &fixture.mine,
            &fixture.wanted
        ),
        "written class baseline must be eligible"
    );
    let target = target(fixture);
    assert!(
        interfaces::target_optional_tail(&probe, &MemberKey::named("count"), &target, 2).is_some(),
        "actual baseline body must match owned proof"
    );
}

fn projection(fixture: &Fixture, target: &Func) -> Option<Projection> {
    let indexed = LoweringSnapshot::new(&fixture.snapshot);
    let probe = FuncBuilder::probe(&indexed);
    let contract = interfaces::contract(&probe, &fixture.wanted)?;
    let mut through = target.clone();
    through.params.truncate(2);
    through.params[0].ty = HirType::Managed(ManagedType::Object(TypeId(6)));
    through.params[1].ty = HirType::NUMBER;
    let tail = interfaces::target_optional_tail(&probe, &MemberKey::named("count"), target, 2);
    interface_projection(
        &fixture.snapshot,
        &Hierarchy::default(),
        &FxHashMap::default(),
        &through,
        target,
        &contract,
        tail.as_ref(),
    )
}

#[test]
fn written_optional_class_tail_creates_an_explicit_undefined_argument() {
    let fixture = fixture();
    let target = target(&fixture);
    let projection = projection(&fixture, &target).unwrap();
    assert_eq!(
        projection.arguments,
        vec![Argument::Pass(0), Argument::Pass(1), Argument::Undefined]
    );
    assert!(
        !projection.is_identity(&target),
        "padding cannot be an identity map"
    );
    let bridge = projected_bridge("adapter".into(), &target, &projection);
    assert_eq!(bridge.params.len(), 2);
    let calls: Vec<_> = bridge
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } if name == &target.name => Some(args),
            _ => None,
        })
        .collect();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].len(), target.params.len());
    let undefined = &bridge.values[calls[0][2].0 as usize];
    assert_eq!(undefined.ty, HirType::Erased);
    assert!(
        matches!(undefined.kind, OpKind::ConstUndefined),
        "{undefined:?}"
    );
}

#[test]
fn signature_only_required_defaulted_rest_and_nonerased_tails_stay_closed() {
    for mutation in 0..10 {
        let mut fixture = fixture(); // Every negative starts from an eligible proof.
        match mutation {
            0 => fixture.mine.declaration = None,
            1 => {
                fixture.snapshot.nodes[fixture.tail.0 as usize]
                    .children
                    .retain(|id| *id != fixture.question);
            }
            2 => {
                node(
                    &mut fixture.snapshot,
                    syntax::NUMERIC_LITERAL,
                    Some(fixture.tail),
                    Some("0"),
                );
            }
            3 => {
                fixture.snapshot.nodes[fixture.question.0 as usize].kind =
                    NodeKind::Syntax(syntax::DOT_DOT_DOT_TOKEN);
            }
            4 => {
                fixture.snapshot.node_types.insert(fixture.name, TypeId(2));
            }
            5 => {
                fixture.snapshot.nodes[fixture.declaration.0 as usize].modifiers =
                    DeclarationModifiers::GENERATOR;
            }
            6 => {
                fixture.snapshot.nodes[fixture.declaration.0 as usize].modifiers =
                    DeclarationModifiers::ASYNC;
            }
            7 => {
                fixture.snapshot.signatures[0].parameters[1].optional = false;
            }
            8 => {
                fixture.snapshot.signatures[0].parameters[1].rest = true;
            }
            9 => {
                fixture.snapshot.nodes[fixture.declaration.0 as usize].parent = None;
            }
            _ => unreachable!(),
        }
        let indexed = LoweringSnapshot::new(&fixture.snapshot);
        let probe = FuncBuilder::probe(&indexed);
        assert!(
            !interfaces::fits(
                &probe,
                &Hierarchy::default(),
                &fixture.mine,
                &fixture.wanted
            ),
            "mutation {mutation} admitted"
        );
    }
}

#[test]
fn literal_prefix_return_and_ambiguous_body_boundaries_remain_conservative() {
    let fixture = fixture();
    let indexed = LoweringSnapshot::new(&fixture.snapshot);
    let probe = FuncBuilder::probe(&indexed);
    let mine = interfaces::contract(&probe, &fixture.mine).unwrap();
    let wanted = interfaces::contract(&probe, &fixture.wanted).unwrap();
    assert!(
        !interfaces::fits_contracts(&fixture.snapshot, &Hierarchy::default(), &mine, &wanted),
        "literal admission must keep its old boundary"
    );
    for mutation in 0..3 {
        let mut changed = fixture.clone();
        match mutation {
            0 => changed.snapshot.signatures[1].parameters[0].ty = TypeId(2),
            1 => changed.snapshot.signatures[1].return_type = TypeId(2),
            2 => {
                let parent = changed.snapshot.nodes[changed.declaration.0 as usize].parent;
                let duplicate = node(
                    &mut changed.snapshot,
                    syntax::METHOD_DECLARATION,
                    parent,
                    None,
                );
                node(
                    &mut changed.snapshot,
                    syntax::IDENTIFIER,
                    Some(duplicate),
                    Some("count"),
                );
                node(&mut changed.snapshot, syntax::BLOCK, Some(duplicate), None);
            }
            _ => unreachable!(),
        }
        let indexed = LoweringSnapshot::new(&changed.snapshot);
        let probe = FuncBuilder::probe(&indexed);
        assert!(
            !interfaces::fits(
                &probe,
                &Hierarchy::default(),
                &changed.mine,
                &changed.wanted
            ),
            "mutation {mutation} admitted"
        );
    }
}

#[test]
fn actual_body_and_parameter_provenance_cannot_be_replaced_by_signature_bits() {
    let fixture = fixture();
    for mutation in 0..6 {
        let mut changed = target(&fixture);
        match mutation {
            0 => changed.origin.location.span = Span::new(900, 901),
            1 => changed.params[2].origin.location.span = Span::new(900, 901),
            2 => changed.params[2].shape = ParamShape::Defaulted,
            3 => changed.params[2].shape = ParamShape::Rest,
            4 => changed.params[2].ty = HirType::NUMBER,
            5 => changed.params.push(changed.params[2].clone()),
            _ => unreachable!(),
        }
        assert!(
            projection(&fixture, &changed).is_none(),
            "actual target mutation {mutation} admitted"
        );
    }
}

#[test]
fn padding_keys_reuse_only_the_complete_plan_and_preserve_dropped_inputs() {
    let fixture = fixture();
    let target = target(&fixture);
    let padded = projection(&fixture, &target).unwrap();
    let ordinary = Projection {
        params: target.params.clone(),
        returns: target.return_type.clone(),
        arguments: (0..target.params.len()).map(Argument::Pass).collect(),
        result_absent: Absent::Impossible,
    };
    assert_ne!(
        AdapterKey::of(&fixture.snapshot, &target, &padded),
        AdapterKey::of(&fixture.snapshot, &target, &ordinary)
    );
    let mut program = Program {
        funcs: vec![target.clone()],
        ..Program::default()
    };
    let mut index = FxHashMap::from_iter([(target.name.clone(), 0)]);
    let mut made = FxHashMap::default();
    let first = intern_projection(
        &fixture.snapshot,
        &mut program,
        &mut index,
        &mut made,
        0,
        &padded,
        "first".into(),
    );
    let second = intern_projection(
        &fixture.snapshot,
        &mut program,
        &mut index,
        &mut made,
        0,
        &padded,
        "second".into(),
    );
    assert_eq!(first, second);
    assert_eq!(program.funcs.len(), 2);
    assert!(
        !program.identity_projections.contains_key(&first),
        "padded reuse must remain nonidentity"
    );
    let mut short = target.clone();
    short.params.truncate(2);
    let dropped = Projection {
        params: target.params.clone(),
        returns: short.return_type.clone(),
        arguments: vec![Argument::Pass(0), Argument::Pass(1)],
        result_absent: Absent::Impossible,
    };
    assert!(
        dropped.is_identity(&short),
        "already-supported dropped input must keep identity"
    );
    let bridge = projected_bridge("dropped".into(), &short, &dropped);
    assert!(
        bridge
            .values
            .iter()
            .all(|op| !matches!(op.kind, OpKind::ConstUndefined))
    );
}

#[test]
fn rejected_tail_calls_take_the_existing_missing_direct_callee_boundary() {
    let fixture = fixture();
    let mut caller = target(&fixture);
    caller.name = "caller".into();
    caller.values = vec![crate::hir::Op {
        kind: OpKind::Call {
            callee: Callee::Virtual {
                slot: 0,
                declared: "Counter#count".into(),
            },
            args: Vec::new(),
            frame: None,
        },
        ty: HirType::NUMBER,
        origin: caller.origin.clone(),
    }];
    caller.blocks[0].ops.push(crate::hir::ValueId(0));
    let layout = crate::hir::Layout {
        types: vec![TypeId(5)],
        name: "Parent".into(),
        fields: Vec::new(),
        methods: vec![Some("Parent#count".into())],
        interfaces: vec![TypeId(6)],
        base: None,
    };
    let mut program = Program {
        funcs: vec![caller],
        layouts: vec![layout],
        ..Program::default()
    };
    let refused = super::refuse_optional_projection(
        &mut program,
        &FxHashMap::default(),
        &[0],
        0,
        "Parent#count",
        "Counter",
    );
    super::refuse_slot_calls(
        &mut program,
        &std::collections::BTreeMap::from([(0, refused.clone())]),
    );
    assert_eq!(program.layouts[0].methods[0].as_ref(), Some(&refused));
    assert_eq!(program.uncompiled.len(), 1);
    assert_eq!(program.uncompiled[0].0, refused);
    let OpKind::Call { callee, .. } = &program.funcs[0].values[0].kind else {
        panic!("call lost")
    };
    let present = rustc_hash::FxHashSet::from_iter(["caller".into()]);
    assert_eq!(
        crate::hir::refused::missing_callee(callee, &present),
        Some(refused.as_str()),
        "normal cascade must recognize this exact call"
    );
}

#[test]
fn every_missing_trailing_parameter_is_an_independent_undefined_value() {
    let mut fixture = fixture();
    let extra = node(
        &mut fixture.snapshot,
        syntax::PARAMETER,
        Some(fixture.declaration),
        None,
    );
    let name = node(
        &mut fixture.snapshot,
        syntax::IDENTIFIER,
        Some(extra),
        Some("other"),
    );
    node(
        &mut fixture.snapshot,
        syntax::QUESTION_TOKEN,
        Some(extra),
        None,
    );
    fixture.snapshot.node_types.insert(name, TypeId(1));
    fixture.snapshot.signatures[0]
        .parameters
        .push(ParameterRecord {
            name: "other".into(),
            ty: TypeId(1),
            optional: true,
            rest: false,
        });
    // Preserve normal method child order: all parameters precede the body.
    let children = &mut fixture.snapshot.nodes[fixture.declaration.0 as usize].children;
    let last = children.pop().unwrap();
    children.insert(children.len() - 1, last);
    assert_baseline(&fixture);
    let target = target(&fixture);
    let projection = projection(&fixture, &target).unwrap();
    assert_eq!(
        projection.arguments,
        vec![
            Argument::Pass(0),
            Argument::Pass(1),
            Argument::Undefined,
            Argument::Undefined
        ]
    );
    let bridge = projected_bridge("two-missing".into(), &target, &projection);
    let args = bridge
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call { args, .. } => Some(args),
            _ => None,
        })
        .unwrap();
    assert_eq!(args.len(), 4);
    assert_ne!(args[2], args[3]);
    for value in &args[2..] {
        let op = &bridge.values[value.0 as usize];
        assert_eq!(op.ty, HirType::Erased);
        assert!(matches!(op.kind, OpKind::ConstUndefined), "{op:?}");
    }
    assert!(!projection.is_identity(&target));
}

fn overloaded_property() -> (Fixture, Func, NodeId) {
    let mut fixture = fixture();
    let target = target(&fixture); // The actual written body, before the property aliases its overload.
    let parent = fixture.snapshot.nodes[fixture.declaration.0 as usize].parent;
    let overload = node(
        &mut fixture.snapshot,
        syntax::METHOD_DECLARATION,
        parent,
        None,
    );
    node(
        &mut fixture.snapshot,
        syntax::IDENTIFIER,
        Some(overload),
        Some("count"),
    );
    node(
        &mut fixture.snapshot,
        syntax::TYPE_PARAMETER,
        Some(overload),
        Some("T"),
    );
    let symbol = nts_semantic_schema::SymbolId(0);
    fixture.snapshot.nodes[overload.0 as usize].symbol = Some(symbol);
    fixture
        .snapshot
        .symbols
        .push(nts_semantic_schema::SymbolRecord {
            name: "count".into(),
            builtin: None,
            flags: nts_semantic_schema::SymbolFlags(0),
            declarations: vec![overload, fixture.declaration],
            ty: Some(TypeId(3)),
            aliased: None,
            library: None,
        });
    let parameter = TypeId(u32::try_from(fixture.snapshot.types.len()).unwrap());
    fixture.snapshot.types.push(TypeRecord {
        kind: TypeKind::TypeParameter {
            name: "T".into(),
            constraint: None,
            is_this: false,
        },
        symbol: None,
    });
    fixture.snapshot.signatures[0]
        .type_parameters
        .push(parameter);
    // Intentionally incompatible PRIMARY-overload result. The actual target
    // and interface still agree; using this alias as the body's result is wrong.
    fixture.snapshot.signatures[0].return_type = TypeId(2);
    fixture.mine.declaration = Some(overload);
    let TypeKind::Object { properties } = &mut fixture.snapshot.types[5].kind else {
        unreachable!()
    };
    properties[0] = fixture.mine.clone();
    if let Some(parent) = parent {
        let children = &mut fixture.snapshot.nodes[parent.0 as usize].children;
        let last = children.pop().unwrap();
        children.insert(0, last);
    }
    (fixture, target, overload)
}

#[test]
fn bound_overload_projection_uses_the_written_body_without_widening_inference() {
    let (fixture, target, overload) = overloaded_property();
    let indexed = LoweringSnapshot::new(&fixture.snapshot);
    let probe = FuncBuilder::probe(&indexed);
    assert!(
        interfaces::contract(&probe, &fixture.mine).is_none(),
        "generic overload inference stays excluded"
    );
    assert!(!interfaces::fits(
        &probe,
        &Hierarchy::default(),
        &fixture.mine,
        &fixture.wanted
    ));
    let projected = projection(&fixture, &target).expect("already-bound nongeneric implementation must project independently of the primary overload alias");
    assert_eq!(projected.arguments.last(), Some(&Argument::Undefined));
    assert!(!projected.is_identity(&target));
    for mutation in 0..4 {
        let mut changed = fixture.clone();
        match mutation {
            0 => changed.snapshot.nodes[overload.0 as usize].symbol = None,
            1 => changed.snapshot.symbols[0].declarations = vec![overload],
            2 => {
                node(
                    &mut changed.snapshot,
                    syntax::TYPE_PARAMETER,
                    Some(changed.declaration),
                    Some("T"),
                );
            }
            3 => {
                let TypeKind::Object { properties } = &mut changed.snapshot.types[5].kind else {
                    unreachable!()
                };
                properties.push(changed.mine.clone());
            }
            _ => unreachable!(),
        }
        assert!(
            projection(&changed, &target).is_none(),
            "bound overload proof mutation {mutation} admitted"
        );
    }
}

fn table_caller(template: &Func) -> Func {
    let mut caller = template.clone();
    caller.name = "table_caller".into();
    caller.params.truncate(2);
    caller.values = caller
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| crate::hir::Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: param.ty.clone(),
            origin: param.origin.clone(),
        })
        .collect();
    for (slot, declared) in [(0, "Counter#count"), (1, "Counter#other")] {
        caller.values.push(crate::hir::Op {
            kind: OpKind::Call {
                callee: Callee::Virtual {
                    slot,
                    declared: declared.into(),
                },
                args: vec![crate::hir::ValueId(0), crate::hir::ValueId(1)],
                frame: None,
            },
            ty: HirType::NUMBER,
            origin: caller.origin.clone(),
        });
    }
    caller.blocks[0].ops = vec![crate::hir::ValueId(2), crate::hir::ValueId(3)];
    caller.blocks[0].terminator = Terminator::Return(Some(crate::hir::ValueId(3)));
    caller
}

fn table_program(fixture: &Fixture) -> (Program, Hierarchy) {
    let mut implementation = target(fixture);
    implementation.values = implementation
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| crate::hir::Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: param.ty.clone(),
            origin: param.origin.clone(),
        })
        .collect();
    implementation.blocks[0].terminator = Terminator::Return(Some(crate::hir::ValueId(1)));
    let caller = table_caller(&implementation);
    let mut other = implementation.clone();
    other.name = "Parent#other".into();
    other.params.truncate(2);
    other.values.truncate(2);
    let mut declaration = other.clone();
    declaration.name = "Counter#count".into();
    declaration.params[0].ty = HirType::Managed(ManagedType::Object(TypeId(6)));
    declaration.values[0].ty = declaration.params[0].ty.clone();
    declaration.abstract_declaration = true;
    declaration.blocks.clear();
    let mut other_declaration = declaration.clone();
    other_declaration.name = "Counter#other".into();
    let layout = crate::hir::Layout {
        types: vec![TypeId(5)],
        name: "Parent".into(),
        fields: Vec::new(),
        methods: vec![Some(implementation.name.clone()), Some(other.name.clone())],
        interfaces: vec![TypeId(6)],
        base: None,
    };
    let program = Program {
        funcs: vec![
            implementation,
            other,
            declaration,
            other_declaration,
            caller,
        ],
        layouts: vec![layout],
        ..Program::default()
    };
    let hierarchy = Hierarchy {
        faces: rustc_hash::FxHashSet::from_iter([TypeId(6)]),
        name: FxHashMap::from_iter([(TypeId(5), "Parent".into()), (TypeId(6), "Counter".into())]),
        slots: FxHashMap::from_iter([
            ((TypeId(6), MemberKey::named("count"), false), 0),
            ((TypeId(6), MemberKey::named("other"), false), 1),
        ]),
        ..Hierarchy::default()
    };
    (program, hierarchy)
}

fn table_fixture() -> Fixture {
    let mut fixture = fixture();
    let TypeKind::Object { properties } = &mut fixture.snapshot.types[6].kind else {
        unreachable!()
    };
    let mut other = fixture.wanted.clone();
    other.name = "other".into();
    properties.push(other);
    fixture
}

fn assert_unrelated_slot(program: &Program) {
    assert_eq!(
        program.layouts[0].methods[1].as_deref(),
        Some("Parent#other")
    );
    let caller = program
        .funcs
        .iter()
        .find(|func| func.name == "table_caller")
        .unwrap();
    assert!(
        matches!(&caller.values[3].kind, OpKind::Call {
        callee: Callee::Virtual { slot: 1, declared }, ..
    } if declared == "Counter#other"),
        "valid unrelated slot changed: {:?}",
        caller.values[3]
    );
}

#[test]
fn actual_table_adaptation_rejects_unlicensed_tail_without_poisoning_other_slots() {
    let baseline = table_fixture();
    let (mut valid, hierarchy) = table_program(&baseline);
    let indexed = LoweringSnapshot::new(&baseline.snapshot);
    super::bridge(&indexed, &hierarchy, &mut valid);
    assert_unrelated_slot(&valid);
    assert!(
        valid.uncompiled.is_empty(),
        "eligible baseline refused: {:?}",
        valid.uncompiled
    );
    let entry = valid.layouts[0].methods[0].as_ref().unwrap();
    assert_ne!(entry, "Parent#count");
    let adapter = valid.funcs.iter().find(|func| &func.name == entry).unwrap();
    assert_eq!(adapter.params.len(), 2);
    assert!(
        !valid.identity_projections.contains_key(entry),
        "padded adapter was identity"
    );
    let args = adapter
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } if name == "Parent#count" => Some(args),
            _ => None,
        })
        .unwrap();
    assert_eq!(args.len(), 3);
    assert!(matches!(
        adapter.values[args[2].0 as usize].kind,
        OpKind::ConstUndefined
    ));
    let mut required = baseline.clone();
    required.snapshot.nodes[required.tail.0 as usize]
        .children
        .retain(|node| *node != required.question);
    required.snapshot.signatures[0].parameters[1].optional = false;
    let (mut rejected, hierarchy) = table_program(&required);
    let indexed = LoweringSnapshot::new(&required.snapshot);
    super::bridge(&indexed, &hierarchy, &mut rejected);
    assert_unrelated_slot(&rejected);
    assert_eq!(rejected.uncompiled.len(), 1);
    let refused = &rejected.uncompiled[0].0;
    assert_eq!(rejected.layouts[0].methods[0].as_ref(), Some(refused));
    assert!(
        !rejected.funcs.iter().any(|func| &func.name == refused),
        "rejected slot unexpectedly published a body"
    );
    let caller = rejected
        .funcs
        .iter()
        .find(|func| func.name == "table_caller")
        .unwrap();
    let OpKind::Call { callee, .. } = &caller.values[2].kind else {
        panic!("affected call lost")
    };
    let present = rejected
        .funcs
        .iter()
        .map(|func| func.name.clone())
        .collect();
    assert_eq!(
        crate::hir::refused::missing_callee(callee, &present),
        Some(refused.as_str()),
        "actual pass must register and rewrite the rejected slot call"
    );
}

#[test]
fn receiver_plan_uses_the_final_rebased_input_during_return_projection() {
    let mut fixture = fixture();
    fixture.snapshot.signatures[1].return_type = TypeId(1); // The face answers unknown.
    let indexed = LoweringSnapshot::new(&fixture.snapshot);
    let probe = FuncBuilder::probe(&indexed);
    let contract = interfaces::contract(&probe, &fixture.wanted).unwrap();
    assert_eq!(contract.returns, HirType::Erased);
    let mut target = target(&fixture);
    target.params.truncate(2); // Ordinary previously-supported projection, no missing tail.
    target.params[0].ty = HirType::Erased;
    let mut through = target.clone();
    through.params[0].ty = HirType::Managed(ManagedType::Object(TypeId(6)));
    through.return_type = HirType::Erased;
    let projected = interface_projection(
        &fixture.snapshot,
        &Hierarchy::default(),
        &FxHashMap::default(),
        &through,
        &target,
        &contract,
        None,
    )
    .unwrap();
    assert_eq!(
        projected.params[0].ty,
        HirType::Erased,
        "receiver was rebased"
    );
    assert_eq!(
        projected.arguments,
        vec![Argument::Pass(0), Argument::Pass(1)]
    );
    assert!(
        !projected.is_identity(&target),
        "return boxing still requires a projection"
    );
    let bridge = projected_bridge("rebased-return".into(), &target, &projected);
    assert_eq!(bridge.params[0].ty, HirType::Erased);
    let args = bridge
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } if name == &target.name => Some(args),
            _ => None,
        })
        .unwrap();
    assert_eq!(args[0], crate::hir::ValueId(0));
    assert_eq!(args.len(), 2);
    assert!(
        bridge.values.iter().all(|op| !matches!(
            op.kind,
            OpKind::Erase {
                value: crate::hir::ValueId(0),
                ..
            }
        )),
        "already-erased receiver must not be erased again"
    );
    let boxed: Vec<_> = bridge
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Erase { value, .. } => Some(*value),
            _ => None,
        })
        .collect();
    assert_eq!(boxed.len(), 1, "only the actual numeric result is boxed");
    assert!(matches!(
        bridge.values[boxed[0].0 as usize].kind,
        OpKind::Call { .. }
    ));
    through.params[0].ty = HirType::Erased;
    let same_receiver = interface_projection(
        &fixture.snapshot,
        &Hierarchy::default(),
        &FxHashMap::default(),
        &through,
        &target,
        &contract,
        None,
    )
    .unwrap();
    assert_eq!(
        AdapterKey::of(&fixture.snapshot, &target, &projected),
        AdapterKey::of(&fixture.snapshot, &target, &same_receiver),
        "receiver remains excluded from key under the shared rebase invariant"
    );
}
