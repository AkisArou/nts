//! Source transforms: a stage that rewrites some of a project's files before
//! nts reads them -- the React Compiler is the one there is.
//!
//! The split: a [`SourceTransform`] knows how to rewrite a file and how to
//! back off when the rewrite does not typecheck; [`TsgoApi`](super::TsgoApi)
//! knows the protocol -- giving tsgo the new text as an overlay, taking a new
//! snapshot, reading its diagnostics. Neither does the other's part.
//!
//! The driver: every one of the project's own files is offered to
//! [`SourceTransform::transform`]; the new texts go to tsgo together, and it
//! rechecks what they affect. A rewritten file with errors is offered to
//! [`SourceTransform::revise`], whose answer is checked the same way, until no
//! file is revised. What nts then reads is the final snapshot, exactly as it
//! would read a project whose files said that on disk.

use camino::Utf8Path;
use nts_semantic_schema::{NodeId, NodeKind};

use super::ast::EncodedSourceFile;
use super::proto::{self, NodeHandle, ProjectHandle, SnapshotHandle, UpdateSnapshotResponse};
use super::types::{node_handle, tsgo_will_answer};
use super::{Client, TsgoError, compiled_files};

/// A stage rewriting some of a project's files before nts reads them.
pub trait SourceTransform: std::fmt::Debug {
    /// What decides this transform's output beside the files -- its version
    /// and options. It keys the snapshot cache: two transforms with one
    /// identity must rewrite every file alike.
    fn identity(&self) -> String;

    /// New text for one of the project's own files, or `None` to leave it.
    fn transform(&mut self, file: &TransformInput<'_>, types: &mut dyn NodeTypes) -> Option<String>;

    /// The text [`SourceTransform::transform`] or an earlier revision gave
    /// `path` has errors at `errors` (UTF-16 offsets into that text): new
    /// text, or `None` to keep it. Each revision must undo some of the
    /// rewrite, so that revising ends.
    fn revise(&mut self, path: &Utf8Path, errors: &[(u32, u32)]) -> Option<String>;

    /// What the transform has to say about `path` once it has settled -- a
    /// part of the rewrite it gave back, a file it could not take -- which
    /// the snapshot records beside tsgo's diagnostics, so a build served from
    /// the snapshot cache reports it too.
    fn diagnostics(&self, path: &Utf8Path) -> Vec<Reported> {
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
    pub tree: &'a EncodedSourceFile,
}

/// The checker's type at a node of the file being transformed, printed as
/// TypeScript would write it there.
pub trait NodeTypes {
    fn type_at(&mut self, node: NodeId) -> Option<String>;
}

/// How [`NodeTypes`] prints a type: in full (never `...`), structurally where
/// an alias cannot be named, with unique symbols as themselves -- tsgo's
/// `NoTruncation | UseStructuralFallback | AllowUniqueESSymbolType`. Not
/// `UseAliasDefinedOutsideCurrentScope`, which names aliases the printed place
/// cannot see.
const TYPE_FORMAT: i32 = 1 | (1 << 3) | (1 << 20);

/// [`NodeTypes`] over a live snapshot.
struct SnapshotTypes<'a> {
    client: &'a mut Client,
    snapshot: SnapshotHandle,
    project: &'a ProjectHandle,
    path: &'a Utf8Path,
    tree: &'a EncodedSourceFile,
}

impl NodeTypes for SnapshotTypes<'_> {
    fn type_at(&mut self, node: NodeId) -> Option<String> {
        type_at(self.client, self.snapshot, self.project, self.path, self.tree, node)
    }
}

/// The checker's type at node `node` of `tree` (the file at `path`), printed
/// as TypeScript would write it there; `None` where tsgo has no type for the
/// node, or would not answer.
pub fn type_at(
    client: &mut Client,
    snapshot: SnapshotHandle,
    project: &ProjectHandle,
    path: &Utf8Path,
    tree: &EncodedSourceFile,
    node: NodeId,
) -> Option<String> {
    let index = node.0 as usize;
    let Some(NodeKind::Syntax(kind)) = tree.nodes.get(index).map(|n| n.kind) else {
        return None;
    };
    // tsgo panics on some nodes rather than answering; this is the list.
    if !tsgo_will_answer(&tree.nodes, index) {
        return None;
    }
    let handle = NodeHandle(node_handle(node.0 + 1, kind, path.as_str()));
    let found = client.types_at(snapshot, project, vec![handle.clone()]).ok()?;
    let found = found.into_iter().next().flatten()?;
    client.type_to_string(snapshot, project, found.id, handle, TYPE_FORMAT).ok()
}

/// Whether a file the program compiles is the project's own source, which a
/// transform may rewrite: under the project, not a declaration file, not a
/// dependency.
fn is_own_source(path: &Utf8Path, root: &Utf8Path) -> bool {
    path.starts_with(root)
        && !path.as_str().contains("/node_modules/")
        && !path.as_str().ends_with(".d.ts")
        && matches!(path.extension(), Some("ts" | "tsx"))
}

/// Revision rounds before the driver refuses. A transform whose revisions
/// each give back part of its rewrite settles in a round or two; the cap is
/// the termination argument, since a revision drawing new errors as fast as
/// it clears old ones would otherwise never end.
pub const REVISION_ROUNDS: usize = 4;

/// Runs `transform` over the project `opened` opened: the snapshot nts
/// should read, and the files in it that were rewritten.
pub(super) fn apply(
    transform: &mut dyn SourceTransform,
    client: &mut Client,
    opened: UpdateSnapshotResponse,
    root: &Utf8Path,
) -> Result<(UpdateSnapshotResponse, Vec<String>), TsgoError> {
    // Each rewritten file, with the project whose diagnostics judge it.
    let mut changed: Vec<(String, ProjectHandle)> = Vec::new();
    for project in &opened.projects {
        for path in compiled_files(client, opened.snapshot, &project.id)? {
            if !is_own_source(&path, root) {
                continue;
            }
            let bytes = client.source_file(opened.snapshot, &project.id, &path)?;
            if bytes.is_empty() {
                continue;
            }
            let tree = super::ast::decode(&bytes, nts_diagnostics::SourceId(0))
                .map_err(|source| TsgoError::Ast { file: path.to_string(), source })?;
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let mut types = SnapshotTypes { client, snapshot: opened.snapshot, project: &project.id, path: &path, tree: &tree };
            if let Some(rewritten) = transform.transform(&TransformInput { path: &path, text: &text, tree: &tree }, &mut types) {
                client.set_overlay(path.as_str(), rewritten)?;
                changed.push((path.to_string(), project.id.clone()));
            }
        }
    }
    if changed.is_empty() {
        return Ok((opened, Vec::new()));
    }
    let paths: Vec<String> = changed.iter().map(|(path, _)| path.clone()).collect();
    let mut current = client.update_files(&paths)?;
    for _ in 0..REVISION_ROUNDS {
        let mut revised = Vec::new();
        for (path, project) in &changed {
            let errors: Vec<(u32, u32)> = client
                .file_diagnostics(current.snapshot, project, path)?
                .into_iter()
                .filter(|d| d.category == proto::category::ERROR)
                .map(|d| (u32::try_from(d.pos.max(0)).unwrap_or(0), u32::try_from(d.end.max(0)).unwrap_or(0)))
                .collect();
            if errors.is_empty() {
                continue;
            }
            if let Some(text) = transform.revise(Utf8Path::new(path.as_str()), &errors) {
                client.set_overlay(path, text)?;
                revised.push(path.clone());
            }
        }
        if revised.is_empty() {
            return Ok((current, paths));
        }
        current = client.update_files(&revised)?;
    }
    Err(TsgoError::TransformUnsettled { rounds: REVISION_ROUNDS, identity: transform.identity() })
}
