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
    ("nts_array_at_foreign", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_at_ref", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_at_value", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_concat", &[None, None], None),
    ("nts_array_concat_foreign", &[None, None], None),
    ("nts_array_concat_ref", &[None, None], None),
    ("nts_array_concat_value", &[None, None], None),
    ("nts_array_element", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_extend", &[None, None], None),
    ("nts_array_extend_foreign", &[None, None], None),
    ("nts_array_extend_ref", &[None, None], None),
    ("nts_array_fill", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_fill_bool", &[None, Some(HirType::Bool)], None),
    ("nts_array_includes", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_array_includes_ref", &[None, None], Some(HirType::Bool)),
    ("nts_array_includes_str", &[None, None], Some(HirType::Bool)),
    ("nts_array_includes_str_value", &[None, None], Some(HirType::Bool)),
    ("nts_array_index_of", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_index_of_ref", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_index_of_str", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_index_of_str_value", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_last_index_of", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_new", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_new_uninitialized", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_pop", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_array_push", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_array_push_ref", &[None, None], Some(HirType::Float { bits: 64 })),
    // `push` on an array whose *elements* are erased. `unknown[]` and an array of
    // a union are the shapes; the element is a sixteen-byte `NtsValue`, which is
    // why it needs a row of its own rather than the widths above.
    ("nts_array_push_value", &[None, None], Some(HirType::Float { bits: 64 })),
    ("nts_array_set_length", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_set_length_foreign", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_set_length_ref", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_set_length_value", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_array_shift", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_array_shift_ref", &[None], None),
    ("nts_array_shift_value", &[None], None),
    ("nts_array_slice", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_array_slice_foreign", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
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
    ("nts_block_carry", &[None, None, Some(HirType::Int { bits: 64, signed: false }), None, Some(HirType::Int { bits: 32, signed: false }), None], None),
    ("nts_bool_to_string", &[Some(HirType::Bool)], None),
    ("nts_bounds", &[Some(HirType::Float { bits: 64 }), Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_callback_task", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Bool)], None),
    ("nts_check", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_check_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_checkpoint_after_callbacks", &[Some(HirType::Bool)], None),
    ("nts_clear_timeout", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_closure_lend", &[None], None),
    ("nts_closure_lend_once", &[None], None),
    ("nts_closure_notify", &[], None),
    ("nts_closure_unlend", &[None], None),
    ("nts_closure_unlend_once", &[None], None),
    ("nts_com_carry", &[None, None, Some(HirType::Int { bits: 64, signed: false }), None, Some(HirType::Int { bits: 32, signed: false }), None], None),
    ("nts_com_compose_named", &[None], None),
    ("nts_com_delegate", &[None, None, None, Some(HirType::Int { bits: 64, signed: false }), Some(HirType::Int { bits: 64, signed: false })], None),
    ("nts_com_query", &[None, Some(HirType::Int { bits: 64, signed: false }), Some(HirType::Int { bits: 64, signed: false })], None),
    ("nts_cstring_release", &[None, None], None),
    ("nts_cstrings_release", &[None], None),
    ("nts_cycle_candidates", &[], Some(HirType::Int { bits: 64, signed: false })),
    ("nts_date_new", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_date_value", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_delay", &[Some(HirType::Float { bits: 64 })], Some(HirType::Float { bits: 64 })),
    ("nts_has_pending_work", &[], Some(HirType::Bool)),
    ("nts_hresult_message", &[Some(HirType::Int { bits: 32, signed: true })], None),
    ("nts_index", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_index_fn", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_is_array", &[None], Some(HirType::Bool)),
    ("nts_is_buffer", &[None], Some(HirType::Bool)),
    ("nts_is_data_view", &[None], Some(HirType::Bool)),
    ("nts_is_date", &[None], Some(HirType::Bool)),
    ("nts_is_finite", &[Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_is_integer", &[Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_is_map", &[None], Some(HirType::Bool)),
    ("nts_is_owner_thread", &[], Some(HirType::Bool)),
    ("nts_is_promise", &[None], Some(HirType::Bool)),
    ("nts_is_safe_integer", &[Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_is_set", &[None], Some(HirType::Bool)),
    ("nts_is_view_kind", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
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
    ("nts_number_to_fixed", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_number_to_string", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_number_to_string_into", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_number_to_string_radix", &[Some(HirType::Float { bits: 64 }), Some(HirType::Float { bits: 64 })], None),
    ("nts_post_delayed", &[None, Some(HirType::Float { bits: 64 }), Some(HirType::Bool)], None),
    ("nts_presence_clear", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_presence_clear_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_presence_has", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Bool)),
    ("nts_presence_has_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Bool)),
    ("nts_presence_has_value", &[None, Some(HirType::Int { bits: 32, signed: false })], Some(HirType::Bool)),
    ("nts_presence_init", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_presence_init_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_presence_set", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_presence_set_fn", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_promise_fulfill_number", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_promise_fulfill_pointer", &[None, None], None),
    ("nts_promise_fulfill_tagged", &[None, None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_promise_is_rejected", &[None], Some(HirType::Bool)),
    ("nts_promise_number", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_promise_pointer", &[None], None),
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
    ("nts_str_to_number", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_str_to_upper_case", &[None], None),
    ("nts_str_to_well_formed", &[None], None),
    ("nts_string_eq", &[None, None], Some(HirType::Bool)),
    ("nts_string_from_char_code", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_char_code_into", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_code_point", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_code_point_into", &[None, Some(HirType::Float { bits: 64 })], None),
    ("nts_string_from_cstring", &[None], None),
    ("nts_string_from_required_cstring", &[None], None),
    ("nts_string_from_utf8", &[None, Some(HirType::Int { bits: 64, signed: false })], None),
    ("nts_string_to_cstring", &[None], None),
    ("nts_string_to_utf16", &[None], None),
    ("nts_string_truthy", &[None], Some(HirType::Bool)),
    ("nts_strings_from_cstrings", &[None, Some(HirType::Bool)], None),
    ("nts_strings_to_cstrings", &[None], None),
    ("nts_symbol_description", &[None], None),
    ("nts_symbol_for", &[None], None),
    ("nts_symbol_key_for", &[None], None),
    ("nts_symbol_new", &[None], None),
    ("nts_symbol_to_string", &[None], None),
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
    ("nts_utf16_release", &[None, None], None),
    ("nts_value_boolean", &[None], Some(HirType::Bool)),
    ("nts_value_eq_boolean", &[None, Some(HirType::Bool)], Some(HirType::Bool)),
    ("nts_value_eq_boolean_fn", &[None, Some(HirType::Bool)], Some(HirType::Bool)),
    ("nts_value_eq_number", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_value_eq_number_fn", &[None, Some(HirType::Float { bits: 64 })], Some(HirType::Bool)),
    ("nts_value_eq_reference", &[None, None], Some(HirType::Bool)),
    ("nts_value_eq_string", &[None, None], Some(HirType::Bool)),
    ("nts_value_is_view", &[None], Some(HirType::Bool)),
    ("nts_value_number", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_value_of_boolean", &[Some(HirType::Bool)], None),
    ("nts_value_of_number", &[Some(HirType::Float { bits: 64 })], None),
    ("nts_value_of_reference", &[None, Some(HirType::Int { bits: 32, signed: false })], None),
    ("nts_value_strict_eq", &[None, None], Some(HirType::Bool)),
    ("nts_value_tag", &[None], Some(HirType::Int { bits: 32, signed: false })),
    ("nts_value_to_number", &[None], Some(HirType::Float { bits: 64 })),
    ("nts_value_truthy", &[None], Some(HirType::Bool)),
    ("nts_value_truthy_fn", &[None], Some(HirType::Bool)),
    ("nts_view_unlend", &[None], None),
    ("nts_winrt_activate", &[None, Some(HirType::Int { bits: 64, signed: false }), Some(HirType::Int { bits: 64, signed: false })], None),
    ("nts_winrt_factory", &[None, Some(HirType::Int { bits: 64, signed: false }), Some(HirType::Int { bits: 64, signed: false })], None),
];

#[must_use]
fn declared(name: &str) -> Option<&'static Declared> {
    SIGNATURES
        .binary_search_by(|(known, _, _)| (*known).cmp(name))
        .ok()
        .map(|at| &SIGNATURES[at])
}

/// Every helper name this table declares, in its sorted order.
///
/// Exposed so a classification elsewhere can be **asserted against the table**
/// rather than hand-maintained beside it. `hir::changes_array_length` is the
/// case that motivated it: a literal list of five prefixes whose omission does
/// not fail at the list, because a helper missing from it produces a working
/// helper and a whole-program array representation that cannot express what it
/// does.
pub fn declared_names() -> impl Iterator<Item = &'static str> {
    SIGNATURES.iter().map(|it| it.0)
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
/// The canonical name of a bound Java member, used as a `Callee::External`
/// name.
///
/// `java/io/OutputStream.write:([B)V` -- owner, member, descriptor, in the
/// spelling the class file uses.
///
/// **One derivation, because two would drift.** The binding generator writes
/// this key and [`keeps`] reads it; if each built its own, a disagreement would
/// surface as a silently-missing escape answer -- the argument would be assumed
/// to escape, the program would stay correct, and the optimisation would just
/// never happen. That is the worst kind of divergence: it costs speed and
/// reports nothing.
///
/// **Keyed by descriptor rather than by a resolved id**, which is the JVM
/// lane's call and the reason is that a descriptor is what the class file
/// guarantees where an id is a fact about our loader. It also has to be the
/// descriptor because an overload set shares a name: without it there is no way
/// to say that `write([B)V` keeps nothing while `write([BII)V` does.
#[must_use]
pub fn foreign_key(owner: &str, member: &str, descriptor: &str) -> String {
    format!("{owner}.{member}:{descriptor}")
}

/// Whether a `Callee::External` name is a bound Java member rather than one of
/// our runtime helpers.
///
/// By shape rather than by a flag, matching `is_signature_name`'s precedent in
/// `lower`: a runtime helper is a C identifier and can contain neither `/` nor
/// `:`, and a JVM binary name always contains a `/` for anything outside the
/// default package.
/// Whether a **layout** stands for a class in somebody's jar.
///
/// The `/` is the whole test: a name this compiler generates is a TypeScript
/// identifier and cannot contain one, while a bound class is named by its JVM
/// binary name -- `com/example/Catalog`.
///
/// **One definition because there were two.** `hir::lower`'s `is_foreign_name`
/// and `codegen/jvm`'s `types::class_name` each had this test written out, and
/// the second carried a comment asserting it matched the first. A comment is
/// not an agreement: it cannot fail when one of them changes. Both now call
/// here.
#[must_use]
pub fn is_foreign_layout_name(name: &str) -> bool {
    name.contains('/')
}

#[must_use]
pub fn is_foreign_key(name: &str) -> bool {
    name.contains(':') && name.contains('/')
}

/// How a bound foreign member is invoked, and what it retains.
///
/// One row of the binding table `nts bind` writes beside a `.d.ts`. The kind
/// cannot live in the key -- a key that names one method twice is not an
/// identity, and [`keeps`] looks up the same string -- so it travels here, from
/// the same rows, read once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForeignCall {
    /// `owner.member:descriptor`, the shape [`foreign_key`] builds.
    pub key: String,
    /// Which JVM instruction this becomes. A backend that cannot classify a row
    /// refuses by name rather than guessing `invokevirtual`: getting virtual
    /// and interface the wrong way round is an `IncompatibleClassChangeError`
    /// at link time, in the user's program.
    pub kind: ForeignKind,
}

/// Every bound member in a program, keyed by `(source, span end)` of the
/// declaration the checker resolved to.
///
/// A named alias because the bare `FxHashMap` in a parameter position fixes
/// the hasher for every caller, which clippy's `implicit_hasher` is right
/// about -- and because the key is the load-bearing half: two tables of bound
/// members exist and they are keyed differently on purpose.
pub type ForeignTable = rustc_hash::FxHashMap<(u32, u32), ForeignCall>;

/// The six ways a bound member is reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForeignKind {
    Static,
    Virtual,
    Interface,
    Special,
    Field,
    StaticField,
}

impl ForeignKind {
    /// Parse the spelling `nts bind` writes.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "static" => Self::Static,
            "virtual" => Self::Virtual,
            "interface" => Self::Interface,
            "special" => Self::Special,
            "field" => Self::Field,
            "staticfield" => Self::StaticField,
            _ => return None,
        })
    }
}

/// What a **bound Java member** retains, if anything is known about it.
///
/// Always `None` today, and that is the sound default: an absent entry means
/// "assume every argument escapes", which is never wrong, only pessimistic.
/// The entries arrive from two places, neither of which exists yet -- a
/// bytecode analysis over the callee, and a checked-in overrides file for the
/// `native` methods that have no bytecode to analyse.
///
/// Separate from [`keeps`] rather than folded into it, because the two have
/// different lifetimes: that table is a fact about a header this repository
/// owns, and this one is a fact about somebody else's jar.
#[must_use]
pub fn foreign_keeps(_key: &str) -> Option<&'static [usize]> {
    None
}

#[must_use]
pub fn keeps(name: &str) -> Option<&'static [usize]> {
    // A bound Java member is not in the table below and never will be: that
    // table is this repository's own helpers. Asking the foreign table first
    // keeps `escape`'s single call site unchanged -- it already asks `keeps`
    // and already treats `None` as "everything escapes".
    if is_foreign_key(name) {
        return foreign_keeps(name);
    }
    match name {
        // Both read, neither kept: the result is a fresh string.
        "nts_concat" | "nts_string_eq" | "nts_str_index_of" | "nts_str_last_index_of"
        | "nts_str_includes" | "nts_str_starts_with" | "nts_str_ends_with" => Some(&[]),
        // The left is consumed and the result may *be* it, so it is kept; the
        // right is only read.
        "nts_str_append" => Some(&[0]),
        // The presence helpers touch one word of the header and keep nothing.
        //
        // Saying so is what lets the object stay on the stack. Without it,
        // handing the receiver to a call is an escape, and **every object with
        // an optional property somebody asks about moved to the heap**: the
        // memory suite's `deleted-field` and `optional-unassigned` both went
        // from 0 allocations to 17, which is the whole of what those cases
        // measure. The helpers are `static inline` in C, so the call the
        // analysis was reasoning about is not even emitted there.
        name if name.starts_with("nts_presence_") => Some(&[]),
        // Reads the result slot an `@ntsHresult` call wrote, which is the
        // caller's local, and keeps nothing of it.
        "nts_com_take" => Some(&[]),
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

/// Runtime helpers that **read and do not store**.
///
/// The header marks them `NTS_READS_ONLY`, which is `__attribute__((pure))`,
/// and `tests/runtime_signatures.rs` checks this list against it — so a helper
/// that gains or loses the attribute cannot leave the two disagreeing.
///
/// # What reads it
///
/// `own::mutating`, which decides whether a borrow survives a call. Its own
/// comment named this gap: *"An external call has no body in this program, so
/// it mutates too. That second one is coarser than it needs to be… Until it
/// does, an external call ends a borrow."*
///
/// The cost of that coarseness, measured on `tooling/memory/cases/dates`:
/// reading `this.atime` to hand to `nts_date_value` — a helper that loads a
/// double and returns it — took a retain and a release per iteration, **34 of
/// that case's 51 operations**.
///
/// `nts_date_value` is how it was found and is one of twenty-eight. The header
/// has marked the rest of them for a long time and nothing on this side read
/// it, so every `xs.indexOf`, `s.startsWith`, `m.has` and `xs.at` ended a
/// borrow it had no way to invalidate.
pub const READS_ONLY: &[&str] = &[
    "nts_array_at",
    "nts_array_at_ref",
    "nts_array_at_value",
    "nts_array_includes",
    "nts_array_includes_ref",
    "nts_array_includes_str",
    "nts_array_includes_str_value",
    "nts_array_index_of",
    "nts_array_index_of_ref",
    "nts_array_index_of_str",
    "nts_array_index_of_str_value",
    "nts_array_last_index_of",
    "nts_buffer_byte_length",
    "nts_buffer_detached",
    "nts_buffer_max_byte_length",
    "nts_buffer_resizable",
    // A view reads its buffer and does not retain it: `byteLength` on a
    // tracking view is a subtraction, `byteOffset` a field, and `buffer` hands
    // back a reference the view already holds.
    "nts_dataview_byte_length",
    "nts_dataview_byte_offset",
    // The bigint pair is `pure` for a reason the rest of the family does not
    // need stated: it returns `__int128` **by value**, so unlike every other
    // helper that yields a `bigint` it allocates nothing and there is nothing
    // for a folded-away second call to leak. Both were marked in the header and
    // neither was listed here, which is a missed elision rather than a hazard --
    // and it survived a commit because the two lists are checked by a test and
    // the commit wrapper runs clippy, not tests.
    "nts_dataview_get_bigint64",
    "nts_dataview_get_biguint64",
    "nts_dataview_get_float32",
    "nts_dataview_get_float64",
    "nts_dataview_get_int16",
    "nts_dataview_get_int32",
    "nts_dataview_get_int8",
    "nts_dataview_get_uint16",
    "nts_dataview_get_uint32",
    "nts_dataview_get_uint8",
    "nts_date_value",
    "nts_is_array",
    "nts_is_buffer",
    "nts_is_class",
    "nts_is_data_view",
    "nts_is_date",
    "nts_is_map",
    "nts_is_promise",
    "nts_is_set",
    "nts_is_view_kind",
    "nts_landing_detail",
    "nts_landing_thrown",
    "nts_promise_reason",
    "nts_promise_state",
    "nts_thrown_class",
    "nts_to_index",
    "nts_value_is_view",
    "nts_value_number_or",
    "nts_value_to_number",
    "nts_view_byte_length",
    "nts_view_byte_offset",
    "nts_view_bytes",
    "nts_view_get",
    "nts_view_length",
    "nts_map_has",
    "nts_map_next",
    "nts_str_char_code_at_fn",
    "nts_str_char_code_at_int_fn",
    "nts_str_code_point_at",
    "nts_str_ends_with",
    "nts_str_includes",
    "nts_str_index_of",
    "nts_str_last_index_of",
    "nts_str_point_width",
    "nts_str_starts_with",
    "nts_string_truthy",
    "nts_unit_fn",
    "nts_value_eq_boolean_fn",
    "nts_value_eq_number_fn",
    "nts_value_truthy_fn",
];

/// Whether a runtime helper is one a borrow survives.
#[must_use]
pub fn reads_only(name: &str) -> bool {
    READS_ONLY.contains(&name)
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

#[cfg(test)]
mod foreign_key_tests {
    use super::{foreign_key, is_foreign_key, keeps};

    #[test]
    fn the_key_carries_the_descriptor_because_overloads_share_a_name() {
        let one = foreign_key("java/io/OutputStream", "write", "([B)V");
        let three = foreign_key("java/io/OutputStream", "write", "([BII)V");
        assert_eq!(one, "java/io/OutputStream.write:([B)V");
        // The whole reason the descriptor is in the key: these are different
        // methods with one name, and they can retain different arguments.
        assert_ne!(one, three);
    }

    #[test]
    fn a_foreign_key_is_told_from_a_helper_by_shape() {
        assert!(is_foreign_key("java/io/OutputStream.write:([B)V"));
        assert!(is_foreign_key("android/view/View.setOnTouchListener:(L;)V"));

        // A runtime helper is a C identifier: no `/`, no `:`. These are the
        // names already in `keeps`, and treating one as foreign would route it
        // to a table that knows nothing and silently lose its answer.
        assert!(!is_foreign_key("nts_str_append"));
        assert!(!is_foreign_key("nts_presence_get"));
        assert!(!is_foreign_key("nts_concat"));
    }

    #[test]
    fn routing_a_foreign_key_does_not_disturb_the_helpers() {
        // The control, and it is the one that matters: every existing answer
        // must be unchanged. `nts_str_append` keeps its left argument and
        // `nts_concat` keeps nothing, both from the table below.
        assert_eq!(keeps("nts_str_append"), Some(&[0][..]));
        assert_eq!(keeps("nts_concat"), Some(&[][..]));
        assert_eq!(keeps("nts_presence_has"), Some(&[][..]));
        assert_eq!(keeps("something_unknown"), None);

        // And a foreign key answers `None` -- assume everything escapes, which
        // is sound and is what happens until a binding table exists.
        assert_eq!(keeps("java/io/OutputStream.write:([B)V"), None);
    }
}
