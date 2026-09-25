//! A source file as tsgo and Babel both count it: in UTF-16 code units.
//!
//! tsgo's node `pos` includes the leading trivia (whitespace and comments)
//! before the token; Babel's `start` does not. Both count UTF-16 code units, as
//! a JavaScript string index does, so once the trivia is skipped the two agree.

use react_compiler_ast::common::{Position, SourceLocation};

#[derive(Debug)]
pub struct SourceText {
    units: Vec<u16>,
    /// The offset of the first unit of each line; line `n` (1-based) starts at
    /// `line_starts[n - 1]`.
    line_starts: Vec<u32>,
}

impl SourceText {
    #[must_use]
    pub fn new(text: &str) -> Self {
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut line_starts = vec![0];
        let mut at = 0;
        while at < units.len() {
            match units[at] {
                // `\r\n` is one line break.
                0x0D if units.get(at + 1) == Some(&0x0A) => {
                    at += 2;
                    line_starts.push(offset(at));
                    continue;
                }
                0x0A | 0x0D | 0x2028 | 0x2029 => line_starts.push(offset(at + 1)),
                _ => {}
            }
            at += 1;
        }
        Self { units, line_starts }
    }

    /// The length in UTF-16 code units.
    #[must_use]
    pub fn len(&self) -> u32 {
        offset(self.units.len())
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.units.is_empty()
    }

    /// The text between two offsets.
    #[must_use]
    pub fn slice(&self, start: u32, end: u32) -> String {
        let end = (end as usize).min(self.units.len());
        let start = (start as usize).min(end);
        String::from_utf16_lossy(&self.units[start..end])
    }

    /// The first offset at or after `pos` that is not trivia: what TypeScript's
    /// `skipTrivia` answers, and so where Babel says the node starts.
    #[must_use]
    pub fn token_start(&self, pos: u32) -> u32 {
        let mut at = pos as usize;
        // A shebang line is trivia only at the very start of the file.
        if at == 0 && self.units.starts_with(&[u16::from(b'#'), u16::from(b'!')]) {
            while at < self.units.len() && !is_line_break(self.units[at]) {
                at += 1;
            }
        }
        while at < self.units.len() {
            let unit = self.units[at];
            if is_whitespace(unit) || is_line_break(unit) {
                at += 1;
            } else if unit == u16::from(b'/') && self.units.get(at + 1) == Some(&u16::from(b'/')) {
                while at < self.units.len() && !is_line_break(self.units[at]) {
                    at += 1;
                }
            } else if unit == u16::from(b'/') && self.units.get(at + 1) == Some(&u16::from(b'*')) {
                at += 2;
                while at < self.units.len()
                    && !(self.units[at] == u16::from(b'*') && self.units.get(at + 1) == Some(&u16::from(b'/')))
                {
                    at += 1;
                }
                at = (at + 2).min(self.units.len());
            } else {
                break;
            }
        }
        offset(at)
    }

    /// Babel's position of an offset: a 1-based line, a 0-based column in
    /// UTF-16 units, and the offset itself as `index`.
    #[must_use]
    pub fn position(&self, at: u32) -> Position {
        let line = self.line_starts.partition_point(|start| *start <= at);
        let line_start = self.line_starts[line.saturating_sub(1)];
        Position {
            line: offset(line),
            column: at - line_start,
            index: Some(at),
        }
    }

    /// The offset of a 1-based line and a 0-based UTF-16 column.
    #[must_use]
    pub fn offset(&self, line: u32, column: u32) -> Option<u32> {
        let start = *self.line_starts.get(usize::try_from(line).ok()?.checked_sub(1)?)?;
        Some(start + column)
    }

    #[must_use]
    pub fn location(&self, start: u32, end: u32) -> SourceLocation {
        SourceLocation {
            start: self.position(start),
            end: self.position(end),
            filename: None,
            identifier_name: None,
        }
    }
}

/// An index into a file's units as a `u32` offset. Files are far smaller than
/// 4 GiB of UTF-16; a larger one saturates rather than wrapping.
fn offset(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

fn is_line_break(unit: u16) -> bool {
    matches!(unit, 0x0A | 0x0D | 0x2028 | 0x2029)
}

/// TypeScript's `isWhiteSpaceSingleLine`.
fn is_whitespace(unit: u16) -> bool {
    matches!(
        unit,
        0x09 | 0x0B | 0x0C | 0x20 | 0x85 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x200B | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

#[cfg(test)]
mod tests {
    use super::SourceText;

    #[test]
    fn trivia_is_skipped() {
        let text = SourceText::new("  // one\n  /* two */ x");
        assert_eq!(text.token_start(0), 21);
        assert_eq!(text.slice(21, 22), "x");
    }

    #[test]
    fn positions_count_utf16_units() {
        // `é` is one unit, `😀` two: the column after them is 4, not 6 bytes.
        let text = SourceText::new("é😀x\r\ny");
        assert_eq!(text.position(3).column, 3);
        let y = text.position(6);
        assert_eq!((y.line, y.column, y.index), (2, 0, Some(6)));
    }
}
