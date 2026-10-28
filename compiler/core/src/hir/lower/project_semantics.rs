//! Project compile policy and construct-specific emitted-runtime settings.

use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{
    DeclarationModifiers, NodeData, NodeId, NodeKind, NodeRecord, SemanticSnapshot, syntax,
};

pub(super) fn rejections(snapshot: &SemanticSnapshot) -> Vec<Diagnostic> {
    let semantics = &snapshot.semantics;
    let strict = super::super::project_policy::strict_rejections(snapshot);
    if !strict.is_empty() {
        return strict;
    }
    if semantics.use_define_for_class_fields
        && !semantics.experimental_decorators
        && !semantics.emit_decorator_metadata
    {
        return Vec::new();
    }
    let mut field = None;
    let mut decorator = None;
    for node in &snapshot.nodes {
        match node.kind {
            NodeKind::Syntax(syntax::PROPERTY_DECLARATION)
                if !semantics.use_define_for_class_fields
                    && field.is_none()
                    && is_emitted(snapshot, node) =>
            {
                field = Some(node);
            }
            NodeKind::Syntax(syntax::DECORATOR)
                if (semantics.experimental_decorators || semantics.emit_decorator_metadata)
                    && decorator.is_none()
                    && is_emitted(snapshot, node) =>
            {
                decorator = Some(node);
            }
            _ => {}
        }
    }
    let mut rejected = Vec::new();
    if !semantics.use_define_for_class_fields
        && let Some(field) = field
    {
        // The declaration's name is a direct child; its initializer and type
        // are never searched for a substitute spelling.
        let name = field_name(snapshot, field);
        let what = name.map_or_else(
            || "a class field".to_owned(),
            |name| format!("class field `{name}`"),
        );
        rejected.push(Diagnostic::error(
            "NTS1001",
            format!("{what} needs useDefineForClassFields: true (effective false)"),
            field.origin.location,
        ));
    }
    if let Some(decorator) = decorator {
        for (enabled, setting) in [
            (semantics.experimental_decorators, "experimentalDecorators"),
            (semantics.emit_decorator_metadata, "emitDecoratorMetadata"),
        ] {
            if enabled {
                rejected.push(Diagnostic::error(
                    "NTS1001",
                    format!("a decorator needs {setting}: false (effective true)"),
                    decorator.origin.location,
                ));
            }
        }
    }
    rejected
}

fn field_name<'a>(snapshot: &'a SemanticSnapshot, field: &NodeRecord) -> Option<&'a str> {
    let slot = nts_semantic_schema::children::properties(syntax::PROPERTY_DECLARATION)
        .iter()
        .position(|name| *name == "name")?;
    let NodeData::Children { present, .. } = field.data else {
        return None;
    };
    if present & (1 << slot) == 0 {
        return None;
    }
    let index = (present & ((1 << slot) - 1)).count_ones() as usize;
    let child = snapshot.nodes.get(field.children.get(index)?.0 as usize)?;
    child.text.as_ref().and_then(|text| text.as_utf8())
}

fn is_emitted(snapshot: &SemanticSnapshot, node: &NodeRecord) -> bool {
    if node.modifiers.contains(DeclarationModifiers::ABSTRACT) {
        return false;
    }
    if snapshot
        .sources
        .get(node.origin.location.file.0 as usize)
        .is_some_and(|source| {
            [".d.ts", ".d.mts", ".d.cts"]
                .iter()
                .any(|extension| source.uri.ends_with(extension))
        })
    {
        return false;
    }
    let mut at = Some(node);
    while let Some(node) = at {
        if node.modifiers.contains(DeclarationModifiers::DECLARE) {
            return false;
        }
        at = node
            .parent
            .and_then(|id: NodeId| snapshot.nodes.get(id.0 as usize));
    }
    true
}
