//! Source coordinates. Native parser offsets are bytes; snapshot spans are
//! UTF-16 code units. A file builds its index once, then lookup is constant time.

/// A native parser position in UTF-8 source bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BytePos(pub u32);

/// A position in UTF-16 code units, as semantic source spans require.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Utf16Pos(pub u32);

/// A half-open source span in UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Utf16Span {
    pub start: Utf16Pos,
    pub end: Utf16Pos,
}

#[derive(Debug)]
pub(crate) struct Utf16Index {
    positions: Box<[u32]>,
}

impl Utf16Index {
    pub(crate) fn new(text: &str) -> Self {
        let mut positions = Vec::with_capacity(text.len() + 1);
        let mut offset = 0;
        for ch in text.chars() {
            positions.extend(std::iter::repeat_n(offset, ch.len_utf8()));
            offset +=
                u32::try_from(ch.len_utf16()).expect("one character is at most two code units");
        }
        positions.push(offset);
        Self {
            positions: positions.into_boxed_slice(),
        }
    }

    pub(crate) fn position(&self, byte: BytePos) -> Utf16Pos {
        Utf16Pos(self.positions[byte.0 as usize])
    }

    pub(crate) fn span(&self, start: BytePos, end: BytePos) -> Utf16Span {
        Utf16Span {
            start: self.position(start),
            end: self.position(end),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_ascii_and_astral_offsets_are_utf16_code_units() {
        let text = "aé😀\r\nβ";
        let index = Utf16Index::new(text);
        for byte in (0..=text.len()).filter(|&byte| text.is_char_boundary(byte)) {
            assert_eq!(
                index.position(BytePos(u32::try_from(byte).expect("test offset fits u32"))),
                Utf16Pos(
                    u32::try_from(text[..byte].encode_utf16().count())
                        .expect("test offset fits u32")
                )
            );
        }
        assert_eq!(
            index.span(BytePos(3), BytePos(7)),
            Utf16Span {
                start: Utf16Pos(2),
                end: Utf16Pos(4)
            }
        );
    }

    #[test]
    fn end_and_empty_source_positions_exist() {
        assert_eq!(Utf16Index::new("").position(BytePos(0)), Utf16Pos(0));
        assert_eq!(Utf16Index::new("abc").position(BytePos(3)), Utf16Pos(3));
    }
}
