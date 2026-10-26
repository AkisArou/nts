//! Checker questions are selected by syntax role, independently of spelling.

use nts_frontend_tsrs::{MetaProperty, Node};
use nts_semantic_schema::{NodeKind, SemanticSnapshot, syntax};

#[derive(Clone, Copy)]
pub(super) struct Queries {
    pub symbols: bool,
    pub types: bool,
}

pub(super) fn for_nodes(
    snapshot: &SemanticSnapshot,
    native_nodes: &[Option<Node<'_>>],
) -> Vec<Queries> {
    let mut queries = vec![
        Queries {
            symbols: true,
            types: true
        };
        snapshot.nodes.len()
    ];
    let mut pending = Vec::new();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if matches!(
            node.kind,
            NodeKind::Syntax(
                syntax::JSX_SELF_CLOSING_ELEMENT
                    | syntax::JSX_OPENING_ELEMENT
                    | syntax::JSX_CLOSING_ELEMENT
            )
        ) {
            // Tags denote intrinsic members or components. Keep their symbols;
            // the enclosing element, rather than its tag, supplies the type.
            pending.extend(node.children.first().map(|id| (*id, true)));
        }
        let phase_import = node.kind == NodeKind::Syntax(syntax::META_PROPERTY)
            && native_nodes[index].is_some_and(|native| {
                matches!(
                    native.attributes().meta_property,
                    Some(MetaProperty::ImportSource | MetaProperty::ImportDefer)
                )
            });
        let callee = node.parent.and_then(|parent| {
            let parent = &snapshot.nodes[parent.0 as usize];
            (parent.kind == NodeKind::Syntax(syntax::CALL_EXPRESSION))
                .then(|| parent.children.first().copied())
                .flatten()
                .filter(|id| id.0 as usize == index)
        });
        if let Some(callee) = callee.filter(|_| phase_import) {
            // import.source/defer is a call grammar production, not an
            // independently checkable value. Its call still supplies result
            // and signature facts; asking its callee's symbol forces an
            // expression-type query the native checker explicitly forbids.
            pending.push((callee, false));
        }
    }
    while let Some((id, symbols)) = pending.pop() {
        let index = id.0 as usize;
        let previous = queries[index];
        queries[index].symbols &= symbols;
        queries[index].types = false;
        if previous.types || previous.symbols != queries[index].symbols {
            pending.extend(
                snapshot.nodes[index]
                    .children
                    .iter()
                    .map(|id| (*id, symbols)),
            );
        }
    }
    queries
}
