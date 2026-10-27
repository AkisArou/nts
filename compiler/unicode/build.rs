//! Generates the case-mapping tables from the vendored UCD.
//!
//! The output is plain Rust data in `$OUT_DIR/case_tables.rs`, included by
//! `src/lib.rs`. Everything an emitter prints (C arrays now, JVM constant
//! arrays next) derives from this one model, so there is exactly one Unicode
//! version in the compiler.
//!
//! A parse failure or a broken invariant is a build failure, never a
//! silently smaller table: the data is the specification.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::PathBuf;

/// The vendored release. Equals the Unicode version of the node pinned in
/// `.tool-versions` (decision D2); `src/lib.rs` names the same version.
const UCD_DIR: &str = "data/ucd-17.0.0";
const UNICODE_VERSION: (u32, u32, u32) = (17, 0, 0);

const MAX_CP: u32 = 0x10_FFFF;
const SURROGATE_LO: u32 = 0xD800;
const SURROGATE_HI: u32 = 0xDFFF;

fn read_ucd(root: &std::path::Path, name: &str) -> String {
    let path = root.join(UCD_DIR).join(name);
    println!("cargo:rerun-if-changed={}", path.display());
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    assert_version(&text, name);
    text
}

/// Every UCD file names its release in the first line
/// (`# SpecialCasing-17.0.0.txt`). A directory whose files disagree with
/// `UNICODE_VERSION` must never generate tables.
fn assert_version(text: &str, name: &str) {
    let first = text.lines().next().expect("UCD file is empty");
    if !first.starts_with('#') {
        // UnicodeData.txt is pure data with no header; its version is the
        // directory's, guarded by SHA256SUMS and the census.
        return;
    }
    let stem = name.strip_suffix(".txt").expect("UCD file name");
    let tail = first
        .strip_prefix('#')
        .and_then(|s| s.trim().strip_prefix(stem))
        .and_then(|s| s.strip_prefix('-'))
        .and_then(|s| s.strip_suffix(".txt"))
        .unwrap_or_else(|| panic!("{name}: first line does not name a version: {first:?}"));
    let mut parts = tail.split('.');
    let version = (
        parse_u32(parts.next().expect("version major"), 10, name),
        parse_u32(parts.next().expect("version minor"), 10, name),
        parse_u32(parts.next().expect("version patch"), 10, name),
    );
    assert_eq!(
        version, UNICODE_VERSION,
        "{name} is UCD {version:?} but the compiler is pinned to {UNICODE_VERSION:?} (D2)"
    );
}

fn parse_u32(s: &str, radix: u32, ctx: &str) -> u32 {
    u32::from_str_radix(s.trim(), radix)
        .unwrap_or_else(|e| panic!("{ctx}: {s:?} is not a number: {e}"))
}

fn parse_cp(s: &str, ctx: &str) -> u32 {
    let cp = parse_u32(s, 16, ctx);
    assert!(cp <= MAX_CP, "{ctx}: U+{cp:X} is out of range");
    cp
}

/// A mapping field: empty (no mapping), or space-separated hex code points.
fn parse_mapping(s: &str, ctx: &str) -> Vec<u32> {
    s.split_whitespace().map(|p| parse_cp(p, ctx)).collect()
}

/// The model one direction of case conversion needs, before shaping.
#[derive(Default)]
struct DirectionModel {
    /// One-to-one mappings that change the code point.
    single: BTreeMap<u32, u32>,
    /// Full mappings that are not one-to-one (expansions, and U+0130).
    exceptions: BTreeMap<u32, Vec<u32>>,
}

impl DirectionModel {
    /// Record a full mapping. A one-code-point result joins `single`
    /// (unless it is the identity); anything else is an exception. A later
    /// record (`SpecialCasing`) overrides an earlier one (`UnicodeData`).
    fn record(&mut self, cp: u32, mapped: &[u32], ctx: &str) {
        assert!(
            !(SURROGATE_LO..=SURROGATE_HI).contains(&cp),
            "{ctx}: surrogate U+{cp:X} has a case mapping"
        );
        if mapped.len() == 1 {
            let to = mapped[0];
            self.exceptions.remove(&cp);
            if to == cp {
                self.single.remove(&cp);
            } else {
                self.single.insert(cp, to);
            }
        } else {
            assert!(!mapped.is_empty(), "{ctx}: U+{cp:X} maps to nothing");
            self.single.remove(&cp);
            self.exceptions.insert(cp, mapped.to_vec());
        }
    }
}

/// UnicodeData.txt: fields 12/13 are the simple uppercase/lowercase
/// mappings. Range records (`<…, First>`/`<…, Last>`) must not carry
/// mappings; if a future release gives one, this is where it stops.
fn parse_unicode_data(text: &str, upper: &mut DirectionModel, lower: &mut DirectionModel) {
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(';').collect();
        assert_eq!(fields.len(), 15, "UnicodeData: malformed line {line:?}");
        let cp = parse_cp(fields[0], "UnicodeData");
        let (up, lo) = (fields[12], fields[13]);
        if fields[1].ends_with(", First>") || fields[1].ends_with(", Last>") {
            assert!(
                up.is_empty() && lo.is_empty(),
                "UnicodeData: range at U+{cp:X} carries a case mapping"
            );
            continue;
        }
        if !up.is_empty() {
            upper.record(cp, &[parse_cp(up, "UnicodeData uppercase")], "UnicodeData");
        }
        if !lo.is_empty() {
            lower.record(cp, &[parse_cp(lo, "UnicodeData lowercase")], "UnicodeData");
        }
    }
}

/// `SpecialCasing` conditions that are language-dependent (locale casing,
/// stage 4) and therefore out of the default conversion JavaScript's
/// `toLowerCase`/`toUpperCase` perform.
const LOCALE_CONDITIONS: &[&str] = &["tr", "az", "lt"];
/// Context words that only occur inside those locale conditions.
const LOCALE_CONTEXTS: &[&str] = &[
    "After_I",
    "After_Soft_Dotted",
    "More_Above",
    "Not_Before_Dot",
];

/// SpecialCasing.txt: unconditional records override the simple mappings;
/// `Final_Sigma` is the one language-independent condition the default
/// conversion applies (handled by the algorithm, checked here to be the
/// sigma record and nothing else). Any other language-independent
/// condition fails the build until the algorithm grows it.
fn parse_special_casing(text: &str, upper: &mut DirectionModel, lower: &mut DirectionModel) {
    for raw in text.lines() {
        let line = raw.split('#').next().expect("split").trim();
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(';').map(str::trim).collect();
        assert!(fields.len() >= 5, "SpecialCasing: malformed line {raw:?}");
        let cp = parse_cp(fields[0], "SpecialCasing");
        let condition = fields.get(4).copied().unwrap_or("");
        if condition.is_empty() {
            lower.record(
                cp,
                &parse_mapping(fields[1], "SpecialCasing lower"),
                "SpecialCasing",
            );
            upper.record(
                cp,
                &parse_mapping(fields[3], "SpecialCasing upper"),
                "SpecialCasing",
            );
        } else if condition == "Final_Sigma" {
            assert_eq!(
                cp, 0x03A3,
                "SpecialCasing: Final_Sigma on U+{cp:X}, not sigma"
            );
            assert_eq!(
                parse_mapping(fields[1], "SpecialCasing Final_Sigma"),
                vec![0x03C2],
                "SpecialCasing: Final_Sigma does not map to U+03C2"
            );
        } else {
            let mut has_locale = false;
            for token in condition.split_whitespace() {
                if LOCALE_CONDITIONS.contains(&token) {
                    has_locale = true;
                } else {
                    assert!(
                        LOCALE_CONTEXTS.contains(&token),
                        "SpecialCasing: unhandled condition {condition:?} at U+{cp:X}"
                    );
                }
            }
            assert!(
                has_locale,
                "SpecialCasing: language-independent condition {condition:?} at U+{cp:X} \
                 is not Final_Sigma; the default conversion must learn it first"
            );
        }
    }
}

/// DerivedCoreProperties.txt: the `Cased` and `Case_Ignorable` membership
/// `Final_Sigma`'s context reads, as sorted inclusive ranges.
fn parse_property_ranges(text: &str, property: &str) -> Vec<(u32, u32)> {
    let mut ranges: Vec<(u32, u32)> = Vec::new();
    for raw in text.lines() {
        let line = raw.split('#').next().expect("split").trim();
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split(';').map(str::trim);
        let span = fields.next().expect("span");
        let name = fields.next().unwrap_or("");
        if name != property {
            continue;
        }
        let (lo, hi) = if let Some((a, b)) = span.split_once("..") {
            (
                parse_cp(a, "DerivedCoreProperties"),
                parse_cp(b, "DerivedCoreProperties"),
            )
        } else {
            let cp = parse_cp(span, "DerivedCoreProperties");
            (cp, cp)
        };
        assert!(lo <= hi, "DerivedCoreProperties: inverted range {span:?}");
        match ranges.last_mut() {
            Some(last) if lo <= last.1 + 1 => last.1 = last.1.max(hi),
            _ => ranges.push((lo, hi)),
        }
    }
    assert!(
        !ranges.is_empty(),
        "DerivedCoreProperties: no {property} ranges"
    );
    ranges
}

/// The facts the run-time fast paths are built on. A Unicode upgrade that
/// breaks one must change the algorithm in the same commit, not ship past
/// this assert.
fn assert_invariants(lower: &DirectionModel, upper: &DirectionModel) {
    // Only U+0130 changes length when lowercased: the one-byte and
    // equal-width lowercase paths assume everything else is one-to-one.
    let lower_ex: Vec<u32> = lower.exceptions.keys().copied().collect();
    assert_eq!(
        lower_ex,
        vec![0x0130],
        "lowercase exceptions are no longer just U+0130"
    );
    // In Latin-1, only micro sign, sharp s and y-diaeresis leave one byte
    // when uppercased.
    let widening: Vec<u32> = (0u32..=0xFF)
        .filter(
            |&cp| match (upper.single.get(&cp), upper.exceptions.get(&cp)) {
                (Some(&to), _) => to > 0xFF,
                (None, Some(_)) => true,
                (None, None) => false,
            },
        )
        .collect();
    assert_eq!(
        widening,
        vec![0x00B5, 0x00DF, 0x00FF],
        "Latin-1 uppercase widening changed"
    );
    for (name, model) in [("lower", lower), ("upper", upper)] {
        for (&cp, &to) in &model.single {
            assert_eq!(
                cp > 0xFFFF,
                to > 0xFFFF,
                "{name}: U+{cp:X} -> U+{to:X} crosses planes; the BMP/astral split is unsound"
            );
        }
        for (&cp, mapped) in &model.exceptions {
            assert!(
                cp <= 0xFFFF,
                "{name}: astral exception at U+{cp:X}; the sentinel scheme is BMP-only"
            );
            assert!(
                mapped.len() <= 3,
                "{name}: U+{cp:X} expands to {} code points; capacity arithmetic assumes at most 3",
                mapped.len()
            );
            assert!(
                mapped.iter().all(|&m| m <= 0xFFFF),
                "{name}: U+{cp:X} expands above the BMP; the pool is UTF-16-unit sized"
            );
        }
    }
}

/// One direction shaped for emission: a two-level BMP table of
/// `target XOR source` values (0 = unchanged, `sentinel` = exception),
/// astral constant-delta ranges, and the exception records.
struct Shaped {
    index: Vec<u8>,
    blocks: Vec<[u16; 256]>,
    ranges: Vec<(u32, u32, i32)>,
}

fn shape(model: &DirectionModel, sentinel: u16, name: &str) -> Shaped {
    let mut blocks: Vec<[u16; 256]> = Vec::new();
    let mut index: Vec<u8> = Vec::with_capacity(256);
    for page in 0u32..256 {
        let mut block = [0u16; 256];
        for low in 0u32..256 {
            let cp = (page << 8) | low;
            block[low as usize] = if model.exceptions.contains_key(&cp) {
                sentinel
            } else if let Some(&to) = model.single.get(&cp) {
                let x = u16::try_from(to ^ cp).expect("BMP xor fits u16");
                assert!(
                    x != 0 && x != sentinel,
                    "{name}: U+{cp:X} collides with a reserved value"
                );
                x
            } else {
                0
            };
        }
        let id = if let Some(pos) = blocks.iter().position(|b| *b == block) {
            pos
        } else {
            blocks.push(block);
            blocks.len() - 1
        };
        index.push(
            u8::try_from(id).unwrap_or_else(|_| panic!("{name}: more than 256 unique blocks")),
        );
    }
    let mut ranges: Vec<(u32, u32, i32)> = Vec::new();
    for (&cp, &to) in model.single.range(0x1_0000..) {
        let delta = i32::try_from(to).expect("cp") - i32::try_from(cp).expect("cp");
        match ranges.last_mut() {
            Some(last) if cp == last.1 + 1 && delta == last.2 => last.1 = cp,
            _ => ranges.push((cp, cp, delta)),
        }
    }
    Shaped {
        index,
        blocks,
        ranges,
    }
}

/// The one XOR value no ordinary BMP mapping in either direction uses, so
/// it can mark "exception" in both tables. Nonzero (0 is "unchanged").
fn choose_sentinel(lower: &DirectionModel, upper: &DirectionModel) -> u16 {
    let mut used = vec![false; 65_536];
    used[0] = true;
    for model in [lower, upper] {
        for (&cp, &to) in &model.single {
            if cp <= 0xFFFF {
                used[usize::try_from(to ^ cp).expect("BMP xor")] = true;
            }
        }
    }
    used.iter()
        .position(|&u| !u)
        .map(|v| u16::try_from(v).expect("sentinel fits u16"))
        .expect("every u16 is an ordinary XOR value; the sentinel scheme is exhausted")
}

fn emit_direction(out: &mut String, prefix: &str, model: &DirectionModel, shaped: &Shaped) {
    let _ = writeln!(out, "pub static {prefix}_INDEX: [u8; 256] = [");
    for chunk in shaped.index.chunks(16) {
        let _ = write!(out, "    ");
        for v in chunk {
            let _ = write!(out, "{v}, ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "];");
    let _ = writeln!(
        out,
        "pub static {prefix}_BLOCKS: [[u16; 256]; {}] = [",
        shaped.blocks.len()
    );
    for block in &shaped.blocks {
        let _ = writeln!(out, "    [");
        for chunk in block.chunks(8) {
            let _ = write!(out, "        ");
            for v in chunk {
                let _ = write!(out, "{v:#06x}, ");
            }
            let _ = writeln!(out);
        }
        let _ = writeln!(out, "    ],");
    }
    let _ = writeln!(out, "];");
    let _ = writeln!(
        out,
        "pub static {prefix}_RANGES: [(u32, u32, i32); {}] = [",
        shaped.ranges.len()
    );
    for (lo, hi, delta) in &shaped.ranges {
        let _ = writeln!(out, "    ({lo:#x}, {hi:#x}, {delta}),");
    }
    let _ = writeln!(out, "];");
    let _ = writeln!(
        out,
        "pub static {prefix}_EXCEPTIONS: [(u32, &[u32]); {}] = [",
        model.exceptions.len()
    );
    for (cp, mapped) in &model.exceptions {
        let _ = write!(out, "    ({cp:#x}, &[");
        for m in mapped {
            let _ = write!(out, "{m:#x}, ");
        }
        let _ = writeln!(out, "]),");
    }
    let _ = writeln!(out, "];");
}

fn emit_ranges(out: &mut String, name: &str, ranges: &[(u32, u32)]) {
    let _ = writeln!(out, "pub static {name}: [(u32, u32); {}] = [", ranges.len());
    for chunk in ranges.chunks(4) {
        let _ = write!(out, "    ");
        for (lo, hi) in chunk {
            let _ = write!(out, "({lo:#x}, {hi:#x}), ");
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "];");
}

fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("crate root"));
    let mut upper = DirectionModel::default();
    let mut lower = DirectionModel::default();
    parse_unicode_data(&read_ucd(&root, "UnicodeData.txt"), &mut upper, &mut lower);
    parse_special_casing(
        &read_ucd(&root, "SpecialCasing.txt"),
        &mut upper,
        &mut lower,
    );
    let derived = read_ucd(&root, "DerivedCoreProperties.txt");
    let cased = parse_property_ranges(&derived, "Cased");
    let ignorable = parse_property_ranges(&derived, "Case_Ignorable");
    assert_invariants(&lower, &upper);
    let sentinel = choose_sentinel(&lower, &upper);
    let lower_shaped = shape(&lower, sentinel, "lower");
    let upper_shaped = shape(&upper, sentinel, "upper");

    let mut out = String::new();
    let _ = writeln!(out, "// Generated by build.rs from {UCD_DIR}; do not edit.");
    let _ = writeln!(out, "pub const EXCEPTION_SENTINEL: u16 = {sentinel:#x};");
    emit_direction(&mut out, "LOWER", &lower, &lower_shaped);
    emit_direction(&mut out, "UPPER", &upper, &upper_shaped);
    emit_ranges(&mut out, "CASED_RANGES", &cased);
    emit_ranges(&mut out, "CASE_IGNORABLE_RANGES", &ignorable);

    let dest = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR")).join("case_tables.rs");
    std::fs::write(&dest, out).unwrap_or_else(|e| panic!("cannot write {}: {e}", dest.display()));
}
