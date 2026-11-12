// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "a_sort_comparator_crosses_a_try.rs"]
mod a_sort_comparator_crosses_a_try;

#[path = "array_allocation_choices.rs"]
mod array_allocation_choices;

#[path = "array_buffer.rs"]
mod array_buffer;

#[path = "array_constructor_contract.rs"]
mod array_constructor_contract;

#[path = "array_from.rs"]
mod array_from;

#[path = "array_from_bounds.rs"]
mod array_from_bounds;

#[path = "array_hole_observations.rs"]
mod array_hole_observations;

#[path = "count_free_sort.rs"]
mod count_free_sort;

#[path = "unchosen_collections.rs"]
mod unchosen_collections;
