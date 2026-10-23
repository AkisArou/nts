//! Borrowed native syntax views. No upstream arena pointer crosses this module.

#[cfg(test)]
#[path = "ast_test.rs"]
mod tests;

use std::fmt;
use std::hash::{Hash, Hasher};

use tsrs_ast::{
    Kind, ModifierFlags, ModifierList, Node as NativeNode, NodeData, NodeFlags, NodeList,
    TokenFlags,
};
use tsrs_core::P;

use crate::program::File;
use crate::text::{BytePos, Utf16Pos, Utf16Span};
use crate::{CapturePhase, ViewPhase};

#[path = "ast_roles.rs"]
mod roles;
pub use roles::{ChildRole, ListRole};

/// A native kind, decoded by the capture's single shared syntax-kind mapping.
pub type NativeKind = u16;

/// An opaque syntax identity, valid only in the borrowed checked revision.
#[derive(Clone, Copy)]
pub struct Node<'p, S: ViewPhase = CapturePhase> {
    pub(super) native: P<NativeNode>,
    file: File<'p, S>,
}

impl<S: ViewPhase> fmt::Debug for Node<'_, S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Node")
            .field("kind", &self.kind())
            .field("file", &self.file.path())
            .field("span", &self.span())
            .finish()
    }
}

impl<S: ViewPhase> PartialEq for Node<'_, S> {
    fn eq(&self, other: &Self) -> bool {
        self.native == other.native && self.file.same_identity(other.file)
    }
}
impl<S: ViewPhase> Eq for Node<'_, S> {}
impl<S: ViewPhase> Hash for Node<'_, S> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.native.hash(state);
        self.file.identity().hash(state);
    }
}

impl<'p, S: ViewPhase> Node<'p, S> {
    pub(crate) fn new(native: P<NativeNode>, file: File<'p, S>) -> Self {
        Self { native, file }
    }
    #[must_use]
    pub fn kind(self) -> NativeKind {
        self.native.kind() as NativeKind
    }
    #[must_use]
    pub const fn source_file(self) -> File<'p, S> {
        self.file
    }
    #[must_use]
    pub fn parent(self) -> Option<Self> {
        self.native
            .parent()
            .map(|native| Self::new(native, self.file))
    }
    #[must_use]
    pub fn span(self) -> Option<Utf16Span> {
        Some(self.file.span(
            BytePos(self.native.loc().source_pos()?),
            BytePos(self.native.loc().source_end()?),
        ))
    }
    #[must_use]
    pub fn token_start(self) -> Option<Utf16Pos> {
        self.native.loc().source_pos()?;
        let byte =
            tsrs_scanner::get_token_pos_of_node(self.native, self.file.native_source(), false);
        Some(self.file.span(BytePos(byte), BytePos(byte)).start)
    }
    /// Present fields in native visitor order. An empty list is still an edge.
    pub fn edges(self) -> impl Iterator<Item = Edge<'p, S>> {
        let _scope = self.file.native_scope();
        roles::edges(self).into_iter()
    }
    #[must_use]
    pub fn child(self, role: ChildRole) -> Option<Self> {
        self.edges().find_map(|edge| match edge {
            Edge::Node { role: found, node } if role == found => Some(node),
            _ => None,
        })
    }
    #[must_use]
    pub fn list(self, role: ListRole) -> Option<List<'p, S>> {
        self.edges().find_map(|edge| match edge {
            Edge::List { role: found, list } if role == found => Some(list),
            _ => None,
        })
    }

    #[must_use]
    pub fn name_text(self) -> Option<&'p str> {
        if !matches!(
            self.native.kind(),
            Kind::Identifier | Kind::PrivateIdentifier
        ) {
            return None;
        }
        let _scope = self.file.native_scope();
        std::str::from_utf8(self.native.text().as_bytes()).ok()
    }

    fn raw(self) -> Option<&'p str> {
        let start = self.native.loc().source_pos()?;
        let end = self.native.loc().source_end()?;
        let start = if self.native.kind() == Kind::JsxText || start == end {
            start
        } else {
            tsrs_scanner::get_token_pos_of_node(self.native, self.file.native_source(), false)
        };
        self.file.text().get(start as usize..end as usize)
    }

    #[must_use]
    pub fn literal(self) -> Option<Literal<'p>> {
        let _scope = self.file.native_scope();
        let (kind, cooked, flags) = match self.native.data() {
            NodeData::StringLiteral(data) => {
                (LiteralKind::String, Some(data.text()), TokenFlags::None)
            }
            NodeData::NumericLiteral(_) => (LiteralKind::Number, None, TokenFlags::None),
            NodeData::BigIntLiteral(_) => (LiteralKind::BigInt, None, TokenFlags::None),
            NodeData::RegularExpressionLiteral(_) => (LiteralKind::RegExp, None, TokenFlags::None),
            NodeData::NoSubstitutionTemplateLiteral(data) => (
                LiteralKind::Template,
                Some(data.text()),
                data.template_flags(),
            ),
            NodeData::TemplateHead(data) => (
                LiteralKind::Template,
                Some(data.text()),
                data.template_flags(),
            ),
            NodeData::TemplateMiddle(data) => (
                LiteralKind::Template,
                Some(data.text()),
                data.template_flags(),
            ),
            NodeData::TemplateTail(data) => (
                LiteralKind::Template,
                Some(data.text()),
                data.template_flags(),
            ),
            NodeData::JsxText(data) => (LiteralKind::JsxText, Some(data.text()), TokenFlags::None),
            _ => return None,
        };
        let invalid_template_escape = flags.intersects(TokenFlags::ContainsInvalidEscape);
        let cooked = if invalid_template_escape {
            None
        } else {
            cooked.map(|text| self.file.intern_string(text.as_bytes()).utf16())
        };
        Some(Literal {
            kind,
            raw: self.raw()?,
            cooked,
            invalid_template_escape,
        })
    }

    #[must_use]
    pub fn attributes(self) -> NodeAttributes {
        let native = self.native;
        let modifiers = Modifiers::from_native(native.modifier_flags());
        let mut attributes = NodeAttributes {
            modifiers,
            ambient_context: native.flags().intersects(NodeFlags::Ambient) || modifiers.declare,
            optional_chain: tsrs_ast::is_optional_chain(native),
            type_only: native.is_type_only(),
            ..NodeAttributes::default()
        };
        for edge in self.edges() {
            if let Edge::Node { role, node } = edge {
                attributes.has_initializer |= role.marks_initializer();
                attributes.has_body |= role.marks_body();
                attributes.generator |= role.marks_asterisk();
                attributes.rest |= role.marks_rest();
                attributes.optional |= role.marks_question()
                    && node.native.kind() == Kind::QuestionToken
                    && native.kind() != Kind::ConditionalExpression;
            }
        }
        if matches!(
            native.kind(),
            Kind::SpreadElement | Kind::SpreadAssignment | Kind::RestType
        ) {
            attributes.rest = true;
        }
        if matches!(
            native.kind(),
            Kind::VariableDeclarationList | Kind::VariableDeclaration | Kind::VariableStatement
        ) {
            let flags = tsrs_ast::get_combined_node_flags(native) & NodeFlags::BlockScoped;
            attributes.variable_kind = Some(if flags == NodeFlags::AwaitUsing {
                VariableKind::AwaitUsing
            } else if flags == NodeFlags::Using {
                VariableKind::Using
            } else if flags == NodeFlags::Const {
                VariableKind::Const
            } else if flags == NodeFlags::Let {
                VariableKind::Let
            } else {
                VariableKind::Var
            });
        }
        attributes.operator = match native.data() {
            NodeData::BinaryExpression(data) => Some(data.operator_token.kind() as NativeKind),
            NodeData::PrefixUnaryExpression(data) => Some(data.operator as NativeKind),
            NodeData::PostfixUnaryExpression(data) => Some(data.operator as NativeKind),
            _ if matches!(
                native.kind(),
                Kind::DeleteExpression
                    | Kind::TypeOfExpression
                    | Kind::VoidExpression
                    | Kind::AwaitExpression
                    | Kind::YieldExpression
            ) =>
            {
                Some(native.kind() as NativeKind)
            }
            _ => None,
        };
        match native.data() {
            NodeData::HeritageClause(data) => {
                attributes.heritage = Some(if data.token == Kind::ExtendsKeyword {
                    HeritageKind::Extends
                } else {
                    HeritageKind::Implements
                });
            }
            NodeData::ExportAssignment(data) => {
                attributes.export_assignment = Some(if data.is_export_equals {
                    ExportAssignmentKind::Equals
                } else {
                    ExportAssignmentKind::Default
                });
            }
            NodeData::MetaProperty(data) => {
                attributes.meta_property = Some(if data.keyword_token == Kind::ImportKeyword {
                    MetaProperty::ImportMeta
                } else {
                    MetaProperty::NewTarget
                });
            }
            _ => {}
        }
        attributes.import_phase = import_phase(native);
        attributes
    }

    pub fn documentation(self) -> impl Iterator<Item = Documentation<'p, S>> {
        let _scope = self.file.native_scope();
        let mut documents = Vec::new();
        for &native in self.native.jsdoc(Some(self.file.native_source().get())) {
            let doc = Self::new(native, self.file);
            let Some(raw) = doc.raw() else { continue };
            let mut tags = Vec::new();
            if let Some(native_tags) = native.as_jsdoc().tags {
                for &native in native_tags.nodes() {
                    let tag = Self::new(native, self.file);
                    let name = native.tag_name();
                    let Some(start) = name.loc().source_end() else {
                        continue;
                    };
                    let Some(end) = native.loc().source_end() else {
                        continue;
                    };
                    let Some(text) = self.file.text().get(start as usize..end as usize) else {
                        continue;
                    };
                    let Some(name) = std::str::from_utf8(name.text().as_bytes()).ok() else {
                        continue;
                    };
                    tags.push(DocumentationTag {
                        span: tag.span(),
                        name,
                        text,
                    });
                }
            }
            documents.push(Documentation {
                source_file: self.file,
                span: doc.span(),
                raw,
                tags,
            });
        }
        documents.into_iter()
    }
}

fn import_phase(native: P<NativeNode>) -> Option<ImportPhase> {
    let phase = match native.data() {
        NodeData::ImportClause(data) => Some(data.phase_modifier()),
        NodeData::ImportDeclaration(data) => {
            Some(data.import_clause.map_or(Kind::Unknown, |clause| {
                clause.as_import_clause().phase_modifier()
            }))
        }
        NodeData::ImportEqualsDeclaration(data) => Some(if data.is_type_only {
            Kind::TypeKeyword
        } else {
            Kind::Unknown
        }),
        NodeData::ImportTypeNode(_) => Some(Kind::TypeKeyword),
        _ => None,
    };
    phase.map(|phase| match phase {
        Kind::TypeKeyword => ImportPhase::Type,
        Kind::DeferKeyword => ImportPhase::Defer,
        Kind::SourceKeyword => ImportPhase::Source,
        _ => ImportPhase::Value,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LiteralKind {
    String,
    Number,
    BigInt,
    RegExp,
    Template,
    JsxText,
}
#[derive(Debug, Clone, Copy)]
pub struct Literal<'p> {
    pub kind: LiteralKind,
    pub raw: &'p str,
    pub cooked: Option<&'p [u16]>,
    pub invalid_template_escape: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VariableKind {
    Var,
    Let,
    Const,
    Using,
    AwaitUsing,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ImportPhase {
    Value,
    Type,
    Defer,
    Source,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ExportAssignmentKind {
    Default,
    Equals,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MetaProperty {
    ImportMeta,
    NewTarget,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HeritageKind {
    Extends,
    Implements,
}
#[derive(Debug, Clone, Copy, Default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent semantic modifier facts, not raw native flags"
)]
pub struct Modifiers {
    pub export: bool,
    pub default: bool,
    pub declare: bool,
    pub public: bool,
    pub private: bool,
    pub protected: bool,
    pub static_: bool,
    pub readonly: bool,
    pub abstract_: bool,
    pub async_: bool,
    pub const_: bool,
    pub override_: bool,
    pub accessor: bool,
    pub in_: bool,
    pub out: bool,
}
impl Modifiers {
    fn from_native(flags: ModifierFlags) -> Self {
        Self {
            export: flags.intersects(ModifierFlags::Export),
            default: flags.intersects(ModifierFlags::Default),
            declare: flags.intersects(ModifierFlags::Ambient),
            public: flags.intersects(ModifierFlags::Public),
            private: flags.intersects(ModifierFlags::Private),
            protected: flags.intersects(ModifierFlags::Protected),
            static_: flags.intersects(ModifierFlags::Static),
            readonly: flags.intersects(ModifierFlags::Readonly),
            abstract_: flags.intersects(ModifierFlags::Abstract),
            async_: flags.intersects(ModifierFlags::Async),
            const_: flags.intersects(ModifierFlags::Const),
            override_: flags.intersects(ModifierFlags::Override),
            accessor: flags.intersects(ModifierFlags::Accessor),
            in_: flags.intersects(ModifierFlags::In),
            out: flags.intersects(ModifierFlags::Out),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "named semantic syntax facts rather than upstream flag numbers"
)]
pub struct NodeAttributes {
    pub modifiers: Modifiers,
    pub ambient_context: bool,
    pub optional_chain: bool,
    pub variable_kind: Option<VariableKind>,
    pub operator: Option<NativeKind>,
    pub heritage: Option<HeritageKind>,
    pub import_phase: Option<ImportPhase>,
    pub type_only: bool,
    pub export_assignment: Option<ExportAssignmentKind>,
    pub meta_property: Option<MetaProperty>,
    pub generator: bool,
    pub optional: bool,
    pub rest: bool,
    pub has_initializer: bool,
    pub has_body: bool,
}
#[derive(Debug, Clone)]
pub struct Documentation<'p, S: ViewPhase = CapturePhase> {
    pub source_file: File<'p, S>,
    pub span: Option<Utf16Span>,
    pub raw: &'p str,
    pub tags: Vec<DocumentationTag<'p>>,
}
#[derive(Debug, Clone, Copy)]
pub struct DocumentationTag<'p> {
    pub span: Option<Utf16Span>,
    pub name: &'p str,
    pub text: &'p str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Edge<'p, S: ViewPhase = CapturePhase> {
    Node { role: ChildRole, node: Node<'p, S> },
    List { role: ListRole, list: List<'p, S> },
}

#[derive(Clone, Copy)]
enum ListStorage {
    List(P<NodeList>),
    Modifiers(P<ModifierList>),
    Slice(&'static [P<NativeNode>]),
}

impl ListStorage {
    fn nodes(self) -> &'static [P<NativeNode>] {
        match self {
            Self::List(list) => list.nodes(),
            Self::Modifiers(list) => list.list.nodes(),
            Self::Slice(nodes) => nodes,
        }
    }
}

/// A present list field, including an honestly empty list.
#[derive(Clone, Copy)]
pub struct List<'p, S: ViewPhase = CapturePhase> {
    parent: Node<'p, S>,
    role: ListRole,
    storage: ListStorage,
}

impl<S: ViewPhase> fmt::Debug for List<'_, S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("List")
            .field("role", &self.role)
            .field("len", &self.storage.nodes().len())
            .finish()
    }
}
impl<S: ViewPhase> PartialEq for List<'_, S> {
    fn eq(&self, other: &Self) -> bool {
        self.parent == other.parent && self.role == other.role
    }
}
impl<S: ViewPhase> Eq for List<'_, S> {}
impl<S: ViewPhase> Hash for List<'_, S> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.parent.hash(state);
        self.role.hash(state);
    }
}

impl<'p, S: ViewPhase> List<'p, S> {
    /// The first token after leading list trivia, including an empty list's
    /// closing delimiter. Span itself retains the native raw start.
    #[must_use]
    pub fn token_start(self) -> Option<Utf16Pos> {
        let loc = match self.storage {
            ListStorage::List(list) => list.loc(),
            ListStorage::Modifiers(list) => list.list.loc(),
            ListStorage::Slice(_) => return None,
        };
        let start = tsrs_scanner::skip_trivia(self.parent.file.text(), loc.source_pos()?);
        Some(self.parent.file.span(BytePos(start), BytePos(start)).start)
    }
    #[must_use]
    pub fn span(self) -> Option<Utf16Span> {
        let loc = match self.storage {
            ListStorage::List(list) => list.loc(),
            ListStorage::Modifiers(list) => list.list.loc(),
            ListStorage::Slice(_) => return None,
        };
        Some(
            self.parent
                .file
                .span(BytePos(loc.source_pos()?), BytePos(loc.source_end()?)),
        )
    }
    pub fn iter(self) -> impl ExactSizeIterator<Item = Node<'p, S>> {
        let _scope = self.parent.file.native_scope();
        self.storage
            .nodes()
            .iter()
            .map(move |&native| Node::new(native, self.parent.file))
    }
    #[must_use]
    pub fn has_trailing_comma(self) -> bool {
        let _scope = self.parent.file.native_scope();
        match self.storage {
            ListStorage::List(list) => list.has_trailing_comma(),
            ListStorage::Modifiers(list) => list.has_trailing_comma(),
            ListStorage::Slice(_) => false,
        }
    }
}

struct Edges<'p, S: ViewPhase = CapturePhase> {
    parent: Node<'p, S>,
    edges: Vec<Edge<'p, S>>,
}

impl<'p, S: ViewPhase> Edges<'p, S> {
    fn new(parent: Node<'p, S>) -> Self {
        Self {
            parent,
            edges: Vec::new(),
        }
    }
    fn child(&mut self, role: ChildRole, child: impl Into<Option<P<NativeNode>>>) {
        if let Some(native) = child.into() {
            self.edges.push(Edge::Node {
                role,
                node: Node::new(native, self.parent.file),
            });
        }
    }
    fn push_list(&mut self, role: ListRole, storage: ListStorage) {
        self.edges.push(Edge::List {
            role,
            list: List {
                parent: self.parent,
                role,
                storage,
            },
        });
    }
    fn list(&mut self, role: ListRole, list: impl Into<Option<P<NodeList>>>) {
        if let Some(list) = list.into() {
            self.push_list(role, ListStorage::List(list));
        }
    }
    fn modifiers(&mut self, role: ListRole, list: impl Into<Option<P<ModifierList>>>) {
        if let Some(list) = list.into() {
            self.push_list(role, ListStorage::Modifiers(list));
        }
    }
    fn slice(&mut self, role: ListRole, nodes: &'static [P<NativeNode>]) {
        self.push_list(role, ListStorage::Slice(nodes));
    }
    fn finish(self) -> Vec<Edge<'p, S>> {
        self.edges
    }
}
