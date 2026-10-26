//! Where a diagnostic is, in the source the program was written from.
//!
//! **Here rather than in a tool, because every type it reads is here.**
//! `SourceFile`, its `rewritten_map`, `Location`, `Span` and `Diagnostic` are
//! all this crate's, and the one thing this needs beyond them is the file's
//! text. A [`SourceLocations`] view reads and indexes each file once for a
//! print batch; spans and diagnostic lines share the same conversion.
//!
//! It lived in `tooling/cli` until 2026-09-28, which is a binary, so
//! `tooling/differential` could not call it -- and `nts check` therefore
//! printed a checker error and four backend declines with no place at all
//! while every other command printed one. A fact about a snapshot's sources
//! kept in a binary is a fact no other tool can have.

use crate::{Diagnostic, Location, RewrittenSegment, SourceFile, SourceId, Span};
use camino::Utf8Path;
use std::collections::{HashMap, hash_map::Entry};

#[cfg(test)]
mod oracle_tests;

/// Source positions for one print batch, with files indexed on their first use.
///
/// HIR headers and refusals can name thousands of positions in one file.
/// Scanning from its beginning for each position is quadratic in file size.
/// This view shares line starts and UTF-16 conversion indexes across the batch,
/// including source ids that name the same physical path. Rewrite maps remain
/// specific to each source record. A fresh view reads files afresh.
#[derive(Debug)]
pub struct SourceLocations<'a> {
    sources: &'a [SourceFile],
    first_file: u32,
    files: HashMap<&'a Utf8Path, Option<FileLocations>>,
    #[cfg(test)]
    file_reads: usize,
}

impl<'a> SourceLocations<'a> {
    #[must_use]
    pub fn new(sources: &'a [SourceFile]) -> Self {
        Self {
            sources,
            first_file: 0,
            files: HashMap::new(),
            #[cfg(test)]
            file_reads: 0,
        }
    }

    fn one_file(sources: &'a [SourceFile], file: SourceId) -> Self {
        let source = sources
            .get(file.0 as usize)
            .map_or(&[][..], std::slice::from_ref);
        let mut locations = Self::new(source);
        locations.first_file = file.0;
        locations
    }

    fn source(&self, file: SourceId) -> Option<&'a SourceFile> {
        let index = file.0.checked_sub(self.first_file)? as usize;
        self.sources.get(index)
    }

    fn file_locations(&mut self, path: &'a Utf8Path) -> Option<&FileLocations> {
        match self.files.entry(path) {
            Entry::Occupied(entry) => entry.into_mut().as_ref(),
            Entry::Vacant(entry) => {
                #[cfg(test)]
                {
                    self.file_reads += 1;
                }
                entry
                    .insert(
                        std::fs::read_to_string(path)
                            .ok()
                            .map(|text| FileLocations::new(&text)),
                    )
                    .as_ref()
            }
        }
    }

    /// A position as `path:line:column`, resolved through its rewrite map.
    #[must_use]
    pub fn where_it_is(&mut self, at: &Location) -> String {
        let Some(source) = self.source(at.file) else {
            return "<unknown>".to_owned();
        };
        let path = &source.display_path;
        let mut offset = at.span.start;
        let mut generated = None;
        // Resolve the source record before using the physical-file index:
        // two records for one path can have different transforms and maps.
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
        let Some(file) = self.file_locations(path) else {
            return path.to_string();
        };
        let (line, column) = file.position(offset);
        match generated {
            Some(transform) => format!(
                "{path}:{line}:{column} (in code {} generated from it)",
                transform_name(transform)
            ),
            None => format!("{path}:{line}:{column}"),
        }
    }

    /// Both endpoints of a span, sharing the same source-file index.
    #[must_use]
    pub fn where_it_spans(&mut self, at: &Location) -> String {
        let ends = |offset| Location {
            file: at.file,
            span: Span::new(offset, offset),
        };
        format!(
            "{} - {}",
            self.where_it_is(&ends(at.span.start)),
            self.where_it_is(&ends(at.span.end))
        )
    }

    /// One diagnostic in the format shared by all tools.
    #[must_use]
    pub fn diagnostic_line(&mut self, diagnostic: &Diagnostic) -> String {
        format!(
            "{}: {} {}",
            self.where_it_is(&diagnostic.primary),
            diagnostic.code,
            diagnostic.message
        )
    }
}

#[derive(Debug)]
struct FileLocations {
    bytes: usize,
    units: usize,
    line_starts: Vec<usize>,
    wide: Vec<WideCharacter>,
}

#[derive(Debug)]
struct WideCharacter {
    unit_start: usize,
    unit_end: usize,
    byte_end: usize,
}

impl FileLocations {
    fn new(text: &str) -> Self {
        let mut line_starts = vec![0];
        let mut wide = Vec::new();
        let mut units = 0;
        // One pass; ASCII needs no conversion entry. Keep only the indexes,
        // so the file's text can be dropped as soon as they are built.
        for (byte, character) in text.char_indices() {
            let unit_end = units + character.len_utf16();
            if !character.is_ascii() {
                wide.push(WideCharacter {
                    unit_start: units,
                    unit_end,
                    byte_end: byte + character.len_utf8(),
                });
            }
            if character == '\n' {
                line_starts.push(byte + 1);
            }
            units = unit_end;
        }
        Self {
            bytes: text.len(),
            units,
            line_starts,
            wide,
        }
    }

    fn byte_of_unit(&self, unit: u32) -> usize {
        let unit = unit as usize;
        if unit >= self.units {
            return self.bytes;
        }
        let before = self.wide.partition_point(|wide| wide.unit_start < unit);
        if before == 0 {
            return unit;
        }
        let wide = &self.wide[before - 1];
        // A surrogate pair's interior has no byte of its own. The old scan
        // rounded it to the end of the character, as it did the pair's end.
        if unit <= wide.unit_end {
            wide.byte_end
        } else {
            wide.byte_end + (unit - wide.unit_end)
        }
    }

    fn position(&self, unit: u32) -> (usize, usize) {
        let byte = self.byte_of_unit(unit);
        let line = self.line_starts.partition_point(|start| *start <= byte);
        // Columns count UTF-8 bytes, as the scanner did; CR is a byte and LF
        // begins a new line. The initial zero also covers an empty file.
        (line, byte - self.line_starts[line - 1] + 1)
    }
}

/// Where a diagnostic is, as `path:line:column`.
///
/// A refusal without a location is a scavenger hunt: the message says what is
/// not supported and the program says nothing about where. Offsets are what the
/// snapshot carries, in UTF-16 code units, matching the frontend syntax views. This wrapper builds a one-file [`SourceLocations`] view;
/// printers with many positions share one view across their whole batch.
///
/// **`sources` rather than the snapshot** so that this crate needs no dependency
/// on the schema: `at.file` indexes that list and nothing else here reads a
/// snapshot at all. Every caller passes `&snapshot.sources`.
#[must_use]
pub fn where_it_is(sources: &[SourceFile], at: &Location) -> String {
    SourceLocations::one_file(sources, at.file).where_it_is(at)
}

/// The extent of a function in the source it was lowered from, as two positions
/// in the form every diagnostic already prints.
///
/// **For a rule nobody could write without it.** A refusal's location is the
/// offending *construct's*, which is routinely outside the body being lowered --
/// `createServer` failing seven hundred lines above its own is the documented
/// case and is correct. What is not correct is a location inside no function at
/// all: `stream`'s `map` is refused as "a `finally` that spans a `yield`" and the
/// diagnostic points at the closing line of a **type alias** a hundred lines
/// away. Telling those two apart needs the function's extent, and deriving it
/// from source is a second brace matcher for a fact the compiler already holds.
///
/// Both endpoints use [`SourceLocations::where_it_is`] rather than a line
/// counter of their own: it resolves a position through a source transform's map, and a
/// rewritten file's lines are not the lines on disk. A second derivation of that
/// would be right until someone rewrote a file.
#[must_use]
pub fn where_it_spans(sources: &[SourceFile], at: &Location) -> String {
    SourceLocations::one_file(sources, at.file).where_it_spans(at)
}

/// One diagnostic as a tool prints it: `path:line:column: NTS1001 <message>`.
///
/// **Eleven sites formatted this line by hand and three of them left the
/// location out.** `report_snapshot_diagnostics`, `dump_hir`'s copy of it and
/// the differential's typecheck report printed a checker error as
/// `TS2769 <message>` -- so the family a reader most needs to click was the one
/// family with nowhere to click, while every NTS refusal beside it in the same
/// stream carried a place. The location was in the `Diagnostic` all along;
/// nothing read it.
///
/// `fc52c150d` fixed the fourth printer of the same thing (`nts frontend`) and
/// missed the rest, which is the argument for one function rather than a twelfth
/// format string: the shape a reader parses is one fact, and eleven derivations
/// of it is how three of them came to disagree about whether it has a place in
/// it at all. Eleven readers across five lanes anchor on that shape, and every
/// one of them was measured to break when it changed.
#[must_use]
pub fn diagnostic_line(sources: &[SourceFile], diagnostic: &Diagnostic) -> String {
    SourceLocations::one_file(sources, diagnostic.primary.file).diagnostic_line(diagnostic)
}

/// A source transform's name, from its identity: `react-compiler` from
/// `react-compiler@1d34f91d jsx=true ...`.
fn transform_name(identity: &str) -> &str {
    identity.split([' ', '@']).next().unwrap_or(identity)
}

/// Where `offset` in a rewritten file's text came from in the file as written,
/// and whether it is in code the transform generated: then the answer is the
/// start of what that code was written from. A position the map does not
/// cover maps to the end of the copy before it. `None` without a map.
fn original_offset(map: &[RewrittenSegment], offset: u32) -> Option<(u32, bool)> {
    let contains = |segment: &&RewrittenSegment| {
        offset >= segment.rewritten && offset < segment.rewritten + segment.len.max(1)
    };
    // A copy inside generated code (a statement a compiled function kept as
    // written) is the more precise answer, so copies are asked first.
    if let Some(copy) = map
        .iter()
        .filter(|segment| !segment.generated)
        .find(contains)
    {
        return Some((copy.original + (offset - copy.rewritten), false));
    }
    // Generated code nests (a function, its statements, their expressions):
    // the smallest range holding the position names what it was written from.
    if let Some(generated) = map
        .iter()
        .filter(|segment| segment.generated)
        .filter(contains)
        .min_by_key(|segment| segment.len)
    {
        return Some((generated.original, true));
    }
    map.iter()
        .filter(|segment| !segment.generated && segment.rewritten + segment.len <= offset)
        .max_by_key(|segment| segment.rewritten)
        .map(|copy| (copy.original + copy.len, true))
}

#[cfg(test)]
mod tests {
    use super::{original_offset, transform_name, where_it_is};
    use crate::{Digest, Location, RewrittenSegment, SourceFile, SourceId, Span};

    fn sources(rewritten_by: Option<&str>) -> Vec<SourceFile> {
        vec![SourceFile {
            uri: "nts-workspace:///src/App.tsx".to_owned(),
            digest: Digest([0; 16]),
            display_path: "src/App.tsx".into(),
            rewritten_by: rewritten_by.map(str::to_owned),
            rewritten_map: Vec::new(),
        }]
    }

    #[test]
    fn a_position_in_a_rewritten_file_is_not_read_off_the_disk() {
        let at = Location {
            file: SourceId(0),
            span: Span::new(40, 41),
        };
        let rendered = where_it_is(&sources(Some("react-compiler@1d34f91d")), &at);
        assert_eq!(
            rendered,
            "src/App.tsx (as react-compiler@1d34f91d rewrote it; the position is in that text, not the file on disk)"
        );
        // The control: a file read as written is rendered as before, here
        // with no file to count lines in.
        assert_eq!(where_it_is(&sources(None), &at), "src/App.tsx");
    }

    #[test]
    fn a_position_in_a_rewritten_file_is_traced_to_the_file_as_written() {
        let copy = |rewritten, original, len| RewrittenSegment {
            rewritten,
            original,
            len,
            generated: false,
        };
        // 0..20 copied from 5, then a function the transform printed from
        // the one at 30 in 20..60, holding a statement copied from 50 at
        // 40..48; 60..70 copied from 90.
        let map = [
            copy(0, 5, 20),
            RewrittenSegment {
                rewritten: 20,
                original: 30,
                len: 40,
                generated: true,
            },
            // An expression in that function, printed from the one at 44.
            RewrittenSegment {
                rewritten: 30,
                original: 44,
                len: 6,
                generated: true,
            },
            copy(40, 50, 8),
            copy(60, 90, 10),
        ];
        assert_eq!(
            original_offset(&map, 3),
            Some((8, false)),
            "a copy maps byte for byte"
        );
        assert_eq!(
            original_offset(&map, 25),
            Some((30, true)),
            "generated code maps to what it came from"
        );
        assert_eq!(
            original_offset(&map, 32),
            Some((44, true)),
            "the smallest generated range holding it wins"
        );
        assert_eq!(
            original_offset(&map, 42),
            Some((52, false)),
            "a copy inside generated code is the more precise answer"
        );
        assert_eq!(original_offset(&map, 65), Some((95, false)));
        assert_eq!(
            original_offset(&map, 75),
            Some((100, true)),
            "past every segment: the end of the copy before"
        );
        // The control: no map, no answer, so the old sentence is printed.
        assert_eq!(original_offset(&[], 3), None);
        assert_eq!(
            transform_name("react-compiler@1d34f91d jsx=true cache=typed"),
            "react-compiler"
        );
    }

    /// A unit offset is not a byte offset, and the em dash is the cheapest
    /// witness: a location shifted by the extra bytes above it lands on *some*
    /// character, usually a token, so nothing downstream announces it.
    #[test]
    fn a_unit_offset_past_a_non_ascii_character_is_converted() {
        let byte_of_unit = |text: &str, unit| super::FileLocations::new(text).byte_of_unit(unit);
        assert_eq!(byte_of_unit("ascii only", 5), 5);
        // An em dash is one unit and three bytes.
        assert_eq!(byte_of_unit("a\u{2014}b", 0), 0);
        assert_eq!(byte_of_unit("a\u{2014}b", 1), 1);
        assert_eq!(
            byte_of_unit("a\u{2014}b", 2),
            4,
            "the unit after the dash is at byte 4"
        );
        // An astral character is two units and four bytes, and neither half of
        // a surrogate pair has a byte of its own: both answer the byte after
        // the whole character, so no offset this returns is ever inside one.
        assert_eq!(byte_of_unit("a\u{1f600}b", 2), 5);
        assert_eq!(byte_of_unit("a\u{1f600}b", 3), 5);
        // Past the end answers the end rather than panicking.
        assert_eq!(byte_of_unit("abc", 99), 3);
    }
}
