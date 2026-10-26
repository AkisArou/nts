//! One file's semantic syntax tree, owned by nts.
//! Used by source transforms before the final multi-file snapshot is built.

use nts_diagnostics::{Diagnostic, Digest};
use nts_semantic_schema::NodeRecord;

#[derive(Debug, Clone)]
pub struct SyntaxTree {
    /// Content digest of the source text.
    pub digest: Digest,
    /// Nodes in source order; child and parent IDs index this vector.
    pub nodes: Vec<NodeRecord>,
    /// Source-annotation diagnostics associated with these nodes.
    pub diagnostics: Vec<Diagnostic>,
}
