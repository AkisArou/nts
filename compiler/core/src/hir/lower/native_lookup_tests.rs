//! Native lookup completeness is independent of declaration depth.

use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, MemberKind, NativeAttributes, NodeData, NodeId, NodeKind, NodeRecord,
    Origin, PropertyKey, PropertyRecord, SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord,
    TypeId, TypeKind, TypeRecord, syntax,
};

fn node(snapshot: &mut SemanticSnapshot, kind: u16, parent: Option<NodeId>) -> NodeId {
    let id = NodeId(u32::try_from(snapshot.nodes.len()).expect("small AST"));
    snapshot.nodes.push(NodeRecord {
        kind: NodeKind::Syntax(kind),
        parent,
        children: Vec::new(),
        symbol: None,
        flags: 0,
        origin: Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 0),
        }),
        modifiers: DeclarationModifiers::default(),
        native: None,
        data: NodeData::Flags { small: 0 },
        text: None,
    });
    if let Some(parent) = parent {
        snapshot.nodes[parent.0 as usize].children.push(id);
    }
    id
}

fn named_member(snapshot: &mut SemanticSnapshot, owner: NodeId, kind: u16, name: &str) -> NodeId {
    let member = node(snapshot, kind, Some(owner));
    let name_node = node(snapshot, syntax::IDENTIFIER, Some(member));
    snapshot.nodes[name_node.0 as usize].text = Some(name.into());
    member
}

fn native_classes(depth: u32) -> (SemanticSnapshot, NodeId, NodeId, NodeId) {
    let mut snapshot = SemanticSnapshot::default();
    let mut classes = Vec::new();
    for at in 0..=depth {
        let class = node(&mut snapshot, syntax::CLASS_DECLARATION, None);
        snapshot.symbols.push(SymbolRecord {
            name: format!("Class{at}").into(),
            flags: SymbolFlags::CLASS,
            builtin: None,
            declarations: vec![class],
            declaration_sites: Vec::new(),
            ty: None,
            aliased: None,
            owner: None,
            constructor_value: None,
            library: None,
        });
        if at != 0 {
            let clause = node(&mut snapshot, syntax::HERITAGE_CLAUSE, Some(class));
            let expression = node(
                &mut snapshot,
                syntax::EXPRESSION_WITH_TYPE_ARGUMENTS,
                Some(clause),
            );
            let base_name = node(&mut snapshot, syntax::IDENTIFIER, Some(expression));
            snapshot.nodes[base_name.0 as usize].symbol = Some(SymbolId(at - 1));
        }
        classes.push(class);
    }
    let root = classes[0];
    snapshot.nodes[root.0 as usize].native = Some(Box::new(NativeAttributes {
        class: Some("NativeBase".to_owned()),
        ..NativeAttributes::default()
    }));
    let method = named_member(&mut snapshot, root, syntax::METHOD_DECLARATION, "go");
    snapshot.nodes[method.0 as usize].native = Some(Box::new(NativeAttributes {
        selector: Some("actualGo".to_owned()),
        ..NativeAttributes::default()
    }));
    let property = named_member(&mut snapshot, root, syntax::PROPERTY_DECLARATION, "label");
    let derived = *classes.last().expect("at least the root");
    let getter = named_member(&mut snapshot, derived, syntax::GET_ACCESSOR, "label");
    (snapshot, derived, getter, property)
}

#[test]
fn selectors_and_properties_find_the_binding_after_64_bases() {
    for depth in [8, 80] {
        let (snapshot, derived, getter, property) = native_classes(depth);
        let lowering = super::LoweringSnapshot::new(&snapshot);
        let builder = super::FuncBuilder::probe(&lowering);
        assert_eq!(
            builder.overridden_selector(derived, "go", 0).as_deref(),
            Some("actualGo"),
            "depth {depth}"
        );
        assert_eq!(
            builder.overridden_property(getter, "label"),
            Some(property),
            "depth {depth}"
        );
        assert_eq!(builder.overridden_selector(derived, "absent", 0), None);
    }
}

fn property(name: &str, ty: TypeId) -> PropertyRecord {
    PropertyRecord {
        name: PropertyKey::Name(name.to_owned()),
        ty,
        readonly: true,
        optional: false,
        declaration: None,
        kind: MemberKind::Field,
        own: true,
    }
}

fn signal_constraints(depth: u32) -> (SemanticSnapshot, TypeId) {
    let mut snapshot = SemanticSnapshot::default();
    for kind in [
        TypeKind::Number,
        TypeKind::Tuple(nts_semantic_schema::TupleType {
            elements: vec![TypeId(0)],
            element_flags: vec![nts_semantic_schema::TupleElementKind::Required],
            fixed_length: 1,
            readonly: false,
        }),
        TypeKind::Object {
            properties: vec![property("changed", TypeId(1))],
        },
        TypeKind::Object {
            properties: vec![property("__c_signals", TypeId(2))],
        },
    ] {
        snapshot.types.push(TypeRecord { kind, symbol: None });
    }
    let mut current = TypeId(3);
    for at in 0..depth {
        let next = TypeId(u32::try_from(snapshot.types.len()).expect("small types"));
        snapshot.types.push(TypeRecord {
            kind: TypeKind::TypeParameter {
                name: format!("T{at}"),
                constraint: Some(current),
                is_this: false,
            },
            symbol: None,
        });
        current = next;
    }
    (snapshot, current)
}

#[test]
fn inherited_signals_survive_more_than_eight_constraints() {
    for depth in [4, 32] {
        let (snapshot, instance) = signal_constraints(depth);
        let signals = super::signals_of_type(&snapshot, instance).expect("complete signal lookup");
        assert_eq!(signals.len(), 1, "depth {depth}");
        assert_eq!(signals[0].name, "changed");
        assert_eq!(signals[0].kinds, "d");
    }
}

#[test]
fn an_unfinished_constraint_cycle_has_a_named_refusal() {
    let (mut snapshot, instance) = signal_constraints(1);
    snapshot.types[instance.0 as usize].kind = TypeKind::TypeParameter {
        name: "Cycle".into(),
        constraint: Some(instance),
        is_this: false,
    };
    assert_eq!(
        super::signals_of_type(&snapshot, instance).expect_err("cannot drop signals silently"),
        "a cyclic type-parameter constraint while discovering C signals"
    );
}

#[test]
fn captured_native_declarations_keep_the_original_selector_at_both_depths() {
    let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/native-query-depth/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in native query fixture");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture native query fixture");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowering = super::LoweringSnapshot::new(&snapshot);
    let builder = super::FuncBuilder::probe(&lowering);
    for name in ["Control", "Subject"] {
        let class = snapshot
            .symbols
            .iter()
            .find(|symbol| symbol.name.is_name(name))
            .and_then(|symbol| symbol.declarations.first())
            .copied()
            .expect("class declaration");
        assert_eq!(
            builder.overridden_selector(class, "go", 0).as_deref(),
            Some("actualGo"),
            "{name}"
        );
        let getter = builder
            .children(class)
            .into_iter()
            .find(|member| builder.kind_of(*member) == Some(syntax::GET_ACCESSOR))
            .expect("getter");
        assert_eq!(
            builder.property_selectors(getter, "label").0,
            "actualLabel",
            "{name}"
        );
    }
    let instance = snapshot
        .types
        .iter()
        .enumerate()
        .find_map(|(index, record)| match &record.kind {
            TypeKind::TypeParameter { name, .. } if name == "T32" => {
                Some(TypeId(u32::try_from(index).expect("fixture type index")))
            }
            _ => None,
        })
        .expect("last authored constraint");
    let signals = super::signals_of_type(&snapshot, instance).expect("authored signal constraints");
    assert_eq!(signals.len(), 1);
    assert_eq!(signals[0].name, "changed");
}
