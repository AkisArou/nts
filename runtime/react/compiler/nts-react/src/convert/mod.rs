//! tsgo's syntax tree, converted into the React Compiler's input: the
//! Babel-shaped `react_compiler_ast`, with the node ids and positions a Babel
//! parse of the same file would give.
//!
//! Every Babel node carries the tsgo node it came from as its `_nodeId`, so the
//! scope information and, later, the restoration of types can go from any node
//! the compiler emits back to the checked program. A construct this converter
//! does not know is an [`Unsupported`]: the file is then left exactly as
//! written, which is always correct, never guessed at.

mod expr;
mod jsx;
pub mod literal;
mod pattern;
mod stmt;
pub mod text;
mod types;

use nts_semantic_schema::{NodeData, NodeId, NodeKind};
use react_compiler_ast::common::{BaseNode, Comment, CommentData};
use react_compiler_ast::{File, Program, SourceType};

use crate::tsgo::{Nodes, kinds as k};
use text::SourceText;

/// A construct the converter does not handle, at the node where it met it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unsupported {
    pub node: NodeId,
    pub what: String,
}

pub type Converted<T> = Result<T, Unsupported>;

/// Converts one source file, given the snapshot's `SourceFile` node for it and
/// the file's text.
pub fn convert_file(nodes: Nodes<'_>, root: NodeId, text: &SourceText) -> Converted<File> {
    let converter = Converter { nodes, text };
    converter.file(root)
}

struct Converter<'a> {
    nodes: Nodes<'a>,
    text: &'a SourceText,
}

impl Converter<'_> {
    // ---- reading the tsgo tree -------------------------------------------

    fn kind(&self, id: NodeId) -> u16 {
        self.nodes.kind(id).unwrap_or(0)
    }

    fn child(&self, id: NodeId, property: &str) -> Option<NodeId> {
        self.nodes.child(id, property)
    }

    fn need(&self, id: NodeId, property: &str) -> Converted<NodeId> {
        self.child(id, property)
            .ok_or_else(|| self.unsupported(id, &format!("a node without its `{property}`")))
    }

    /// The items of a list property, or nothing when it is absent.
    fn list(&self, id: NodeId, property: &str) -> Vec<NodeId> {
        self.child(id, property).map_or_else(Vec::new, |list| self.nodes.items(list).to_vec())
    }

    fn record(&self, id: NodeId) -> &nts_semantic_schema::NodeRecord {
        &self.nodes.snapshot.nodes[id.0 as usize]
    }

    /// The node's own text: an identifier's name, a literal's cooked value.
    fn text_of(&self, id: NodeId) -> String {
        self.record(id).text.clone().unwrap_or_default()
    }

    /// A string literal's value, cooked from its source.
    fn string_value(&self, id: NodeId) -> react_compiler_diagnostics::JsString {
        let raw = self.text.slice(self.start(id), self.end(id));
        react_compiler_diagnostics::JsString::from_code_units(literal::cook_string(&raw))
    }

    fn flags(&self, id: NodeId) -> u32 {
        self.record(id).flags
    }

    /// The per-kind bits tsgo's encoder keeps beside the children: a unary
    /// operator, whether an import is type-only.
    fn small(&self, id: NodeId) -> u8 {
        match self.record(id).data {
            NodeData::Children { small, .. } | NodeData::String { small, .. } | NodeData::Extended { small, .. } => small,
            NodeData::ListLength(_) => 0,
        }
    }

    /// The kinds of the modifier keywords written on a declaration.
    fn modifiers(&self, id: NodeId) -> Vec<u16> {
        self.list(id, "modifiers").into_iter().map(|m| self.kind(m)).collect()
    }

    fn has_modifier(&self, id: NodeId, modifier: u16) -> bool {
        self.modifiers(id).contains(&modifier)
    }

    fn unsupported(&self, id: NodeId, what: &str) -> Unsupported {
        Unsupported { node: id, what: format!("{what} ({})", self.kind_name(id)) }
    }

    fn kind_name(&self, id: NodeId) -> String {
        match self.record(id).kind {
            NodeKind::Syntax(kind) => nts_semantic_schema::syntax::name_of(kind).map_or_else(|| format!("kind {kind}"), str::to_owned),
            NodeKind::List => "a list".to_owned(),
        }
    }

    // ---- positions -------------------------------------------------------

    /// Where tsgo's node starts, trivia included.
    fn pos(&self, id: NodeId) -> u32 {
        self.record(id).origin.location.span.start
    }

    fn end(&self, id: NodeId) -> u32 {
        self.record(id).origin.location.span.end
    }

    /// Where Babel says the node starts: its first token. JSX text is its own
    /// content, whitespace and all, so it starts where tsgo says.
    fn start(&self, id: NodeId) -> u32 {
        if self.kind(id) == k::JSX_TEXT {
            self.pos(id)
        } else {
            self.text.token_start(self.pos(id))
        }
    }

    /// A Babel base for a node spanning `start..end`, carrying `id`.
    fn base_span(&self, id: NodeId, start: u32, end: u32) -> BaseNode {
        BaseNode {
            start: Some(start),
            end: Some(end),
            loc: Some(self.text.location(start, end)),
            node_id: Some(id.0),
            ..BaseNode::default()
        }
    }

    fn base(&self, id: NodeId) -> BaseNode {
        self.base_span(id, self.start(id), self.end(id))
    }

    /// The offset of the first token at or after `from` that is `token`,
    /// skipping trivia only. Used for punctuation tsgo keeps no node for, like
    /// the `:` that starts a type annotation or the `<` of type arguments.
    fn token_at(&self, from: u32, token: &str) -> Option<u32> {
        let at = self.text.token_start(from);
        (self.text.slice(at, at + u32::try_from(token.len()).unwrap_or(0)) == token).then_some(at)
    }

    /// The offset of the last `token` before `before`, looking back past
    /// whitespace only (the tokens this looks for are never behind a comment
    /// in a parse Babel would accept differently).
    fn token_before(&self, before: u32, token: char) -> Option<u32> {
        let mut at = before;
        while at > 0 {
            at -= 1;
            let ch = self.text.slice(at, at + 1);
            if ch.chars().all(char::is_whitespace) {
                continue;
            }
            return ch.starts_with(token).then_some(at);
        }
        None
    }

    // ---- the file --------------------------------------------------------

    fn file(&self, root: NodeId) -> Converted<File> {
        // A source file keeps extended data rather than a presence mask, so it
        // has no property table: its children are the statement list and the
        // end-of-file token.
        let statements = self
            .record(root)
            .children
            .iter()
            .find(|child| self.nodes.kind(**child).is_none())
            .map_or_else(Vec::new, |list| self.nodes.items(*list).to_vec());
        let (body, directives) = self.statements_with_directives(&statements)?;
        let end = self.text.len();
        let mut program_base = self.base_span(root, 0, end);
        program_base.node_type = Some("Program".to_owned());
        let program = Program {
            base: program_base,
            body,
            directives,
            source_type: SourceType::Module,
            interpreter: None,
            source_file: None,
        };
        let mut base = self.base_span(root, 0, end);
        base.node_type = Some("File".to_owned());
        // The program and the file are one tsgo node; only the program keeps
        // its id, so no two Babel nodes share one.
        base.node_id = None;
        Ok(File { base, program, comments: self.comments(root), errors: Vec::new() })
    }

    // ---- comments --------------------------------------------------------

    /// Every comment in the file, in order.
    ///
    /// tsgo keeps no comments, but it knows where every token is: a comment can
    /// only sit in a node's leading trivia or in a gap between a node's
    /// children, and those gaps hold nothing but punctuation, keywords and
    /// trivia -- strings, templates, regular expressions and JSX text are all
    /// nodes of their own. So scanning exactly those regions finds every
    /// comment and cannot mistake the inside of a string for one.
    fn comments(&self, root: NodeId) -> Vec<Comment> {
        let mut found = Vec::new();
        self.collect_comments(root, &mut found);
        found.sort_by_key(|(start, _)| *start);
        found.dedup_by_key(|(start, _)| *start);
        found.into_iter().map(|(_, comment)| comment).collect()
    }

    fn collect_comments(&self, id: NodeId, found: &mut Vec<(u32, Comment)>) {
        let record = self.record(id);
        if matches!(record.kind, NodeKind::Syntax(kind) if kind == k::JSX_TEXT) {
            return;
        }
        // A literal's inside is not trivia.
        if matches!(record.kind, NodeKind::Syntax(kind) if is_literal_token(kind)) {
            self.scan_comments(self.pos(id), self.start(id), found);
            return;
        }
        let mut at = self.pos(id);
        for child in self.nodes.property_children(id).chain(self.jsdoc_children(id)) {
            let child_pos = self.pos(child);
            if child_pos >= at {
                self.scan_comments(at, child_pos, found);
            }
            self.collect_comments(child, found);
            at = at.max(self.end(child));
        }
        let end = self.end(id);
        if at < end {
            self.scan_comments(at, end, found);
        }
    }

    fn jsdoc_children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.record(id)
            .children
            .iter()
            .copied()
            .filter(|child| matches!(self.record(*child).kind, NodeKind::Syntax(kind) if crate::tsgo::children::is_jsdoc(kind)))
    }

    /// Comments in `from..to`, a region holding only trivia and punctuation.
    fn scan_comments(&self, from: u32, to: u32, found: &mut Vec<(u32, Comment)>) {
        let region = self.text.slice(from, to);
        let units: Vec<u16> = region.encode_utf16().collect();
        let mut at = 0usize;
        while at + 1 < units.len() {
            let (first, second) = (units[at], units[at + 1]);
            if first == u16::from(b'/') && second == u16::from(b'/') {
                let body_start = at + 2;
                let mut end = body_start;
                while end < units.len() && !matches!(units[end], 0x0A | 0x0D | 0x2028 | 0x2029) {
                    end += 1;
                }
                found.push(self.comment(from, at, body_start, end, end, false, &units));
                at = end;
            } else if first == u16::from(b'/') && second == u16::from(b'*') {
                let body_start = at + 2;
                let mut end = body_start;
                while end + 1 < units.len() && !(units[end] == u16::from(b'*') && units[end + 1] == u16::from(b'/')) {
                    end += 1;
                }
                let close = (end + 2).min(units.len());
                found.push(self.comment(from, at, body_start, end, close, true, &units));
                at = close;
            } else {
                at += 1;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn comment(
        &self,
        region: u32,
        start: usize,
        body_start: usize,
        body_end: usize,
        end: usize,
        block: bool,
        units: &[u16],
    ) -> (u32, Comment) {
        let offset = |at: usize| region + u32::try_from(at).unwrap_or(u32::MAX);
        let (start, end) = (offset(start), offset(end));
        let data = CommentData {
            value: String::from_utf16_lossy(&units[body_start..body_end.min(units.len())]),
            start: Some(start),
            end: Some(end),
            loc: Some(self.text.location(start, end)),
        };
        (start, if block { Comment::CommentBlock(data) } else { Comment::CommentLine(data) })
    }
}

/// Tokens whose text is content, not trivia: a `//` inside one is not a comment.
fn is_literal_token(kind: u16) -> bool {
    matches!(
        kind,
        k::STRING_LITERAL
            | k::NUMERIC_LITERAL
            | k::BIG_INT_LITERAL
            | k::REGULAR_EXPRESSION_LITERAL
            | k::NO_SUBSTITUTION_TEMPLATE_LITERAL
            | k::TEMPLATE_HEAD
            | k::TEMPLATE_MIDDLE
            | k::TEMPLATE_TAIL
    )
}
