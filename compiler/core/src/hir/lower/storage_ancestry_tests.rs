//! Physical storage discovery examines every base, including deep and shared bases.

use super::{HirType, LoweringSnapshot, ManagedType, NodeId, TypeId, type_bases};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, Library, NodeData, NodeKind, NodeRecord, Origin, SemanticSnapshot,
    SymbolFlags, SymbolId, SymbolRecord, TypeKind, TypeRecord, syntax,
};

fn graph(depth: u32, name: Option<&str>, kind: TypeKind) -> (SemanticSnapshot, TypeId) {
    let mut snapshot = SemanticSnapshot::default();
    snapshot.nodes.push(NodeRecord {
        kind: NodeKind::Syntax(syntax::IDENTIFIER),
        parent: None,
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
    snapshot.symbols.push(SymbolRecord {
        name: name.unwrap_or("Base").into(),
        flags: SymbolFlags::CLASS,
        builtin: None,
        declarations: Vec::new(),
        declaration_sites: Vec::new(),
        ty: None,
        aliased: None,
        library: name.map(|_| Library::Es),
    });
    snapshot.types.push(TypeRecord {
        kind,
        symbol: Some(SymbolId(0)),
    });
    let mut leaf = TypeId(0);
    for n in 1..=depth {
        let next = TypeId(n);
        snapshot.symbols.push(SymbolRecord {
            name: format!("Derived{n}").into(),
            flags: SymbolFlags::CLASS,
            builtin: None,
            declarations: Vec::new(),
            declaration_sites: Vec::new(),
            ty: None,
            aliased: None,
            library: None,
        });
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new(),
            },
            symbol: Some(SymbolId(n)),
        });
        snapshot.base_types.insert(next, vec![leaf]);
        leaf = next;
    }
    (snapshot, leaf)
}

#[test]
fn typed_array_storage_is_found_beyond_32_bases() {
    for depth in [4, 80] {
        let (snapshot, leaf) = graph(
            depth,
            Some("Uint8Array"),
            TypeKind::Object {
                properties: Vec::new(),
            },
        );
        assert_eq!(
            super::inherited_typed_array(&snapshot, leaf),
            Some(HirType::Int {
                bits: 8,
                signed: false
            })
        );
        assert_eq!(
            super::representation(&snapshot, leaf),
            Some(HirType::Managed(ManagedType::View(Box::new(
                HirType::Int {
                    bits: 8,
                    signed: false
                }
            ))))
        );
    }
}

#[test]
fn provided_error_storage_is_found_beyond_32_bases() {
    for depth in [4, 80] {
        let (snapshot, leaf) = graph(
            depth,
            Some("TypeError"),
            TypeKind::Object {
                properties: Vec::new(),
            },
        );
        let lowering = LoweringSnapshot::new(&snapshot);
        let builder = super::FuncBuilder::probe(&lowering);
        assert_eq!(
            builder.provided_error_base(leaf).as_deref(),
            Some("TypeError")
        );
    }
}

#[test]
fn every_storage_base_must_be_representable() {
    for depth in [4, 80] {
        let (snapshot, leaf) = graph(depth, None, TypeKind::Number);
        let lowering = LoweringSnapshot::new(&snapshot);
        let builder = super::FuncBuilder::probe(&lowering);
        assert!(
            builder.representable_bases(NodeId(0), leaf).is_err(),
            "depth {depth}"
        );
        let (snapshot, leaf) = graph(
            depth,
            None,
            TypeKind::Object {
                properties: Vec::new(),
            },
        );
        let lowering = LoweringSnapshot::new(&snapshot);
        let builder = super::FuncBuilder::probe(&lowering);
        assert!(builder.representable_bases(NodeId(0), leaf).is_ok());
    }
}

#[test]
fn base_graph_visits_shared_and_cyclic_edges_once_in_written_order() {
    let (mut snapshot, leaf) = graph(
        80,
        None,
        TypeKind::Object {
            properties: Vec::new(),
        },
    );
    snapshot.base_types.insert(TypeId(0), vec![leaf]);
    snapshot
        .base_types
        .insert(leaf, vec![TypeId(1), TypeId(79)]);
    let visited: Vec<_> = type_bases::walk(&snapshot, leaf, type_bases::Order::Written).collect();
    assert_eq!(&visited[..3], &[TypeId(1), TypeId(0), TypeId(79)]);
    assert_eq!(visited.len(), 80);
    assert_eq!(
        visited
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        80
    );
}

#[test]
fn provided_storage_preserves_the_existing_multiple_base_order() {
    for (first, last, expected) in [
        ("TypeError", "RangeError", None),
        ("Uint8Array", "Uint16Array", Some(16)),
    ] {
        let (mut snapshot, _) = graph(
            1,
            Some(first),
            TypeKind::Object {
                properties: Vec::new(),
            },
        );
        snapshot.symbols.push(SymbolRecord {
            name: last.into(),
            flags: SymbolFlags::CLASS,
            builtin: None,
            declarations: Vec::new(),
            declaration_sites: Vec::new(),
            ty: None,
            aliased: None,
            library: Some(Library::Es),
        });
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new(),
            },
            symbol: Some(SymbolId(2)),
        });
        snapshot
            .base_types
            .insert(TypeId(1), vec![TypeId(0), TypeId(2)]);
        let lowering = LoweringSnapshot::new(&snapshot);
        let builder = super::FuncBuilder::probe(&lowering);
        if let Some(bits) = expected {
            assert_eq!(
                super::inherited_typed_array(&snapshot, TypeId(1)),
                Some(HirType::Int {
                    bits,
                    signed: false
                })
            );
        } else {
            assert_eq!(
                builder.provided_error_base(TypeId(1)).as_deref(),
                Some(last)
            );
        }
        assert_eq!(
            type_bases::walk(&snapshot, TypeId(1), type_bases::Order::Written).collect::<Vec<_>>(),
            vec![TypeId(0), TypeId(2)]
        );
        assert_eq!(
            type_bases::walk(&snapshot, TypeId(1), type_bases::Order::Reversed).collect::<Vec<_>>(),
            vec![TypeId(2), TypeId(0)]
        );
    }
}
