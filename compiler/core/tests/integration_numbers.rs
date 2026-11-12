// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "bigint_obligation_arrivals.rs"]
mod bigint_obligation_arrivals;

#[path = "builtin_numeric_arguments.rs"]
mod builtin_numeric_arguments;

#[path = "exact_arithmetic.rs"]
mod exact_arithmetic;

#[path = "int32_images.rs"]
mod int32_images;

#[path = "integer_extrema.rs"]
mod integer_extrema;

#[path = "integer_same_value.rs"]
mod integer_same_value;

#[path = "one_unit_comparisons.rs"]
mod one_unit_comparisons;

#[path = "parse_int_radix.rs"]
mod parse_int_radix;
