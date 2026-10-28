//! A bounded planning continuation inside the capture's checked session.
//!
//! This module supplies no provider policy. The build's planner owns selection
//! and the shared semantic classifier; the frontend owns native lifetimes,
//! source stages and the single final semantic capture.

use camino::{Utf8Path, Utf8PathBuf};
use nts_diagnostics::SourceFile;
use nts_frontend_tsrs::{Input, ProjectSpec};
use nts_semantic_schema::{
    ModuleRecord, NodeRecord, ProjectSemantics, SemanticSnapshot, SnapshotError,
};

use crate::transform::NodeTypes;

pub(crate) fn roots_present<'a>(
    roots: &[Utf8PathBuf],
    sources: impl IntoIterator<Item = &'a Utf8Path>,
) -> bool {
    if roots.is_empty() {
        return true;
    }
    let sources: rustc_hash::FxHashSet<_> = sources.into_iter().collect();
    roots.iter().all(|root| sources.contains(root.as_path()))
}

/// The syntax arena which this capture will finish, with checked queries into
/// precisely that revision. Node IDs are local to this view. Only owned
/// declaration identities and the owned plan may survive a source revision.
#[derive(Debug)]
pub struct SourceWorld<'a> {
    pub(crate) nodes: &'a [NodeRecord],
    pub(crate) sources: &'a [SourceFile],
    pub(crate) modules: &'a [ModuleRecord],
    pub(crate) semantics: &'a ProjectSemantics,
    pub(crate) types: NodeTypes<'a>,
}

impl SourceWorld<'_> {
    #[must_use]
    pub fn nodes(&self) -> &[NodeRecord] {
        self.nodes
    }

    #[must_use]
    pub fn sources(&self) -> &[SourceFile] {
        self.sources
    }

    /// Module roots have been associated; imports/exports and the full type
    /// graph are captured only after planning has accepted the final world.
    #[must_use]
    pub fn modules(&self) -> &[ModuleRecord] {
        self.modules
    }

    #[must_use]
    pub fn semantics(&self) -> &ProjectSemantics {
        self.semantics
    }

    #[must_use]
    pub fn types(&self) -> &NodeTypes<'_> {
        &self.types
    }
}

/// The selected plan and its complete, recorded source implementation closure.
/// Roots are absolute paths. Ordinary source dependencies inside an external
/// package must be named too; adding an entry never opens all of `node_modules`.
#[derive(Debug)]
pub struct Planned<P> {
    pub plan: P,
    pub source_roots: Vec<Utf8PathBuf>,
}

/// One selection, followed by at most one final-world verification. A changed
/// requirement/supplier set must return an error from `verify`, never ask the
/// frontend to replan. No native type/symbol/overload handle can enter `Plan`.
pub trait CapturePlanner: Send {
    type Plan: Send;
    type Error: From<SnapshotError> + Send;

    fn plan(&mut self, world: &SourceWorld<'_>) -> Result<Planned<Self::Plan>, Self::Error>;

    /// Called only when the plan added source roots. Reclassify the complete
    /// final supplier/requirement set, including ambient merges and overloads,
    /// and validate the plan against it. This cannot request another revision.
    fn verify(&mut self, world: &SourceWorld<'_>, plan: &Self::Plan) -> Result<(), Self::Error>;
}

/// Exact native host observations for one revision, including negative lookups.
/// These are run-local replay evidence, not portable provider-record digests.
/// Validate them through the native adapter with this exact spec and session
/// identity; the path-shaped fingerprints must not be relabelled file hashes.
#[derive(Debug)]
pub struct RevisionInputs {
    pub spec: ProjectSpec,
    pub inputs: Vec<Input>,
}

#[derive(Debug)]
pub struct PlannedSnapshot<P> {
    pub snapshot: SemanticSnapshot,
    pub plan: P,
    /// Every physical/overlay revision, not only the final transformed world.
    pub inputs: Vec<RevisionInputs>,
    pub session_identity: String,
}

#[cfg(test)]
mod tests {
    use super::roots_present;
    use camino::Utf8PathBuf;
    use std::cell::Cell;

    #[test]
    fn dense_root_membership_visits_each_source_once() {
        let files: Vec<_> = (0..8192)
            .map(|id| Utf8PathBuf::from(format!("/source/{id}.ts")))
            .collect();
        let roots: Vec<_> = files.iter().rev().cloned().collect();
        let visits = Cell::new(0);
        assert!(roots_present(
            &roots,
            files.iter().map(|file| {
                visits.set(visits.get() + 1);
                file.as_path()
            })
        ));
        assert_eq!(
            visits.get(),
            files.len(),
            "one collection, not one scan per root"
        );
        let mut missing = roots;
        missing.push(Utf8PathBuf::from("/source/absent.ts"));
        assert!(!roots_present(
            &missing,
            files.iter().map(Utf8PathBuf::as_path)
        ));
    }

    #[test]
    fn an_empty_root_request_does_not_walk_or_index_sources() {
        assert!(roots_present(
            &[],
            std::iter::once_with(|| -> &'static camino::Utf8Path {
                panic!("compiler-only planning needs no source-path index")
            })
        ));
    }
}
