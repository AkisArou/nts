//! What the C runtime declares its parameters to be.
//!
//! # Why the middle end knows this
//!
//! A runtime helper's signature is C's and fixed: `nts_array_new` takes a
//! `double` length whatever specialization narrowed ours to, and something has
//! to convert. C does it at the call and says nothing, so the C backend never
//! had to; the LLVM backend wrote it out, and for a while it was the only place
//! the conversion existed.
//!
//! One conversion, written in two backends, is two chances to write it
//! differently -- which is exactly how `store i64` ended up in an array of
//! doubles. So it is inserted here instead, once, and both backends read it.
//!
//! # Why the types carry signedness and the LLVM table does not
//!
//! `i32` is both `int32_t` and `uint32_t`, and the difference is `fptosi`
//! against `fptoui` -- which reads 4294967295 as -1. The LLVM signature table
//! cannot answer it. These come from clang's AST dump of the same header, where
//! the C spelling survives.
//!
//! `None` is a parameter that is not a scalar: a pointer or an `NtsValue`,
//! neither of which is converted on the way in.
//!
//! `static inline` helpers are here too. The LLVM backend cannot *call* one --
//! there is no symbol -- but the C backend can, and its argument needs the same
//! conversion. Leaving them out left ten `nts_value_of_number(int32_t)` calls
//! converting implicitly in the generated C.
//!
//! Generated; `tests/runtime_signatures.rs` checks it against the header.

use super::HirType;

/// One helper: its name, its parameters, and what it returns.
///
/// `None` in either position is something that is not a scalar -- a pointer or
/// an `NtsValue` -- which is not converted on the way in or out.
type Declared = (&'static str, &'static [Option<HirType>], Option<HirType>);

/// Every helper, sorted by name so a lookup is a binary search.
static SIGNATURES: &[Declared] = &[
    ("nts_alloc", &[Some(HirType::Int { bits: 64, signed: false })], None),
    ("nts_array_at", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_at_ref", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_at_value", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_concat", &[None, None], None),
    ("nts_array_concat_ref", &[None, None], None),
    ("nts_array_extend", &[None, None], None),
    ("nts_array_extend_ref", &[None, None], None),
    ("nts_array_fill", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_fill_bool", &[None, Some(HirType::Bool)], None),
    ("nts_array_includes", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_array_includes_ref", &[None, None], Some(HirType::Bool)),
    ("nts_array_includes_str", &[None, None], Some(HirType::Bool)),
    ("nts_array_index_of", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_index_of_ref", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_index_of_str", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_last_index_of", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_new", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_new_uninitialized", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_pop", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_array_push", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_push_ref", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_shift", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_array_shift_ref", &[None], None),
    ("nts_array_shift_value", &[None], None),
    ("nts_array_slice", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_array_slice_ref", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_array_splice", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_array_splice_ref", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_array_unshift", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_unshift_ref", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_bigint_as_intn", &[Some(HirType::Float { bits: 64 }), Some(HirType::BigInt)], Some(HirType::BigInt)),
    ("nts_bigint_as_uintn", &[Some(HirType::Float { bits: 64 }), Some(HirType::BigInt)], Some(HirType::BigInt)),
    ("nts_bigint_from_number", &[Some(HirType::Float { bits: 64 })], Some(HirType::BigInt)),
    ("nts_bigint_shl", &[Some(HirType::BigInt), Some(HirType::BigInt)], Some(HirType::BigInt)),
    ("nts_bigint_shr", &[Some(HirType::BigInt), Some(HirType::BigInt)], Some(HirType::BigInt)),
    ("nts_bigint_to_string", &[Some(HirType::BigInt)], None),
    ("nts_bool_to_string", &[Some(HirType::Bool)], None),
    ("nts_bounds", &[Some(HirType::Float { bits: 64 }), Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_callback_task", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Bool)], None),
    ("nts_check", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_check_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_clear_timeout", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_cycle_candidates", &[], Some(HirType::Int { bits: 64, signed: false })),
    ("nts_delay", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_has_pending_work", &[], Some(HirType::Bool)),
    ("nts_index", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_index_fn", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_is_finite", &[Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_is_integer", &[Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_is_owner_thread", &[], Some(HirType::Bool)),
    ("nts_is_safe_integer", &[Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_live_bytes", &[], Some(HirType::Int { bits: 64, signed: false })),
    ("nts_live_count", &[], Some(HirType::Int { bits: 64, signed: false })),
    ("nts_map_delete", &[None, None], Some(HirType::Bool)),
    ("nts_map_has", &[None, None], Some(HirType::Bool)),
    ("nts_map_key_at", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_map_new", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_map_next", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_map_value_at", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_math_acos", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_asin", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_atan", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_atan2", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_cbrt", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_cos", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_cosh", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_exp", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_expm1", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_fround", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_hypot", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_log", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_log10", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_log1p", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_log2", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_pow", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_sign", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_sin", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_sinh", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_tan", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_math_tanh", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_max", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_max_fn", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_min", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_min_fn", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_number_to_string", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_number_to_string_into", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_post_delayed", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Bool)], None),
    ("nts_promise_fulfill_number", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_promise_fulfill_tagged", &[None, None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_promise_is_rejected", &[None], Some(HirType::Bool)),
    ("nts_promise_number", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_round", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_round_fn", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_set_new", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_set_timeout", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 }), Some(HirType::Bool)], Some(HirType::Float { bits: 64 })),
    ("nts_shl", &[Some(HirType::Int { bits: 32, signed: true }), Some(HirType::Int { bits: 32, signed: true })], Some(HirType::Int { bits: 32, signed: true })),
    ("nts_shr", &[Some(HirType::Int { bits: 32, signed: true }), Some(HirType::Int { bits: 32, signed: true })], Some(HirType::Int { bits: 32, signed: true })),
    ("nts_str_append", &[None, None], None),
    ("nts_str_at", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_str_at_into", &[None, None, Some(HirType::Float { bits: 64 })], None),
    ("nts_str_char_at", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_str_char_at_into", &[None, None, Some(HirType::Float { bits: 64 })], None),
    ("nts_str_char_code_at", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_str_char_code_at_fn", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_str_char_code_at_int", &[None, Some(HirType::Int { bits: 64, signed: true })], Some(HirType::Float { bits: 64 })),
    ("nts_str_char_code_at_int_fn", &[None, Some(HirType::Int { bits: 64, signed: true })], Some(HirType::Float { bits: 64 })),
    ("nts_str_code_point_at", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_str_ends_with", &[None, None], Some(HirType::Bool)),
    ("nts_str_includes", &[None, None], Some(HirType::Bool)),
    ("nts_str_index_of", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_str_index_of_from", &[None, None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_str_is_well_formed", &[None], Some(HirType::Bool)),
    ("nts_str_last_index_of", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_str_pad_end", &[None, Some(HirType::Float { bits: 64 }), None], None),
    ("nts_str_pad_start", &[None, Some(HirType::Float { bits: 64 }), None], None),
    ("nts_str_point_width", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_str_repeat", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_str_slice", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_str_slice_into", &[None, None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_str_starts_with", &[None, None], Some(HirType::Bool)),
    ("nts_str_substring", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_str_substring_general", &[None, None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_str_substring_into", &[None, None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_str_substring_into_fn", &[None, None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_str_to_lower_case", &[None], None),
    ("nts_str_to_upper_case", &[None], None),
    ("nts_str_to_well_formed", &[None], None),
    ("nts_string_eq", &[None, None], Some(HirType::Bool)),
    ("nts_string_from_char_code", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_char_code_into", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_code_point", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_utf8", &[None, Some(HirType::Int { bits: 64, signed: false })], None),
    ("nts_string_truthy", &[None], Some(HirType::Bool)),
    ("nts_tag_name", &[Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_tag_of_reference", &[None], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_to_int16", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 16, signed: true })),
    ("nts_to_int32", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: true })),
    ("nts_to_int32_fn", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: true })),
    ("nts_to_int8", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 8, signed: true })),
    ("nts_to_integer", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_to_uint16", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 16, signed: false })),
    ("nts_to_uint32", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_to_uint32_fn", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_to_uint8", &[Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 8, signed: false })),
    ("nts_unit", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Int { bits: 16, signed: false })),
    ("nts_unit_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Int { bits: 16, signed: false })),
    ("nts_ushr", &[Some(HirType::Int { bits: 32, signed: true }), Some(HirType::Int { bits: 32, signed: true })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_value_boolean", &[None], Some(HirType::Bool)),
    ("nts_value_eq_boolean", &[None, Some(HirType::Bool)], Some(HirType::Bool)),
    ("nts_value_eq_boolean_fn", &[None, Some(HirType::Bool)], Some(HirType::Bool)),
    ("nts_value_eq_number", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_value_eq_number_fn", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_value_eq_reference", &[None, None], Some(HirType::Bool)),
    ("nts_value_eq_string", &[None, None], Some(HirType::Bool)),
    ("nts_value_number", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_value_of_boolean", &[Some(HirType::Bool)], None),
    ("nts_value_of_number", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_value_of_reference", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_value_strict_eq", &[None, None], Some(HirType::Bool)),
    ("nts_value_tag", &[None], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_value_truthy", &[None], Some(HirType::Bool)),
    ("nts_value_truthy_fn", &[None], Some(HirType::Bool)),
];

#[must_use]
fn declared(name: &str) -> Option<&'static Declared> {
    SIGNATURES
        .binary_search_by(|(known, _, _)| (*known).cmp(name))
        .ok()
        .map(|at| &SIGNATURES[at])
}

/// What `name` declares its parameters to be, if the runtime declares it.
#[must_use]
pub fn parameters(name: &str) -> Option<&'static [Option<HirType>]> {
    declared(name).map(|it| it.1)
}

/// What `name` declares it returns, where that is a scalar.
///
/// `nts_math_pow` returns a `double` and the operation that calls it carries
/// `bigint`, so the result needs converting as much as the arguments did -- and
/// C did that at the assignment without being asked, which is the whole shape
/// of this file.
#[must_use]
pub fn result(name: &str) -> Option<&'static HirType> {
    declared(name).and_then(|it| it.2.as_ref())
}

/// Argument slots a runtime helper may let outlive the call.
///
/// `escape` escapes every argument of every external call, because a body it
/// cannot see could do anything with what it is handed. These it can see: they
/// are in `runtime/c`, and what they do with a string is *read* it.
///
/// That blanket was measured once and found to cost nothing, on a suite where
/// no case handed a string to a helper. `out += String.fromCharCode(c)` is that
/// case: the one-unit string on the right dies on the next line, and could sit
/// in the frame if anything knew that `nts_str_append` does not keep it.
///
/// `None` is the honest default and means every argument. An entry is a promise
/// about a function in this repository, checked by nothing but the reading of
/// it, so the list is short and only grows where a measurement asks.
#[must_use]
pub fn keeps(name: &str) -> Option<&'static [usize]> {
    match name {
        // Both read, neither kept: the result is a fresh string.
        "nts_concat" | "nts_string_eq" | "nts_str_index_of" | "nts_str_last_index_of"
        | "nts_str_includes" | "nts_str_starts_with" | "nts_str_ends_with" => Some(&[]),
        // The left is consumed and the result may *be* it, so it is kept; the
        // right is only read.
        "nts_str_append" => Some(&[0]),
        _ => None,
    }
}

/// The name of a helper's frame-placed form.
///
/// `nts_str_slice_into` is a real function; `nts_str_substring_into` is a
/// `static inline` fast path with a linkable companion beside it. Preferring
/// the plain `_into` and falling back to `_into_fn` picks whichever exists.
#[must_use]
pub fn into_form(target: &str) -> String {
    let into = format!("{target}_into");
    if parameters(&into).is_some() {
        into
    } else {
        format!("{into}_fn")
    }
}

#[cfg(test)]
mod tests {
    use super::SIGNATURES;

    /// The same guard the LLVM backend's table has, and for the same reason it
    /// was written there: [`declared`] is a binary search, an unsorted entry
    /// answers `None`, and `None` here does not fail -- it means "the runtime
    /// does not declare this", which is a sentence about the runtime that is
    /// simply false.
    ///
    /// What it costs is quiet. `parameters` answering `None` makes
    /// [`into_form`] fall back to the `_into_fn` spelling; `result` answering
    /// `None` skips a conversion the operation needed. Neither says anything.
    ///
    /// It had drifted in six places when this was added -- among them
    /// `nts_bigint_from_number`, three rows after `nts_bigint_shr` -- and the
    /// LLVM table's copy of this test had been catching its own version of the
    /// same mistake for some time. One table had a guard and the other did not.
    #[test]
    fn the_table_is_sorted_because_it_is_binary_searched() {
        for pair in SIGNATURES.windows(2) {
            assert!(
                pair[0].0 < pair[1].0,
                "signatures out of order: `{}` must come after `{}`",
                pair[0].0,
                pair[1].0
            );
        }
    }
}
