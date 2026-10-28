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

/// One helper: name, optional scalar ABI normalization, result, and raising.
/// Pointer/erased-only additions need no normalization record; this preserves
/// the existing ABI conversion view while the effect catalog covers all helpers.
///
/// `None` in either position is something that is not a scalar -- a pointer or
/// an `NtsValue` -- which is not converted on the way in or out.
type Declared = (
    &'static str,
    Option<&'static [Option<HirType>]>,
    Option<HirType>,
    Raising,
);

/// Language-level raising behavior. A host refusal or allocation failure is
/// not a catchable JavaScript value; a helper which always ends the process
/// has no returning or exceptional edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Raising {
    NoRaise,
    MayRaise,
    Diverges,
}

/// Every helper, sorted by name so a lookup is a binary search.
static SIGNATURES: &[Declared] = &[
    (
        "nts_access_key_description",
        Some(&[None]),
        None,
        Raising::MayRaise,
    ),
    (
        "nts_alloc",
        Some(&[Some(HirType::Int {
            bits: 64,
            signed: false,
        })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_append_slot", None, None, Raising::NoRaise),
    (
        "nts_array_at",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_array_at_element",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_at_foreign",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_at_ref",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_at_value",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_concat",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_concat_foreign",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_concat_ref",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_concat_value",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_element",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_extend",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_extend_foreign",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_extend_ref",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_fill",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_fill_bool",
        Some(&[None, Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_array_fill_foreign", None, None, Raising::NoRaise),
    ("nts_array_fill_from_nsarray", None, None, Raising::NoRaise),
    ("nts_array_fill_ref", None, None, Raising::NoRaise),
    (
        "nts_array_fill_strings_from_nsarray",
        None,
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_from_handles",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            None,
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_array_handles", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_array_includes",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_array_includes_ref",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_array_includes_str",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_array_includes_str_value",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_array_index_of",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_array_index_of_ref",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_array_index_of_str",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_array_index_of_str_value",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_array_join_num", None, None, Raising::NoRaise),
    ("nts_array_join_str", None, None, Raising::NoRaise),
    ("nts_array_keep_first", None, None, Raising::NoRaise),
    (
        "nts_array_last_index_of",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_array_last_index_of_ref", None, None, Raising::NoRaise),
    ("nts_array_last_index_of_str", None, None, Raising::NoRaise),
    (
        "nts_array_length",
        Some(&[None]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_array_mark_null_slots", None, None, Raising::NoRaise),
    (
        "nts_array_new",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_new_uninitialized",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_array_of_numbers", None, None, Raising::NoRaise),
    ("nts_array_of_values", None, None, Raising::NoRaise),
    (
        "nts_array_pop",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_array_pop_ref", None, None, Raising::NoRaise),
    ("nts_array_pop_value", None, None, Raising::NoRaise),
    (
        "nts_array_push",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_array_push_ref",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    // `push` on an array whose *elements* are erased. `unknown[]` and an array of
    // a union are the shapes; the element is a sixteen-byte `NtsValue`, which is
    // why it needs a row of its own rather than the widths above.
    (
        "nts_array_push_value",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_array_reverse", None, None, Raising::NoRaise),
    ("nts_array_reverse_ref", None, None, Raising::NoRaise),
    (
        "nts_array_set_length",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_set_length_foreign",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_set_length_ref",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_set_length_value",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_array_set_width", None, None, Raising::NoRaise),
    (
        "nts_array_shift",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_array_shift_ref", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_array_shift_value",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_slice",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_slice_foreign",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_slice_ref",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_slice_value",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_sort_str",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_splice",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_array_splice_ref",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_array_to_string", None, None, Raising::MayRaise),
    ("nts_array_unlend", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_array_unshift",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_array_unshift_ref",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_array_writable", Some(&[None]), None, Raising::NoRaise),
    ("nts_assertion_failed", None, None, Raising::Diverges),
    (
        "nts_bigint_as_intn",
        Some(&[Some(HirType::Float { bits: 64 }), Some(HirType::BigInt)]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    (
        "nts_bigint_as_uintn",
        Some(&[Some(HirType::Float { bits: 64 }), Some(HirType::BigInt)]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    (
        "nts_bigint_box",
        Some(&[Some(HirType::BigInt)]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_bigint_compare_string",
        Some(&[Some(HirType::BigInt), None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_bigint_from_number",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    ("nts_bigint_overflow", Some(&[]), None, Raising::Diverges),
    (
        "nts_bigint_pow",
        Some(&[Some(HirType::BigInt), Some(HirType::BigInt)]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    (
        "nts_bigint_shl",
        Some(&[Some(HirType::BigInt), Some(HirType::BigInt)]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    (
        "nts_bigint_shr",
        Some(&[Some(HirType::BigInt), Some(HirType::BigInt)]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    (
        "nts_bigint_to_string",
        Some(&[Some(HirType::BigInt)]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_bigint_unbox",
        Some(&[None]),
        Some(HirType::BigInt),
        Raising::NoRaise,
    ),
    (
        "nts_block_carry",
        Some(&[
            None,
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            None,
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_block_unlend", None, None, Raising::NoRaise),
    (
        "nts_bool_to_string",
        Some(&[Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_bound_function_to_string", None, None, Raising::NoRaise),
    (
        "nts_bounds",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_boxed_new",
        Some(&[
            None,
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_boxed_unlend", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_buffer_byte_length",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_buffer_detached", None, None, Raising::NoRaise),
    (
        "nts_buffer_max_byte_length",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_buffer_new", None, None, Raising::NoRaise),
    ("nts_buffer_new_resizable", None, None, Raising::NoRaise),
    ("nts_buffer_resizable", None, None, Raising::NoRaise),
    ("nts_buffer_resize", None, None, Raising::NoRaise),
    ("nts_buffer_slice", None, None, Raising::NoRaise),
    ("nts_buffer_transfer", None, None, Raising::NoRaise),
    ("nts_callback_enter", None, None, Raising::NoRaise),
    ("nts_callback_leave", None, None, Raising::MayRaise),
    (
        "nts_callback_task",
        Some(&[None, Some(HirType::Float { bits: 64 }), Some(HirType::Bool)]),
        None,
        Raising::MayRaise,
    ),
    (
        "nts_callbacks_return_to_loop_when",
        None,
        None,
        Raising::NoRaise,
    ),
    ("nts_cancel_delayed", None, None, Raising::NoRaise),
    ("nts_cell_unready", None, None, Raising::Diverges),
    (
        "nts_check",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_check_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_check_or_grow", None, None, Raising::NoRaise),
    ("nts_check_or_grow_fn", None, None, Raising::NoRaise),
    ("nts_checkpoint", None, None, Raising::MayRaise),
    (
        "nts_checkpoint_after_callbacks",
        Some(&[Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_clear_timeout",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_closure_lend", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_closure_lend_once",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_closure_notify", Some(&[]), None, Raising::NoRaise),
    ("nts_closure_unlend", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_closure_unlend_once",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_closures_owed", None, None, Raising::NoRaise),
    ("nts_collect_cycles", None, None, Raising::NoRaise),
    ("nts_collection_epoch", None, None, Raising::NoRaise),
    ("nts_com_addref", None, None, Raising::MayRaise),
    ("nts_com_answer", None, None, Raising::MayRaise),
    ("nts_com_answer_string", None, None, Raising::MayRaise),
    (
        "nts_com_base",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_com_carry",
        Some(&[
            None,
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            None,
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_com_compose", None, None, Raising::MayRaise),
    (
        "nts_com_compose_named",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_com_delegate",
        Some(&[
            None,
            None,
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_com_delegates", None, None, Raising::MayRaise),
    ("nts_com_outer_addref", None, None, Raising::MayRaise),
    ("nts_com_outer_base", None, None, Raising::MayRaise),
    ("nts_com_outer_iids", None, None, Raising::MayRaise),
    ("nts_com_outer_instance", None, None, Raising::MayRaise),
    ("nts_com_outer_name", None, None, Raising::MayRaise),
    ("nts_com_outer_query", None, None, Raising::MayRaise),
    ("nts_com_outer_release", None, None, Raising::MayRaise),
    ("nts_com_outer_trust", None, None, Raising::MayRaise),
    (
        "nts_com_query",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_com_query_array",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_com_register", None, None, Raising::MayRaise),
    ("nts_com_release", None, None, Raising::MayRaise),
    (
        "nts_com_release_array",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_com_releases", None, None, Raising::MayRaise),
    ("nts_com_state", None, None, Raising::MayRaise),
    ("nts_com_take", None, None, Raising::MayRaise),
    ("nts_com_unlend", Some(&[None]), None, Raising::NoRaise),
    ("nts_concat", None, None, Raising::NoRaise),
    ("nts_concat_into", None, None, Raising::NoRaise),
    (
        "nts_console_write",
        Some(&[None, Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_counted_allocations", None, None, Raising::NoRaise),
    ("nts_counted_releases", None, None, Raising::NoRaise),
    ("nts_counted_retains", None, None, Raising::NoRaise),
    ("nts_counting_reset", None, None, Raising::NoRaise),
    (
        "nts_cstring_release",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_cstrings_release",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_cycle_candidates",
        Some(&[]),
        Some(HirType::Int {
            bits: 64,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_dataview_buffer", None, None, Raising::NoRaise),
    (
        "nts_dataview_byte_length",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_dataview_byte_offset", None, None, Raising::NoRaise),
    ("nts_dataview_get_bigint64", None, None, Raising::NoRaise),
    ("nts_dataview_get_biguint64", None, None, Raising::NoRaise),
    ("nts_dataview_get_float32", None, None, Raising::NoRaise),
    ("nts_dataview_get_float64", None, None, Raising::NoRaise),
    ("nts_dataview_get_int16", None, None, Raising::NoRaise),
    ("nts_dataview_get_int32", None, None, Raising::NoRaise),
    ("nts_dataview_get_int8", None, None, Raising::NoRaise),
    ("nts_dataview_get_uint16", None, None, Raising::NoRaise),
    ("nts_dataview_get_uint32", None, None, Raising::NoRaise),
    ("nts_dataview_get_uint8", None, None, Raising::NoRaise),
    ("nts_dataview_over", None, None, Raising::NoRaise),
    ("nts_dataview_part", None, None, Raising::NoRaise),
    ("nts_dataview_set_bigint64", None, None, Raising::NoRaise),
    ("nts_dataview_set_biguint64", None, None, Raising::NoRaise),
    ("nts_dataview_set_float32", None, None, Raising::NoRaise),
    ("nts_dataview_set_float64", None, None, Raising::NoRaise),
    ("nts_dataview_set_int16", None, None, Raising::NoRaise),
    ("nts_dataview_set_int32", None, None, Raising::NoRaise),
    ("nts_dataview_set_int8", None, None, Raising::NoRaise),
    ("nts_dataview_set_uint16", None, None, Raising::NoRaise),
    ("nts_dataview_set_uint32", None, None, Raising::NoRaise),
    ("nts_dataview_set_uint8", None, None, Raising::NoRaise),
    (
        "nts_date_new",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_date_value",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_decode_uri", None, None, Raising::NoRaise),
    (
        "nts_delay",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_dictionary_fill_from_nsdictionary",
        None,
        None,
        Raising::NoRaise,
    ),
    (
        "nts_dictionary_fill_strings_from_nsdictionary",
        None,
        None,
        Raising::NoRaise,
    ),
    ("nts_encode_uri", None, None, Raising::NoRaise),
    (
        "nts_enqueue_job",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::MayRaise,
    ),
    ("nts_enqueue_microtask", None, None, Raising::NoRaise),
    ("nts_enqueue_tick", None, None, Raising::NoRaise),
    ("nts_enter", None, None, Raising::NoRaise),
    ("nts_environment_create", None, None, Raising::NoRaise),
    ("nts_environment_current", None, None, Raising::NoRaise),
    ("nts_environment_destroy", None, None, Raising::NoRaise),
    ("nts_environment_enter", None, None, Raising::NoRaise),
    ("nts_environment_has_platform", None, None, Raising::NoRaise),
    (
        "nts_environment_install_platform",
        None,
        None,
        Raising::NoRaise,
    ),
    ("nts_environment_leave", None, None, Raising::NoRaise),
    ("nts_environment_platform", None, None, Raising::NoRaise),
    ("nts_family_row", None, None, Raising::NoRaise),
    ("nts_function_name", Some(&[None]), None, Raising::NoRaise),
    ("nts_function_to_string", None, None, Raising::NoRaise),
    (
        "nts_gobject_boxed",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_gobject_boxed_copy",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_gobject_boxed_new",
        Some(&[
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_gobject_is_boxed",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_gobject_made", None, None, Raising::NoRaise),
    ("nts_gobject_state", None, None, Raising::NoRaise),
    (
        "nts_handle_check",
        Some(&[
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_handle_family_register",
        Some(&[
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            None,
            None,
            None,
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_has_pending_work",
        Some(&[]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_host_checkpoint_end", None, None, Raising::NoRaise),
    ("nts_host_install", None, None, Raising::NoRaise),
    (
        "nts_hresult_clear",
        Some(&[
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_hresult_message",
        Some(&[Some(HirType::Int {
            bits: 32,
            signed: true,
        })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_hstring_release", None, None, Raising::NoRaise),
    (
        "nts_hstrings_release",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_in_callback", None, None, Raising::NoRaise),
    (
        "nts_index",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_index_fn",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_is_array",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_buffer",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_is_class", None, None, Raising::NoRaise),
    (
        "nts_is_data_view",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_date",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_finite",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_integer",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_map",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_owner_thread",
        Some(&[]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_promise",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_safe_integer",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_set",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_is_view_kind",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_json_first_escape",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_json_quote", None, None, Raising::NoRaise),
    ("nts_jvm_store_append", None, None, Raising::MayRaise),
    ("nts_jvm_store_close", None, None, Raising::MayRaise),
    ("nts_jvm_store_commit", None, None, Raising::MayRaise),
    ("nts_jvm_store_configure", None, None, Raising::MayRaise),
    ("nts_jvm_store_delete", None, None, Raising::MayRaise),
    ("nts_jvm_store_discard", None, None, Raising::MayRaise),
    ("nts_jvm_store_list", None, None, Raising::MayRaise),
    ("nts_jvm_store_open", None, None, Raising::MayRaise),
    ("nts_jvm_store_read", None, None, Raising::MayRaise),
    ("nts_jvm_store_size", None, None, Raising::MayRaise),
    ("nts_jvm_store_source_close", None, None, Raising::MayRaise),
    ("nts_jvm_store_source_open", None, None, Raising::MayRaise),
    ("nts_jvm_store_source_read", None, None, Raising::MayRaise),
    ("nts_jvm_store_source_size", None, None, Raising::MayRaise),
    ("nts_jvm_web_cancel_connect", None, None, Raising::MayRaise),
    ("nts_jvm_web_close", None, None, Raising::MayRaise),
    ("nts_jvm_web_connect", None, None, Raising::MayRaise),
    ("nts_jvm_web_connect_alpn", None, None, Raising::MayRaise),
    ("nts_jvm_web_network_changed", None, None, Raising::MayRaise),
    ("nts_jvm_web_open_count", None, None, Raising::MayRaise),
    ("nts_jvm_web_protocol", None, None, Raising::MayRaise),
    ("nts_jvm_web_random_fill", None, None, Raising::MayRaise),
    ("nts_jvm_web_read", None, None, Raising::MayRaise),
    (
        "nts_jvm_web_system_proxy_for",
        None,
        None,
        Raising::MayRaise,
    ),
    ("nts_jvm_web_write", None, None, Raising::MayRaise),
    ("nts_landing_detail", None, None, Raising::NoRaise),
    ("nts_landing_pop", None, None, Raising::NoRaise),
    ("nts_landing_push", None, None, Raising::NoRaise),
    ("nts_landing_thrown", None, None, Raising::NoRaise),
    ("nts_leave", None, None, Raising::MayRaise),
    (
        "nts_live_bytes",
        Some(&[]),
        Some(HirType::Int {
            bits: 64,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_live_count",
        Some(&[]),
        Some(HirType::Int {
            bits: 64,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_map_clear", None, None, Raising::NoRaise),
    ("nts_map_copy", None, None, Raising::NoRaise),
    // The keyed helpers end with the key kind the call was written against
    // (`hir::tables`).
    (
        "nts_map_delete",
        Some(&[None, None, Some(super::tables::KIND_TYPE)]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_map_entry",
        Some(&[None, None, Some(super::tables::KIND_TYPE)]),
        Some(HirType::Int {
            bits: 64,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_map_entry_get",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            None,
            Some(super::tables::KIND_TYPE),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_map_entry_set",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            None,
            None,
            Some(super::tables::KIND_TYPE),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_map_extend", None, None, Raising::NoRaise),
    (
        "nts_map_get",
        Some(&[None, None, Some(super::tables::KIND_TYPE)]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_map_has",
        Some(&[None, None, Some(super::tables::KIND_TYPE)]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_map_key_at",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_map_keys_into", None, None, Raising::NoRaise),
    ("nts_map_keys_str", None, None, Raising::NoRaise),
    (
        "nts_map_new",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_map_next",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_map_set",
        Some(&[None, None, None, Some(super::tables::KIND_TYPE)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_map_size", None, None, Raising::NoRaise),
    (
        "nts_map_value_at",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_map_values_into", None, None, Raising::NoRaise),
    (
        "nts_math_acos",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_asin",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_atan",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_atan2",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_cbrt",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_cos",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_cosh",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_exp",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_expm1",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_fround",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_hypot",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_imul",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_log",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_log10",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_log1p",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_log2",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_pow",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_sign",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_sin",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_sinh",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_tan",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_math_tanh",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_max",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_max_fn",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_min",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_min_fn",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_no_arm", None, None, Raising::Diverges),
    ("nts_no_arm_of", None, None, Raising::Diverges),
    ("nts_nsarray_of_objects", None, None, Raising::NoRaise),
    ("nts_nsarray_of_strings", None, None, Raising::NoRaise),
    ("nts_nsdictionary_of_objects", None, None, Raising::NoRaise),
    ("nts_nsdictionary_of_strings", None, None, Raising::NoRaise),
    ("nts_nsset_of_objects", None, None, Raising::NoRaise),
    ("nts_nsset_of_strings", None, None, Raising::NoRaise),
    ("nts_nsstring_of", None, None, Raising::NoRaise),
    (
        "nts_number_to_fixed",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_number_to_string",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_number_to_string_into",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_number_to_string_radix",
        Some(&[
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_objc_adopt", None, None, Raising::NoRaise),
    ("nts_objc_register_class", None, None, Raising::NoRaise),
    ("nts_objc_state", None, None, Raising::NoRaise),
    ("nts_object_new", None, None, Raising::NoRaise),
    ("nts_object_to_string", None, None, Raising::NoRaise),
    ("nts_parse_float", None, None, Raising::NoRaise),
    ("nts_parse_int", None, None, Raising::NoRaise),
    ("nts_pending_begin", None, None, Raising::NoRaise),
    ("nts_pending_count", None, None, Raising::NoRaise),
    ("nts_pending_end", None, None, Raising::NoRaise),
    ("nts_permanent_count", None, None, Raising::NoRaise),
    (
        "nts_post_delayed",
        Some(&[None, Some(HirType::Float { bits: 64 }), Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_post_from_any_thread", None, None, Raising::NoRaise),
    ("nts_post_task", None, None, Raising::NoRaise),
    (
        "nts_presence_clear",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_presence_clear_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_presence_has",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_presence_has_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_presence_has_value",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_presence_init",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_presence_init_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_presence_set",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_presence_set_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_process_start", None, None, Raising::NoRaise),
    ("nts_promise_adopt", None, None, Raising::MayRaise),
    ("nts_promise_all", None, None, Raising::MayRaise),
    (
        "nts_promise_claim",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_promise_fulfill_number",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::MayRaise,
    ),
    (
        "nts_promise_fulfill_pointer",
        Some(&[None, None]),
        None,
        Raising::MayRaise,
    ),
    (
        "nts_promise_fulfill_reference",
        None,
        None,
        Raising::MayRaise,
    ),
    (
        "nts_promise_fulfill_tagged",
        Some(&[
            None,
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::MayRaise,
    ),
    ("nts_promise_fulfill_value", None, None, Raising::MayRaise),
    ("nts_promise_fulfill_void", None, None, Raising::MayRaise),
    (
        "nts_promise_is_rejected",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_promise_join", None, None, Raising::MayRaise),
    ("nts_promise_new", None, None, Raising::NoRaise),
    (
        "nts_promise_number",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_promise_pair",
        Some(&[None]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_promise_pointer", Some(&[None]), None, Raising::NoRaise),
    ("nts_promise_race", None, None, Raising::MayRaise),
    ("nts_promise_reason", None, None, Raising::NoRaise),
    ("nts_promise_reference", None, None, Raising::NoRaise),
    ("nts_promise_reject", None, None, Raising::MayRaise),
    ("nts_promise_reject_error", None, None, Raising::NoRaise),
    ("nts_promise_reject_value", None, None, Raising::MayRaise),
    ("nts_promise_reject_with", None, None, Raising::MayRaise),
    ("nts_promise_resolve_value", None, None, Raising::MayRaise),
    ("nts_promise_state", None, None, Raising::NoRaise),
    ("nts_promise_subscribe", None, None, Raising::MayRaise),
    ("nts_promise_value", None, None, Raising::NoRaise),
    ("nts_raise", None, None, Raising::MayRaise),
    ("nts_raise_take", None, None, Raising::NoRaise),
    ("nts_raising", None, None, Raising::NoRaise),
    ("nts_refused", None, None, Raising::Diverges),
    ("nts_region_begin", None, None, Raising::NoRaise),
    ("nts_region_end_call", None, None, Raising::NoRaise),
    ("nts_region_hold", None, None, Raising::NoRaise),
    ("nts_region_keep", None, None, Raising::NoRaise),
    ("nts_region_open", None, None, Raising::NoRaise),
    ("nts_region_owns", None, None, Raising::NoRaise),
    ("nts_region_reset", None, None, Raising::NoRaise),
    ("nts_region_suspend", None, None, Raising::NoRaise),
    ("nts_register_holders", None, None, Raising::NoRaise),
    ("nts_release", None, None, Raising::NoRaise),
    ("nts_rem_i32", None, None, Raising::NoRaise),
    ("nts_retain", None, None, Raising::NoRaise),
    (
        "nts_round",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_round_fn",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_set_add",
        Some(&[None, None, Some(super::tables::KIND_TYPE)]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_set_new",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_set_timeout",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Bool),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::MayRaise,
    ),
    (
        "nts_shl",
        Some(&[
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_shr",
        Some(&[
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    ("nts_slot_or_grow", None, None, Raising::NoRaise),
    ("nts_slot_or_grow_fn", None, None, Raising::NoRaise),
    (
        "nts_stderr_is_tty",
        Some(&[]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_stdout_is_tty",
        Some(&[]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_str_alloc", None, None, Raising::NoRaise),
    (
        "nts_str_append",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_append_at",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_append_char_at",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_append_char_code",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_str_append_json_quoted", None, None, Raising::NoRaise),
    (
        "nts_str_append_number",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_append_slice",
        Some(&[
            None,
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_at",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_at_into",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_char_at",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_char_at_into",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_char_code_at",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_char_code_at_fn",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_char_code_at_int",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: true,
            }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_char_code_at_int_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: true,
            }),
        ]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_code_point_at",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_concat_at",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_concat_char_at",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_concat_char_code",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_str_concat_grown", None, None, Raising::NoRaise),
    ("nts_str_concat_json_quoted", None, None, Raising::NoRaise),
    (
        "nts_str_concat_number",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_concat_slice",
        Some(&[
            None,
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_ends_with",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_str_includes",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_str_index_of",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_index_of_from",
        Some(&[None, None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_is_well_formed",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_str_last_index_of",
        Some(&[None, None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_pad_end",
        Some(&[None, Some(HirType::Float { bits: 64 }), None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_pad_start",
        Some(&[None, Some(HirType::Float { bits: 64 }), None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_point_width",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_str_raw", None, None, Raising::NoRaise),
    ("nts_str_relative_at", None, None, Raising::NoRaise),
    (
        "nts_str_repeat",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    ("nts_str_replace", None, None, Raising::NoRaise),
    ("nts_str_replace_all", None, None, Raising::NoRaise),
    (
        "nts_str_slice",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_slice_into",
        Some(&[
            None,
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_str_split", None, None, Raising::NoRaise),
    (
        "nts_str_starts_with",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_str_substring",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_substring_general",
        Some(&[
            None,
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_substring_into",
        Some(&[
            None,
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_substring_into_fn",
        Some(&[
            None,
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_to_lower_case",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_to_number",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_str_to_upper_case",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_str_to_well_formed",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_str_trim", None, None, Raising::NoRaise),
    ("nts_str_trim_end", None, None, Raising::NoRaise),
    ("nts_str_trim_start", None, None, Raising::NoRaise),
    ("nts_string_cmp", None, None, Raising::NoRaise),
    ("nts_string_copy_hstring", None, None, Raising::NoRaise),
    (
        "nts_string_eq",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_string_from_char_code",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_char_code_into",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_code_point",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_code_point_into",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_cstring",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_string_from_hstring", None, None, Raising::NoRaise),
    (
        "nts_string_from_required_cstring",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_required_view",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_utf8",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_string_from_view",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_string_of_nsstring", None, None, Raising::NoRaise),
    (
        "nts_string_to_cstring",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_string_to_hstring", None, None, Raising::NoRaise),
    ("nts_string_to_owned_cstring", None, None, Raising::NoRaise),
    ("nts_string_to_utf16", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_string_truthy",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_string_unlend", Some(&[None]), None, Raising::NoRaise),
    ("nts_string_view", None, None, Raising::NoRaise),
    (
        "nts_strings_from_cstrings",
        Some(&[None, Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_strings_to_cstrings",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_strings_to_hstrings",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_symbol_description",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_symbol_for", Some(&[None]), None, Raising::NoRaise),
    ("nts_symbol_key_for", Some(&[None]), None, Raising::NoRaise),
    ("nts_symbol_new", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_symbol_to_string",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_table_membership",
        Some(&[None, None]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_table_new",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_tag_name",
        Some(&[Some(HirType::Int {
            bits: 32,
            signed: false,
        })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_tag_of_reference",
        Some(&[None]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_task_run", None, None, Raising::MayRaise),
    (
        "nts_template_reflection",
        Some(&[Some(HirType::Erased)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_thrown_class", None, None, Raising::NoRaise),
    (
        // ToIndex of a number the lowering has already range-checked: a
        // `double`, which `flow` sharpens to the whole number it was given.
        // Without this row nothing held the call at the type C returns, and
        // a sharper fact retyped the call itself (`: i32` over a `double`).
        "nts_to_index",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_to_int16",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 16,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    ("nts_to_int16_fn", None, None, Raising::NoRaise),
    (
        "nts_to_int32",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_to_int32_fn",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_to_int8",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 8,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    ("nts_to_int8_fn", None, None, Raising::NoRaise),
    (
        "nts_to_integer",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_to_uint16",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 16,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_to_uint16_fn", None, None, Raising::NoRaise),
    (
        "nts_to_uint32",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_to_uint32_fn",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_to_uint8",
        Some(&[Some(HirType::Float { bits: 64 })]),
        Some(HirType::Int {
            bits: 8,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    ("nts_to_uint8_fn", None, None, Raising::NoRaise),
    ("nts_uncaught", None, None, Raising::Diverges),
    (
        "nts_unit",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Int {
            bits: 16,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_unit_fn",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        Some(HirType::Int {
            bits: 16,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_ushr",
        Some(&[
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_utf16_release",
        Some(&[None, None]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_value_boolean",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_eq_boolean",
        Some(&[None, Some(HirType::Bool)]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_eq_boolean_fn",
        Some(&[None, Some(HirType::Bool)]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_value_eq_handle", None, None, Raising::NoRaise),
    (
        "nts_value_eq_number",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_eq_number_fn",
        Some(&[None, Some(HirType::Float { bits: 64 })]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_eq_reference",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_eq_string",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_value_handle", None, None, Raising::NoRaise),
    ("nts_value_inspect", None, None, Raising::MayRaise),
    (
        "nts_value_is_view",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_number",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_value_number_or", None, None, Raising::NoRaise),
    (
        "nts_value_of_boolean",
        Some(&[Some(HirType::Bool)]),
        None,
        Raising::NoRaise,
    ),
    ("nts_value_of_handle", None, None, Raising::NoRaise),
    ("nts_value_of_null", None, None, Raising::NoRaise),
    (
        "nts_value_of_number",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_value_of_reference",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_value_of_undefined", None, None, Raising::NoRaise),
    ("nts_value_reference", None, None, Raising::NoRaise),
    ("nts_value_release", None, None, Raising::NoRaise),
    ("nts_value_retain", None, None, Raising::NoRaise),
    (
        "nts_value_strict_eq",
        Some(&[None, None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_tag",
        Some(&[None]),
        Some(HirType::Int {
            bits: 32,
            signed: false,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_value_to_number",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_value_to_number_explicit",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_value_to_string", None, None, Raising::MayRaise),
    (
        "nts_value_truthy",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_value_truthy_fn",
        Some(&[None]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    ("nts_view_buffer", None, None, Raising::NoRaise),
    (
        "nts_view_byte_length",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_view_byte_offset", None, None, Raising::NoRaise),
    ("nts_view_bytes", None, None, Raising::NoRaise),
    ("nts_view_check", None, None, Raising::NoRaise),
    ("nts_view_check_fn", None, None, Raising::NoRaise),
    ("nts_view_copy_within", None, None, Raising::NoRaise),
    ("nts_view_fill", None, None, Raising::NoRaise),
    ("nts_view_from_bytes", None, None, Raising::NoRaise),
    ("nts_view_from_elements", None, None, Raising::NoRaise),
    ("nts_view_get", None, None, Raising::NoRaise),
    ("nts_view_index", None, None, Raising::NoRaise),
    ("nts_view_index_fn", None, None, Raising::NoRaise),
    ("nts_view_join", None, None, Raising::NoRaise),
    (
        "nts_view_length",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    ("nts_view_new", None, None, Raising::NoRaise),
    ("nts_view_put", None, None, Raising::NoRaise),
    ("nts_view_set", None, None, Raising::NoRaise),
    ("nts_view_slice", None, None, Raising::NoRaise),
    ("nts_view_subarray", None, None, Raising::NoRaise),
    ("nts_view_unlend", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_winrt_activate",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_winrt_activations", None, None, Raising::MayRaise),
    (
        "nts_winrt_alloc",
        Some(&[Some(HirType::Float { bits: 64 })]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_winrt_array_items",
        Some(&[None]),
        None,
        Raising::NoRaise,
    ),
    ("nts_winrt_box", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_winrt_factory",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_winrt_free", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_winrt_is",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        Some(HirType::Bool),
        Raising::NoRaise,
    ),
    (
        "nts_winrt_listen",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            None,
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_winrt_received",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            Some(HirType::Float { bits: 64 }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_winrt_received_handles",
        Some(&[
            None,
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_winrt_received_strings",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    (
        "nts_winrt_reference",
        Some(&[
            None,
            Some(HirType::Float { bits: 64 }),
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
        ]),
        None,
        Raising::NoRaise,
    ),
    ("nts_winrt_unbox", Some(&[None]), None, Raising::NoRaise),
    (
        "nts_winrt_unlisten",
        Some(&[
            None,
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 64,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            Some(HirType::Int {
                bits: 32,
                signed: false,
            }),
            None,
        ]),
        Some(HirType::Int {
            bits: 32,
            signed: true,
        }),
        Raising::NoRaise,
    ),
    (
        "nts_write_stderr",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
    (
        "nts_write_stdout",
        Some(&[None]),
        Some(HirType::Float { bits: 64 }),
        Raising::NoRaise,
    ),
];

#[must_use]
fn declared(name: &str) -> Option<&'static Declared> {
    SIGNATURES
        .binary_search_by(|(known, _, _, _)| (*known).cmp(name))
        .ok()
        .map(|at| &SIGNATURES[at])
}

/// Every helper with a scalar-normalization record, in its sorted order.
///
/// Exposed so a classification elsewhere can be **asserted against the table**
/// rather than hand-maintained beside it. `hir::changes_array_length` is the
/// case that motivated it: a literal list of five prefixes whose omission does
/// not fail at the list, because a helper missing from it produces a working
/// helper and a whole-program array representation that cannot express what it
/// does.
pub fn declared_names() -> impl Iterator<Item = &'static str> {
    SIGNATURES.iter().filter(|it| it.1.is_some()).map(|it| it.0)
}

/// Every runtime helper in the shared catalog, including helpers which need no
/// scalar ABI normalization. Unknown external functions are not in this view.
pub fn helper_names() -> impl Iterator<Item = &'static str> {
    SIGNATURES.iter().map(|it| it.0)
}

/// The helper's explicit language-level raising contract. `None` is an
/// unknown external contract, never permission to erase an exceptional edge.
#[must_use]
pub fn raising(name: &str) -> Option<Raising> {
    declared(name).map(|it| it.3)
}

/// What `name` declares its parameters to be, if the runtime declares it.
#[must_use]
pub fn parameters(name: &str) -> Option<&'static [Option<HirType>]> {
    declared(name).and_then(|it| it.1)
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

/// How a bound foreign member is invoked.
///
/// A declaration's `@ntsJvm` contract, indexed by the checker-selected node.
/// Retention proofs remain in the semantic metadata; escape analysis currently
/// treats foreign calls conservatively through [`foreign_keeps`].
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
/// Declaration metadata carries bytecode retention evidence, but this query
/// does not yet consume it. Native methods without a body remain unknown.
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
        // Both read, neither kept: the result is a fresh string. And a
        // table's keys or values copied into the array the caller sized: the
        // table is read and the array written, neither kept, as the
        // `nts_map_next` / `nts_map_key_at` walk they replace never made the
        // table escape.
        "nts_concat"
        | "nts_json_quote"
        | "nts_json_first_escape"
        | "nts_str_concat_at"
        | "nts_str_concat_char_at"
        | "nts_str_concat_char_code"
        | "nts_str_concat_grown"
        | "nts_str_concat_json_quoted"
        | "nts_str_concat_number"
        | "nts_str_concat_slice"
        | "nts_string_eq"
        | "nts_str_index_of"
        | "nts_str_last_index_of"
        | "nts_str_includes"
        | "nts_str_starts_with"
        | "nts_str_ends_with"
        | "nts_map_keys_into"
        | "nts_map_values_into" => Some(&[]),
        // The left is consumed and the result may *be* it, so it is kept; the
        // right is only read. The same for the appends that write a number, a
        // unit, a slice or a string's quoted form without making a string of
        // it.
        "nts_str_append"
        | "nts_str_append_at"
        | "nts_str_append_char_at"
        | "nts_str_append_char_code"
        | "nts_str_append_json_quoted"
        | "nts_str_append_number"
        | "nts_str_append_slice" => Some(&[0]),
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
        // `nts_com_take` reads the result slot an `@ntsHresult` call wrote,
        // which is the caller's local, and keeps nothing of it. A COM object
        // asked for another of its interfaces (`nts_com_query`) answers a
        // reference of its own and keeps none of the object's; an event's
        // listener table keeps the object uncounted (a weak reference) and the
        // delegate through the source, never the program's reference.
        // `own::held_to_the_end` reads these as borrows, so the object keeps
        // its anchor.
        // And `nts_gobject_made`, which sinks a floating GObject for a
        // never-free program and does nothing under counting: read, not held.
        // `nts_winrt_reference` copies the value it is handed into the
        // reference it makes, and keeps nothing of the caller's storage.
        // `nts_hresult_clear` writes the output storage but never retains its
        // address. It is deliberately not reads-only or stores-nothing.
        "nts_hresult_clear"
        | "nts_com_take"
        | "nts_com_query"
        | "nts_com_query_array"
        | "nts_com_release_array"
        | "nts_com_unlend"
        | "nts_winrt_listen"
        | "nts_winrt_unlisten"
        | "nts_winrt_box"
        | "nts_winrt_is"
        | "nts_winrt_reference"
        | "nts_gobject_made" => Some(&[]),
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
/// The cost of that coarseness, measured on `tests/memory/dates`:
/// reading `this.atime` to hand to `nts_date_value` — a helper that loads a
/// double and returns it — took a retain and a release per iteration, **34 of
/// that case's 51 operations**.
///
/// `nts_date_value` is how it was found and is one of twenty-eight. The header
/// has marked the rest of them for a long time and nothing on this side read
/// it, so every `xs.indexOf`, `s.startsWith`, `m.has` and `xs.at` ended a
/// borrow it had no way to invalidate.
pub const READS_ONLY: &[&str] = &[
    // Not nts_access_key_description: it allocates or retains its result.
    "nts_array_at",
    // Not `nts_array_at_ref`: it retains the element it returns.
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
    "nts_bigint_compare_string",
    "nts_bigint_unbox",
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
    "nts_gobject_is_boxed",
    "nts_is_array",
    "nts_is_buffer",
    "nts_is_class",
    "nts_is_data_view",
    "nts_is_date",
    "nts_is_map",
    "nts_is_promise",
    "nts_is_set",
    "nts_is_view_kind",
    "nts_json_first_escape",
    "nts_landing_detail",
    "nts_landing_thrown",
    "nts_promise_pair",
    "nts_promise_state",
    "nts_table_membership",
    "nts_thrown_class",
    "nts_to_index",
    "nts_value_is_view",
    "nts_value_number_or",
    "nts_value_to_number_explicit",
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

/// Helpers that store nothing yet are not [`READS_ONLY`]: their one effect is
/// to retain the reference they return, which is how the runtime hands back a
/// managed one. A retain invalidates no borrow, so a borrow survives a call to
/// one of these as it survives a reads-only one; but the caller owns the
/// result, which is counting to do, so a function calling one is not inert.
/// `nts_array_at_ref` was on `READS_ONLY` until 2026-10-14, and that second half
/// is the leak it caused: `return xs.find(...)` never released what it found.
pub const RETAINS_ONLY_ITS_RESULT: &[&str] = &[
    "nts_array_at_ref",
    // Table reads retain the returned tagged value, which can hold a reference,
    // and neither store into a container nor run the program's code. A keyed
    // read whose kind is not the table's asks the key and widens nothing: only
    // a write widens (`nts_map_set_unpromised`).
    "nts_map_entry_get",
    "nts_map_get",
    "nts_map_key_at",
    "nts_map_value_at",
];

/// Helpers that store nothing and retain nothing, and are still not
/// [`READS_ONLY`]. `nts_map_entry` answers a number -- the table's generation
/// and a slot -- which is a reading of the table's shape: the header keeps it
/// off `NTS_READS_ONLY` so that two of them are never taken for one. A borrow
/// survives it as it survives any read.
pub const READS_A_SHAPE: &[&str] = &["nts_map_entry"];

/// Whether a call overwrites no program storage a borrow depends on.
///
/// This is not purity: diagnostics and stopping are observable effects.
/// `nts_refused` prints and aborts without storing into the program or calling
/// its code, so it cannot invalidate a borrow. It must stay out of
/// [`READS_ONLY`], whose calls may be deleted. A body that stores before this
/// stop still mutates through that store.
#[must_use]
pub fn stores_nothing(name: &str) -> bool {
    reads_only(name)
        || RETAINS_ONLY_ITS_RESULT.contains(&name)
        || READS_A_SHAPE.contains(&name)
        || REGION_CALLS.contains(&name)
        || name == "nts_refused"
}

/// What `regions::rewrite` puts around a call it serves. None stores into
/// the program: they open and close the runtime's own region, retain an
/// argument into its kept list, or do nothing at all (`nts_region_hold`). A
/// call that may store would break every borrow across it, and the caller's
/// walk of the result -- the whole point -- is borrows.
pub const REGION_CALLS: &[&str] = &[
    "nts_region_begin",
    "nts_region_end_call",
    "nts_region_hold",
    "nts_region_keep",
];

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
