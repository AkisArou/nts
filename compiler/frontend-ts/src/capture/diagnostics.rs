//! Preserve native diagnostics and their source associations in the snapshot.

use nts_diagnostics::{Diagnostic, Digest, Label, Location, Severity, SourceFile, SourceId, Span};
use nts_frontend_tsrs::{self as native, Project, SyntaxPhase};
use nts_semantic_schema::{SemanticSnapshot, SnapshotError};

use super::{arena_index, workspace_uri};

pub(crate) fn append(
    snapshot: &mut SemanticSnapshot,
    cwd: &camino::Utf8Path,
    project: Project<'_, SyntaxPhase>,
    mut reported: Vec<native::Diagnostic>,
) -> Result<(), SnapshotError> {
    // Ordinary diagnostics retain TypeScript's checkJs/directive filtering.
    // Only the separate plain-JS facts are narrowed by nts's measured policy.
    for diagnostic in project.plain_js_unfiltered() {
        if crate::early_errors::EARLY_ERRORS.contains(&diagnostic.code)
            && !reported.iter().any(|seen| {
                seen.code == diagnostic.code
                    && seen.path == diagnostic.path
                    && seen.span == diagnostic.span
            })
        {
            reported.push(diagnostic);
        }
    }
    reported.sort();
    Diagnostics { snapshot, cwd }.diagnostics(project, reported)
}

struct Diagnostics<'a> {
    snapshot: &'a mut SemanticSnapshot,
    cwd: &'a camino::Utf8Path,
}

impl Diagnostics<'_> {
    fn diagnostics(
        &mut self,
        project: Project<'_, SyntaxPhase>,
        reported: Vec<native::Diagnostic>,
    ) -> Result<(), SnapshotError> {
        for native in reported {
            let primary = self.diagnostic_location(project, &native, None)?;
            let mut diagnostic = Diagnostic {
                severity: match native.category {
                    native::DiagnosticCategory::Error => Severity::Error,
                    native::DiagnosticCategory::Warning => Severity::Warning,
                    native::DiagnosticCategory::Suggestion
                    | native::DiagnosticCategory::Message => Severity::Note,
                },
                code: format!("TS{}", native.code),
                message: native.message,
                primary,
                labels: Vec::new(),
            };
            let mut pending: Vec<_> = native
                .chain
                .into_iter()
                .chain(native.related)
                .rev()
                .map(|d| (d, primary))
                .collect();
            while let Some((nested, parent)) = pending.pop() {
                let location = self.diagnostic_location(project, &nested, Some(parent))?;
                diagnostic.labels.push(Label {
                    location,
                    message: nested.message,
                });
                pending.extend(
                    nested
                        .chain
                        .into_iter()
                        .chain(nested.related)
                        .rev()
                        .map(|d| (d, location)),
                );
            }
            self.snapshot.diagnostics.push(diagnostic);
        }
        Ok(())
    }

    fn diagnostic_location(
        &mut self,
        project: Project<'_, SyntaxPhase>,
        reported: &native::Diagnostic,
        inherited: Option<Location>,
    ) -> Result<Location, SnapshotError> {
        if reported.path.is_none()
            && let Some(location) = inherited
        {
            return Ok(location);
        }
        // A global/configuration diagnostic belongs to the actual config. It
        // must not acquire an arbitrary program source as its primary location.
        let path = reported
            .path
            .as_deref()
            .unwrap_or_else(|| project.config_path());
        let file = if let Some(index) = self
            .snapshot
            .sources
            .iter()
            .position(|source| source.display_path == path)
        {
            SourceId(arena_index(index)?)
        } else {
            let digest = if let Some(file) = project.files().find(|file| file.path() == path) {
                file.content_digest()
            } else {
                let bytes = std::fs::read(path).map_err(|error| {
                    SnapshotError::Project(format!("cannot read diagnostic source {path}: {error}"))
                })?;
                xxhash_rust::xxh3::xxh3_128(&bytes)
            };
            let id = SourceId(arena_index(self.snapshot.sources.len())?);
            self.snapshot.sources.push(SourceFile {
                uri: workspace_uri(self.cwd, path),
                digest: Digest(digest.to_le_bytes()),
                display_path: path.to_owned(),
                rewritten_by: None,
                rewritten_map: Vec::new(),
            });
            id
        };
        Ok(Location {
            file,
            span: reported
                .span
                .map_or(Span::new(0, 0), |span| Span::new(span.start.0, span.end.0)),
        })
    }
}
