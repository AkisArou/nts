//! Lossless JavaScript strings. Native WTF-8 never becomes a public Rust str.

use std::cell::RefCell;
use std::fmt::Write as _;

use rustc_hash::FxHashMap;
use tsrs_core::arena::Region;

/// A borrowed JavaScript string, including lone UTF-16 surrogates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct JsString<'p> {
    utf16: &'p [u16],
    utf8: Option<&'p str>,
}

impl<'p> JsString<'p> {
    #[must_use]
    pub const fn utf16(self) -> &'p [u16] {
        self.utf16
    }
    /// Exactly `None` when the value contains an unpaired surrogate.
    #[must_use]
    pub const fn utf8(self) -> Option<&'p str> {
        self.utf8
    }
}

pub(crate) fn decode(bytes: &[u8]) -> Vec<u16> {
    let mut remaining = bytes;
    let mut units = Vec::new();
    while !remaining.is_empty() {
        let (rune, length) = tsrs_core::stringutil::decode_js_string_rune_bytes(remaining);
        assert!(
            length > 0 && length <= remaining.len(),
            "native JS string decoder must advance"
        );
        if rune <= 0xffff {
            units.push(
                u16::try_from(rune)
                    .expect("the preceding branch bounded this decoded unit to 0xffff"),
            );
        } else {
            let (high, low) = tsrs_core::stringutil::code_point_to_surrogate_pair(rune);
            units.push(u16::try_from(high).expect(
                "native surrogate conversion returns a unit within 0xffff even for invalid scalars",
            ));
            units.push(u16::try_from(low).expect(
                "native surrogate conversion returns a unit within 0xffff even for invalid scalars",
            ));
        }
        remaining = &remaining[length..];
    }
    units
}

pub(crate) fn display(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    let mut output = String::new();
    for unit in char::decode_utf16(decode(bytes)) {
        match unit {
            Ok(ch) => output.push(ch),
            Err(lone) => write!(output, "\\u{:04X}", lone.unpaired_surrogate())
                .expect("writing to a String cannot fail"),
        }
    }
    output
}

#[derive(Clone, Copy)]
struct Interned {
    utf16: &'static [u16],
    utf8: Option<&'static str>,
}

pub(crate) struct StringPool {
    region: Region,
    values: RefCell<FxHashMap<Vec<u8>, Interned>>,
}

impl StringPool {
    pub(crate) fn new(region: Region) -> Self {
        Self {
            region,
            values: RefCell::default(),
        }
    }
    pub(crate) fn enter(&self) -> tsrs_core::arena::RegionScope {
        self.region.enter()
    }
    pub(crate) fn intern(&self, bytes: &[u8]) -> JsString<'_> {
        let mut values = self.values.borrow_mut();
        let value = *values.entry(bytes.to_vec()).or_insert_with(|| {
            let units = decode(bytes);
            // The owner retains this region until every public view ends.
            // Native allocators return static handles; only a shortened borrow
            // is exposed here, exactly like the native AST/type view boundary.
            let _scope = self.region.enter();
            let unicode = String::from_utf16(&units).ok();
            Interned {
                utf16: tsrs_core::alloc_slice(&units),
                utf8: unicode.as_deref().map(tsrs_core::alloc_str),
            }
        });
        JsString {
            utf16: value.utf16,
            utf8: value.utf8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinel_surrogates_are_lossless_and_pairs_have_a_unicode_view() {
        let pool = StringPool::new(Region::new_scratch(4096));
        let lone = pool.intern(&[0xed, 0xa0, 0x80]);
        assert_eq!(lone.utf16(), [0xd800]);
        assert_eq!(lone.utf8(), None);
        let pair = pool.intern(&[0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);
        assert_eq!(pair.utf16(), [0xd83d, 0xde00]);
        assert_eq!(pair.utf8(), Some("😀"));
        assert_eq!(pair, pool.intern("😀".as_bytes()));
        assert!(std::ptr::eq(
            lone.utf16(),
            pool.intern(&[0xed, 0xa0, 0x80]).utf16()
        ));
    }

    #[test]
    fn diagnostic_display_escapes_each_lone_surrogate_and_preserves_pairs() {
        assert_eq!(display(b"module '\xed\xa0\x80'"), "module '\\uD800'");
        assert_eq!(display(&[0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]), "😀");
        assert_eq!(
            display("ordinary Unicode β".as_bytes()),
            "ordinary Unicode β"
        );
    }
}
