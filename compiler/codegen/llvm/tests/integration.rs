// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../../test-support/scratch.rs"]
mod scratch;

#[path = "../../common/test-support/c_symbols.rs"]
mod c_symbols;

#[path = "agrees_with_c.rs"]
mod agrees_with_c;

#[path = "by_value.rs"]
mod by_value;

#[path = "callback_abi.rs"]
mod callback_abi;

#[path = "callback_result_ownership.rs"]
mod callback_result_ownership;

#[path = "com_classes.rs"]
mod com_classes;

#[path = "container_contents.rs"]
mod container_contents;

#[path = "count_free_sort.rs"]
mod count_free_sort;

#[path = "entry_parameter_roles.rs"]
mod entry_parameter_roles;

#[path = "entry_tail_ownership.rs"]
mod entry_tail_ownership;

#[path = "exported_closure_values.rs"]
mod exported_closure_values;

#[path = "literal_assertions.rs"]
mod literal_assertions;

#[path = "native.rs"]
mod native;

#[path = "objc_arc.rs"]
mod objc_arc;

#[path = "optimizations_hold.rs"]
mod optimizations_hold;

#[path = "possibly_undefined.rs"]
mod possibly_undefined;

#[path = "proved_int32_accumulators.rs"]
mod proved_int32_accumulators;

#[path = "provides.rs"]
mod provides;

#[path = "refused_names.rs"]
mod refused_names;

#[path = "rounding_width.rs"]
mod rounding_width;

#[path = "runtime_abi.rs"]
mod runtime_abi;

#[path = "signatures.rs"]
mod signatures;

#[path = "store_cycle_roots.rs"]
mod store_cycle_roots;

#[path = "task_receiver_roles.rs"]
mod task_receiver_roles;

#[path = "typed_release.rs"]
mod typed_release;

#[path = "view_constants.rs"]
mod view_constants;
