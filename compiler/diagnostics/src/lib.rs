//! Source identity, spans, and diagnostics.
//!
//! This crate is the root of the dependency graph: everything else may depend
//! on it, and it depends on nothing of ours. It exists so that a source
//! location means one thing across the frontend, the IR, analysis, codegen,
//! and the debug map.
//!
//! RFC §20.4 requires that a source file be identified by a normalized
//! workspace URI and a content digest rather than by an absolute machine path,
//! so that builds are reproducible and release artifacts never carry a
//! developer's home directory.

use camino::Utf8PathBuf;
use serde::{Deserialize, Serialize};

/// Interned identity of a source file within one compilation.
///
/// The `u32` is an index into the snapshot's source table, not a hash. Two
/// compilations may assign different ids to the same file; [`SourceFile::digest`]
/// is the stable identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SourceId(pub u32);

/// A content digest over a source file's bytes.
///
/// Participates in cache keys. Stored as bytes rather than a string so the
/// hash algorithm can change without reformatting every cached artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Digest(pub [u8; 16]);

/// A source file's stable identity, per RFC §20.4.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceFile {
    /// Normalized, machine-independent URI: `nts-workspace:///src/App.tsx`.
    pub uri: String,
    /// Digest over the file's bytes.
    pub digest: Digest,
    /// Path as written, for diagnostics only. Never enters a release artifact.
    pub display_path: Utf8PathBuf,
}

/// A half-open byte range within a source file.
///
/// Byte offsets rather than line/column: tsgo's encoded AST carries `pos`/`end`
/// as byte offsets, and converting once at the diagnostic boundary is cheaper
/// and less lossy than converting at every node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    #[must_use]
    pub const fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }

    #[must_use]
    pub const fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }

    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.end <= self.start
    }
}

/// A span paired with the file it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Location {
    pub file: SourceId,
    pub span: Span,
}

/// How severely a diagnostic affects the build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Severity {
    /// The build cannot produce an artifact.
    Error,
    /// The build proceeds, but something is likely wrong.
    Warning,
    /// Explanatory context attached to another diagnostic.
    Note,
}

/// A compiler diagnostic.
///
/// RFC §4.1: unsupported reachable behavior must be diagnosed *precisely*.
/// A diagnostic without a location is a bug, which is why [`Diagnostic::primary`]
/// is not optional.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: Severity,
    /// Stable, greppable identifier such as `NTS0042`.
    pub code: String,
    pub message: String,
    pub primary: Location,
    pub labels: Vec<Label>,
}

/// A secondary annotation on a diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Label {
    pub location: Location,
    pub message: String,
}

impl Diagnostic {
    pub fn error(code: impl Into<String>, message: impl Into<String>, primary: Location) -> Self {
        Self {
            severity: Severity::Error,
            code: code.into(),
            message: message.into(),
            primary,
            labels: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_label(mut self, location: Location, message: impl Into<String>) -> Self {
        self.labels.push(Label {
            location,
            message: message.into(),
        });
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_span_has_no_length() {
        let span = Span::new(7, 7);
        assert!(span.is_empty());
        assert_eq!(span.len(), 0);
    }

    #[test]
    fn inverted_span_does_not_underflow() {
        // Defensive: a malformed span from the frontend must not panic in
        // release or wrap into a huge length.
        let span = Span::new(9, 4);
        assert_eq!(span.len(), 0);
        assert!(span.is_empty());
    }
}
