//! One native-to-owned declaration projection for inspection and full capture.

use nts_diagnostics::{Digest, Span};
use nts_frontend_tsrs::{File, Node};
use nts_semantic_schema::{DeclarationIdentity, DeclarationSource, SnapshotError};
use rustc_hash::FxHashMap;

/// Memoization is local to one checked revision. Owned file/config keys keep
/// this table independent of native lifetimes and preserve inspection covariance.
#[derive(Debug, Default)]
pub(crate) struct Sources {
    files: FxHashMap<(camino::Utf8PathBuf, camino::Utf8PathBuf), DeclarationSource>,
}

impl Sources {
    pub(crate) fn source(&mut self, file: File<'_>) -> Result<&DeclarationSource, SnapshotError> {
        let key = (
            file.project_config_path().to_owned(),
            file.path().to_owned(),
        );
        if let std::collections::hash_map::Entry::Vacant(entry) = self.files.entry(key.clone()) {
            entry.insert(DeclarationSource {
                project: file.project_config_path().to_owned(),
                path: file.path().to_owned(),
                digest: Digest(file.content_digest().to_le_bytes()),
                utf16_len: u32::try_from(file.text().encode_utf16().count()).map_err(|_| {
                    SnapshotError::Project(format!(
                        "source {} exceeds nts's span range",
                        file.path()
                    ))
                })?,
            });
        }
        Ok(&self.files[&key])
    }

    pub(crate) fn identity(
        &mut self,
        node: Node<'_>,
    ) -> Result<Option<DeclarationIdentity>, SnapshotError> {
        let Some((span, kind)) = coordinates(node)? else {
            return Ok(None);
        };
        Ok(Some(DeclarationIdentity {
            source: self.source(node.source_file())?.clone(),
            span,
            kind,
        }))
    }
}

pub(crate) fn coordinates(node: Node<'_>) -> Result<Option<(Span, u16)>, SnapshotError> {
    let Some(span) = node.span() else {
        return Ok(None);
    };
    let kind = crate::native_syntax::to_semantic(node.kind()).ok_or_else(|| {
        SnapshotError::Project(format!("unknown declaration syntax kind {}", node.kind()))
    })?;
    Ok(Some((
        Span::new(node.token_start().map_or(span.start.0, |p| p.0), span.end.0),
        kind,
    )))
}
