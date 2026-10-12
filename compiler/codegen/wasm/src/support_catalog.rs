//! Literal decisions: adding a helper requires an explicit reviewed row.
use super::Support;
pub(super) const ROWS: &[(&str, Support)] = &[
    (
        "nts_alloc",
        Support::Decline("native memory/provider contract"),
    ),
    (
        "nts_append_slot",
        Support::Decline("native memory/provider contract"),
    ),
    ("nts_array_at", Support::WasmHelper),
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
    (
        "nts_array_join_num",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_join_str",
        Support::Decline("array helper not yet implemented"),
    ),
    ("nts_array_keep_first", Support::Intrinsic),
    ("nts_array_last_index_of", Support::WasmHelper),
    (
        "nts_array_length",
        Support::Decline("array helper not yet implemented"),
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
    (
        "nts_array_shift",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_shift_ref",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_shift_value",
        Support::Decline("array helper not yet implemented"),
    ),
    ("nts_array_slice", Support::WasmHelper),
    (
        "nts_array_slice_foreign",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    ("nts_array_slice_ref", Support::WasmHelper),
    (
        "nts_array_sort_str",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_splice",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_splice_ref",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_to_string",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_unlend",
        Support::Decline("native/string-buffer boundary"),
    ),
    (
        "nts_array_unshift",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_unshift_ref",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_array_writable",
        Support::Decline("array helper not yet implemented"),
    ),
    (
        "nts_assertion_failed",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_bigint_as_intn",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_as_uintn",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_box",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_compare_string",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_from_number",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_shl",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_shr",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_to_string",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_bigint_unbox",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_block_carry",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_block_unlend",
        Support::Decline("foreign/native ABI or ownership"),
    ),
    (
        "nts_bool_to_string",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_buffer_byte_length",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_detached",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_max_byte_length",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_new",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_new_resizable",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_resizable",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_resize",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_slice",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_buffer_transfer",
        Support::Decline("buffer/view/DataView representation"),
    ),
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
    (
        "nts_clear_timeout",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
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
    (
        "nts_console_write",
        Support::Decline("value/control helper not yet implemented"),
    ),
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
    (
        "nts_dataview_buffer",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_byte_length",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_byte_offset",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_bigint64",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_biguint64",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_float32",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_float64",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_int16",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_int32",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_int8",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_uint16",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_uint32",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_get_uint8",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_over",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_part",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_bigint64",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_biguint64",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_float32",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_float64",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_int16",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_int32",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_int8",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_uint16",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_uint32",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_dataview_set_uint8",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_date_new",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_date_value",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_decode_uri",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_encode_uri",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_enqueue_job",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
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
    (
        "nts_function_name",
        Support::Decline("value/control helper not yet implemented"),
    ),
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
    (
        "nts_is_array",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_is_buffer",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_is_class",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_is_data_view",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_is_date",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_is_finite",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_is_integer",
        Support::Decline("numeric helper not yet implemented"),
    ),
    ("nts_is_map", Support::Decline("Map/Table/Set runtime")),
    (
        "nts_is_owner_thread",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_is_promise",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_is_safe_integer",
        Support::Decline("numeric helper not yet implemented"),
    ),
    ("nts_is_set", Support::Decline("Map/Table/Set runtime")),
    (
        "nts_is_view_kind",
        Support::Decline("buffer/view/DataView representation"),
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
    ("nts_map_clear", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_copy", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_delete", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_extend", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_get", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_has", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_key_at", Support::Decline("Map/Table/Set runtime")),
    (
        "nts_map_keys_str",
        Support::Decline("Map/Table/Set runtime"),
    ),
    ("nts_map_new", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_next", Support::Decline("Map/Table/Set runtime")),
    ("nts_map_set", Support::Decline("Map/Table/Set runtime")),
    (
        "nts_map_value_at",
        Support::Decline("Map/Table/Set runtime"),
    ),
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
    (
        "nts_no_arm_of",
        Support::Decline("value/control helper not yet implemented"),
    ),
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
    (
        "nts_number_to_fixed",
        Support::Decline("string helper not yet implemented"),
    ),
    ("nts_number_to_string", Support::HostImport),
    (
        "nts_number_to_string_into",
        Support::Decline("native frame-storage helper"),
    ),
    (
        "nts_number_to_string_radix",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_presence_clear",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_clear_fn",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_has",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_has_fn",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_has_value",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_init",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_init_fn",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_set",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_presence_set_fn",
        Support::Decline("optional-field presence representation"),
    ),
    (
        "nts_promise_adopt",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_all",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_claim",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_fulfill_number",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_fulfill_pointer",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_fulfill_reference",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_fulfill_tagged",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_fulfill_value",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_fulfill_void",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_is_rejected",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_join",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_new",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_number",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_pair",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_pointer",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_race",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_reason",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_reference",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_reject",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_reject_error",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_reject_value",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_reject_with",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_resolve_value",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_state",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_subscribe",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    (
        "nts_promise_value",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
    ("nts_raise", Support::WasmHelper),
    ("nts_raise_take", Support::WasmHelper),
    ("nts_raising", Support::WasmHelper),
    (
        "nts_refused",
        Support::Decline("value/control helper not yet implemented"),
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
    ("nts_set_add", Support::Decline("Map/Table/Set runtime")),
    ("nts_set_new", Support::Decline("Map/Table/Set runtime")),
    (
        "nts_set_timeout",
        Support::Decline("async/scheduler/host lifecycle (M5)"),
    ),
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
        "nts_str_at",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_str_code_point_at",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_ends_with",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_includes",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_index_of",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_index_of_from",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_is_well_formed",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_last_index_of",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_pad_end",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_pad_start",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_point_width",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_raw",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_relative_at",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_repeat",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_replace",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_replace_all",
        Support::Decline("string helper not yet implemented"),
    ),
    ("nts_str_slice", Support::WasmHelper),
    (
        "nts_str_slice_into",
        Support::Decline("native frame-storage helper"),
    ),
    (
        "nts_str_split",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_starts_with",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_str_to_lower_case",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_to_number",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_to_upper_case",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_to_well_formed",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_trim",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_trim_end",
        Support::Decline("string helper not yet implemented"),
    ),
    (
        "nts_str_trim_start",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_string_from_code_point",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_symbol_description",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_symbol_for",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_symbol_key_for",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_symbol_new",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    (
        "nts_symbol_to_string",
        Support::Decline("bigint/symbol/date/promise family"),
    ),
    ("nts_table_new", Support::Decline("Map/Table/Set runtime")),
    (
        "nts_tag_name",
        Support::Decline("string helper not yet implemented"),
    ),
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
    (
        "nts_to_index",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_int16",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_int16_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_int32",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_int32_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_int8",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_int8_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_integer",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_uint16",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_uint16_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_uint32",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_uint32_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_uint8",
        Support::Decline("numeric helper not yet implemented"),
    ),
    (
        "nts_to_uint8_fn",
        Support::Decline("numeric helper not yet implemented"),
    ),
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
    (
        "nts_value_inspect",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_is_view",
        Support::Decline("buffer/view/DataView representation"),
    ),
    ("nts_value_number", Support::WasmHelper),
    (
        "nts_value_number_or",
        Support::Decline("value/control helper not yet implemented"),
    ),
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
    (
        "nts_value_to_number",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_to_number_explicit",
        Support::Decline("value/control helper not yet implemented"),
    ),
    (
        "nts_value_to_string",
        Support::Decline("value/control helper not yet implemented"),
    ),
    ("nts_value_truthy", Support::WasmHelper),
    ("nts_value_truthy_fn", Support::WasmHelper),
    (
        "nts_view_buffer",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_byte_length",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_byte_offset",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_bytes",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_check",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_check_fn",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_copy_within",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_fill",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_from_bytes",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_from_elements",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_get",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_index",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_index_fn",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_join",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_length",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_new",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_put",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_set",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_slice",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_subarray",
        Support::Decline("buffer/view/DataView representation"),
    ),
    (
        "nts_view_unlend",
        Support::Decline("buffer/view/DataView representation"),
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
