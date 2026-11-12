// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "abstract_methods.rs"]
mod abstract_methods;

#[path = "async_methods.rs"]
mod async_methods;

#[path = "devirtualize.rs"]
mod devirtualize;

#[path = "function_names.rs"]
mod function_names;

#[path = "function_value_this.rs"]
mod function_value_this;

#[path = "guarded_calls.rs"]
mod guarded_calls;

#[path = "intrinsic_function_values.rs"]
mod intrinsic_function_values;

#[path = "literal_methods.rs"]
mod literal_methods;

#[path = "method_value_this.rs"]
mod method_value_this;

#[path = "nested_function_raising.rs"]
mod nested_function_raising;

#[path = "optional_method_receiver_absence.rs"]
mod optional_method_receiver_absence;

#[path = "prefix_receivers.rs"]
mod prefix_receivers;

#[path = "receivers.rs"]
mod receivers;
