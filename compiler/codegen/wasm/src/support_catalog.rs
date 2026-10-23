//! Literal decisions: adding a helper requires an explicit reviewed row.
use super::Support;
pub(super) const ROWS: &[(&str, Support)] = &[
    ("nts_access_key_description", Support::WasmHelper),
    (
        "nts_alloc",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_append_slot",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_array_at", Support::WasmHelper),
    ("nts_array_at_element", Support::WasmHelper),
    (
        "nts_array_at_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_at_ref", Support::WasmHelper),
    ("nts_array_at_value", Support::WasmHelper),
    ("nts_array_concat", Support::WasmHelper),
    (
        "nts_array_concat_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_concat_ref", Support::WasmHelper),
    ("nts_array_concat_value", Support::WasmHelper),
    ("nts_array_element", Support::Intrinsic),
    ("nts_array_extend", Support::WasmHelper),
    (
        "nts_array_extend_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_extend_ref", Support::WasmHelper),
    ("nts_array_fill", Support::Intrinsic),
    ("nts_array_fill_bool", Support::Intrinsic),
    (
        "nts_array_fill_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_array_fill_from_nsarray",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_fill_ref", Support::Intrinsic),
    (
        "nts_array_fill_strings_from_nsarray",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_array_from_handles",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_array_handles",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_includes", Support::WasmHelper),
    ("nts_array_includes_ref", Support::WasmHelper),
    ("nts_array_includes_str", Support::WasmHelper),
    ("nts_array_includes_str_value", Support::WasmHelper),
    ("nts_array_index_of", Support::WasmHelper),
    ("nts_array_index_of_ref", Support::WasmHelper),
    ("nts_array_index_of_str", Support::WasmHelper),
    ("nts_array_index_of_str_value", Support::WasmHelper),
    ("nts_array_join_num", Support::WasmHelper),
    ("nts_array_join_str", Support::WasmHelper),
    ("nts_array_keep_first", Support::Intrinsic),
    ("nts_array_last_index_of", Support::WasmHelper),
    (
        "nts_array_length",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_mark_null_slots",
        Support::Decline("an Erase's null-slot mark is the backend's own, never a call"),
    ),
    (
        "nts_array_new",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_new_uninitialized",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_of_numbers",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_of_values",
        Support::Decline("array helper not yet implemented"),
    ),
    ("nts_array_pop", Support::Intrinsic),
    ("nts_array_pop_ref", Support::Intrinsic),
    ("nts_array_pop_value", Support::Intrinsic),
    ("nts_array_push", Support::Intrinsic),
    ("nts_array_push_ref", Support::Intrinsic),
    ("nts_array_push_value", Support::Intrinsic),
    ("nts_array_reverse", Support::WasmHelper),
    ("nts_array_reverse_ref", Support::WasmHelper),
    ("nts_array_set_length", Support::Intrinsic),
    (
        "nts_array_set_length_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_set_length_ref", Support::Intrinsic),
    ("nts_array_set_length_value", Support::Intrinsic),
    ("nts_array_shift", Support::Intrinsic),
    ("nts_array_shift_ref", Support::Intrinsic),
    ("nts_array_shift_value", Support::Intrinsic),
    ("nts_array_slice", Support::WasmHelper),
    (
        "nts_array_slice_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_slice_ref", Support::WasmHelper),
    ("nts_array_slice_value", Support::WasmHelper),
    ("nts_array_sort_str", Support::WasmHelper),
    ("nts_array_splice", Support::WasmHelper),
    ("nts_array_splice_ref", Support::WasmHelper),
    (
        "nts_array_to_string",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_unlend",
        Support::Decline("native/string-buffer boundary"),
    ),
    ("nts_array_unshift", Support::Intrinsic),
    ("nts_array_unshift_ref", Support::Intrinsic),
    (
        "nts_array_writable",
        Support::Decline("array helper not yet implemented"),
    ),
    ("nts_assertion_failed", Support::Intrinsic),
    ("nts_bigint_as_intn", Support::WasmHelper),
    ("nts_bigint_as_uintn", Support::WasmHelper),
    ("nts_bigint_box", Support::Intrinsic),
    ("nts_bigint_compare_string", Support::WasmHelper),
    ("nts_bigint_from_number", Support::WasmHelper),
    ("nts_bigint_overflow", Support::Intrinsic),
    ("nts_bigint_pow", Support::WasmHelper),
    ("nts_bigint_shl", Support::WasmHelper),
    ("nts_bigint_shr", Support::WasmHelper),
    ("nts_bigint_to_string", Support::WasmHelper),
    ("nts_bigint_unbox", Support::Intrinsic),
    (
        "nts_block_carry",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_block_unlend",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_bool_to_string", Support::Intrinsic),
    (
        "nts_bound_function_to_string",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_bounds",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_boxed_new",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_boxed_unlend",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_buffer_byte_length", Support::Intrinsic),
    ("nts_buffer_detached", Support::Intrinsic),
    ("nts_buffer_max_byte_length", Support::Intrinsic),
    ("nts_buffer_new", Support::WasmHelper),
    ("nts_buffer_new_resizable", Support::WasmHelper),
    ("nts_buffer_resizable", Support::Intrinsic),
    ("nts_buffer_resize", Support::WasmHelper),
    ("nts_buffer_slice", Support::WasmHelper),
    ("nts_buffer_transfer", Support::WasmHelper),
    (
        "nts_callback_enter",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_callback_leave",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_callback_task",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_callbacks_return_to_loop_when",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_cancel_delayed",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_cell_unready",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_check",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_check_fn",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_check_or_grow",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_check_or_grow_fn",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_checkpoint",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_checkpoint_after_callbacks",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_clear_timeout", Support::WasmHelper),
    (
        "nts_closure_lend",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_closure_lend_once",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_closure_notify",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_closure_unlend",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_closure_unlend_once",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_closures_owed",
        Support::Decline("foreign/native callback lifecycle"),
    ),
    (
        "nts_collect_cycles",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_collection_epoch",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_com_addref",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_answer",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_answer_string",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_base",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_carry",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_compose",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_compose_named",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_delegate",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_delegates",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_addref",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_base",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_iids",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_instance",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_name",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_query",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_outer_trust",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_query",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_query_array",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_register",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_release_array",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_releases",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_state",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_take",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_com_unlend",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_concat", Support::Intrinsic),
    ("nts_concat_fn", Support::Intrinsic),
    (
        "nts_concat_into",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_console_write", Support::WasmHelper),
    (
        "nts_counted_allocations",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_counted_releases",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_counted_retains",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_counting_reset",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_cstring_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_cstrings_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_cycle_candidates",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_dataview_buffer", Support::Intrinsic),
    ("nts_dataview_byte_length", Support::Intrinsic),
    ("nts_dataview_byte_offset", Support::Intrinsic),
    ("nts_dataview_get_bigint64", Support::WasmHelper),
    ("nts_dataview_get_biguint64", Support::WasmHelper),
    ("nts_dataview_get_float32", Support::WasmHelper),
    ("nts_dataview_get_float64", Support::WasmHelper),
    ("nts_dataview_get_int16", Support::WasmHelper),
    ("nts_dataview_get_int32", Support::WasmHelper),
    ("nts_dataview_get_int8", Support::WasmHelper),
    ("nts_dataview_get_uint16", Support::WasmHelper),
    ("nts_dataview_get_uint32", Support::WasmHelper),
    ("nts_dataview_get_uint8", Support::WasmHelper),
    ("nts_dataview_over", Support::WasmHelper),
    ("nts_dataview_part", Support::WasmHelper),
    ("nts_dataview_set_bigint64", Support::WasmHelper),
    ("nts_dataview_set_biguint64", Support::WasmHelper),
    ("nts_dataview_set_float32", Support::WasmHelper),
    ("nts_dataview_set_float64", Support::WasmHelper),
    ("nts_dataview_set_int16", Support::WasmHelper),
    ("nts_dataview_set_int32", Support::WasmHelper),
    ("nts_dataview_set_int8", Support::WasmHelper),
    ("nts_dataview_set_uint16", Support::WasmHelper),
    ("nts_dataview_set_uint32", Support::WasmHelper),
    ("nts_dataview_set_uint8", Support::WasmHelper),
    ("nts_date_new", Support::Intrinsic),
    ("nts_date_value", Support::Intrinsic),
    ("nts_decode_uri", Support::HostImport),
    (
        "nts_delay",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_dictionary_fill_from_nsdictionary",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_dictionary_fill_strings_from_nsdictionary",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_encode_uri", Support::HostImport),
    ("nts_enqueue_job", Support::WasmHelper),
    (
        "nts_enqueue_microtask",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_enqueue_tick",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_enter",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_environment_create",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_current",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_destroy",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_enter",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_has_platform",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_install_platform",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_leave",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_environment_platform",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_function_name", Support::WasmHelper),
    (
        "nts_function_to_string",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_gobject_boxed",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_gobject_boxed_copy",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_gobject_boxed_new",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_gobject_is_boxed",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_gobject_made",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_gobject_state",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_handle_check",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_handle_family_register",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_has_pending_work",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_host_checkpoint_end",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_host_install",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_hresult_clear",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_hresult_message",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_hstring_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_hstrings_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_in_callback",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_index",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_index_fn",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_is_array", Support::Intrinsic),
    ("nts_is_buffer", Support::Intrinsic),
    (
        "nts_is_class",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_is_data_view", Support::Intrinsic),
    (
        "nts_is_date",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    ("nts_is_finite", Support::Intrinsic),
    ("nts_is_integer", Support::Intrinsic),
    ("nts_is_map", Support::Intrinsic),
    (
        "nts_is_owner_thread",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_is_promise", Support::Intrinsic),
    ("nts_is_safe_integer", Support::Intrinsic),
    ("nts_is_set", Support::Intrinsic),
    ("nts_is_view_kind", Support::Intrinsic),
    (
        "nts_json_first_escape",
        Support::Decline(
            "the C runtime's JSON escape kernel; this target runs the TypeScript escaper",
        ),
    ),
    (
        "nts_json_quote",
        Support::Decline(
            "the C runtime's JSON escape kernel; this target runs the TypeScript escaper",
        ),
    ),
    (
        "nts_landing_detail",
        Support::Decline("native setjmp landing state"),
    ),
    (
        "nts_landing_pop",
        Support::Decline("native setjmp landing state"),
    ),
    (
        "nts_landing_push",
        Support::Decline("native setjmp landing state"),
    ),
    (
        "nts_landing_thrown",
        Support::Decline("native setjmp landing state"),
    ),
    (
        "nts_leave",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_live_bytes",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_live_count",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_map_clear", Support::WasmHelper),
    ("nts_map_copy", Support::WasmHelper),
    ("nts_map_delete", Support::WasmHelper),
    ("nts_map_entry", Support::WasmHelper),
    ("nts_map_entry_get", Support::WasmHelper),
    ("nts_map_entry_set", Support::WasmHelper),
    ("nts_map_extend", Support::WasmHelper),
    ("nts_map_get", Support::WasmHelper),
    ("nts_map_has", Support::WasmHelper),
    ("nts_map_key_at", Support::Intrinsic),
    ("nts_map_keys_into", Support::WasmHelper),
    ("nts_map_keys_str", Support::WasmHelper),
    ("nts_map_new", Support::Intrinsic),
    ("nts_map_next", Support::WasmHelper),
    ("nts_map_set", Support::WasmHelper),
    ("nts_map_value_at", Support::Intrinsic),
    ("nts_map_values_into", Support::WasmHelper),
    ("nts_math_acos", Support::HostImport),
    ("nts_math_asin", Support::HostImport),
    ("nts_math_atan", Support::HostImport),
    ("nts_math_atan2", Support::HostImport),
    ("nts_math_cbrt", Support::HostImport),
    ("nts_math_cos", Support::HostImport),
    ("nts_math_cosh", Support::HostImport),
    ("nts_math_exp", Support::HostImport),
    ("nts_math_expm1", Support::HostImport),
    ("nts_math_fround", Support::HostImport),
    ("nts_math_hypot", Support::HostImport),
    ("nts_math_imul", Support::HostImport),
    ("nts_math_log", Support::HostImport),
    ("nts_math_log10", Support::HostImport),
    ("nts_math_log1p", Support::HostImport),
    ("nts_math_log2", Support::HostImport),
    ("nts_math_pow", Support::HostImport),
    ("nts_math_sign", Support::HostImport),
    ("nts_math_sin", Support::HostImport),
    ("nts_math_sinh", Support::HostImport),
    ("nts_math_tan", Support::HostImport),
    ("nts_math_tanh", Support::HostImport),
    (
        "nts_max",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_max_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_min",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_min_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_no_arm",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_no_arm_of", Support::Intrinsic),
    (
        "nts_nsarray_of_objects",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_nsarray_of_strings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_nsdictionary_of_objects",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_nsdictionary_of_strings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_nsset_of_objects",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_nsset_of_strings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_nsstring_of",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_number_to_fixed", Support::HostImport),
    ("nts_number_to_string", Support::HostImport),
    (
        "nts_number_to_string_into",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_number_to_string_radix", Support::HostImport),
    (
        "nts_objc_adopt",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_objc_register_class",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_objc_state",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_object_new",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_object_to_string",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_parse_float", Support::HostImport),
    ("nts_parse_int", Support::HostImport),
    (
        "nts_pending_begin",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_pending_count",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_pending_end",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_permanent_count",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_post_delayed",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_post_from_any_thread",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_post_task",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_presence_clear", Support::Intrinsic),
    ("nts_presence_clear_fn", Support::Intrinsic),
    ("nts_presence_has", Support::Intrinsic),
    ("nts_presence_has_fn", Support::Intrinsic),
    ("nts_presence_has_value", Support::WasmHelper),
    ("nts_presence_init", Support::Intrinsic),
    ("nts_presence_init_fn", Support::Intrinsic),
    ("nts_presence_set", Support::Intrinsic),
    ("nts_presence_set_fn", Support::Intrinsic),
    (
        "nts_process_start",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_promise_adopt", Support::WasmHelper),
    ("nts_promise_all", Support::WasmHelper),
    ("nts_promise_claim", Support::Intrinsic),
    ("nts_promise_fulfill_number", Support::WasmHelper),
    (
        "nts_promise_fulfill_pointer",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_promise_fulfill_reference", Support::WasmHelper),
    ("nts_promise_fulfill_tagged", Support::WasmHelper),
    ("nts_promise_fulfill_value", Support::WasmHelper),
    ("nts_promise_fulfill_void", Support::WasmHelper),
    ("nts_promise_is_rejected", Support::Intrinsic),
    (
        "nts_promise_join",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_promise_new", Support::Intrinsic),
    ("nts_promise_number", Support::Intrinsic),
    ("nts_promise_pair", Support::Intrinsic),
    (
        "nts_promise_pointer",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_promise_race", Support::WasmHelper),
    ("nts_promise_reason", Support::Intrinsic),
    ("nts_promise_reference", Support::Intrinsic),
    ("nts_promise_reject", Support::WasmHelper),
    (
        "nts_promise_reject_error",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_promise_reject_value", Support::WasmHelper),
    ("nts_promise_reject_with", Support::WasmHelper),
    ("nts_promise_resolve_value", Support::WasmHelper),
    ("nts_promise_state", Support::Intrinsic),
    (
        "nts_promise_subscribe",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_promise_value", Support::Intrinsic),
    ("nts_raise", Support::WasmHelper),
    ("nts_raise_take", Support::WasmHelper),
    ("nts_raising", Support::WasmHelper),
    ("nts_refused", Support::Intrinsic),
    (
        "nts_region_begin",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_end_call",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_hold",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_keep",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_open",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_owns",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_reset",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_region_suspend",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_register_holders",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_release",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_retain",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_round",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_round_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    ("nts_set_add", Support::WasmHelper),
    ("nts_set_new", Support::Intrinsic),
    ("nts_set_timeout", Support::WasmHelper),
    (
        "nts_shl",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_shr",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_slot_or_grow",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_slot_or_grow_fn",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_str_alloc",
        Support::Decline("string helper not yet implemented"),
    ),
    ("nts_str_append", Support::Intrinsic),
    (
        "nts_str_append_at",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_append_char_at",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_append_char_code",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_append_json_quoted",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_append_number",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_append_slice",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    ("nts_str_at", Support::Intrinsic),
    (
        "nts_str_at_into",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_str_char_at", Support::WasmHelper),
    (
        "nts_str_char_at_into",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_str_char_code_at", Support::WasmHelper),
    ("nts_str_char_code_at_fn", Support::WasmHelper),
    ("nts_str_char_code_at_int", Support::WasmHelper),
    ("nts_str_char_code_at_int_fn", Support::WasmHelper),
    ("nts_str_code_point_at", Support::HostImport),
    (
        "nts_str_concat_at",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_concat_char_at",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_concat_char_code",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_concat_json_quoted",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_concat_number",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    (
        "nts_str_concat_slice",
        Support::Decline("counted in-place append, made only under reference counting"),
    ),
    ("nts_str_ends_with", Support::WasmHelper),
    ("nts_str_includes", Support::HostImport),
    ("nts_str_index_of", Support::HostImport),
    ("nts_str_index_of_from", Support::HostImport),
    ("nts_str_is_well_formed", Support::HostImport),
    ("nts_str_last_index_of", Support::HostImport),
    ("nts_str_pad_end", Support::HostImport),
    ("nts_str_pad_start", Support::HostImport),
    ("nts_str_point_width", Support::HostImport),
    (
        "nts_str_raw",
        Support::Decline("string helper not yet implemented"),
    ),
    ("nts_str_relative_at", Support::HostImport),
    ("nts_str_repeat", Support::HostImport),
    ("nts_str_replace", Support::HostImport),
    ("nts_str_replace_all", Support::HostImport),
    ("nts_str_slice", Support::WasmHelper),
    (
        "nts_str_slice_into",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_str_split", Support::WasmHelper),
    ("nts_str_starts_with", Support::WasmHelper),
    ("nts_str_substring", Support::WasmHelper),
    (
        "nts_str_substring_general",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_substring_into",
        Support::Decline("native frame-storage helper"),
    ),
    (
        "nts_str_substring_into_fn",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_str_to_lower_case", Support::HostImport),
    ("nts_str_to_number", Support::HostImport),
    ("nts_str_to_upper_case", Support::HostImport),
    ("nts_str_to_well_formed", Support::HostImport),
    ("nts_str_trim", Support::HostImport),
    ("nts_str_trim_end", Support::HostImport),
    ("nts_str_trim_start", Support::HostImport),
    (
        "nts_string_cmp",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_string_copy_hstring",
        Support::Decline("WinRT HSTRING boundary"),
    ),
    ("nts_string_eq", Support::Intrinsic),
    ("nts_string_from_char_code", Support::WasmHelper),
    (
        "nts_string_from_char_code_into",
        Support::Decline("native frame-storage helper"),
    ),
    ("nts_string_from_code_point", Support::HostImport),
    (
        "nts_string_from_code_point_into",
        Support::Decline("native frame-storage helper"),
    ),
    (
        "nts_string_from_cstring",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_from_hstring",
        Support::Decline("WinRT HSTRING boundary"),
    ),
    (
        "nts_string_from_required_cstring",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_from_required_view",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_from_utf8",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_from_view",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_of_nsstring",
        Support::Decline("Objective-C NSString boundary"),
    ),
    (
        "nts_string_to_cstring",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_to_hstring",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_to_owned_cstring",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_to_utf16",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_truthy",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_string_unlend",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_string_view",
        Support::Decline("borrowed native string-view storage"),
    ),
    (
        "nts_strings_from_cstrings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_strings_to_cstrings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_strings_to_hstrings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_symbol_description", Support::Intrinsic),
    ("nts_symbol_for", Support::WasmHelper),
    ("nts_symbol_key_for", Support::WasmHelper),
    ("nts_symbol_new", Support::Intrinsic),
    ("nts_symbol_to_string", Support::WasmHelper),
    ("nts_table_new", Support::Intrinsic),
    ("nts_tag_name", Support::WasmHelper),
    (
        "nts_tag_of_reference",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_task_run",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_template_reflection",
        Support::Decline("template reflection"),
    ),
    (
        "nts_thrown_class",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_to_index", Support::Intrinsic),
    ("nts_to_int16", Support::Intrinsic),
    ("nts_to_int16_fn", Support::Intrinsic),
    ("nts_to_int32", Support::Intrinsic),
    ("nts_to_int32_fn", Support::Intrinsic),
    ("nts_to_int8", Support::Intrinsic),
    ("nts_to_int8_fn", Support::Intrinsic),
    (
        "nts_to_integer",
        Support::Decline("numeric helper not yet implemented"),
    ),
    ("nts_to_uint16", Support::Intrinsic),
    ("nts_to_uint16_fn", Support::Intrinsic),
    ("nts_to_uint32", Support::Intrinsic),
    ("nts_to_uint32_fn", Support::Intrinsic),
    ("nts_to_uint8", Support::Intrinsic),
    ("nts_to_uint8_fn", Support::Intrinsic),
    ("nts_uncaught", Support::WasmHelper),
    (
        "nts_unit",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_unit_fn",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_ushr",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_utf16_release",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_value_boolean", Support::WasmHelper),
    ("nts_value_eq_boolean", Support::WasmHelper),
    ("nts_value_eq_boolean_fn", Support::WasmHelper),
    (
        "nts_value_eq_handle",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_value_eq_number", Support::WasmHelper),
    ("nts_value_eq_number_fn", Support::WasmHelper),
    (
        "nts_value_eq_reference",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_value_eq_string", Support::WasmHelper),
    (
        "nts_value_handle",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_value_inspect", Support::WasmHelper),
    ("nts_value_is_view", Support::Intrinsic),
    ("nts_value_number", Support::WasmHelper),
    ("nts_value_number_or", Support::WasmHelper),
    ("nts_value_of_boolean", Support::WasmHelper),
    (
        "nts_value_of_handle",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_value_of_null",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_value_of_number", Support::WasmHelper),
    (
        "nts_value_of_reference",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_of_undefined",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_reference",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_release",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_retain",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_value_strict_eq", Support::WasmHelper),
    ("nts_value_tag", Support::WasmHelper),
    ("nts_value_to_number", Support::WasmHelper),
    ("nts_value_to_number_explicit", Support::WasmHelper),
    ("nts_value_to_string", Support::WasmHelper),
    ("nts_value_truthy", Support::WasmHelper),
    ("nts_value_truthy_fn", Support::WasmHelper),
    ("nts_view_buffer", Support::Intrinsic),
    ("nts_view_byte_length", Support::WasmHelper),
    ("nts_view_byte_offset", Support::Intrinsic),
    (
        "nts_view_bytes",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_view_check",
        Support::Decline("C and LLVM element access; Wasm lowers ArrayGet on a view itself"),
    ),
    (
        "nts_view_check_fn",
        Support::Decline("C and LLVM element access; Wasm lowers ArrayGet on a view itself"),
    ),
    ("nts_view_copy_within", Support::WasmHelper),
    ("nts_view_fill", Support::WasmHelper),
    (
        "nts_view_from_bytes",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_view_from_elements",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_view_get",
        Support::Decline("run-time-kind element access no lowering calls"),
    ),
    (
        "nts_view_index",
        Support::Decline("C and LLVM element access; Wasm lowers ArrayGet on a view itself"),
    ),
    (
        "nts_view_index_fn",
        Support::Decline("C and LLVM element access; Wasm lowers ArrayGet on a view itself"),
    ),
    ("nts_view_join", Support::WasmHelper),
    ("nts_view_length", Support::WasmHelper),
    ("nts_view_new", Support::WasmHelper),
    (
        "nts_view_put",
        Support::Decline("run-time-kind element access no lowering calls"),
    ),
    ("nts_view_set", Support::WasmHelper),
    ("nts_view_slice", Support::WasmHelper),
    ("nts_view_subarray", Support::WasmHelper),
    (
        "nts_view_unlend",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_activate",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_activations",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_alloc",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_array_items",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_box",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_factory",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_free",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_is",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_listen",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_received",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_received_handles",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_received_strings",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_reference",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_unbox",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_winrt_unlisten",
        Support::Decline("foreign/native ABI or ownership"),
    ),
];
