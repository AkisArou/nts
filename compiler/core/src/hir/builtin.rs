//! The classes this compiler provides rather than reads.
//!
//! # Why `Error` cannot come from `lib.d.ts`
//!
//! Every other class this compiler lays out is decomposed from the checker's
//! own type, and `Error` cannot be. Its declared interface has `stack?: string`
//! and `cause?: unknown`, and an optional property is refused here because it
//! needs a presence bit, which changes the layout rather than adding to it.
//!
//! So `class MyError extends Error {}` — which is how every error in a real
//! TypeScript program is written — failed for a reason that had nothing to do
//! with errors, and reported the *base* as unrepresentable, which was true and
//! unhelpful.
//!
//! The answer is not to widen what a layout can hold. It is to say what an
//! `Error` is in a compiled program: a message and a name. `stack` is a record
//! of frames a compiled binary does not keep, and refusing to read one is
//! better than a field that is always empty.
//!
//! # What a subclass gets
//!
//! The checker's property list is flattened, so `class CodedError extends Error
//! { code: string }` arrives with `code`, `name`, `message`, `stack?` and
//! `cause?` all at one level. What separates them is `PropertyRecord::own`,
//! which the schema already carries: `code` is the class's own and the rest
//! came from the base. So a descendant's layout is *this* module's fields
//! followed by the properties the class declares itself — which is the
//! base-first rule every other hierarchy here already follows.

use super::{Field, HirType, ManagedType};

/// The error classes this compiler provides.
///
/// Four rather than one because they are distinguishable at run time —
/// `assert.throws(fn, TypeError)` is an `instanceof` check, and code that
/// branches on which error it caught is ordinary. They hold the same two
/// fields, so this is a list rather than four definitions.
pub(super) const ERRORS: &[&str] = &["Error", "TypeError", "RangeError", "URIError"];

/// Members of the declared `Error` that this compiler does not provide.
///
/// Named, rather than left to fail as "a property the type does not declare",
/// so that reading one says *why* it is absent.
pub(super) const OMITTED: &[(&str, &str)] = &[
    (
        "stack",
        "a compiled binary keeps no record of the frames it came through",
    ),
    (
        "cause",
        "the chained error would have to be a reference to any error type",
    ),
];

/// Whether a name is one of the provided error classes.
pub(super) fn is_error(name: &str) -> bool {
    ERRORS.contains(&name)
}

/// Why a member of the declared `Error` is absent here, if it is one.
pub(super) fn omitted(name: &str) -> Option<&'static str> {
    OMITTED
        .iter()
        .find(|(member, _)| *member == name)
        .map(|(_, reason)| *reason)
}

/// What every provided error class holds.
///
/// `name` is a field rather than a constant on the layout because constructors
/// write it: a subclass that wants `e.name` to be its own sets `this.name`
/// after `super(...)`, which is what Node's error classes do.
///
/// Neither is `readonly`: `e.message = ...` is legal JavaScript, and a
/// `readonly` field here would be a claim about the program rather than about
/// the type.
pub(super) fn error_fields() -> Vec<Field> {
    ["message", "name"]
        .into_iter()
        .map(|name| Field {
            name: name.to_owned(),
            ty: HirType::Managed(ManagedType::String),
            readonly: false,
        })
        .collect()
}

/// What each typed array stores, if the name is one.
///
/// A typed array needs no representation of its own: it is an ordinary
/// [`ManagedType::Array`] whose element width was *written down* rather than
/// inferred. `hir::elements` decides that a `number[]` holding small whole
/// numbers can be an `int32_t[]`; `Int32Array` is the same storage, chosen by
/// the author instead of proved by the compiler. So the descriptors, the bounds
/// checks, the escape analysis and the reference counting all already work on
/// one.
///
/// `Uint8ClampedArray` is deliberately absent. It stores by *clamping* to
/// `[0, 255]` where the others wrap, and giving it the wrapping conversion
/// would be silently wrong for exactly the inputs anyone would notice.
/// `BigInt64Array` and `BigUint64Array` are absent because `bigint` is.
pub(super) fn typed_array_element(name: &str) -> Option<HirType> {
    let int = |bits, signed| HirType::Int { bits, signed };
    Some(match name {
        "Int8Array" => int(8, true),
        "Uint8Array" => int(8, false),
        "Int16Array" => int(16, true),
        "Uint16Array" => int(16, false),
        "Int32Array" => int(32, true),
        "Uint32Array" => int(32, false),
        "Float32Array" => HirType::Float { bits: 32 },
        "Float64Array" => HirType::Float { bits: 64 },
        _ => return None,
    })
}

/// The runtime helper that turns a `number` into what a typed array stores.
///
/// Storing into an integer typed array is not a cast. `u8[i] = 300` stores 44,
/// `i32[i] = 1.7` stores 1, and `u8[i] = NaN` stores 0 — ECMAScript truncates
/// toward zero and then takes the value modulo the width, with the
/// non-finite cases going to zero. C's `(uint8_t)someDouble` is *undefined
/// behaviour* for every one of those inputs, so the conversion is a named
/// helper rather than a cast the backend guesses at.
///
/// `None` for the floating-point arrays: `double` to `float` is a defined
/// narrowing conversion and `double` to `double` is nothing at all.
pub(super) fn element_coercion(element: &HirType) -> Option<&'static str> {
    match element {
        HirType::Int { bits: 8, signed: true } => Some("nts_to_int8"),
        HirType::Int { bits: 8, signed: false } => Some("nts_to_uint8"),
        HirType::Int { bits: 16, signed: true } => Some("nts_to_int16"),
        HirType::Int { bits: 16, signed: false } => Some("nts_to_uint16"),
        HirType::Int { bits: 32, signed: true } => Some("nts_to_int32"),
        HirType::Int { bits: 32, signed: false } => Some("nts_to_uint32"),
        _ => None,
    }
}
