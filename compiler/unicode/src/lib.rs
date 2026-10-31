//! The compiler's Unicode model: one version, parsed from the vendored UCD
//! (see `data/README.md`), read by every emitter.
//!
//! The tables are generated at build time from the release named by
//! [`UNICODE_VERSION`], which is the version the pinned node reports
//! (decision D2 in `docs/foundations/unicode.md`). Nothing here does I/O at
//! run time: `build.rs` parsed the files once, when `nts` itself was built.
//!
//! Stage 1 covers case mapping: per-direction tables shaped for emission
//! ([`CaseTables`]), a direct lookup ([`map_case`]), the `Cased` and
//! `Case_Ignorable` membership `Final_Sigma` needs, and a reference
//! whole-string conversion over UTF-16 units ([`convert_case`]) that the
//! run-time algorithms mirror.

/// The UCD release the tables were generated from. Must equal the version
/// the pinned node reports; `tooling/gate/unicode-version.test.ts` fails
/// otherwise.
pub const UNICODE_VERSION: (u32, u32, u32) = (17, 0, 0);

/// The license the vendored data ships under (Unicode License V3), for the
/// notices an emitted program carries. Vendored beside the data so the text
/// cannot drift from the files it licenses.
pub const LICENSE: &str = include_str!("../data/LICENSE");

#[allow(unreachable_pub)]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/case_tables.rs"));
}

/// A direction of case conversion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    Lower,
    Upper,
}

/// One direction's tables, in the shape emitters print.
///
/// The BMP is a two-level table: `index[cp >> 8]` selects a deduplicated
/// 256-entry block of `target XOR source` values, so a lookup is two loads.
/// `0` means unchanged; [`EXCEPTION_SENTINEL`] means the code point's full
/// mapping is in `exceptions`; anything else XORs the code point into its
/// mapping. Above the BMP, `ranges` holds the constant-delta runs
/// (start, end inclusive, delta).
#[derive(Clone, Copy, Debug)]
pub struct CaseTables {
    pub index: &'static [u8; 256],
    pub blocks: &'static [[u16; 256]],
    pub ranges: &'static [(u32, u32, i32)],
    pub exceptions: &'static [(u32, &'static [u32])],
}

/// The block value meaning "this code point's mapping is an exception".
/// One value for both directions, chosen by the generator from the XOR
/// values no ordinary mapping uses, and nonzero (`0` is "unchanged").
pub const EXCEPTION_SENTINEL: u16 = generated::EXCEPTION_SENTINEL;

/// The tables for one direction.
#[must_use]
pub const fn case_tables(direction: Direction) -> CaseTables {
    match direction {
        Direction::Lower => CaseTables {
            index: &generated::LOWER_INDEX,
            blocks: &generated::LOWER_BLOCKS,
            ranges: &generated::LOWER_RANGES,
            exceptions: &generated::LOWER_EXCEPTIONS,
        },
        Direction::Upper => CaseTables {
            index: &generated::UPPER_INDEX,
            blocks: &generated::UPPER_BLOCKS,
            ranges: &generated::UPPER_RANGES,
            exceptions: &generated::UPPER_EXCEPTIONS,
        },
    }
}

/// `Cased` membership as sorted inclusive ranges, for emitters.
pub const CASED_RANGES: &[(u32, u32)] = &generated::CASED_RANGES;
/// `Case_Ignorable` membership as sorted inclusive ranges, for emitters.
pub const CASE_IGNORABLE_RANGES: &[(u32, u32)] = &generated::CASE_IGNORABLE_RANGES;

fn in_ranges(ranges: &[(u32, u32)], cp: u32) -> bool {
    ranges
        .binary_search_by(|&(lo, hi)| {
            if cp < lo {
                std::cmp::Ordering::Greater
            } else if cp > hi {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

/// Whether a code point has the `Cased` property.
#[must_use]
pub fn is_cased(cp: u32) -> bool {
    in_ranges(CASED_RANGES, cp)
}

/// Whether a code point has the `Case_Ignorable` property.
#[must_use]
pub fn is_case_ignorable(cp: u32) -> bool {
    in_ranges(CASE_IGNORABLE_RANGES, cp)
}

/// What one code point maps to, context-free.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaseMapping {
    Unchanged,
    Single(u32),
    Exception(&'static [u32]),
}

/// The context-free mapping of one code point. `Final_Sigma` is context and
/// so is not applied here (U+03A3 maps to U+03C3); [`convert_case`] applies
/// it. Surrogates and out-of-range inputs are unchanged.
#[must_use]
pub fn map_case(direction: Direction, cp: u32) -> CaseMapping {
    let tables = case_tables(direction);
    if cp <= 0xFFFF {
        let page = usize::try_from(cp >> 8).expect("page fits");
        let low = usize::try_from(cp & 0xFF).expect("low byte fits");
        let x = tables.blocks[usize::from(tables.index[page])][low];
        if x == 0 {
            CaseMapping::Unchanged
        } else if x == EXCEPTION_SENTINEL {
            let found = tables
                .exceptions
                .binary_search_by_key(&cp, |&(c, _)| c)
                .expect("sentinel without an exception record");
            CaseMapping::Exception(tables.exceptions[found].1)
        } else {
            CaseMapping::Single(cp ^ u32::from(x))
        }
    } else if cp <= 0x10_FFFF {
        for &(lo, hi, delta) in tables.ranges {
            if cp < lo {
                break;
            }
            if cp <= hi {
                return CaseMapping::Single(cp.wrapping_add(delta.cast_unsigned()));
            }
        }
        CaseMapping::Unchanged
    } else {
        CaseMapping::Unchanged
    }
}

/// One decoded character of a UTF-16 input: a code point (a surrogate pair
/// combined), or a lone surrogate kept as its unit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Decoded {
    CodePoint(u32),
    LoneSurrogate(u16),
}

fn decode(units: &[u16]) -> Vec<Decoded> {
    let mut out = Vec::with_capacity(units.len());
    let mut i = 0;
    while i < units.len() {
        let u = units[i];
        if (0xD800..0xDC00).contains(&u) {
            if let Some(&v) = units.get(i + 1)
                && (0xDC00..0xE000).contains(&v)
            {
                out.push(Decoded::CodePoint(
                    0x1_0000 + (u32::from(u - 0xD800) << 10) + u32::from(v - 0xDC00),
                ));
                i += 2;
                continue;
            }
            out.push(Decoded::LoneSurrogate(u));
        } else if (0xDC00..0xE000).contains(&u) {
            out.push(Decoded::LoneSurrogate(u));
        } else {
            out.push(Decoded::CodePoint(u32::from(u)));
        }
        i += 1;
    }
    out
}

fn encode(out: &mut Vec<u16>, cp: u32) {
    if cp <= 0xFFFF {
        out.push(u16::try_from(cp).expect("BMP fits"));
    } else {
        let v = cp - 0x1_0000;
        out.push(u16::try_from(0xD800 + (v >> 10)).expect("high surrogate"));
        out.push(u16::try_from(0xDC00 + (v & 0x3FF)).expect("low surrogate"));
    }
}

/// `Final_Sigma`, over the *original* input: a capital sigma lowercases to
/// U+03C2 when a cased character precedes it (skipping case-ignorable ones)
/// and no cased character follows it (likewise). Lone surrogates are
/// neither, and so break the context like any uncased character.
fn is_final_sigma(chars: &[Decoded], at: usize) -> bool {
    let mut before = false;
    for ch in chars[..at].iter().rev() {
        match ch {
            Decoded::CodePoint(cp) if is_case_ignorable(*cp) => {}
            Decoded::CodePoint(cp) => {
                before = is_cased(*cp);
                break;
            }
            Decoded::LoneSurrogate(_) => break,
        }
    }
    if !before {
        return false;
    }
    for ch in &chars[at + 1..] {
        match ch {
            Decoded::CodePoint(cp) if is_case_ignorable(*cp) => {}
            Decoded::CodePoint(cp) => return !is_cased(*cp),
            Decoded::LoneSurrogate(_) => return true,
        }
    }
    true
}

/// The reference whole-string conversion over UTF-16 units: JavaScript's
/// locale-insensitive `toLowerCase`/`toUpperCase`. Lone surrogates pass
/// through; no normalization is implied. The run-time implementations
/// mirror this exactly.
#[must_use]
pub fn convert_case(direction: Direction, units: &[u16]) -> Vec<u16> {
    let chars = decode(units);
    let mut out: Vec<u16> = Vec::with_capacity(units.len());
    for (i, ch) in chars.iter().enumerate() {
        match *ch {
            Decoded::LoneSurrogate(u) => out.push(u),
            Decoded::CodePoint(cp) => {
                if direction == Direction::Lower && cp == 0x03A3 && is_final_sigma(&chars, i) {
                    encode(&mut out, 0x03C2);
                    continue;
                }
                match map_case(direction, cp) {
                    CaseMapping::Unchanged => encode(&mut out, cp),
                    CaseMapping::Single(to) => encode(&mut out, to),
                    CaseMapping::Exception(mapped) => {
                        for &m in mapped {
                            encode(&mut out, m);
                        }
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{CaseMapping, Direction, EXCEPTION_SENTINEL, case_tables, convert_case, map_case};

    fn convert(direction: Direction, s: &str) -> String {
        let units: Vec<u16> = s.encode_utf16().collect();
        String::from_utf16(&convert_case(direction, &units)).expect("valid UTF-16")
    }

    #[test]
    fn sentinel_is_reserved() {
        assert_ne!(EXCEPTION_SENTINEL, 0);
        for direction in [Direction::Lower, Direction::Upper] {
            let tables = case_tables(direction);
            for cp in 0..=0xFFFFu32 {
                if let CaseMapping::Single(to) = map_case(direction, cp) {
                    assert_ne!(
                        to ^ cp,
                        u32::from(EXCEPTION_SENTINEL),
                        "U+{cp:X} uses the sentinel"
                    );
                    // Reverse direction tables were checked by the
                    // generator; here the round trip through the shipped
                    // shape must at least be self-consistent.
                    assert_ne!(to, cp);
                }
            }
            assert_ne!(tables.exceptions.len(), 0);
        }
    }

    #[test]
    fn latin1_and_exceptions() {
        use Direction::{Lower, Upper};
        assert_eq!(convert(Upper, "straße"), "STRASSE");
        assert_eq!(convert(Upper, "ﬀ"), "FF");
        assert_eq!(convert(Lower, "İ"), "i\u{307}");
        assert_eq!(convert(Upper, "µ"), "Μ");
        assert_eq!(convert(Upper, "ÿ"), "Ÿ");
        assert_eq!(convert(Lower, "ABC"), "abc");
        assert_eq!(convert(Lower, "Κ"), "κ"); // Kelvin sign
    }

    #[test]
    fn final_sigma_context() {
        use Direction::Lower;
        assert_eq!(convert(Lower, "ΑΣ"), "ας");
        assert_eq!(convert(Lower, "A\u{1FBE}\u{03A3}"), "a\u{1FBE}\u{03C2}");
        assert_eq!(convert(Lower, "ΣΣ"), "σς");
        assert_eq!(convert(Lower, "ΑΣΑ"), "ασα");
        assert_eq!(convert(Lower, "Σ"), "σ");
        assert_eq!(convert(Lower, "ΑΣ'"), "ας'"); // apostrophe is Case_Ignorable
    }

    #[test]
    fn astral_and_lone_surrogates() {
        use Direction::{Lower, Upper};
        assert_eq!(convert(Lower, "𐐀"), "𐐨"); // Deseret capital -> small
        assert_eq!(convert(Upper, "𐐨"), "𐐀");
        let lone: Vec<u16> = vec![0xD800, 0x03A3];
        assert_eq!(convert_case(Lower, &lone), vec![0xD800, 0x03C3]);
        let lone_after: Vec<u16> = vec![0x0391, 0x03A3, 0xD800];
        assert_eq!(
            convert_case(Lower, &lone_after),
            vec![0x03B1, 0x03C2, 0xD800]
        );
    }

    #[test]
    fn the_license_travels_with_the_data() {
        assert!(super::LICENSE.starts_with("UNICODE LICENSE V3\n"));
        assert!(super::LICENSE.contains("Unicode, Inc."));
    }

    #[test]
    fn version_signature_letters() {
        use Direction::Lower;
        // U+A7CB (Unicode 16) and U+A7CE (Unicode 17), the version-pin
        // test's signatures.
        assert_eq!(map_case(Lower, 0xA7CB), CaseMapping::Single(0x0264));
        assert_eq!(map_case(Lower, 0xA7CE), CaseMapping::Single(0xA7CF));
    }
}
