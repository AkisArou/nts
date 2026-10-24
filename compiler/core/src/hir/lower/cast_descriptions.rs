//! Source spellings for structural-cast diagnostics, separate from ABI names.

use std::collections::hash_map::Entry;

use nts_diagnostics::{SourceId, SourceLocations};
use rustc_hash::FxHashMap;

use super::{FuncBuilder, NodeId, SemanticSnapshot, TypeId, describe, named};

pub(super) struct Descriptions<'a> {
    snapshot: &'a SemanticSnapshot,
    locations: SourceLocations<'a>,
    texts: FxHashMap<SourceId, Option<Vec<u16>>>,
}

impl<'a> Descriptions<'a> {
    pub(super) fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self {
            snapshot,
            locations: SourceLocations::new(&snapshot.sources),
            texts: FxHashMap::default(),
        }
    }

    pub(super) fn describe(
        &mut self,
        probe: &FuncBuilder<'_>,
        cast: NodeId,
        operand: usize,
        face: TypeId,
    ) -> String {
        let type_node = probe
            .children(cast)
            .get(1 - operand)
            .copied()
            .unwrap_or(cast);
        let at = &probe.node(type_node).origin.location;
        let source = self.snapshot.sources.get(at.file.0 as usize);
        let text = match self.texts.entry(at.file) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(
                source
                    .filter(|source| source.rewritten_by.is_none())
                    .and_then(|source| {
                        std::fs::read_to_string(&source.display_path)
                            .ok()
                            .map(|text| text.encode_utf16().collect())
                    }),
            ),
        };
        // Snapshot positions count UTF-16 units, including non-ASCII prefixes.
        let spelling = text
            .as_ref()
            .and_then(|text| text.get(at.span.start as usize..at.span.end as usize))
            .map(String::from_utf16_lossy)
            .map(|text| text.trim().replace(['\r', '\n'], " "))
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| {
                named(self.snapshot, face)
                    .filter(|name| !name.starts_with("__"))
                    .map_or_else(|| describe(self.snapshot, face), str::to_owned)
            });
        let position = self.locations.where_it_is(at);
        let position = source.map_or(position.clone(), |source| {
            position
                .strip_prefix(source.display_path.as_str())
                .map_or_else(
                    || source.uri.clone(),
                    |tail| format!("{}{tail}", source.uri),
                )
        });
        format!("`{spelling}` at {position}")
    }
}
