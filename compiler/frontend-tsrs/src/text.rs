//! Source coordinates. Native parser offsets are bytes; snapshot spans are
//! UTF-16 code units. ASCII needs no table. Other files use fixed 64-byte blocks
//! with scalar-end masks: constant-time lookup without retaining source text.

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
    Blocks(Box<[Block]>),
}

/// Each bit names a byte boundary at which a scalar ends. Astral scalars add
/// two UTF-16 units there. Interior UTF-8 bytes therefore add no units.
#[derive(Debug, Clone, Copy)]
struct Block {
    offset: u32,
    ends: u64,
    astral_ends: u64,
}

impl Block {
    fn position(self, within: u32) -> Utf16Pos {
        let mask = u64::MAX >> (63 - within);
        Utf16Pos(
            self.offset + (self.ends & mask).count_ones() + (self.astral_ends & mask).count_ones(),
        )
    }
}

impl Utf16Index {
    pub(crate) fn new(text: &str) -> Self {
        let positions = if text.is_ascii() {
            Positions::Ascii
        } else {
            let mut blocks = vec![
                Block {
                    offset: 0,
                    ends: u64::MAX,
                    astral_ends: 0
                };
                (text.len() >> 6) + 1
            ];
            // ASCII has one scalar end at every boundary except byte zero.
            blocks[0].ends &= !1;
            for (start, ch) in text.char_indices().filter(|(_, ch)| !ch.is_ascii()) {
                let end = start + ch.len_utf8();
                for interior in start + 1..end {
                    blocks[interior >> 6].ends &= !(1 << (interior & 63));
                }
                if ch.len_utf16() == 2 {
                    blocks[end >> 6].astral_ends |= 1 << (end & 63);
                }
            }
            let mut offset = 0;
            for block in &mut blocks {
                block.offset = offset;
                offset += block.ends.count_ones() + block.astral_ends.count_ones();
            }
            Positions::Blocks(blocks.into_boxed_slice())
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
        match &self.positions {
            Positions::Ascii => Utf16Pos(byte.0),
            Positions::Blocks(blocks) => blocks[(byte.0 >> 6) as usize].position(byte.0 & 63),
        }
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
            Positions::Blocks(_)
        ));
        assert!(matches!(
            Utf16Index::new("ééé").positions,
            Positions::Blocks(_)
        ));
    }

    #[test]
    fn block_eof_at_the_maximum_source_offset_fits() {
        let block = Block {
            offset: u32::MAX - 65,
            ends: u64::MAX,
            astral_ends: 0,
        };
        assert_eq!(block.position(63), Utf16Pos(u32::MAX - 1));
    }

    #[test]
    fn scalars_crossing_each_block_boundary_match_the_dense_reference() {
        for prefix in 0..=128 {
            for scalar in ["é", "中", "😀"] {
                let text = format!("{}{scalar}{}", "a".repeat(prefix), "z".repeat(70));
                assert_dense_equivalence(&text);
            }
        }
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
