//! A source view changes neither the collection carrier nor a prior check.

use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, NodeData, NodeId, NodeKind, NodeRecord, Origin, SemanticSnapshot, syntax,
};

use super::{FuncBuilder, HirType, LoweringSnapshot, ManagedType, OpKind};

#[test]
fn collection_views_are_flat_and_keep_the_checked_carrier() {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 0),
    });
    let mut snapshot = SemanticSnapshot::default();
    snapshot.nodes.push(NodeRecord {
        kind: NodeKind::Syntax(syntax::IDENTIFIER),
        parent: None,
        children: Vec::new(),
        symbol: None,
        flags: 0,
        origin: origin.clone(),
        modifiers: DeclarationModifiers::default(),
        native: None,
        data: NodeData::Flags { small: 0 },
        text: None,
    });
    let lowering = LoweringSnapshot::new(&snapshot);
    for map in [true, false] {
        let collection = |element| {
            HirType::Managed(if map {
                ManagedType::Map(Box::new(HirType::NUMBER), Box::new(element))
            } else {
                ManagedType::Set(Box::new(element))
            })
        };
        let narrow = collection(HirType::NUMBER);
        let wide = collection(HirType::Erased);
        let mut builder = FuncBuilder::probe(&lowering);
        let input = builder.push(OpKind::Param(0), HirType::Erased, origin.clone());
        // The projection is a narrowing boundary, not a same-family view.
        let checked = builder.push(OpKind::unerase(input), narrow.clone(), origin.clone());
        let mut value = checked;
        for index in 0..256 {
            let want = if index % 2 == 0 { &wide } else { &narrow };
            value = builder.collection_view(NodeId(0), value, want.clone());
            assert_eq!(&builder.values[value.0 as usize].ty, want);
            if value != checked {
                assert!(
                    matches!(builder.values[value.0 as usize].kind, OpKind::Convert(source) if source == checked),
                    "every source view must directly name the checked carrier"
                );
            }
            assert!(
                matches!(builder.values[checked.0 as usize].kind, OpKind::Unerase { value, .. } if value == input),
                "collapsing no-op views must preserve the narrowing link"
            );
        }
    }
}
