//! Required container layout discovery cannot silently skip a deep payload.

use super::{FuncBuilder, HirType, LoweringSnapshot, ManagedType, NodeId, TypeId};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, NodeData, NodeKind, NodeRecord, Origin, SemanticSnapshot, TypeKind,
    TypeRecord, syntax,
};

fn snapshot() -> SemanticSnapshot {
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
    snapshot.types = vec![
        TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new()
            },
            symbol: None
        };
        2
    ];
    snapshot
}

fn nested(mut ty: HirType, depth: usize, optional: bool) -> HirType {
    for at in 0..depth {
        if optional && at % 4 == 3 {
            ty = HirType::PossiblyUndefined(Box::new(ty));
            continue;
        }
        ty = HirType::Managed(match at % 4 {
            0 => ManagedType::Array(Box::new(ty)),
            1 => ManagedType::Promise(Box::new(ty)),
            _ => ManagedType::Set(Box::new(ty)),
        });
    }
    ty
}

#[test]
fn every_container_payload_is_materialized_beyond_the_old_depth() {
    for depth in [4, 80] {
        for record in [false, true] {
            for optional in [false, true] {
                let snapshot = snapshot();
                let lowering = LoweringSnapshot::new(&snapshot);
                let mut builder = FuncBuilder::probe(&lowering);
                let key = Box::new(nested(
                    HirType::Managed(ManagedType::Object(TypeId(0))),
                    depth,
                    optional,
                ));
                let value = Box::new(nested(
                    HirType::Managed(ManagedType::Object(TypeId(1))),
                    depth,
                    optional,
                ));
                let ty = HirType::Managed(if record {
                    ManagedType::Table(key, value)
                } else {
                    ManagedType::Map(key, value)
                });
                builder
                    .materialize(NodeId(0), &ty)
                    .expect("complete container layout discovery");
                for object in [TypeId(0), TypeId(1)] {
                    assert!(
                        builder
                            .layouts
                            .iter()
                            .any(|layout| layout.types.contains(&object)),
                        "depth {depth}, {object:?}"
                    );
                }
                let count = builder.layouts.len();
                builder
                    .materialize(NodeId(0), &ty)
                    .expect("idempotent discovery");
                assert_eq!(builder.layouts.len(), count);
            }
        }
    }
}

#[test]
fn a_missing_deep_object_layout_is_an_error_not_success() {
    let snapshot = snapshot();
    let lowering = LoweringSnapshot::new(&snapshot);
    let mut builder = FuncBuilder::probe(&lowering);
    let ty = nested(HirType::Managed(ManagedType::Object(TypeId(99))), 80, false);
    assert!(builder.materialize(NodeId(0), &ty).is_err());
}
