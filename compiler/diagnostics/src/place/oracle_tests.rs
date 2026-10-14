//! Preserve the old scanner's answers while indexing source locations.

use super::{diagnostic_line, original_offset, transform_name, where_it_is, where_it_spans};
use crate::{Diagnostic, Digest, Location, RewrittenSegment, SourceFile, SourceId, Span};
use camino::Utf8PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_FILE: AtomicUsize = AtomicUsize::new(0);

struct Scratch(Utf8PathBuf);

impl Scratch {
    fn new(bytes: &[u8]) -> Self {
        let name = format!(
            "nts-place-{}-{}.ts",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        );
        let path = Utf8PathBuf::from_path_buf(std::env::temp_dir().join(name))
            .expect("test scratch path is UTF-8");
        std::fs::write(&path, bytes).expect("write location fixture");
        Self(path)
    }

    fn source(&self) -> SourceFile {
        SourceFile {
            uri: format!(
                "nts-workspace:///{}",
                self.0.file_name().expect("file name")
            ),
            digest: Digest([0; 16]),
            display_path: self.0.clone(),
            rewritten_by: None,
            rewritten_map: Vec::new(),
        }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn at(file: u32, start: u32, end: u32) -> Location {
    Location {
        file: SourceId(file),
        span: Span::new(start, end),
    }
}

/// The pre-index implementation, including surrogate-interior rounding and
/// byte columns. Kept as a test oracle, never called by a production printer.
pub(super) fn old_where_it_is(sources: &[SourceFile], at: &Location) -> String {
    let Some(source) = sources.get(at.file.0 as usize) else {
        return "<unknown>".to_owned();
    };
    let path = &source.display_path;
    let mut offset = at.span.start;
    let mut generated = None;
    if let Some(transform) = &source.rewritten_by {
        match original_offset(&source.rewritten_map, offset) {
            Some((original, was_generated)) => {
                offset = original;
                generated = was_generated.then_some(transform);
            }
            None => {
                return format!(
                    "{path} (as {transform} rewrote it; the position is in that text, not the file on disk)"
                );
            }
        }
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return path.to_string();
    };
    let offset = old_byte_of_unit(&text, offset);
    let upto = &text.as_bytes()[..offset.min(text.len())];
    #[allow(clippy::naive_bytecount)]
    let line = upto.iter().filter(|byte| **byte == b'\n').count() + 1;
    let column = upto.len()
        - upto
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |at| at + 1);
    match generated {
        Some(transform) => format!(
            "{path}:{line}:{} (in code {} generated from it)",
            column + 1,
            transform_name(transform)
        ),
        None => format!("{path}:{line}:{}", column + 1),
    }
}

fn old_byte_of_unit(text: &str, unit: u32) -> usize {
    let mut units = 0u32;
    for (at, character) in text.char_indices() {
        if units >= unit {
            return at;
        }
        units += u32::try_from(character.len_utf16()).unwrap_or(1);
    }
    text.len()
}

fn assert_all_offsets(sources: &[SourceFile], through: u32) {
    for file in 0..sources.len() {
        for start in 0..=through {
            let file = u32::try_from(file).expect("small source fixture");
            let location = at(file, start, start.saturating_add(3));
            let expected = old_where_it_is(sources, &location);
            assert_eq!(where_it_is(sources, &location), expected, "{location:?}");
            assert_eq!(
                where_it_spans(sources, &location),
                format!(
                    "{} - {}",
                    expected,
                    old_where_it_is(sources, &at(file, location.span.end, location.span.end))
                ),
                "{location:?}"
            );
            let diagnostic = Diagnostic::error("NTS1001", "a location control", location);
            assert_eq!(
                diagnostic_line(sources, &diagnostic),
                format!("{expected}: NTS1001 a location control")
            );
        }
    }
}

#[test]
fn every_unit_offset_keeps_the_scanners_line_and_byte_column() {
    for text in [
        "",
        "ascii without a newline",
        "first\nsecond\n",
        "first\r\nsecond\r\n",
        "a\u{2014}b\n\u{00e9}\u{4e2d}\r\n\u{1f600}tail\n",
        "\u{1f600}\u{1f600}\u{2014}\u{1f600}",
    ] {
        let scratch = Scratch::new(text.as_bytes());
        let sources = [scratch.source()];
        let units = u32::try_from(text.encode_utf16().count()).expect("short fixture");
        assert_all_offsets(&sources, units + 5);
        assert_eq!(
            where_it_is(&sources, &at(0, u32::MAX, u32::MAX)),
            old_where_it_is(&sources, &at(0, u32::MAX, u32::MAX))
        );
    }
}

fn segment(rewritten: u32, original: u32, len: u32, generated: bool) -> RewrittenSegment {
    RewrittenSegment {
        rewritten,
        original,
        len,
        generated,
    }
}

#[test]
fn copied_generated_overlapping_and_uncovered_rewrites_keep_the_old_answer() {
    let scratch = Scratch::new("head\r\n\u{2014}\u{1f600}tail\nlast".as_bytes());
    let plain = scratch.source();
    let mut rewritten = plain.clone();
    rewritten.rewritten_by = Some("react-compiler@identity jsx=true".to_owned());
    rewritten.rewritten_map = vec![
        segment(0, 0, 5, false),
        segment(10, 6, 30, true),
        segment(12, 7, 3, true),
        segment(13, 8, 2, false),
        segment(13, 0, 2, false), // The first overlapping copy wins.
        segment(50, 10, 3, false),
        segment(60, 16, 0, true),
    ];
    let mut unmapped = plain.clone();
    unmapped.rewritten_by = rewritten.rewritten_by.clone();
    // These source ids share a physical file, but have distinct rewrite maps.
    assert_all_offsets(&[plain, rewritten, unmapped], 70);
}

#[test]
fn missing_invalid_utf8_and_unknown_sources_keep_the_fallback() {
    let invalid = Scratch::new(&[b'a', 0xff, b'\n']);
    let missing = Scratch::new(b"control\n");
    std::fs::remove_file(&missing.0).expect("remove missing-file fixture");
    let mut generated_missing = missing.source();
    generated_missing.rewritten_by = Some("react-compiler@identity".to_owned());
    generated_missing.rewritten_map = vec![segment(0, 0, 9, true)];
    let sources = [invalid.source(), missing.source(), generated_missing];
    assert_all_offsets(&sources, 12);
    for file in [3, u32::MAX] {
        let location = at(file, 1, 2);
        assert_eq!(where_it_is(&sources, &location), "<unknown>");
        assert_eq!(where_it_spans(&sources, &location), "<unknown> - <unknown>");
    }
    assert_eq!(where_it_is(&sources, &at(2, 1, 2)), missing.0.as_str());
}

#[test]
fn independent_wrapper_calls_read_a_replaced_file_again() {
    let scratch = Scratch::new(b"first\nsecond\n");
    let sources = [scratch.source()];
    let location = at(0, 8, 8);
    assert_eq!(
        where_it_is(&sources, &location),
        format!("{}:2:3", scratch.0)
    );
    std::fs::write(&scratch.0, b"no newline now").expect("replace location fixture");
    assert_eq!(
        where_it_is(&sources, &location),
        format!("{}:1:9", scratch.0)
    );
}
