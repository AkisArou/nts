//! Which hash and comparison a table's keys take: one answer, read by every
//! backend.
//!
//! A `Map<string, V>` hashes and compares strings, a `Map<number, V>` numbers,
//! a `Map<Foo, V>` identities, and only a key type that is genuinely several
//! things is `ERASED`, which reads each key's tag. These are `NTS_KEY_*` in the
//! C runtime's header; the two are a pair and neither is meaningful alone.
//!
//! # Two places the answer is given
//!
//! A table's constructor is told the kind of its own key type, and builds the
//! table to hash that way. Every call that takes a key -- [`KEYED`] -- is told
//! the kind of the key type *it* was written against, as its last argument.
//! The two differ only where a view widened the key type: method parameters
//! are bivariant, so a `Map<string, number>` is a `Map<unknown, unknown>`, and
//! through that view any key may arrive. So the C runtime takes a call's kind
//! as a promise about the key -- the static type guarantees a `STRING` call's
//! key is a string -- and when it equals the table's, hashes with it as a
//! constant: no tag read, no dispatch, one compare that says so. When it does
//! not, the runtime asks the key (`nts_map_fits`) and widens the table on a
//! write.
//!
//! The call's kind is fixed by lowering, from the type the call was resolved
//! against, and not derived later from the table operand: inlining can retype
//! that operand -- a `Map<unknown, unknown>` parameter replaced by the typed
//! table passed to it -- while the key still came from wide code.
//!
//! The JVM's and Wasm's tables choose their columns from the table's type and
//! erase themselves (`NtsTable.eraseKeys`) or decline the conversion, so they
//! read a keyed call's [`operands`] without the kind.

use super::{HirType, ManagedType, ValueId};

/// A key that may be anything: each one's tag is read.
pub const ERASED: u32 = 0;
/// A string, hashed and compared by its contents.
pub const STRING: u32 = 1;
/// A number, compared by `SameValueZero`.
pub const NUMBER: u32 = 2;
/// Every other managed value: a pointer, compared by identity, which is what
/// JavaScript compares objects and symbols by.
pub const REFERENCE: u32 = 3;
/// An Objective-C object, in its box: `-hash` and `-isEqual:`.
pub const OBJC: u32 = 4;

/// The type a call's kind argument has: the runtime's `uint32_t`.
pub const KIND_TYPE: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

/// The helpers that take a key, each with the position of its kind argument,
/// which is its last.
pub const KEYED: &[(&str, usize)] = &[
    ("nts_map_delete", 2),
    ("nts_map_entry", 2),
    ("nts_map_entry_get", 3),
    ("nts_map_entry_set", 4),
    ("nts_map_get", 2),
    ("nts_map_has", 2),
    ("nts_map_set", 3),
    ("nts_set_add", 2),
];

/// The kind a key type is hashed and compared by.
///
/// The whole of what a `Map`'s key type costs at run time: a `Map<string, V>`
/// gets the string hash and compares with `nts_string_eq`, and its probe loop
/// never reads a tag.
#[must_use]
pub fn key_kind(key: &HirType) -> u32 {
    match key {
        HirType::Managed(ManagedType::String) => STRING,
        HirType::NativePointer(pointee) if is_objc_object(pointee) => OBJC,
        HirType::Float { .. } | HirType::Int { .. } => NUMBER,
        // Every other managed value is a pointer, and identity is what
        // JavaScript compares objects by, so one entry serves them all.
        HirType::Managed(_) => REFERENCE,
        // A boolean key is rare enough not to be worth a hash of its own, and
        // an erased one has to read its tag by definition.
        _ => ERASED,
    }
}

/// The kind of a table type's keys: a `Map`'s, a `Set`'s elements, a
/// dictionary's. Anything else names no key type, and is `ERASED`.
#[must_use]
pub fn key_kind_of_table(table: &HirType) -> u32 {
    match table {
        HirType::Managed(
            ManagedType::Map(key, _) | ManagedType::Table(key, _) | ManagedType::Set(key),
        ) => key_kind(key),
        _ => ERASED,
    }
}

/// Where a keyed helper's kind argument is, or `None` for any other helper.
#[must_use]
pub fn kind_at(helper: &str) -> Option<usize> {
    KEYED
        .binary_search_by(|(name, _)| (*name).cmp(helper))
        .ok()
        .map(|found| KEYED[found].1)
}

/// A call's operands without the key kind a keyed helper is told: what a table
/// that chooses its own columns reads.
#[must_use]
pub fn operands<'a>(helper: &str, args: &'a [ValueId]) -> &'a [ValueId] {
    match kind_at(helper) {
        Some(at) if args.len() == at + 1 => &args[..at],
        _ => args,
    }
}

/// Whether a pointer is to an Objective-C object the program counts.
pub(crate) fn is_objc_object(pointee: &super::native::Pointee) -> bool {
    matches!(pointee.viewed(), super::native::Pointee::Opaque(handle) if handle.family == super::native::Family::Objc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keyed_helpers_are_sorted_and_end_with_their_kind() {
        assert!(KEYED.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert_eq!(kind_at("nts_map_set"), Some(3));
        assert_eq!(kind_at("nts_map_clear"), None);
        let args = [ValueId(0), ValueId(1), ValueId(2)];
        assert_eq!(operands("nts_map_get", &args), &args[..2]);
        assert_eq!(operands("nts_map_clear", &args), &args[..]);
    }
}
