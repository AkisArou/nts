// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../test-support/scratch.rs"]
mod scratch;

#[path = "accumulator_widths.rs"]
mod accumulator_widths;

#[path = "helper_appends.rs"]
mod helper_appends;

#[path = "json_quote_appends.rs"]
mod json_quote_appends;

#[path = "repeat_count.rs"]
mod repeat_count;

#[path = "string_accumulators.rs"]
mod string_accumulators;

#[path = "string_position_arguments.rs"]
mod string_position_arguments;

#[path = "tagged_templates.rs"]
mod tagged_templates;
