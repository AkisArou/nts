//! Intern owned identities, including declarations outside the captured AST.

use nts_diagnostics::Digest;
use nts_frontend_tsrs::{File, Node};
use nts_semantic_schema::{DeclarationSite, DeclarationSourceId, NodeKind, SnapshotError};

use super::{Capture, arena_index};

impl<'p> Capture<'p, '_> {
    pub(super) fn intern_declaration_source(
        &mut self,
        file: File<'p>,
        captured: Option<&crate::SyntaxTree>,
    ) -> Result<DeclarationSourceId, SnapshotError> {
        if let Some(&id) = self.declaration_source_ids.get(&file.root()) {
            return Ok(id);
        }
        let (digest, utf16_len) = if let Some(tree) = captured {
            // The syntax root spans the entire file, including trailing trivia.
            // Its digest and coordinates already came from this checked revision.
            (tree.digest, tree.nodes[0].origin.location.span.end)
        } else {
            (
                Digest(file.content_digest().to_le_bytes()),
                u32::try_from(file.text().encode_utf16().count()).map_err(|_| {
                    SnapshotError::Project(format!(
                        "source {} exceeds nts's span range",
                        file.path()
                    ))
                })?,
            )
        };
        let source = nts_semantic_schema::DeclarationSource {
            project: file.project_config_path().to_owned(),
            path: file.path().to_owned(),
            digest,
            utf16_len,
        };
        let id = DeclarationSourceId(arena_index(self.snapshot.declaration_sources.len())?);
        self.snapshot.declaration_sources.push(source);
        self.declaration_source_ids.insert(file.root(), id);
        Ok(id)
    }

    pub(super) fn declaration_site(
        &mut self,
        node: Node<'p>,
    ) -> Result<Option<DeclarationSite>, SnapshotError> {
        if let Some(&id) = self.nodes.get(&node) {
            let captured = &self.snapshot.nodes[id.0 as usize];
            if captured.origin.generated.is_some() {
                return Ok(None);
            }
            if let NodeKind::Syntax(kind) = captured.kind {
                // The syntax pass already normalized token-start coordinates.
                // Querying native syntax again repeats that work per supplier.
                return Ok(Some(DeclarationSite {
                    source: self.snapshot.source_contexts[&captured.origin.location.file],
                    span: captured.origin.location.span,
                    kind,
                }));
            }
        }
        let Some((span, kind)) = crate::declaration::coordinates(node)? else {
            return Ok(None);
        };
        Ok(Some(DeclarationSite {
            source: self.intern_declaration_source(node.source_file(), None)?,
            span,
            kind,
        }))
    }
}
