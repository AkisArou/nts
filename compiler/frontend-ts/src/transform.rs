//! Source transforms run before nts captures the program's final semantics.
//! They rewrite owned syntax trees and may ask for the checker's rendered types.

use camino::Utf8Path;
use nts_semantic_schema::{DeclarationIdentity, NodeId, SnapshotError};
use std::cell::RefCell;

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

/// Checked facts at nodes of the file being inspected or transformed. Binding
/// uses owned declaration identities; rendered types are a presentation query.
#[derive(Debug)]
pub struct NodeTypes<'a> {
    nodes: &'a [Option<nts_frontend_tsrs::Node<'a>>],
    sources: RefCell<crate::declaration::Sources>,
    captured: Option<CapturedIdentities<'a>>,
}

#[derive(Debug)]
struct CapturedIdentities<'a> {
    snapshot: &'a nts_semantic_schema::SemanticSnapshot,
    nodes: &'a rustc_hash::FxHashMap<nts_frontend_tsrs::Node<'a>, NodeId>,
}

/// Typed declaration facts for one use. Declaration identities are locators;
/// they do not certify that an added root leaves the semantic world unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeReferences {
    pub site: DeclarationIdentity,
    /// Declarations of the referenced symbol and every alias supplier.
    pub declarations: Vec<DeclarationIdentity>,
    /// The overload selected by the checker, independent of the supplier set.
    pub selected_overload: Option<DeclarationIdentity>,
}

impl<'a> NodeTypes<'a> {
    pub(crate) fn new(nodes: &'a [Option<nts_frontend_tsrs::Node<'a>>]) -> Self {
        Self {
            nodes,
            sources: RefCell::default(),
            captured: None,
        }
    }

    #[expect(
        clippy::mutable_key_type,
        reason = "native Node Eq/Hash uses immutable node/file identities, never the lazy text index"
    )]
    pub(crate) fn captured(
        nodes: &'a [Option<nts_frontend_tsrs::Node<'a>>],
        snapshot: &'a nts_semantic_schema::SemanticSnapshot,
        identities: &'a rustc_hash::FxHashMap<nts_frontend_tsrs::Node<'a>, NodeId>,
    ) -> Self {
        Self {
            nodes,
            sources: RefCell::default(),
            captured: Some(CapturedIdentities {
                snapshot,
                nodes: identities,
            }),
        }
    }

    fn identity(
        &self,
        native: nts_frontend_tsrs::Node<'a>,
    ) -> Result<Option<DeclarationIdentity>, SnapshotError> {
        if let Some(captured) = &self.captured {
            if let Some(&id) = captured.nodes.get(&native) {
                if captured.snapshot.nodes[id.0 as usize]
                    .origin
                    .generated
                    .is_some()
                {
                    return Ok(None);
                }
                if let Some(identity) = captured.snapshot.node_identity(id) {
                    return Ok(Some(identity));
                }
            }
            if let Some(&root) = captured.nodes.get(&native.source_file().root()) {
                let source_id = captured.snapshot.nodes[root.0 as usize]
                    .origin
                    .location
                    .file;
                if let Some(&context) = captured.snapshot.source_contexts.get(&source_id)
                    && let Some((span, kind)) = crate::declaration::coordinates(native)?
                {
                    return Ok(Some(DeclarationIdentity {
                        source: captured.snapshot.declaration_sources[context.0 as usize].clone(),
                        span,
                        kind,
                    }));
                }
            }
        }
        self.sources.borrow_mut().identity(native)
    }

    /// Own a checked syntax locator. Synthetic list nodes have no locator.
    pub fn identity_at(&self, node: NodeId) -> Result<Option<DeclarationIdentity>, SnapshotError> {
        match self.nodes.get(node.0 as usize).copied().flatten() {
            Some(node) => self.identity(node),
            None => Ok(None),
        }
    }

    /// Read declaration identities without rendered type strings or native IDs.
    /// Alias cycles are an error, never an incomplete supplier claim.
    pub fn references_at(&self, node: NodeId) -> Result<Option<NodeReferences>, SnapshotError> {
        let Some(native) = self.nodes.get(node.0 as usize).copied().flatten() else {
            return Ok(None);
        };
        let Some(site) = self.identity_at(node)? else {
            return Ok(None);
        };
        let mut declarations = Vec::new();
        let mut symbol = native.symbol();
        #[expect(
            clippy::mutable_key_type,
            reason = "native Symbol Eq/Hash uses immutable opaque identities, never the file's lazy UTF-16 index"
        )]
        let mut seen = rustc_hash::FxHashSet::default();
        while let Some(current) = symbol {
            if !seen.insert(current) {
                return Err(SnapshotError::Project(
                    "cyclic alias in declaration inspection".into(),
                ));
            }
            for declaration in current.declarations() {
                if let Some(identity) = self.identity(declaration)? {
                    declarations.push(identity);
                }
            }
            symbol = current.alias_target();
        }
        declarations.sort();
        declarations.dedup();
        let selected_overload = native
            .resolved_signature()
            .and_then(nts_frontend_tsrs::Signature::declaration)
            .map(|declaration| self.identity(declaration))
            .transpose()?
            .flatten();
        Ok(Some(NodeReferences {
            site,
            declarations,
            selected_overload,
        }))
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
