//! A code writer that cannot emit a line without saying where it came from.
//!
//! # Provenance is structural, not remembered
//!
//! RFC decision 20 requires source provenance to survive into the emitted
//! artifact, and RFC §21.1 wants `#line` directives and a sidecar debug map. A
//! writer that takes text and separately offers a "record an origin" call gets
//! that right exactly as often as somebody remembers to call it.
//!
//! Here the only way to emit is [`CodeWriter::line`], which requires an
//! [`Origin`]. The text and the line-to-origin map are produced by the same call,
//! so they cannot disagree and neither can be forgotten.

use nts_semantic_schema::Origin;

/// Emitted text, and where each line came from.
#[derive(Debug, Default)]
pub struct CodeWriter {
    text: String,
    /// One entry per emitted line, parallel to the text's lines.
    origins: Vec<Origin>,
    indent: usize,
}

impl CodeWriter {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Emit one line, attributed to `origin`.
    ///
    /// The only way to add code. Everything else on this type either adjusts
    /// indentation or reads the result.
    pub fn line(&mut self, origin: &Origin, text: impl AsRef<str>) {
        for _ in 0..self.indent {
            self.text.push_str("    ");
        }
        self.text.push_str(text.as_ref());
        self.text.push('\n');
        self.origins.push(origin.clone());
    }

    /// Emit a blank line.
    ///
    /// Attributed like any other line, because a debug map with holes in its line
    /// numbering is a debug map that points at the wrong line.
    pub fn blank(&mut self, origin: &Origin) {
        self.text.push('\n');
        self.origins.push(origin.clone());
    }

    pub fn indent(&mut self) {
        self.indent += 1;
    }

    pub fn dedent(&mut self) {
        self.indent = self.indent.saturating_sub(1);
    }

    /// Run `body` one level deeper.
    pub fn nested(&mut self, body: impl FnOnce(&mut Self)) {
        self.indent();
        body(self);
        self.dedent();
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Where each emitted line came from, indexed from zero.
    ///
    /// A `#line` directive or a `.ntsdbg` entry is built from this without the
    /// emitter having had to maintain it.
    #[must_use]
    pub fn origins(&self) -> &[Origin] {
        &self.origins
    }

    /// The origin of a one-based line number, as a debugger would ask.
    #[must_use]
    pub fn origin_of_line(&self, line: usize) -> Option<&Origin> {
        self.origins.get(line.checked_sub(1)?)
    }

    #[must_use]
    pub fn into_text(self) -> String {
        self.text
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use nts_diagnostics::{Location, SourceId, Span};

    fn origin(start: u32) -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(start, start + 1),
        })
    }

    #[test]
    fn every_emitted_line_has_an_origin() {
        // The invariant the type exists for. There is no way to add a line
        // without one, so the map cannot fall behind the text.
        let mut writer = CodeWriter::new();
        writer.line(&origin(1), "int f(void) {");
        writer.nested(|w| w.line(&origin(2), "return 1;"));
        writer.line(&origin(3), "}");

        assert_eq!(writer.text().lines().count(), writer.origins().len());
    }

    #[test]
    fn a_line_maps_back_to_its_source_span() {
        let mut writer = CodeWriter::new();
        writer.line(&origin(10), "a");
        writer.line(&origin(20), "b");

        assert_eq!(
            writer.origin_of_line(2).map(|o| o.location.span.start),
            Some(20),
        );
        assert!(writer.origin_of_line(0).is_none(), "lines are one-based");
        assert!(writer.origin_of_line(3).is_none());
    }

    #[test]
    fn a_blank_line_still_occupies_a_line_number() {
        // A hole here shifts every subsequent line in the debug map, which points
        // a debugger at the wrong statement — quietly.
        let mut writer = CodeWriter::new();
        writer.line(&origin(1), "a");
        writer.blank(&origin(1));
        writer.line(&origin(2), "b");

        assert_eq!(writer.origins().len(), 3);
        assert_eq!(
            writer.origin_of_line(3).map(|o| o.location.span.start),
            Some(2),
        );
    }

    #[test]
    fn nesting_indents_and_restores() {
        let mut writer = CodeWriter::new();
        writer.line(&origin(1), "outer");
        writer.nested(|w| w.line(&origin(2), "inner"));
        writer.line(&origin(3), "outer again");

        let lines: Vec<&str> = writer.text().lines().collect();
        assert_eq!(lines[0], "outer");
        assert_eq!(lines[1], "    inner");
        assert_eq!(lines[2], "outer again");
    }
}
