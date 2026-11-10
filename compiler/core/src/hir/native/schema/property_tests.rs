//! A member identity and its declared type survive the same guarded walk.

use super::*;
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    Accessor, DeclarationModifiers, NodeData, NodeRecord, Origin, SymbolFlags, SymbolRecord,
    TypeRecord,
};

#[test]
fn exact_keys_and_nullable_contracts_survive_nested_and_cyclic_intersections() {
    let keys = [
        PropertyKey::Name("value".to_owned()),
        PropertyKey::Private("#value".to_owned()),
        PropertyKey::Symbol(TypeId(4)),
        PropertyKey::Name("#value".to_owned()),
    ];
    let properties = keys
        .iter()
        .cloned()
        .map(|name| PropertyRecord {
            name,
            ty: TypeId(5),
            readonly: false,
            optional: false,
            declaration: None,
            kind: MemberKind::Accessor(Accessor::GetSet),
            own: true,
        })
        .collect();
    let kinds = [
        // A cycle before the real branch must not conceal that branch.
        TypeKind::Intersection(vec![TypeId(0), TypeId(1)]),
        TypeKind::Intersection(vec![TypeId(2), TypeId(3)]),
        TypeKind::Intersection(vec![TypeId(0)]),
        TypeKind::Object { properties },
        TypeKind::UniqueSymbol,
        TypeKind::Union(vec![TypeId(6), TypeId(7)]),
        TypeKind::Null,
        TypeKind::String,
    ];
    let snapshot = SemanticSnapshot {
        types: kinds
            .into_iter()
            .map(|kind| TypeRecord { kind, symbol: None })
            .collect(),
        ..SemanticSnapshot::default()
    };
    for key in &keys {
        let found = property_key(&snapshot, TypeId(0), key).expect("intersection member");
        assert_eq!(&found.name, key);
        assert_eq!(found.ty, TypeId(5), "retain the getter's nullable type");
    }
    assert_eq!(
        property(&snapshot, TypeId(0), "#value").map(|member| &member.name),
        Some(&keys[3]),
        "a native marker name cannot alias a private key"
    );
    assert!(property(&snapshot, TypeId(0), "missing").is_none());
    assert!(property_key(&snapshot, TypeId(0), &PropertyKey::Symbol(TypeId(6))).is_none());
}

/// One node, appended; its id is its index.
fn push(
    snapshot: &mut SemanticSnapshot,
    kind: u16,
    children: Vec<NodeId>,
    symbol: Option<SymbolId>,
    small: u8,
) -> NodeId {
    let id = NodeId(u32::try_from(snapshot.nodes.len()).expect("node count fits"));
    snapshot.nodes.push(NodeRecord {
        kind: NodeKind::Syntax(kind),
        parent: None,
        children,
        symbol,
        flags: 0,
        origin: Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 0),
        }),
        modifiers: DeclarationModifiers::default(),
        native: None,
        data: NodeData::Children { present: 0, small },
        text: None,
    });
    id
}

/// A class symbol, declared at `declaration` once that node exists.
fn class_symbol(snapshot: &mut SemanticSnapshot, name: &str) -> SymbolId {
    let id = SymbolId(u32::try_from(snapshot.symbols.len()).expect("symbol count fits"));
    snapshot.symbols.push(SymbolRecord {
        name: name.into(),
        flags: SymbolFlags::CLASS,
        builtin: None,
        declarations: Vec::new(),
        declaration_sites: Vec::new(),
        ty: None,
        aliased: None,
        owner: None,
        constructor_value: None,
        library: None,
    });
    id
}

/// `class <name>` with one heritage clause (`small`: 0 `extends`,
/// 1 `implements`) naming `target`, or none where `target` is `None`.
fn class(
    snapshot: &mut SemanticSnapshot,
    symbol: SymbolId,
    heritage: Option<(u8, SymbolId)>,
) -> NodeId {
    let children = match heritage {
        Some((small, target)) => {
            let name = push(snapshot, syntax::IDENTIFIER, Vec::new(), Some(target), 0);
            let expression = push(
                snapshot,
                syntax::EXPRESSION_WITH_TYPE_ARGUMENTS,
                vec![name],
                None,
                0,
            );
            vec![push(
                snapshot,
                syntax::HERITAGE_CLAUSE,
                vec![expression],
                None,
                small,
            )]
        }
        None => Vec::new(),
    };
    let declaration = push(snapshot, syntax::CLASS_DECLARATION, children, None, 0);
    snapshot.symbols[symbol.0 as usize].declarations = vec![declaration];
    declaration
}

#[test]
fn an_implements_clause_is_not_a_base_and_a_cyclic_chain_fails_closed() {
    let mut snapshot = SemanticSnapshot::default();
    let a = class_symbol(&mut snapshot, "A");
    let b = class_symbol(&mut snapshot, "B");
    // A finite chain: `A extends B`, and `B` extends nothing.
    let b_decl = class(&mut snapshot, b, None);
    let a_decl = class(&mut snapshot, a, Some((0, b)));
    assert_eq!(base_class(&snapshot, a_decl), Some(b_decl));
    assert_eq!(ancestry(&snapshot, a_decl), Some(vec![b_decl]));

    // The #497 shape: `C implements C`, its own merged interface. The
    // clause names no base, so the chain is empty -- and finite.
    let c = class_symbol(&mut snapshot, "C");
    let c_decl = class(&mut snapshot, c, Some((1, c)));
    assert_eq!(base_class(&snapshot, c_decl), None);
    assert_eq!(ancestry(&snapshot, c_decl), Some(Vec::new()));

    // A cycle a checker-error snapshot can still carry: `B extends A`
    // closes A -> B -> A. The ancestry is unknown, not the partial
    // chain, and every walk over it answers at once.
    let b_decl = class(&mut snapshot, b, Some((0, a)));
    assert_eq!(base_class(&snapshot, b_decl), Some(a_decl));
    assert_eq!(ancestry(&snapshot, a_decl), None);
    assert!(!extends_objc(&snapshot, a_decl));
    assert!(composable_base(&snapshot, a_decl).is_none());
}
