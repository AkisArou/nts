//! The constant pool.
//!
//! Every name, type, literal and cross-reference in a class file is an index
//! into one table. The table is written once, at the front, and everything
//! after it is indices -- so a builder that hands out an index the moment it is
//! asked, and remembers what it handed out, is the whole design.
//!
//! # Interning is not an optimization here
//!
//! It is what keeps the table small enough to exist. `Ljava/lang/String;`
//! appears in every descriptor a program has; `nts/rt/NtsRuntime` appears at
//! every runtime call. Without interning a moderate program would exhaust the
//! 65,535-entry space on repeated spellings of the same six names.
//!
//! Interning is keyed on the *resolved* entry rather than on the request, which
//! is why [`Pool::method_ref`] takes three strings and looks up a triple of
//! indices: two spellings that resolve to the same three indices are the same
//! entry, and nothing has to reason about how a caller spelled it.

use rustc_hash::FxHashMap;

/// The tag byte that introduces each kind of entry. JVMS 4.4, table 4.4-B.
mod tag {
    pub(super) const UTF8: u8 = 1;
    pub(super) const INTEGER: u8 = 3;
    pub(super) const FLOAT: u8 = 4;
    pub(super) const LONG: u8 = 5;
    pub(super) const DOUBLE: u8 = 6;
    pub(super) const CLASS: u8 = 7;
    pub(super) const STRING: u8 = 8;
    pub(super) const FIELDREF: u8 = 9;
    pub(super) const METHODREF: u8 = 10;
    pub(super) const INTERFACE_METHODREF: u8 = 11;
    pub(super) const NAME_AND_TYPE: u8 = 12;
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Key {
    Utf8(String),
    Integer(i32),
    /// Bits rather than the float, so `NaN` interns with itself and `-0.0`
    /// does not intern with `0.0` -- both of which a JavaScript program can
    /// tell apart and a `f32` key could not.
    Float(u32),
    Long(i64),
    Double(u64),
    Class(u16),
    String(u16),
    NameAndType(u16, u16),
    Ref(u8, u16, u16),
}

#[derive(Debug, Clone)]
enum Entry {
    Utf8(String),
    Integer(i32),
    Float(u32),
    Long(i64),
    Double(u64),
    Class(u16),
    String(u16),
    NameAndType(u16, u16),
    Ref { tag: u8, class: u16, name_and_type: u16 },
    /// The unusable slot that follows a `Long` or a `Double`.
    ///
    /// JVMS 4.4.5 calls this "a poor choice" in its own words and keeps it.
    /// Nothing may reference this index; it exists so the next entry's index
    /// is two higher rather than one.
    Filler,
}

/// A class file's constant pool, under construction.
///
/// Indices are 1-based and the zeroth is not a slot -- so `entries[0]` is the
/// entry at index 1, and [`Pool::count`] reports one more than there are
/// entries, which is what the file format wants written.
#[derive(Debug, Default)]
pub struct Pool {
    entries: Vec<Entry>,
    interned: FxHashMap<Key, u16>,
    /// Set when a push would have exceeded index 65,535.
    ///
    /// Recorded rather than returned, because the alternative is a `Result` at
    /// several thousand call sites for a condition that ends the compilation of
    /// one function however it is reported. [`Pool::overflowed`] is checked
    /// once, where the class is finished.
    overflow: bool,
}

impl Pool {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// One more than the number of entries -- what `constant_pool_count` is.
    #[must_use]
    pub fn count(&self) -> u16 {
        // Saturating rather than wrapping: past the limit `overflow` is already
        // set and the class will not be written, so any value here is unused.
        u16::try_from(self.entries.len() + 1).unwrap_or(u16::MAX)
    }

    /// Whether the pool ran out of index space. A class whose pool overflowed
    /// must not be written: every index past the limit is wrong.
    #[must_use]
    pub const fn overflowed(&self) -> bool {
        self.overflow
    }

    fn push(&mut self, key: Key, entry: Entry) -> u16 {
        if let Some(&at) = self.interned.get(&key) {
            return at;
        }
        // The index this entry will occupy, before it is pushed.
        let Ok(at) = u16::try_from(self.entries.len() + 1) else {
            self.overflow = true;
            return 1;
        };
        let wide = matches!(entry, Entry::Long(_) | Entry::Double(_));
        if wide && at == u16::MAX {
            // The filler would not fit, which is the same exhaustion one entry
            // earlier and would otherwise write a truncated pool.
            self.overflow = true;
            return 1;
        }
        self.entries.push(entry);
        if wide {
            self.entries.push(Entry::Filler);
        }
        self.interned.insert(key, at);
        at
    }

    pub fn utf8(&mut self, text: &str) -> u16 {
        self.push(Key::Utf8(text.to_owned()), Entry::Utf8(text.to_owned()))
    }

    /// A class, named the way the JVM names one: `java/lang/String`, with
    /// slashes and no `L`/`;`. An array class is named by its *descriptor*
    /// instead (`[D`, `[Ljava/lang/String;`), which is the one place the two
    /// spellings meet.
    pub fn class(&mut self, internal_name: &str) -> u16 {
        let name = self.utf8(internal_name);
        self.push(Key::Class(name), Entry::Class(name))
    }

    pub fn string(&mut self, text: &str) -> u16 {
        let utf8 = self.utf8(text);
        self.push(Key::String(utf8), Entry::String(utf8))
    }

    pub fn integer(&mut self, value: i32) -> u16 {
        self.push(Key::Integer(value), Entry::Integer(value))
    }

    pub fn float(&mut self, value: f32) -> u16 {
        let bits = value.to_bits();
        self.push(Key::Float(bits), Entry::Float(bits))
    }

    pub fn long(&mut self, value: i64) -> u16 {
        self.push(Key::Long(value), Entry::Long(value))
    }

    pub fn double(&mut self, value: f64) -> u16 {
        let bits = value.to_bits();
        self.push(Key::Double(bits), Entry::Double(bits))
    }

    fn name_and_type(&mut self, name: &str, descriptor: &str) -> u16 {
        let name = self.utf8(name);
        let descriptor = self.utf8(descriptor);
        self.push(
            Key::NameAndType(name, descriptor),
            Entry::NameAndType(name, descriptor),
        )
    }

    fn reference(&mut self, tag: u8, class: &str, name: &str, descriptor: &str) -> u16 {
        let class = self.class(class);
        let name_and_type = self.name_and_type(name, descriptor);
        self.push(
            Key::Ref(tag, class, name_and_type),
            Entry::Ref { tag, class, name_and_type },
        )
    }

    pub fn field_ref(&mut self, class: &str, name: &str, descriptor: &str) -> u16 {
        self.reference(tag::FIELDREF, class, name, descriptor)
    }

    pub fn method_ref(&mut self, class: &str, name: &str, descriptor: &str) -> u16 {
        self.reference(tag::METHODREF, class, name, descriptor)
    }

    /// The same thing as [`Pool::method_ref`] with a different tag, and the
    /// difference is load-bearing: `invokeinterface` requires an
    /// `InterfaceMethodref` and `invokevirtual` refuses one.
    pub fn interface_method_ref(&mut self, class: &str, name: &str, descriptor: &str) -> u16 {
        self.reference(tag::INTERFACE_METHODREF, class, name, descriptor)
    }

    pub fn write(&self, out: &mut Vec<u8>) {
        for entry in &self.entries {
            match entry {
                Entry::Filler => {}
                Entry::Utf8(text) => {
                    out.push(tag::UTF8);
                    let bytes = modified_utf8(text);
                    // The length is a `u2`, so a literal past 65,535 bytes has
                    // no representation. `Class::to_bytes` refuses one before
                    // reaching here; this truncation is unreachable and is
                    // written rather than panicking, because a panic in an
                    // emitter is worse than a class the verifier rejects.
                    let length = u16::try_from(bytes.len()).unwrap_or(u16::MAX);
                    out.extend_from_slice(&length.to_be_bytes());
                    out.extend_from_slice(&bytes[..length as usize]);
                }
                Entry::Integer(value) => {
                    out.push(tag::INTEGER);
                    out.extend_from_slice(&value.to_be_bytes());
                }
                Entry::Float(bits) => {
                    out.push(tag::FLOAT);
                    out.extend_from_slice(&bits.to_be_bytes());
                }
                Entry::Long(value) => {
                    out.push(tag::LONG);
                    out.extend_from_slice(&value.to_be_bytes());
                }
                Entry::Double(bits) => {
                    out.push(tag::DOUBLE);
                    out.extend_from_slice(&bits.to_be_bytes());
                }
                Entry::Class(name) => {
                    out.push(tag::CLASS);
                    out.extend_from_slice(&name.to_be_bytes());
                }
                Entry::String(utf8) => {
                    out.push(tag::STRING);
                    out.extend_from_slice(&utf8.to_be_bytes());
                }
                Entry::NameAndType(name, descriptor) => {
                    out.push(tag::NAME_AND_TYPE);
                    out.extend_from_slice(&name.to_be_bytes());
                    out.extend_from_slice(&descriptor.to_be_bytes());
                }
                Entry::Ref { tag, class, name_and_type } => {
                    out.push(*tag);
                    out.extend_from_slice(&class.to_be_bytes());
                    out.extend_from_slice(&name_and_type.to_be_bytes());
                }
            }
        }
    }

    /// The encoded length of a string, for the 65,535-byte check that has to
    /// happen before the entry is created.
    #[must_use]
    pub fn utf8_length(text: &str) -> usize {
        modified_utf8(text).len()
    }
}

/// Java's modified UTF-8, which is not UTF-8.
///
/// Two differences, both deliberate in the format and both wrong if skipped:
///
/// - `U+0000` is written as `C0 80` rather than as a zero byte, so an encoded
///   string contains no NUL and C code can treat it as terminated.
/// - A character outside the basic multilingual plane is written as its
///   *surrogate pair*, three bytes each, rather than as UTF-8's four. Rust
///   strings hold the four-byte form, so this is a real re-encoding and not a
///   copy -- and a TypeScript program that puts an emoji in a string literal
///   reaches it on the first try.
// Every cast here is a deliberate truncation: the code point has already been
// masked to six or twelve bits by the shift above it, and a `try_from` would
// state a range check the mask has just performed.
#[allow(clippy::cast_possible_truncation)]
fn modified_utf8(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let code = ch as u32;
        if code == 0 {
            out.extend_from_slice(&[0xC0, 0x80]);
        } else if code < 0x80 {
            out.push(code as u8);
        } else if code < 0x800 {
            out.push(0xC0 | (code >> 6) as u8);
            out.push(0x80 | (code & 0x3F) as u8);
        } else if code < 0x1_0000 {
            out.push(0xE0 | (code >> 12) as u8);
            out.push(0x80 | ((code >> 6) & 0x3F) as u8);
            out.push(0x80 | (code & 0x3F) as u8);
        } else {
            // The surrogate pair, each half encoded as three bytes.
            let value = code - 0x1_0000;
            let high = 0xD800 + (value >> 10);
            let low = 0xDC00 + (value & 0x3FF);
            for half in [high, low] {
                out.push(0xE0 | (half >> 12) as u8);
                out.push(0x80 | ((half >> 6) & 0x3F) as u8);
                out.push(0x80 | (half & 0x3F) as u8);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    #[test]
    fn one_entry_per_distinct_name() {
        let mut pool = Pool::new();
        let first = pool.utf8("java/lang/String");
        let second = pool.utf8("java/lang/String");
        assert_eq!(first, second);
        assert_eq!(pool.count(), 2);
    }

    #[test]
    fn a_long_occupies_two_indices() {
        let mut pool = Pool::new();
        let long = pool.long(7);
        let after = pool.integer(1);
        assert_eq!(long, 1);
        assert_eq!(after, 3, "the index after a Long skips its filler");
    }

    #[test]
    fn negative_zero_is_not_zero() {
        // `-0.0 == 0.0` in Rust, so a key that compared floats would merge two
        // constants a JavaScript program distinguishes.
        let mut pool = Pool::new();
        assert_ne!(pool.double(0.0), pool.double(-0.0));
    }

    #[test]
    fn every_nan_is_one_constant() {
        let mut pool = Pool::new();
        assert_eq!(pool.double(f64::NAN), pool.double(f64::NAN));
    }

    #[test]
    fn a_reference_reuses_its_parts() {
        let mut pool = Pool::new();
        pool.method_ref("nts/rt/NtsRuntime", "round", "(D)D");
        let before = pool.count();
        // Same class, same descriptor, different name: only the name Utf8 and
        // the NameAndType and the Methodref are new.
        pool.method_ref("nts/rt/NtsRuntime", "trunc", "(D)D");
        assert_eq!(pool.count() - before, 3);
    }

    #[test]
    fn nul_is_two_bytes_and_not_a_terminator() {
        assert_eq!(modified_utf8("\0"), vec![0xC0, 0x80]);
    }

    #[test]
    fn astral_characters_become_surrogate_pairs() {
        // U+1F600. UTF-8 would be four bytes; modified UTF-8 is six.
        let encoded = modified_utf8("\u{1F600}");
        assert_eq!(encoded.len(), 6);
        assert_eq!(encoded, vec![0xED, 0xA0, 0xBD, 0xED, 0xB8, 0x80]);
    }
}
