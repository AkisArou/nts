//! `nts_unicode_tables.h`: the case tables as C data, printed from the
//! compiler's Unicode model ([`nts_unicode`]) so an emitted program carries
//! exactly that model -- one version, the one the pinned node reports.
//!
//! The header is data only. `nts_unicode.c` (the one file that includes it)
//! holds the algorithm, and reads a direction through the `__nts_case_tables`
//! descriptor each direction ends in.

use std::fmt::Write as _;
use std::sync::LazyLock;

use nts_unicode::Direction;

use super::UnicodeNeeds;

#[cfg(all(test, unix))]
#[path = "unicode_tables/runtime_tests.rs"]
mod runtime_tests;

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
        "typedef struct __nts_case_exception {{ uint32_t code_point; uint32_t offset; uint32_t length; }} __nts_case_exception;"
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
    let _ = writeln!(out, "  const uint16_t *blocks;");
    let _ = writeln!(out, "  const __nts_case_identity *identity;");
    let _ = writeln!(out, "  uint16_t zero_block;");
    let _ = writeln!(out, "  const __nts_case_range *ranges;");
    let _ = writeln!(out, "  uint32_t range_count;");
    let _ = writeln!(out, "  const __nts_case_exception *exceptions;");
    let _ = writeln!(out, "  uint32_t exception_count;");
    let _ = writeln!(out, "  const uint32_t *exception_pool;");
    let _ = writeln!(out, "}} __nts_case_tables;");
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

fn direction(out: &mut String, name: &str, direction: Direction) {
    let tables = nts_unicode::case_tables(direction);
    let identity = identity_ranges(tables.index, tables.blocks);
    emit_identity(out, name, &identity);
    let _ = writeln!(out);
    // The runtime compiles a direction in only under its define.
    let _ = writeln!(out, "#define __nts_UNICODE_{} 1", name.to_uppercase());
    let _ = writeln!(
        out,
        "static const uint8_t __nts_case_{name}_index[256] = {{"
    );
    for chunk in tables.index.chunks(16) {
        let _ = write!(out, "  ");
        for v in chunk {
            let _ = write!(out, "{v}, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "}};");
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
    let _ = writeln!(
        out,
        "static const uint16_t __nts_case_{name}_blocks[{}] = {{",
        tables.blocks.len() * 256
    );
    for block in tables.blocks {
        for chunk in block.chunks(8) {
            let _ = write!(out, "    ");
            for v in chunk {
                let _ = write!(out, "{v:#06x}, ");
            }
            let _ = writeln!(out);
        }
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
    for (cp, mapped) in tables.exceptions {
        let _ = writeln!(out, "  {{{cp:#x}u, {}u, {}u}},", pool.len(), mapped.len());
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
    let _ = writeln!(
        out,
        "static const __nts_case_tables __nts_case_{name}_tables = {{"
    );
    let _ = writeln!(out, "  .latin1 = __nts_case_{name}_latin1,");
    let _ = writeln!(out, "  .index = __nts_case_{name}_index,");
    let _ = writeln!(out, "  .blocks = __nts_case_{name}_blocks,");
    let _ = writeln!(out, "  .identity = __nts_case_{name}_identity,");
    let zero = tables
        .blocks
        .iter()
        .position(|block| block.iter().all(|&delta| delta == 0))
        .unwrap_or(256);
    let _ = writeln!(out, "  .zero_block = {zero}u,");
    let _ = writeln!(out, "  .ranges = __nts_case_{name}_ranges,");
    let _ = writeln!(out, "  .range_count = {}u,", tables.ranges.len());
    let _ = writeln!(out, "  .exceptions = __nts_case_{name}_exceptions,");
    let _ = writeln!(out, "  .exception_count = {}u,", tables.exceptions.len());
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
}
