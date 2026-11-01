//! `nts_unicode_tables.h`: the case tables as C data, printed from the
//! compiler's Unicode model ([`nts_unicode`]) so an emitted program carries
//! exactly that model -- one version, the one the pinned node reports.
//!
//! The header is data only. `nts_unicode.c` (the one file that includes it)
//! holds the algorithm, and reads a direction through the `__nts_case_tables`
//! descriptor each direction ends in.

use std::fmt::Write as _;
use std::sync::LazyLock;

use rustc_hash::FxHashMap;

use nts_unicode::Direction;

use super::UnicodeNeeds;

#[cfg(all(test, unix))]
#[path = "unicode_tables/runtime_tests.rs"]
mod runtime_tests;

// The low sixteen bits are an XOR delta, or a direct exception-record index.
// Count ignores WRITE_STOP for Sigma, whose count facts are model-licensed.
const WRITE_STOP: u32 = 1 << 31;
const COUNT_STOP: u32 = 1 << 30;
const WIDE: u32 = 1 << 29;
const IDENTITY: u32 = 1 << 28;
const FULL_EXCEPTION: u32 = 1 << 27;

#[derive(Debug)]
struct PackedTables {
    index: [u8; 256],
    blocks: Vec<[u32; 256]>,
}

/// The name the generated tables ship under, beside `nts_unicode.c`.
pub(super) const HEADER_NAME: &str = "nts_unicode_tables.h";

/// The generated header for one program's recorded needs: only the called
/// directions' tables, so the unused direction is compiled out of the
/// runtime with them. Fixed per needs for a compiler build (the model is),
/// so each shape is generated once per process.
pub(super) fn header(needs: UnicodeNeeds) -> &'static str {
    static LOWER: LazyLock<String> = LazyLock::new(|| {
        generate(UnicodeNeeds {
            lower: true,
            upper: false,
        })
    });
    static UPPER: LazyLock<String> = LazyLock::new(|| {
        generate(UnicodeNeeds {
            lower: false,
            upper: true,
        })
    });
    static BOTH: LazyLock<String> = LazyLock::new(|| generate(UnicodeNeeds::ALL));
    match (needs.lower, needs.upper) {
        (true, true) => &BOTH,
        (true, false) => &LOWER,
        (false, true) => &UPPER,
        (false, false) => "",
    }
}

fn generate(needs: UnicodeNeeds) -> String {
    if needs.lower {
        sigma_count_contract();
    }
    let (major, minor, patch) = nts_unicode::UNICODE_VERSION;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "/* Generated from the compiler's Unicode model of UCD {major}.{minor}.{patch};"
    );
    let _ = writeln!(
        out,
        " * do not edit. Unicode License V3: notices/unicode-data/LICENSE. */"
    );
    let _ = writeln!(out, "#ifndef __nts_UNICODE_TABLES_H");
    let _ = writeln!(out, "#define __nts_UNICODE_TABLES_H");
    let _ = writeln!(out);
    let _ = writeln!(out, "#include <stdint.h>");
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "typedef struct __nts_case_range {{ uint32_t lo; uint32_t hi; int32_t delta; }} __nts_case_range;"
    );
    let _ = writeln!(
        out,
        "typedef struct __nts_case_exception {{ uint32_t offset; uint32_t length; }} __nts_case_exception;"
    );
    let _ = writeln!(
        out,
        "typedef struct __nts_property_range {{ uint32_t lo; uint32_t hi; }} __nts_property_range;"
    );
    let _ = writeln!(
        out,
        "typedef struct __nts_case_identity {{ uint16_t lo; uint16_t hi; }} __nts_case_identity;"
    );
    let _ = writeln!(out, "typedef struct __nts_case_tables {{");
    let _ = writeln!(out, "  const uint8_t *latin1;");
    let _ = writeln!(out, "  const uint8_t *index;");
    let _ = writeln!(out, "  const uint32_t *blocks;");
    let _ = writeln!(out, "  const __nts_case_identity *identity;");
    let _ = writeln!(out, "  const __nts_case_range *ranges;");
    let _ = writeln!(out, "  uint32_t range_count;");
    let _ = writeln!(out, "  const __nts_case_exception *exceptions;");
    let _ = writeln!(out, "  const uint32_t *exception_pool;");
    let _ = writeln!(out, "}} __nts_case_tables;");
    for (name, value) in [
        ("WRITE_STOP", WRITE_STOP),
        ("COUNT_STOP", COUNT_STOP),
        ("WIDE", WIDE),
        ("IDENTITY", IDENTITY),
        ("FULL_EXCEPTION", FULL_EXCEPTION),
    ] {
        let _ = writeln!(out, "#define __nts_CASE_{name} {value:#010x}u");
    }
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "#define __nts_CASE_EXCEPTION_SENTINEL {:#06x}u",
        nts_unicode::EXCEPTION_SENTINEL
    );
    if needs.lower {
        direction(&mut out, "lower", Direction::Lower);
        // Final_Sigma's context is a lowercase concern only.
        property_ranges(
            &mut out,
            "__nts_case_cased_ranges",
            nts_unicode::CASED_RANGES,
        );
        property_ranges(
            &mut out,
            "__nts_case_ignorable_ranges",
            nts_unicode::CASE_IGNORABLE_RANGES,
        );
    }
    if needs.upper {
        direction(&mut out, "upper", Direction::Upper);
    }
    let _ = writeln!(out, "#endif");
    out
}

// Runs never cross the storage-width boundary or contain surrogate pages.
// Consequently a run starting wide stays wide, while a narrow run plus the
// unchanged ASCII accepted by the runtime can never introduce a wide output.
fn identity_ranges(index: &[u8; 256], blocks: &[[u16; 256]]) -> Vec<(u16, u16)> {
    let eligible: Vec<_> = index
        .iter()
        .enumerate()
        .map(|(page, &block)| {
            !(0xd8..=0xdf).contains(&page)
                && blocks[usize::from(block)].iter().all(|&delta| delta == 0)
        })
        .collect();
    let mut ranges = vec![(1, 0); 256];
    let mut page = 0;
    while page < 256 {
        if !eligible[page] {
            page += 1;
            continue;
        }
        let first = page;
        page += 1;
        while page < 256 && page != 1 && eligible[page] {
            page += 1;
        }
        let lo = u16::try_from(first * 256).expect("BMP identity lower bound");
        let hi = u16::try_from(page * 256 - 1).expect("BMP identity upper bound");
        ranges[first..page].fill((lo, hi));
    }
    ranges
}

fn emit_identity(out: &mut String, name: &str, ranges: &[(u16, u16)]) {
    let _ = writeln!(
        out,
        "static const __nts_case_identity __nts_case_{name}_identity[256] = {{"
    );
    for chunk in ranges.chunks(8) {
        let _ = write!(out, "  ");
        for (lo, hi) in chunk {
            let _ = write!(out, "{{{lo:#06x}u, {hi:#06x}u}}, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "}};");
}

// The count pass does not need Sigma context: both possible answers have
// the same length, width and changedness. Refuse a changed model rather than
// silently carrying this licence across a data update.
fn sigma_count_contract() {
    use nts_unicode::{CaseMapping, Direction, convert_case, map_case};
    assert_eq!(
        map_case(Direction::Lower, 0x03a3),
        CaseMapping::Single(0x03c3)
    );
    for (input, expected) in [
        ([0x41, 0x03a3, 0x20], 0x03c2),
        ([0x41, 0x03a3, 0x41], 0x03c3),
    ] {
        let mapped = convert_case(Direction::Lower, &input);
        assert_eq!(mapped.len(), input.len());
        assert_eq!(mapped[1], expected);
        assert!(mapped[1] > 255 && mapped[1] != input[1]);
    }
}

fn packed_entry(
    tables: &nts_unicode::CaseTables,
    cp: u32,
    delta: u16,
    identity: bool,
    lower: bool,
) -> u32 {
    if (0xd800..=0xdfff).contains(&cp) {
        assert_eq!(delta, 0, "a surrogate is unchanged");
        return WRITE_STOP | COUNT_STOP | WIDE;
    }
    if delta == nts_unicode::EXCEPTION_SENTINEL {
        let (index, (_, values)) = tables
            .exceptions
            .iter()
            .enumerate()
            .find(|(_, (point, _))| *point == cp)
            .expect("exception sentinel record");
        let payload = u32::from(u16::try_from(index).expect("exception index fits payload"));
        let wide = if values.iter().any(|&value| value > 255) {
            WIDE
        } else {
            0
        };
        return WRITE_STOP | COUNT_STOP | FULL_EXCEPTION | wide | payload;
    }
    let mut entry = u32::from(delta);
    if (cp ^ u32::from(delta)) > 255 {
        entry |= WIDE;
    }
    if lower && cp == 0x03a3 {
        entry |= WRITE_STOP;
    }
    if identity {
        entry |= WRITE_STOP | COUNT_STOP | IDENTITY;
    }
    entry
}

fn packed_tables(tables: &nts_unicode::CaseTables, lower: bool) -> PackedTables {
    let mut data = PackedTables {
        index: [0; 256],
        blocks: Vec::new(),
    };
    let mut indices = FxHashMap::default();
    for page in 0..256 {
        let canonical = &tables.blocks[usize::from(tables.index[page])];
        let identity = !(0xd8..=0xdf).contains(&page) && canonical.iter().all(|&v| v == 0);
        let mut block = [0u32; 256];
        for (low, entry) in block.iter_mut().enumerate() {
            let cp = u32::try_from(page * 256 + low).expect("BMP code point");
            *entry = packed_entry(tables, cp, canonical[low], identity, lower);
        }
        let index = *indices.entry(block).or_insert_with(|| {
            let index = u8::try_from(data.blocks.len()).expect("at most 256 BMP pages");
            data.blocks.push(block);
            index
        });
        data.index[page] = index;
    }
    data
}

fn emit_packed(out: &mut String, name: &str, data: &PackedTables) {
    let _ = writeln!(
        out,
        "static const uint8_t __nts_case_{name}_index[256] = {{"
    );
    for chunk in data.index.chunks(16) {
        let _ = write!(out, "  ");
        for value in chunk {
            let _ = write!(out, "{value}, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "}};");
    let _ = writeln!(
        out,
        "static const uint32_t __nts_case_{name}_blocks[{}] = {{",
        data.blocks.len() * 256
    );
    for block in &data.blocks {
        for chunk in block.chunks(8) {
            let _ = write!(out, "    ");
            for value in chunk {
                let _ = write!(out, "{value:#010x}u, ");
            }
            let _ = writeln!(out);
        }
    }
    let _ = writeln!(out, "}};");
}

fn direction(out: &mut String, name: &str, direction: Direction) {
    let tables = nts_unicode::case_tables(direction);
    let identity = identity_ranges(tables.index, tables.blocks);
    emit_identity(out, name, &identity);
    let _ = writeln!(out);
    // The runtime compiles a direction in only under its define.
    let _ = writeln!(out, "#define __nts_UNICODE_{} 1", name.to_uppercase());
    let packed = packed_tables(&tables, matches!(direction, Direction::Lower));
    emit_packed(out, name, &packed);
    let _ = writeln!(
        out,
        "static const uint8_t __nts_case_{name}_latin1[256] = {{"
    );
    for start in (0..256u32).step_by(16) {
        let _ = write!(out, "  ");
        for cp in start..start + 16 {
            let mapped = match nts_unicode::map_case(direction, cp) {
                nts_unicode::CaseMapping::Unchanged => cp,
                nts_unicode::CaseMapping::Single(mapped) if mapped <= 255 => mapped,
                _ => {
                    assert!(direction == Direction::Upper && matches!(cp, 0xb5 | 0xdf | 0xff));
                    // The runtime excludes these before selecting the one-byte path.
                    cp
                }
            };
            let _ = write!(out, "{mapped:#04x}, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "}};");
    assert!(!tables.ranges.is_empty(), "{name}: no astral ranges");
    let _ = writeln!(
        out,
        "static const __nts_case_range __nts_case_{name}_ranges[{}] = {{",
        tables.ranges.len()
    );
    for (lo, hi, delta) in tables.ranges {
        let _ = writeln!(out, "  {{{lo:#x}u, {hi:#x}u, {delta}}},");
    }
    let _ = writeln!(out, "}};");
    assert!(!tables.exceptions.is_empty(), "{name}: no exceptions");
    let mut pool: Vec<u32> = Vec::new();
    let _ = writeln!(
        out,
        "static const __nts_case_exception __nts_case_{name}_exceptions[{}] = {{",
        tables.exceptions.len()
    );
    for (_, mapped) in tables.exceptions {
        let _ = writeln!(out, "  {{{}u, {}u}},", pool.len(), mapped.len());
        pool.extend_from_slice(mapped);
    }
    let _ = writeln!(out, "}};");
    let _ = writeln!(
        out,
        "static const uint32_t __nts_case_{name}_exception_pool[{}] = {{",
        pool.len()
    );
    for chunk in pool.chunks(8) {
        let _ = write!(out, "  ");
        for v in chunk {
            let _ = write!(out, "{v:#x}u, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "}};");
    descriptor(out, name, &tables);
}

fn descriptor(out: &mut String, name: &str, tables: &nts_unicode::CaseTables) {
    let _ = writeln!(
        out,
        "static const __nts_case_tables __nts_case_{name}_tables = {{"
    );
    let _ = writeln!(out, "  .latin1 = __nts_case_{name}_latin1,");
    let _ = writeln!(out, "  .index = __nts_case_{name}_index,");
    let _ = writeln!(out, "  .blocks = __nts_case_{name}_blocks,");
    let _ = writeln!(out, "  .identity = __nts_case_{name}_identity,");
    let _ = writeln!(out, "  .ranges = __nts_case_{name}_ranges,");
    let _ = writeln!(out, "  .range_count = {}u,", tables.ranges.len());
    let _ = writeln!(out, "  .exceptions = __nts_case_{name}_exceptions,");
    let _ = writeln!(out, "  .exception_pool = __nts_case_{name}_exception_pool,");
    let _ = writeln!(out, "}};");
}

fn property_ranges(out: &mut String, name: &str, ranges: &[(u32, u32)]) {
    let define = format!(
        "__nts_{}",
        name.strip_prefix("__nts_")
            .expect("private table name")
            .to_uppercase()
    );
    let _ = writeln!(out);
    let _ = writeln!(out, "#define {define}_COUNT {}u", ranges.len());
    let _ = writeln!(
        out,
        "static const __nts_property_range {name}[{}] = {{",
        ranges.len()
    );
    for chunk in ranges.chunks(4) {
        let _ = write!(out, "  ");
        for (lo, hi) in chunk {
            let _ = write!(out, "{{{lo:#x}u, {hi:#x}u}}, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "}};");
}

#[cfg(test)]
mod tests {
    use super::super::UnicodeNeeds;

    #[test]
    fn the_header_names_its_version_and_both_directions() {
        let header = super::header(UnicodeNeeds::ALL);
        let (major, minor, patch) = nts_unicode::UNICODE_VERSION;
        assert!(header.contains(&format!("UCD {major}.{minor}.{patch}")));
        assert!(header.contains("__nts_case_lower_tables"));
        assert!(header.contains("__nts_case_upper_tables"));
        assert!(header.contains("__nts_CASE_EXCEPTION_SENTINEL"));
    }

    #[test]
    fn an_uncalled_direction_is_not_generated() {
        let lower = super::header(UnicodeNeeds {
            lower: true,
            upper: false,
        });
        assert!(lower.contains("__nts_case_lower_tables"));
        assert!(!lower.contains("__nts_case_upper"));
        assert!(lower.contains("__nts_case_cased_ranges"));
        let upper = super::header(UnicodeNeeds {
            lower: false,
            upper: true,
        });
        assert!(upper.contains("__nts_case_upper_tables"));
        assert!(!upper.contains("__nts_case_lower"));
        assert!(!upper.contains("__nts_case_cased_ranges"));
        assert_eq!(super::header(UnicodeNeeds::NONE), "");
    }
    #[test]
    fn identity_runs_match_every_real_page_and_exclude_cold_domains() {
        for direction in [nts_unicode::Direction::Lower, nts_unicode::Direction::Upper] {
            let tables = nts_unicode::case_tables(direction);
            let ranges = super::identity_ranges(tables.index, tables.blocks);
            for (page, &(lo, hi)) in ranges.iter().enumerate() {
                let zero = tables.blocks[usize::from(tables.index[page])]
                    .iter()
                    .all(|&v| v == 0);
                assert_eq!(lo <= hi, zero && !(0xd8..=0xdf).contains(&page));
                if lo > hi {
                    continue;
                }
                assert!(usize::from(lo) <= page * 256 && usize::from(hi) >= page * 256 + 255);
                assert!(hi <= 255 || lo >= 256);
                assert!(hi < 0xd800 || lo > 0xdfff);
                for cp in u32::from(lo)..=u32::from(hi) {
                    assert_eq!(
                        tables.blocks[usize::from(tables.index[(cp >> 8) as usize])]
                            [(cp & 255) as usize],
                        0
                    );
                }
            }
        }
    }

    #[test]
    fn a_partially_mapped_page_is_not_an_identity_run() {
        let mut blocks = [[0u16; 256]; 2];
        blocks[1][0] = 1;
        blocks[1][127] = 1;
        blocks[1][255] = 1;
        let mut index = [0u8; 256];
        index[0x4e] = 1;
        let ranges = super::identity_ranges(&index, &blocks);
        assert!(ranges[0x4e].0 > ranges[0x4e].1);
        assert_eq!(ranges[0], (0, 255));
        assert_eq!(ranges[0x4d].1, 0x4dff);
        assert_eq!(ranges[0x4f].0, 0x4f00);
        assert!(ranges[0xd8].0 > ranges[0xd8].1);
    }
    #[test]
    fn every_packed_entry_decodes_to_the_model_and_exact_stop_domains() {
        super::sigma_count_contract();
        for direction in [nts_unicode::Direction::Lower, nts_unicode::Direction::Upper] {
            let tables = nts_unicode::case_tables(direction);
            let lower = matches!(direction, nts_unicode::Direction::Lower);
            let packed = super::packed_tables(&tables, lower);
            for cp in 0..=u16::MAX {
                let page = usize::from(cp >> 8);
                let canonical = &tables.blocks[usize::from(tables.index[page])];
                let delta = canonical[usize::from(cp & 255)];
                let entry = packed.blocks[usize::from(packed.index[page])][usize::from(cp & 255)];
                let surrogate = (0xd800..=0xdfff).contains(&cp);
                let identity = !surrogate && canonical.iter().all(|&v| v == 0);
                let full = delta == nts_unicode::EXCEPTION_SENTINEL;
                assert_eq!(entry & super::IDENTITY != 0, identity);
                assert_eq!(entry & super::FULL_EXCEPTION != 0, full);
                assert_eq!(
                    entry & super::COUNT_STOP != 0,
                    surrogate || identity || full
                );
                assert_eq!(
                    entry & super::WRITE_STOP != 0,
                    surrogate || identity || full || (lower && cp == 0x03a3)
                );
                let payload = u16::try_from(entry & 0xffff).expect("masked payload");
                let wide = if full {
                    let (point, values) = tables.exceptions[usize::from(payload)];
                    assert_eq!(point, u32::from(cp));
                    assert!(!values.is_empty() && values.len() <= 3);
                    values.iter().any(|&value| value > 255)
                } else {
                    assert_eq!(payload, delta);
                    (cp ^ payload) > 255
                };
                assert_eq!(entry & super::WIDE != 0, wide);
            }
        }
    }
}
