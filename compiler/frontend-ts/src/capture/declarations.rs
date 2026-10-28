//! Intern owned identities, including declarations outside the captured AST.

use nts_frontend_tsrs::{File, Node};
use nts_semantic_schema::{DeclarationSite, DeclarationSourceId, SnapshotError};

use super::{Capture, arena_index};

impl<'p> Capture<'p, '_> {
    pub(super) fn intern_declaration_source(
        &mut self,
        file: File<'p>,
    ) -> Result<DeclarationSourceId, SnapshotError> {
        if let Some(&id) = self.declaration_source_ids.get(&file.root()) {
            return Ok(id);
        }
        let source = self.declaration_sources.source(file)?.clone();
        let id = DeclarationSourceId(arena_index(self.snapshot.declaration_sources.len())?);
        self.snapshot.declaration_sources.push(source);
        self.declaration_source_ids.insert(file.root(), id);
        Ok(id)
    }

    pub(super) fn declaration_site(
        &mut self,
        node: Node<'p>,
    ) -> Result<Option<DeclarationSite>, SnapshotError> {
        let Some((span, kind)) = crate::declaration::coordinates(node)? else {
            return Ok(None);
        };
        Ok(Some(DeclarationSite {
            source: self.intern_declaration_source(node.source_file())?,
            span,
            kind,
        }))
    }
}
