//! Direct capture of native nodes into the syntax arena nts owns.
//!
//! Native visitor order is projected onto the schema's named slots. The walk
//! uses an explicit task stack, so source expression depth does not consume the
//! checking thread's stack. Borrowed native views remain inside capture.

mod projection;
pub(crate) mod roles;

#[cfg(test)]
mod tests;

use nts_diagnostics::{Digest, Location, SourceId, Span};
use nts_frontend_tsrs::{self as native, Edge, File, List, Node};
use nts_semantic_schema::{
    DeclarationModifiers, GeneratedReason, NodeData, NodeId, NodeKind, NodeRecord, Origin,
    SnapshotError, children, syntax,
};
use rustc_hash::FxHashMap;

use crate::{SyntaxTree, annotations, native_syntax};
use roles::Projection;

/// The owned file tree and the checked-revision identities corresponding to its
/// syntax nodes. Artificial list nodes have no native syntax identity.
#[derive(Debug)]
pub(crate) struct Captured<'p> {
    pub tree: SyntaxTree,
    pub native_nodes: Vec<Option<Node<'p>>>,
    pub by_node: FxHashMap<Node<'p>, NodeId>,
}

enum Task<'p> {
    Node(Node<'p>, Option<NodeId>),
    List(List<'p>, NodeId),
}

pub(crate) fn capture(file: File<'_>, source: SourceId) -> Result<Captured<'_>, SnapshotError> {
    let root = file.root();
    let fallback = file_origin(file, source)?;
    let mut output = Captured::new(file);
    let mut work = vec![Task::Node(root, None)];
    while let Some(task) = work.pop() {
        match task {
            Task::List(list, parent) => {
                let nodes: Vec<_> = list.iter().collect();
                let origin = origin(
                    list.span(),
                    list.token_start(),
                    source,
                    &output.tree.nodes[parent.0 as usize].origin,
                );
                let id = output.push(
                    None,
                    Some(parent),
                    NodeKind::List,
                    origin,
                    NodeData::ListLength(
                        u32::try_from(nodes.len()).map_err(|_| too_many_nodes(file))?,
                    ),
                    0,
                    DeclarationModifiers::default(),
                    None,
                );
                work.extend(
                    nodes
                        .into_iter()
                        .rev()
                        .map(|node| Task::Node(node, Some(id))),
                );
            }
            Task::Node(node, parent) => {
                let kind = native_syntax::to_semantic(node.kind()).ok_or_else(|| {
                    SnapshotError::Project(format!(
                        "native syntax kind {} is unknown in {}",
                        node.kind(),
                        file.path()
                    ))
                })?;
                let inherited =
                    parent.map_or(&fallback, |id| &output.tree.nodes[id.0 as usize].origin);
                let origin = origin(node.span(), node.token_start(), source, inherited);
                let attrs = node.attributes();
                let small = small(kind, &attrs)?;
                let flags = flags(&attrs);
                let modifiers = modifiers(&attrs);
                let projection::Projected {
                    present,
                    edges,
                    contents,
                } = projection::children(node, kind)?;
                let text = text(node);
                let (kind, data) = if let Some(nodes) = &contents {
                    (
                        NodeKind::List,
                        NodeData::ListLength(
                            u32::try_from(nodes.len()).map_err(|_| too_many_nodes(file))?,
                        ),
                    )
                } else if children::properties(kind).is_empty() {
                    (NodeKind::Syntax(kind), NodeData::Flags { small })
                } else {
                    (
                        NodeKind::Syntax(kind),
                        NodeData::Children { present, small },
                    )
                };
                let id = output.push(
                    Some(node),
                    parent,
                    kind,
                    origin,
                    data,
                    flags,
                    modifiers,
                    text,
                );
                output.annotate(node, id, file);
                if let Some(nodes) = contents {
                    work.extend(
                        nodes
                            .into_iter()
                            .rev()
                            .map(|node| Task::Node(node, Some(id))),
                    );
                } else {
                    for edge in edges.into_iter().rev() {
                        work.push(match edge {
                            Edge::Node { node, .. } => Task::Node(node, Some(id)),
                            Edge::List { list, .. } => Task::List(list, id),
                        });
                    }
                }
            }
        }
    }
    Ok(output)
}

fn too_many_nodes(file: File<'_>) -> SnapshotError {
    SnapshotError::Project(format!(
        "syntax in {} exceeds nts's arena range",
        file.path()
    ))
}

fn file_origin(file: File<'_>, source: SourceId) -> Result<Origin, SnapshotError> {
    let end = u32::try_from(file.text().encode_utf16().count()).map_err(|_| {
        SnapshotError::Project(format!("source {} exceeds nts's span range", file.path()))
    })?;
    Ok(Origin::source(Location {
        file: source,
        span: Span::new(0, end),
    }))
}

fn origin(
    span: Option<native::Utf16Span>,
    token: Option<native::Utf16Pos>,
    file: SourceId,
    parent: &Origin,
) -> Origin {
    span.map_or_else(
        || Origin::generated(parent.location, GeneratedReason::NativeAdapter),
        |span| {
            Origin::source(Location {
                file,
                span: Span::new(token.map_or(span.start.0, |at| at.0), span.end.0),
            })
        },
    )
}

impl<'p> Captured<'p> {
    fn new(file: File<'_>) -> Self {
        Self {
            tree: SyntaxTree {
                digest: Digest(file.content_digest().to_le_bytes()),
                nodes: Vec::new(),
                diagnostics: Vec::new(),
            },
            native_nodes: Vec::new(),
            by_node: FxHashMap::default(),
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "one append owns every node arena and its native-view association"
    )]
    fn push(
        &mut self,
        native: Option<Node<'p>>,
        parent: Option<NodeId>,
        kind: NodeKind,
        origin: Origin,
        data: NodeData,
        flags: u32,
        modifiers: DeclarationModifiers,
        text: Option<nts_semantic_schema::JsText>,
    ) -> NodeId {
        let id = NodeId(u32::try_from(self.tree.nodes.len()).expect("capture arena fits u32"));
        self.tree.nodes.push(NodeRecord {
            kind,
            origin,
            parent,
            children: Vec::new(),
            symbol: None,
            flags,
            modifiers,
            native: None,
            data,
            text,
        });
        self.native_nodes.push(native);
        if let Some(native) = native {
            self.by_node.entry(native).or_insert(id);
        }
        if let Some(parent) = parent {
            self.tree.nodes[parent.0 as usize].children.push(id);
        }
        id
    }

    fn annotate(&mut self, node: Node<'_>, id: NodeId, file: File<'_>) {
        let record = &mut self.tree.nodes[id.0 as usize];
        if !annotations::carries_native_attributes(record.kind) {
            return;
        }
        let documentation = if record.kind == NodeKind::Syntax(syntax::SOURCE_FILE) {
            file.text().to_owned()
        } else {
            node.documentation()
                .map(|doc| doc.raw)
                .collect::<Vec<_>>()
                .join("\n")
        };
        record.native = annotations::native_attributes(&documentation);
        if matches!(
            record.kind,
            NodeKind::Syntax(syntax::SOURCE_FILE | syntax::MODULE_DECLARATION)
        ) {
            return;
        }
        match annotations::jvm::read(&documentation) {
            Ok(Some(jvm)) => record.native.get_or_insert_with(Default::default).jvm = Some(jvm),
            Ok(None) => {}
            Err(reason) => {
                let name = node
                    .edges()
                    .find_map(|edge| match edge {
                        Edge::Node { role, node }
                            if roles::child(role) == Projection::Slot("name") =>
                        {
                            node.name_text()
                        }
                        _ => None,
                    })
                    .unwrap_or("declaration");
                self.tree
                    .diagnostics
                    .push(nts_diagnostics::Diagnostic::error(
                        "NTS0005",
                        format!("{reason} on declaration `{name}`"),
                        record.origin.location,
                    ));
            }
        }
    }
}

fn text(node: Node<'_>) -> Option<nts_semantic_schema::JsText> {
    if let Some(name) = node.name_text() {
        return Some(name.into());
    }
    let literal = node.literal()?;
    match literal.kind {
        native::LiteralKind::Number | native::LiteralKind::BigInt | native::LiteralKind::RegExp => {
            Some(literal.raw.into())
        }
        native::LiteralKind::String
        | native::LiteralKind::Template
        | native::LiteralKind::JsxText => {
            if literal.invalid_template_escape {
                None
            } else {
                literal
                    .cooked
                    .map(|units| nts_semantic_schema::JsText::from_utf16(units.to_vec()))
            }
        }
    }
}

fn flags(attrs: &native::NodeAttributes) -> u32 {
    let mut flags = if attrs.ambient_context {
        syntax::NODE_FLAGS_AMBIENT
    } else {
        0
    };
    if attrs.optional_chain {
        flags |= syntax::NODE_FLAGS_OPTIONAL_CHAIN;
    }
    let variable = match attrs.variable_kind {
        Some(native::VariableKind::Let) => nts_semantic_schema::VariableKind::Let,
        Some(native::VariableKind::Const) => nts_semantic_schema::VariableKind::Const,
        Some(native::VariableKind::Using) => nts_semantic_schema::VariableKind::Using,
        Some(native::VariableKind::AwaitUsing) => nts_semantic_schema::VariableKind::AwaitUsing,
        Some(native::VariableKind::Var) | None => nts_semantic_schema::VariableKind::Var,
    };
    flags | variable.node_flags()
}

fn modifiers(attrs: &native::NodeAttributes) -> DeclarationModifiers {
    let m = &attrs.modifiers;
    let mut modifiers = DeclarationModifiers::default();
    for (present, flag) in [
        (m.export, DeclarationModifiers::EXPORT),
        (m.default, DeclarationModifiers::DEFAULT),
        (m.declare, DeclarationModifiers::DECLARE),
        (m.public, DeclarationModifiers::PUBLIC),
        (m.private, DeclarationModifiers::PRIVATE),
        (m.protected, DeclarationModifiers::PROTECTED),
        (m.static_, DeclarationModifiers::STATIC),
        (m.readonly, DeclarationModifiers::READONLY),
        (m.abstract_, DeclarationModifiers::ABSTRACT),
        (m.async_, DeclarationModifiers::ASYNC),
        (m.const_, DeclarationModifiers::CONST),
        (m.override_, DeclarationModifiers::OVERRIDE),
        (attrs.generator, DeclarationModifiers::GENERATOR),
    ] {
        if present {
            modifiers = modifiers.union(flag);
        }
    }
    modifiers
}

fn small(kind: u16, attrs: &native::NodeAttributes) -> Result<u8, SnapshotError> {
    let unsupported = || {
        SnapshotError::Project(format!(
            "missing native operator on {}",
            syntax::name_of(kind).unwrap_or("unknown syntax")
        ))
    };
    Ok(match kind {
        syntax::PREFIX_UNARY_EXPRESSION => {
            match attrs.operator.and_then(native_syntax::to_semantic) {
                Some(syntax::PLUS_TOKEN) => syntax::prefix_operator::PLUS,
                Some(syntax::MINUS_TOKEN) => syntax::prefix_operator::MINUS,
                Some(syntax::TILDE_TOKEN) => syntax::prefix_operator::TILDE,
                Some(syntax::EXCLAMATION_TOKEN) => syntax::prefix_operator::EXCLAMATION,
                Some(syntax::PLUS_PLUS_TOKEN) => syntax::prefix_operator::PLUS_PLUS,
                Some(syntax::MINUS_MINUS_TOKEN) => syntax::prefix_operator::MINUS_MINUS,
                _ => return Err(unsupported()),
            }
        }
        syntax::POSTFIX_UNARY_EXPRESSION => {
            match attrs.operator.and_then(native_syntax::to_semantic) {
                Some(syntax::PLUS_PLUS_TOKEN) => syntax::postfix_operator::PLUS_PLUS,
                Some(syntax::MINUS_MINUS_TOKEN) => syntax::postfix_operator::MINUS_MINUS,
                _ => return Err(unsupported()),
            }
        }
        syntax::HERITAGE_CLAUSE => u8::from(matches!(
            attrs.heritage,
            Some(native::HeritageKind::Implements)
        )),
        syntax::IMPORT_CLAUSE => match attrs.import_phase {
            Some(native::ImportPhase::Type) => 1,
            Some(native::ImportPhase::Defer) => 2,
            Some(native::ImportPhase::Source) => 3,
            Some(native::ImportPhase::Value) | None => 0,
        },
        syntax::EXPORT_ASSIGNMENT => u8::from(matches!(
            attrs.export_assignment,
            Some(native::ExportAssignmentKind::Equals)
        )),
        syntax::META_PROPERTY => match attrs.meta_property {
            Some(native::MetaProperty::ImportMeta) => 0,
            Some(native::MetaProperty::NewTarget) => 1,
            Some(native::MetaProperty::ImportSource) => 2,
            Some(native::MetaProperty::ImportDefer) => 3,
            None => return Err(unsupported()),
        },
        syntax::YIELD_EXPRESSION => u8::from(attrs.generator),
        _ => u8::from(attrs.type_only),
    })
}
