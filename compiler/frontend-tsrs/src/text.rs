//! Source coordinates. Native parser offsets are bytes; snapshot spans are
//! UTF-16 code units. ASCII needs no table. Mixed text stores only non-ASCII
//! scalar checkpoints; dense Unicode uses a per-byte table when that is smaller.

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
    bytes: usize,
    positions: Positions,
}

#[derive(Debug)]
enum Positions {
    Ascii,
    Sparse(Box<[NonAscii]>),
    Dense(Box<[u32]>),
}

#[derive(Debug)]
struct NonAscii {
    byte_start: u32,
    utf16_start: u32,
    byte_len: u8,
    utf16_len: u8,
}

impl Utf16Index {
    pub(crate) fn new(text: &str) -> Self {
        let positions = if text.is_ascii() {
            Positions::Ascii
        } else {
            let non_ascii = text.chars().filter(|ch| !ch.is_ascii()).count();
            if non_ascii * std::mem::size_of::<NonAscii>()
                < (text.len() + 1) * std::mem::size_of::<u32>()
            {
                let mut positions = Vec::with_capacity(non_ascii);
                let mut utf16 = 0;
                for (byte, ch) in text.char_indices() {
                    if !ch.is_ascii() {
                        positions.push(NonAscii {
                            byte_start: u32::try_from(byte).expect("source offsets fit u32"),
                            utf16_start: utf16,
                            byte_len: u8::try_from(ch.len_utf8()).expect("at most four bytes"),
                            utf16_len: u8::try_from(ch.len_utf16())
                                .expect("at most two code units"),
                        });
                    }
                    utf16 += u32::try_from(ch.len_utf16()).expect("at most two code units");
                }
                Positions::Sparse(positions.into_boxed_slice())
            } else {
                let mut positions = Vec::with_capacity(text.len() + 1);
                let mut offset = 0;
                for ch in text.chars() {
                    positions.extend(std::iter::repeat_n(offset, ch.len_utf8()));
                    offset += u32::try_from(ch.len_utf16()).expect("at most two code units");
                }
                positions.push(offset);
                Positions::Dense(positions.into_boxed_slice())
            }
        };
        Self {
            bytes: text.len(),
            positions,
        }
    }

    pub(crate) fn position(&self, byte: BytePos) -> Utf16Pos {
        assert!(
            (byte.0 as usize) <= self.bytes,
            "source byte position out of bounds"
        );
        Utf16Pos(match &self.positions {
            Positions::Ascii => byte.0,
            Positions::Dense(positions) => positions[byte.0 as usize],
            Positions::Sparse(positions) => {
                let end = positions.partition_point(|entry| entry.byte_start <= byte.0);
                if end == 0 {
                    return Utf16Pos(byte.0);
                }
                let entry = &positions[end - 1];
                let byte_end = entry.byte_start + u32::from(entry.byte_len);
                // Interior UTF-8 bytes map to the scalar's first code unit,
                // exactly as the dense table does; EOF maps after the scalar.
                entry.utf16_start
                    + if byte.0 < byte_end {
                        0
                    } else {
                        u32::from(entry.utf16_len) + (byte.0 - byte_end)
                    }
            }
        })
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

    fn assert_dense_equivalence(text: &str) {
        let mut dense = Vec::new();
        let mut utf16 = 0;
        for ch in text.chars() {
            dense.extend(std::iter::repeat_n(utf16, ch.len_utf8()));
            utf16 += u32::try_from(ch.len_utf16()).expect("at most two code units");
        }
        dense.push(utf16);
        let index = Utf16Index::new(text);
        for (byte, expected) in dense.into_iter().enumerate() {
            assert_eq!(
                index.position(BytePos(u32::try_from(byte).expect("fixture fits u32"))),
                Utf16Pos(expected),
                "byte {byte}"
            );
        }
    }

    #[test]
    fn real_files_match_the_dense_reference_at_every_byte() {
        for text in [
            include_str!("../Cargo.toml"),
            include_str!("../tests/fixtures/coordinates/segment-sentence-iterable.txt"),
            include_str!("../tests/fixtures/coordinates/start-unicode-10.0.0-class.txt"),
        ] {
            assert_dense_equivalence(text);
        }
    }

    #[test]
    fn every_representation_preserves_interior_bytes_and_surrogate_pairs() {
        for text in ["", "abc\r\n", "😀ascii😀", "ééé", "中文中文", "😀😀😀"] {
            assert_dense_equivalence(text);
        }
        assert!(matches!(
            Utf16Index::new("ascii").positions,
            Positions::Ascii
        ));
        assert!(matches!(
            Utf16Index::new("😀ascii😀").positions,
            Positions::Sparse(_)
        ));
        assert!(matches!(
            Utf16Index::new("ééé").positions,
            Positions::Dense(_)
        ));
    }

    #[test]
    fn sparse_eof_does_not_overflow_an_intermediate_sum() {
        let index = Utf16Index {
            bytes: u32::MAX as usize,
            positions: Positions::Sparse(
                vec![NonAscii {
                    byte_start: 0,
                    utf16_start: 0,
                    byte_len: 2,
                    utf16_len: 1,
                }]
                .into_boxed_slice(),
            ),
        };
        assert_eq!(index.position(BytePos(u32::MAX)), Utf16Pos(u32::MAX - 1));
    }

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
