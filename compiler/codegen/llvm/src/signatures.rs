//! Every runtime function's signature, as clang reports it.
//!
//! # Why this is generated
//!
//! The first version of this backend read a helper's signature off the *call
//! site* -- the argument types the lowering chose and the result type the
//! operation carries. That is sound only where the two already agree, and they
//! do not: `nts_tag_name` takes a `uint32_t` and the lowering hands it a
//! double, because C converts implicitly at the call and the C backend never
//! had to think about it. LLVM has no implicit conversion, so the double went
//! into an SSE register and the callee read an integer one. `typeof v` answered
//! "undefined" for a number.
//!
//! So the signatures come from clang, which is the only thing that knows them.
//! `tests/signatures.rs` regenerates this from `nts_runtime.h` and fails if it
//! has drifted, which is what makes a generated file safe to check in.
//!
//! # The attributes are the point
//!
//! `NTS_READS_ONLY` is `__attribute__((pure))` on twenty-nine declarations, and
//! the header explains why it is not decoration: `text.indexOf("brown")` in a
//! loop is loop-invariant, and a compiler may only hoist it if it knows the
//! call has no side effects. C carries that fact and the *generated C* carries
//! it too, because the header is included. An LLVM module includes nothing --
//! so without these the second backend would be the only one that could not
//! hoist a search out of a loop.
//!
//! Taken from clang rather than restated: `pure` is `nounwind willreturn
//! memory(read)` and that mapping is clang's business, not a thing to look up
//! in a manual and get subtly wrong.

/// A runtime function: its name, its result, its parameters, and what the
/// runtime promises about it.
#[derive(Debug)]
pub struct Signature {
    pub name: &'static str,
    pub returns: &'static str,
    pub params: &'static [&'static str],
    /// Function attributes, in clang's spelling. Only the semantic ones: the
    /// target and stack-protector settings belong to whoever links, not to a
    /// declaration.
    pub attributes: &'static [&'static str],
}

/// Sorted by name, so a lookup is a binary search and a diff is readable.
pub const SIGNATURES: &[Signature] = &[
    Signature { name: "fmod", returns: "double", params: &["double", "double"], attributes: &["nounwind"] },
    Signature { name: "llvm.floor.f64", returns: "double", params: &["double"], attributes: &["nocallback", "nocreateundeforpoison", "nofree", "nosync", "nounwind", "speculatable", "willreturn", "memory(none)"] },
    Signature { name: "llvm.is.fpclass.f64", returns: "i1", params: &["double", "i32 immarg"], attributes: &["nocallback", "nofree", "nosync", "nounwind", "willreturn", "memory(none)"] },
    Signature { name: "llvm.memcpy.p0.p0.i64", returns: "void", params: &["ptr noalias writeonly captures(none)", "ptr noalias readonly captures(none)", "i64", "i1 immarg"], attributes: &["nocallback", "nofree", "nounwind", "willreturn", "memory(argmem: readwrite)"] },
    Signature { name: "llvm.trunc.f64", returns: "double", params: &["double"], attributes: &["nocallback", "nofree", "nosync", "nounwind", "willreturn", "memory(none)"] },
    Signature { name: "nts_alloc", returns: "noalias nonnull ptr", params: &["i64"], attributes: &[] },
    Signature { name: "nts_array_at", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_at_ref", returns: "ptr", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_at_value", returns: "{ i32, i64 }", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_fill", returns: "ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_array_fill_bool", returns: "ptr", params: &["ptr", "i1 zeroext"], attributes: &[] },
    Signature { name: "nts_array_fill_ref", returns: "ptr", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_array_includes", returns: "zeroext i1", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_includes_ref", returns: "zeroext i1", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_includes_str", returns: "zeroext i1", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_index_of", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_index_of_ref", returns: "double", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_index_of_str", returns: "double", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_join_str", returns: "ptr", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_array_last_index_of", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_array_new", returns: "noalias nonnull ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_array_new_uninitialized", returns: "noalias nonnull ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_array_pop", returns: "double", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_array_pop_ref", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_array_pop_value", returns: "{ i32, i64 }", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_array_push", returns: "double", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_array_push_ref", returns: "double", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_array_reverse", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_array_reverse_ref", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_array_slice", returns: "ptr", params: &["ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_array_slice_ref", returns: "ptr", params: &["ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_bigint_as_intn", returns: "i128", params: &["double", "i128"], attributes: &[] },
    Signature { name: "nts_bigint_as_uintn", returns: "i128", params: &["double", "i128"], attributes: &[] },
    Signature { name: "nts_bigint_shl", returns: "i128", params: &["i128", "i128"], attributes: &[] },
    Signature { name: "nts_bigint_shr", returns: "i128", params: &["i128", "i128"], attributes: &[] },
    Signature { name: "nts_bigint_to_string", returns: "ptr", params: &["i128"], attributes: &[] },
    Signature { name: "nts_bool_to_string", returns: "ptr", params: &["i1 zeroext"], attributes: &[] },
    Signature { name: "nts_bounds", returns: "void", params: &["double", "i32"], attributes: &[] },
    Signature { name: "nts_callback_task", returns: "void", params: &["ptr dead_on_unwind writable sret(%struct.NtsTask) align 8", "ptr", "double", "i1 zeroext"], attributes: &[] },
    Signature { name: "nts_cancel_delayed", returns: "void", params: &["i64"], attributes: &[] },
    Signature { name: "nts_cell_unready", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_check_fn", returns: "i32", params: &["ptr", "i32"], attributes: &[] },
    Signature { name: "nts_checkpoint", returns: "void", params: &[], attributes: &[] },
    Signature { name: "nts_clear_timeout", returns: "void", params: &["double"], attributes: &[] },
    Signature { name: "nts_collect_cycles", returns: "void", params: &[], attributes: &[] },
    Signature { name: "nts_concat", returns: "noalias nonnull ptr", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_concat_into", returns: "ptr", params: &["ptr", "ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_counted_allocations", returns: "i64", params: &[], attributes: &[] },
    Signature { name: "nts_counted_releases", returns: "i64", params: &[], attributes: &[] },
    Signature { name: "nts_counted_retains", returns: "i64", params: &[], attributes: &[] },
    Signature { name: "nts_counting_reset", returns: "void", params: &[], attributes: &[] },
    Signature { name: "nts_cycle_candidates", returns: "i64", params: &[], attributes: &[] },
    Signature { name: "nts_delay", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_enqueue_microtask", returns: "void", params: &["ptr byval(%struct.NtsTask) align 8"], attributes: &[] },
    Signature { name: "nts_enqueue_tick", returns: "void", params: &["ptr byval(%struct.NtsTask) align 8"], attributes: &[] },
    Signature { name: "nts_enter", returns: "void", params: &[], attributes: &[] },
    Signature { name: "nts_has_pending_work", returns: "zeroext i1", params: &[], attributes: &[] },
    Signature { name: "nts_host_install", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_index_fn", returns: "i32", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_is_finite", returns: "zeroext i1", params: &["double"], attributes: &[] },
    Signature { name: "nts_is_integer", returns: "zeroext i1", params: &["double"], attributes: &[] },
    Signature { name: "nts_is_owner_thread", returns: "zeroext i1", params: &[], attributes: &[] },
    Signature { name: "nts_is_safe_integer", returns: "zeroext i1", params: &["double"], attributes: &[] },
    Signature { name: "nts_leave", returns: "void", params: &[], attributes: &[] },
    Signature { name: "nts_live_bytes", returns: "i64", params: &[], attributes: &[] },
    Signature { name: "nts_live_count", returns: "i64", params: &[], attributes: &[] },
    Signature { name: "nts_map_clear", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_map_delete", returns: "zeroext i1", params: &["ptr", "i32", "i64"], attributes: &[] },
    Signature { name: "nts_map_get", returns: "{ i32, i64 }", params: &["ptr", "i32", "i64"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_map_has", returns: "zeroext i1", params: &["ptr", "i32", "i64"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_map_key_at", returns: "{ i32, i64 }", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_map_new", returns: "noalias nonnull ptr", params: &["double"], attributes: &[] },
    Signature { name: "nts_map_next", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_map_set", returns: "ptr", params: &["ptr", "i32", "i64", "i32", "i64"], attributes: &[] },
    Signature { name: "nts_map_value_at", returns: "{ i32, i64 }", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_math_acos", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_asin", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_atan", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_atan2", returns: "double", params: &["double", "double"], attributes: &[] },
    Signature { name: "nts_math_cbrt", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_cos", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_cosh", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_exp", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_expm1", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_fround", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_hypot", returns: "double", params: &["double", "double"], attributes: &[] },
    Signature { name: "nts_math_log", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_log10", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_log1p", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_log2", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_pow", returns: "double", params: &["double", "double"], attributes: &[] },
    Signature { name: "nts_math_sign", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_sin", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_sinh", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_tan", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_math_tanh", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_max_fn", returns: "double", params: &["double", "double"], attributes: &[] },
    Signature { name: "nts_min_fn", returns: "double", params: &["double", "double"], attributes: &[] },
    Signature { name: "nts_number_to_string", returns: "ptr", params: &["double"], attributes: &[] },
    Signature { name: "nts_number_to_string_into", returns: "ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_object_new", returns: "noalias nonnull ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_post_delayed", returns: "i64", params: &["ptr byval(%struct.NtsTask) align 8", "double", "i1 zeroext"], attributes: &[] },
    Signature { name: "nts_post_from_any_thread", returns: "void", params: &["ptr byval(%struct.NtsTask) align 8"], attributes: &[] },
    Signature { name: "nts_post_task", returns: "void", params: &["ptr byval(%struct.NtsTask) align 8"], attributes: &[] },
    Signature { name: "nts_promise_all", returns: "ptr", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_promise_fulfill_number", returns: "void", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_promise_fulfill_reference", returns: "void", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_promise_fulfill_tagged", returns: "void", params: &["ptr", "ptr", "i32"], attributes: &[] },
    Signature { name: "nts_promise_fulfill_value", returns: "void", params: &["ptr", "i32", "i64"], attributes: &[] },
    Signature { name: "nts_promise_fulfill_void", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_promise_is_rejected", returns: "zeroext i1", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_promise_new", returns: "ptr", params: &[], attributes: &[] },
    Signature { name: "nts_promise_number", returns: "double", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_promise_race", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_promise_reference", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_promise_reject", returns: "void", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_promise_reject_with", returns: "void", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_promise_subscribe", returns: "void", params: &["ptr", "ptr byval(%struct.NtsTask) align 8"], attributes: &[] },
    Signature { name: "nts_promise_value", returns: "{ i32, i64 }", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_release", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_retain", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_round_fn", returns: "double", params: &["double"], attributes: &[] },
    Signature { name: "nts_set_add", returns: "ptr", params: &["ptr", "i32", "i64"], attributes: &[] },
    Signature { name: "nts_set_new", returns: "noalias nonnull ptr", params: &["double"], attributes: &[] },
    Signature { name: "nts_set_timeout", returns: "double", params: &["ptr", "double", "double", "i1 zeroext"], attributes: &[] },
    Signature { name: "nts_str_append", returns: "ptr", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_str_char_at", returns: "ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_str_char_at_into", returns: "ptr", params: &["ptr", "ptr", "double"], attributes: &[] },
    Signature { name: "nts_str_char_code_at_fn", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_code_point_at", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_ends_with", returns: "zeroext i1", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_includes", returns: "zeroext i1", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_index_of", returns: "double", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_is_well_formed", returns: "zeroext i1", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_str_last_index_of", returns: "double", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_pad_end", returns: "ptr", params: &["ptr", "double", "ptr"], attributes: &[] },
    Signature { name: "nts_str_pad_start", returns: "ptr", params: &["ptr", "double", "ptr"], attributes: &[] },
    Signature { name: "nts_str_point_width", returns: "double", params: &["ptr", "double"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_repeat", returns: "ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_str_replace", returns: "ptr", params: &["ptr", "ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_str_replace_all", returns: "ptr", params: &["ptr", "ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_str_slice", returns: "ptr", params: &["ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_str_slice_into", returns: "ptr", params: &["ptr", "ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_str_split", returns: "ptr", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_str_starts_with", returns: "zeroext i1", params: &["ptr", "ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_str_substring", returns: "ptr", params: &["ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_str_substring_general", returns: "ptr", params: &["ptr", "ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_str_substring_into_fn", returns: "ptr", params: &["ptr", "ptr", "double", "double"], attributes: &[] },
    Signature { name: "nts_str_to_lower_case", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_str_to_upper_case", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_str_to_well_formed", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_str_trim", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_str_trim_end", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_str_trim_start", returns: "ptr", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_string_eq", returns: "zeroext i1", params: &["ptr", "ptr"], attributes: &[] },
    Signature { name: "nts_string_from_char_code", returns: "ptr", params: &["double"], attributes: &[] },
    Signature { name: "nts_string_from_char_code_into", returns: "ptr", params: &["ptr", "double"], attributes: &[] },
    Signature { name: "nts_string_from_code_point", returns: "ptr", params: &["double"], attributes: &[] },
    Signature { name: "nts_string_from_utf8", returns: "ptr", params: &["ptr", "i64"], attributes: &[] },
    Signature { name: "nts_string_truthy", returns: "zeroext i1", params: &["ptr"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_tag_name", returns: "ptr", params: &["i32"], attributes: &[] },
    Signature { name: "nts_tag_of_reference", returns: "i32", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_task_run", returns: "void", params: &["ptr byval(%struct.NtsTask) align 8"], attributes: &[] },
    Signature { name: "nts_thrown", returns: "void", params: &["ptr"], attributes: &[] },
    Signature { name: "nts_to_int16_fn", returns: "signext i16", params: &["double"], attributes: &[] },
    Signature { name: "nts_to_int32_fn", returns: "i32", params: &["double"], attributes: &[] },
    Signature { name: "nts_to_int8_fn", returns: "signext i8", params: &["double"], attributes: &[] },
    Signature { name: "nts_to_uint16_fn", returns: "zeroext i16", params: &["double"], attributes: &[] },
    Signature { name: "nts_to_uint32_fn", returns: "i32", params: &["double"], attributes: &[] },
    Signature { name: "nts_to_uint8_fn", returns: "zeroext i8", params: &["double"], attributes: &[] },
    Signature { name: "nts_unit_fn", returns: "zeroext i16", params: &["ptr", "i32"], attributes: &["nounwind", "willreturn", "memory(read)"] },
    Signature { name: "nts_value_eq_reference", returns: "zeroext i1", params: &["i32", "i64", "ptr"], attributes: &[] },
    Signature { name: "nts_value_eq_string", returns: "zeroext i1", params: &["i32", "i64", "ptr"], attributes: &[] },
    Signature { name: "nts_value_release", returns: "void", params: &["i32", "i64"], attributes: &[] },
    Signature { name: "nts_value_retain", returns: "void", params: &["i32", "i64"], attributes: &[] },
    Signature { name: "nts_value_strict_eq", returns: "zeroext i1", params: &["i32", "i64", "i32", "i64"], attributes: &[] },
    Signature { name: "nts_value_to_string", returns: "ptr", params: &["i32", "i64"], attributes: &[] },
];

/// The signature of a runtime function, if the runtime declares one.
#[must_use]
pub fn signature(name: &str) -> Option<&'static Signature> {
    SIGNATURES
        .binary_search_by(|known| known.name.cmp(name))
        .ok()
        .map(|at| &SIGNATURES[at])
}

#[cfg(test)]
mod tests {
    use super::SIGNATURES;

    /// The table is searched with `binary_search_by`, so its order is not a
    /// matter of taste.
    ///
    /// An entry in the wrong place is not found, `signature` answers `None`,
    /// and the backend refuses the call as one "the runtime declares only as a
    /// `static inline` and so exposes no symbol for" -- which is a sentence
    /// about the runtime that is simply false. `nts_str_to_lower_case` was
    /// added three rows too late and cost the LLVM column of a whole benchmark
    /// row, with a refusal message pointing at the wrong file.
    ///
    /// Nothing checked this before, and a lookup that silently answers `None`
    /// for a name that is right there is the worst shape a table can have.
    #[test]
    fn the_table_is_sorted_because_it_is_binary_searched() {
        for pair in SIGNATURES.windows(2) {
            assert!(
                pair[0].name < pair[1].name,
                "signatures out of order: `{}` must come after `{}`",
                pair[0].name,
                pair[1].name
            );
        }
    }
}
