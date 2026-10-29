//! A binding's ownership and mutability survive arbitrarily nested patterns.

use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, NodeData, NodeId, NodeKind, NodeRecord, Origin, SemanticSnapshot,
    SymbolFlags, SymbolRecord, VariableKind, syntax,
};

fn binding(depth: u32, owner: u16, kind: VariableKind) -> SemanticSnapshot {
    let mut snapshot = SemanticSnapshot::default();
    let mut add = |kind, parent| {
        let id = NodeId(u32::try_from(snapshot.nodes.len()).expect("small test AST"));
        snapshot.nodes.push(NodeRecord {
            kind,
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
        id
    };
    let root = add(NodeKind::Syntax(owner), None);
    let list = add(
        NodeKind::Syntax(syntax::VARIABLE_DECLARATION_LIST),
        Some(root),
    );
    let mut parent = add(NodeKind::List, Some(list));
    parent = add(NodeKind::Syntax(syntax::VARIABLE_DECLARATION), Some(parent));
    for _ in 0..depth {
        parent = add(
            NodeKind::Syntax(syntax::OBJECT_BINDING_PATTERN),
            Some(parent),
        );
        parent = add(NodeKind::List, Some(parent));
        parent = add(NodeKind::Syntax(syntax::BINDING_ELEMENT), Some(parent));
    }
    let declaration = parent;
    snapshot.nodes[list.0 as usize].flags = kind.node_flags();
    snapshot.symbols.push(SymbolRecord {
        name: "binding".into(),
        flags: SymbolFlags::VARIABLE,
        builtin: None,
        declarations: vec![declaration],
        declaration_sites: Vec::new(),
        ty: None,
        aliased: None,
        library: None,
    });
    snapshot
}

#[test]
fn nested_patterns_keep_their_variable_kind_and_iteration_owner() {
    for depth in [0, 1, 8, 256] {
        for kind in [VariableKind::Let, VariableKind::Const, VariableKind::Var] {
            let snapshot = binding(depth, syntax::FOR_STATEMENT, kind);
            let lowering = super::LoweringSnapshot::new(&snapshot);
            let builder = super::FuncBuilder::probe(&lowering);
            let record = &snapshot.symbols[0];
            let declaration = record.declarations[0];
            assert_eq!(
                builder.variable_kind(declaration),
                Some(kind),
                "depth {depth}"
            );
            assert_eq!(
                builder.per_iteration_loop(record),
                Some((NodeId(0), declaration)),
                "depth {depth}"
            );
        }
    }
}

#[test]
fn a_body_binding_stops_before_the_outer_loop() {
    let mut snapshot = binding(256, syntax::BLOCK, VariableKind::Let);
    let mut outer = snapshot.nodes[0].clone();
    outer.kind = NodeKind::Syntax(syntax::FOR_STATEMENT);
    snapshot.nodes[0].parent = Some(NodeId(
        u32::try_from(snapshot.nodes.len()).expect("small AST"),
    ));
    snapshot.nodes.push(outer);
    let lowering = super::LoweringSnapshot::new(&snapshot);
    let builder = super::FuncBuilder::probe(&lowering);
    assert_eq!(
        builder.variable_kind(snapshot.symbols[0].declarations[0]),
        Some(VariableKind::Let)
    );
    assert_eq!(builder.per_iteration_loop(&snapshot.symbols[0]), None);
}

#[test]
fn a_parameter_does_not_take_the_kind_of_a_containing_initializer() {
    let mut snapshot = binding(0, syntax::FOR_STATEMENT, VariableKind::Const);
    let declaration = snapshot.symbols[0].declarations[0];
    let mut arrow = snapshot.nodes[declaration.0 as usize].clone();
    arrow.kind = NodeKind::Syntax(syntax::ARROW_FUNCTION);
    arrow.parent = Some(declaration);
    let arrow_id = NodeId(u32::try_from(snapshot.nodes.len()).expect("small AST"));
    snapshot.nodes.push(arrow.clone());
    let mut list = arrow;
    list.kind = NodeKind::List;
    list.parent = Some(arrow_id);
    let list_id = NodeId(u32::try_from(snapshot.nodes.len()).expect("small AST"));
    snapshot.nodes.push(list.clone());
    let mut parameter = list;
    parameter.kind = NodeKind::Syntax(syntax::PARAMETER);
    parameter.parent = Some(list_id);
    let at = NodeId(u32::try_from(snapshot.nodes.len()).expect("small AST"));
    snapshot.nodes.push(parameter);
    snapshot.symbols[0].declarations = vec![at];
    let lowering = super::LoweringSnapshot::new(&snapshot);
    let builder = super::FuncBuilder::probe(&lowering);
    assert_eq!(builder.variable_kind(at), None);
    assert_eq!(builder.per_iteration_loop(&snapshot.symbols[0]), None);
}
