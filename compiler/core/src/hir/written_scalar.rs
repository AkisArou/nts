//! Source annotation policy shared by lowering and source-only root planning.

use nts_semantic_schema::{
    DeclarationModifiers, NodeId, NodeKind, SemanticSnapshot, TypeId, syntax,
};

use super::native::{self, Scalar};

/// Syntactic children with the frontend's list containers flattened once.
pub fn children(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
) -> impl DoubleEndedIterator<Item = NodeId> + '_ {
    snapshot.nodes[declaration.0 as usize]
        .children
        .iter()
        .flat_map(|child| {
            let node = &snapshot.nodes[child.0 as usize];
            if node.kind == NodeKind::List {
                node.children.as_slice()
            } else {
                std::slice::from_ref(child)
            }
        })
        .copied()
}

fn kind(snapshot: &SemanticSnapshot, node: NodeId) -> Option<u16> {
    match snapshot.nodes[node.0 as usize].kind {
        NodeKind::Syntax(kind) => Some(kind),
        NodeKind::List => None,
    }
}

/// Whether the declaration has its own written type annotation.
#[must_use]
pub fn annotated(snapshot: &SemanticSnapshot, declaration: NodeId) -> bool {
    children(snapshot, declaration)
        .any(|child| syntax::is_type_node(kind(snapshot, child).unwrap_or(0)))
}

/// A parameter's initializer, preserving destructured names and optional marks.
#[must_use]
pub fn default_of(snapshot: &SemanticSnapshot, parameter: NodeId) -> Option<NodeId> {
    let last = children(snapshot, parameter).next_back()?;
    // A binding pattern is a name too. Treating only identifiers as names loses
    // the default in `function f({ a = 1 }: Options = {})`.
    let name = children(snapshot, parameter).find(|child| {
        matches!(
            kind(snapshot, *child),
            Some(
                syntax::IDENTIFIER | syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN
            )
        )
    })?;
    (last != name
        && !syntax::is_type_node(kind(snapshot, last).unwrap_or(0))
        && kind(snapshot, last) != Some(syntax::QUESTION_TOKEN))
    .then_some(last)
}

/// A declaration's written scalar, including a parameter's contextual type
/// only when that parameter has no default initializer.
#[must_use]
pub fn parameter(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
    resolved: TypeId,
) -> Option<Scalar> {
    let contextual = kind(snapshot, declaration) == Some(syntax::PARAMETER)
        && default_of(snapshot, declaration).is_none();
    if contextual || annotated(snapshot, declaration) {
        native::present_scalar(snapshot, resolved)
    } else {
        None
    }
}

/// A written return scalar. The caller resolves overload selection first;
/// async declarations name the scalar of their Promise's payload.
#[must_use]
pub fn returned(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
    resolved: TypeId,
) -> Option<Scalar> {
    if !annotated(snapshot, declaration) {
        return None;
    }
    let resolved = if snapshot.nodes[declaration.0 as usize]
        .modifiers
        .contains(DeclarationModifiers::ASYNC)
    {
        *snapshot.type_arguments.get(&resolved)?.first()?
    } else {
        resolved
    };
    native::present_scalar(snapshot, resolved)
}
