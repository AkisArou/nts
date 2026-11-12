// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "callback_index.rs"]
mod callback_index;

#[path = "length_bound.rs"]
mod length_bound;

#[path = "table_entries.rs"]
mod table_entries;

#[path = "table_for_each.rs"]
mod table_for_each;

#[path = "table_kinds.rs"]
mod table_kinds;

#[path = "widened_map_values.rs"]
mod widened_map_values;
