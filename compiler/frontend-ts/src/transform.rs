//! Source transforms run before nts captures the program's final semantics.
//! They rewrite owned syntax trees and may ask for the checker's rendered types.

use camino::Utf8Path;
use nts_semantic_schema::NodeId;

use crate::SyntaxTree;

/// A stage rewriting some of a project's files before nts reads them.
pub trait SourceTransform: std::fmt::Debug + Send {
    /// What decides this transform's output beside the files -- its version
    /// and options. Two transforms with one identity must rewrite every file
    /// alike; the frontend records that identity with its source stages.
    fn identity(&self) -> String;

    /// New text for one of the project's own files, or `None` to leave it.
    fn transform(&mut self, file: &TransformInput<'_>, types: &NodeTypes<'_>) -> Option<String>;

    /// The text [`SourceTransform::transform`] or an earlier revision gave
    /// `path` has errors at `errors` (UTF-16 offsets into that text): new
    /// text, or `None` to keep it. Each revision must undo some of the
    /// rewrite, so that revising ends.
    fn revise(&mut self, path: &Utf8Path, errors: &[(u32, u32)]) -> Option<String>;

    /// What the transform has to say about `path` once it has settled -- a
    /// part of the rewrite it gave back, a file it could not take -- which
    /// the snapshot records beside checker diagnostics for every consumer.
    fn diagnostics(&self, path: &Utf8Path) -> Vec<Reported> {
        let _ = path;
        Vec::new()
    }

    /// Where the text the transform settled on for `path` came from, so a
    /// diagnostic in it can point into the file the user wrote. Empty when
    /// the transform does not say.
    fn position_map(&self, path: &Utf8Path) -> Vec<nts_diagnostics::RewrittenSegment> {
        let _ = path;
        Vec::new()
    }
}

/// A transform's diagnostic on a file, as a whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reported {
    pub severity: nts_diagnostics::Severity,
    /// Stable, greppable: `NTS0004`.
    pub code: &'static str,
    pub message: String,
}

/// A file offered to a transform.
#[derive(Debug)]
pub struct TransformInput<'a> {
    pub path: &'a Utf8Path,
    pub text: &'a str,
    /// Its syntax tree; node 0 is the `SourceFile`.
    pub tree: &'a SyntaxTree,
}

/// The checker's type at a node of the file being transformed, printed as
/// TypeScript would write it there.
#[derive(Debug)]
pub struct NodeTypes<'a> {
    nodes: &'a [Option<nts_frontend_tsrs::Node<'a>>],
}

impl<'a> NodeTypes<'a> {
    pub(crate) fn new(nodes: &'a [Option<nts_frontend_tsrs::Node<'a>>]) -> Self {
        Self { nodes }
    }

    #[must_use]
    pub fn type_at(&self, node: NodeId) -> Option<String> {
        self.nodes
            .get(node.0 as usize)?
            .map(nts_frontend_tsrs::Node::type_text)
    }
}

/// Revision rounds before the driver refuses. A transform whose revisions
/// each give back part of its rewrite settles in a round or two; the cap is
/// the termination argument, since a revision drawing new errors as fast as
/// it clears old ones would otherwise never end.
pub const REVISION_ROUNDS: usize = 4;
