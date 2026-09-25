//! A project as tsgo checks it: the snapshot, and the files of its own that
//! the React Compiler stage transforms.

use anyhow::{Context, Result, anyhow};
use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo};
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot};

use crate::tsgo::kinds as k;

/// Checks the project and returns nts's snapshot of it.
pub fn snapshot(tsconfig: &Utf8Path) -> Result<SemanticSnapshot> {
    let executable = tsgo::locate().ok_or_else(|| anyhow!("no tsgo: set NTS_TSGO, or build it (target/tsgo)"))?;
    TsgoApi::new(executable).snapshot(tsconfig).with_context(|| format!("tsgo could not load {tsconfig}"))
}

/// One source file of the project, with its `SourceFile` node.
#[derive(Debug, Clone)]
pub struct Source {
    pub path: Utf8PathBuf,
    pub root: NodeId,
}

/// The project's own TypeScript sources: under the project directory, not
/// declarations, not reached through `node_modules`.
#[must_use]
pub fn own_sources(snapshot: &SemanticSnapshot, project: &Utf8Path) -> Vec<Source> {
    let mut roots = vec![None; snapshot.sources.len()];
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind == NodeKind::Syntax(k::SOURCE_FILE) {
            let file = node.origin.location.file.0 as usize;
            if let Some(slot) = roots.get_mut(file) {
                slot.get_or_insert(NodeId(u32::try_from(index).unwrap_or(u32::MAX)));
            }
        }
    }
    snapshot
        .sources
        .iter()
        .zip(roots)
        .filter_map(|(source, root)| {
            let path = &source.display_path;
            let own = path.starts_with(project)
                && !path.as_str().contains("/node_modules/")
                && !path.as_str().ends_with(".d.ts")
                && matches!(path.extension(), Some("ts" | "tsx"));
            own.then(|| root.map(|root| Source { path: path.clone(), root })).flatten()
        })
        .collect()
}
