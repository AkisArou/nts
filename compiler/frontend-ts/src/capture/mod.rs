//! Build one owned semantic graph from the requested native program.
//!
//! Every file's syntax identity is associated before any declaration is
//! resolved. A cross-file declaration is therefore an ordinary lookup; no
//! declaration handle or deferred transport repair survives this boundary.

mod diagnostics;
mod graph;
mod queries;
mod signatures;
mod symbols;
mod types;

pub(crate) use diagnostics::append as append_diagnostics;

#[cfg(test)]
mod tests;

use camino::Utf8Path;
use nts_diagnostics::{SourceFile, SourceId};
use nts_frontend_tsrs::{File, Node, Signature, Symbol, Type};
use nts_semantic_schema::{
    ModuleRecord, NodeId, SCHEMA_VERSION, SemanticSnapshot, SignatureId, SnapshotError, SymbolId,
    TypeId,
};
use rustc_hash::FxHashMap;

/// Native identities are lookup keys only. Arena and worklist insertion order
/// comes from native source/visitor order, never a checker ID or hash iteration.
pub(crate) struct Capture<'p, 'r> {
    snapshot: SemanticSnapshot,
    cwd: &'r Utf8Path,
    nodes: FxHashMap<Node<'p>, NodeId>,
    native_nodes: Vec<Option<Node<'p>>>,
    queries: Vec<queries::Queries>,
    files: Vec<(File<'p>, NodeId)>,
    symbols: FxHashMap<Symbol<'p>, SymbolId>,
    symbol_work: Vec<Symbol<'p>>,
    types: FxHashMap<Type<'p>, TypeId>,
    type_work: Vec<Type<'p>>,
    signatures: FxHashMap<(Signature<'p>, bool), SignatureId>,
    type_budget_exhausted: bool,
    #[cfg(test)]
    type_query_trace: Vec<graph::TypeQuery>,
}

impl<'p, 'r> Capture<'p, 'r> {
    /// Files have already passed nts's source/library/surface inclusion policy.
    /// Only the requested Project's files may be passed here; referenced
    /// programs are not merged into a compilation's identity domain.
    pub(crate) fn syntax(
        cwd: &'r Utf8Path,
        files: impl IntoIterator<Item = File<'p>>,
        semantics: nts_frontend_tsrs::ProjectSemantics,
    ) -> Result<Self, SnapshotError> {
        let mut capture = Self {
            snapshot: SemanticSnapshot {
                schema_version: SCHEMA_VERSION,
                semantics: nts_semantic_schema::ProjectSemantics {
                    use_define_for_class_fields: semantics.use_define_for_class_fields,
                    experimental_decorators: semantics.experimental_decorators,
                    emit_decorator_metadata: semantics.emit_decorator_metadata,
                    verbatim_module_syntax: semantics.verbatim_module_syntax,
                    preserve_const_enums: semantics.preserve_const_enums,
                    isolated_modules: semantics.isolated_modules,
                },
                ..SemanticSnapshot::default()
            },
            cwd,
            nodes: FxHashMap::default(),
            native_nodes: Vec::new(),
            queries: Vec::new(),
            files: Vec::new(),
            symbols: FxHashMap::default(),
            symbol_work: Vec::new(),
            types: FxHashMap::default(),
            type_work: Vec::new(),
            signatures: FxHashMap::default(),
            type_budget_exhausted: false,
            #[cfg(test)]
            type_query_trace: Vec::new(),
        };
        for file in files {
            let source = SourceId(arena_index(capture.snapshot.sources.len())?);
            let tree = crate::native_ast::capture(file, source)?;
            let base = arena_index(capture.snapshot.nodes.len())?;
            capture
                .snapshot
                .nodes
                .extend(tree.tree.nodes.into_iter().map(|mut node| {
                    node.parent = node.parent.map(|id| NodeId(id.0 + base));
                    for child in &mut node.children {
                        child.0 += base;
                    }
                    node
                }));
            capture.snapshot.diagnostics.extend(tree.tree.diagnostics);
            capture.native_nodes.extend(tree.native_nodes);
            for (native, local) in tree.by_node {
                capture.nodes.insert(native, NodeId(local.0 + base));
            }
            capture.snapshot.sources.push(SourceFile {
                uri: workspace_uri(cwd, file.path()),
                display_path: file.path().to_owned(),
                digest: tree.tree.digest,
                rewritten_by: None,
                rewritten_map: Vec::new(),
            });
            capture.files.push((file, NodeId(base)));
            capture.snapshot.modules.push(ModuleRecord {
                file: source,
                root: NodeId(base),
                imports: Vec::new(),
                exports: Vec::new(),
            });
        }
        capture.queries = queries::for_nodes(&capture.snapshot, &capture.native_nodes);
        Ok(capture)
    }

    pub(crate) fn finish(mut self) -> Result<SemanticSnapshot, SnapshotError> {
        self.resolve_symbols()?;
        crate::link::modules(&mut self.snapshot);
        self.capture_node_types()?;
        self.capture_calls_and_constants()?;
        let seeds = nts_semantic_schema::reachability::for_frontend(&self.snapshot).seeds();
        self.expand_types(seeds)?;
        self.snapshot.bound_types = crate::bindings::bound_types(&self.snapshot);
        self.snapshot.validate()?;
        Ok(self.snapshot)
    }
}

fn arena_index(length: usize) -> Result<u32, SnapshotError> {
    u32::try_from(length)
        .map_err(|_| SnapshotError::Project("the semantic graph exceeds nts's arena range".into()))
}

fn workspace_uri(cwd: &Utf8Path, path: &Utf8Path) -> String {
    format!(
        "nts-workspace:///{}",
        path.strip_prefix(cwd).unwrap_or(path)
    )
}
