// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "bounds_checks.rs"]
mod bounds_checks;

#[path = "checked_read_facts.rs"]
mod checked_read_facts;

#[path = "flow_merge_bounds.rs"]
mod flow_merge_bounds;

#[path = "global_widths.rs"]
mod global_widths;

#[path = "stores_in_range.rs"]
mod stores_in_range;
