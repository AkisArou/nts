//! Whether an optional property was ever written.
//!
//! JavaScript distinguishes `{}` from `{ x: undefined }` and a struct cannot: an
//! optional property's slot exists whether or not anybody stored to it. So
//! `"x" in o`, `Object.keys(o)`, `Object.hasOwn(o, "x")` and `for (const k in
//! o)` all refused on a type with one -- four refusals across three ledger rows,
//! and one missing fact behind them.
//!
//! The fact is one bit per optional property, in the object header's `flags`
//! word. It costs no memory: bits 0 through 5 are spoken for by the string,
//! array and collector flags, the other twenty-six were free, and every object
//! already carries the word.
//!
//! # Where the rule lives
//!
//! Here, and the arithmetic lives in C. The compiler hands out a zero-based
//! *index* and `nts_presence_set`/`_clear`/`_has` add the shift, so the 6 has
//! exactly one definition and cannot drift. [`BITS`] is the one number stated
//! twice, because the compiler has to refuse a layout it cannot record and C
//! cannot be asked at compile time -- `nts_runtime.h` asserts its own half, so a
//! change on either side is a build error rather than a silent capacity cut.
//!
//! The same arrangement [`super::tags`] documents, for the same reason.

use super::Layout;

/// How many optional properties one object can record.
///
/// `32 - NTS_PRESENCE_SHIFT`. Stated here and asserted in `nts_runtime.h`; a
/// change to either without the other fails that assertion.
///
/// **The same number for every backend, and deliberately lower than one of
/// them needs.** The JVM keeps these bits in an `int` field of its own rather
/// than in a header word -- its objects live in the platform collector's heap,
/// so there is no word to borrow -- which gives that lane 32. Agreed with it
/// and kept at 26 anyway: a program that compiles for one backend and not
/// another is a worse failure than a limit that is lower than it needs to be on
/// one, and nothing in the corpus comes near either number.
///
/// So the day a program wants a twenty-seventh, the fix is *here* -- a second
/// presence word, or spilling past the header -- and not a per-backend limit.
/// The JVM's emission reads the index it is handed and nothing else, so it
/// follows whatever this does.
pub const BITS: u32 = 26;

/// What a property's presence is recorded in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    /// Not optional. Its slot is written at construction, so there is nothing
    /// to record and every question about it is answered from the type.
    Always,
    /// Optional, recorded in this bit.
    Bit(u32),
    /// Optional, and past what the word holds.
    ///
    /// A separate outcome rather than a `None` shared with [`Self::Always`],
    /// because the two want opposite handling: one is an answer and the other
    /// is a refusal that has to name what it could not represent.
    TooMany {
        /// How many optional properties the layout has.
        optional: usize,
    },
}

/// The bit recording whether `key` was written on a value of this layout.
///
/// The index is the property's position among the layout's optional fields, **in
/// layout order**. That is the load-bearing sentence: layout order is
/// base-first, so a subclass and its base agree about a shared property's bit by
/// exactly the argument their field *offsets* already rest on, and a value
/// reaching a base-typed parameter tests the same bit either way.
///
/// Deriving it from the checker's property list instead would be wrong in a way
/// that runs. That list is flattened with a class's **own** properties first --
/// `class CodedError extends Error { code }` arrives as `code`, `name`,
/// `message`, `stack?`, `cause?` -- so `stack?` would be bit 0 on the base and
/// bit 0 on the subclass only by coincidence, and any own optional property
/// would shift every inherited one.
///
/// `optional` answers whether a field name is an optional property of the type
/// being asked about; it is the caller's because it is a question about the
/// snapshot, and this module is about the layout.
pub fn of(layout: &Layout, optional: impl Fn(&str) -> bool, key: &str) -> Presence {
    let mut index = 0u32;
    let mut found = None;
    for field in &layout.fields {
        if !optional(&field.name) {
            continue;
        }
        if field.name == key {
            found = Some(index);
        }
        index += 1;
    }
    match found {
        // Counted to the end even after finding it, so that `TooMany` is a
        // property of the *layout* rather than of where the key happens to sit
        // in it. A layout with thirty optional properties cannot record any of
        // them, including the first: a program that sets bit 29 on one path and
        // reads bit 3 on another would be answering from a word that dropped
        // the write.
        Some(bit) if index <= BITS => Presence::Bit(bit),
        Some(_) => Presence::TooMany {
            optional: index as usize,
        },
        None => Presence::Always,
    }
}
