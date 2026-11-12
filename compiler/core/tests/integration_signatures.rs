// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../test-support/scratch.rs"]
mod scratch;

#[path = "appended_parameters.rs"]
mod appended_parameters;

#[path = "overloads.rs"]
mod overloads;

#[path = "param_shape.rs"]
mod param_shape;

#[path = "parameter_arrivals.rs"]
mod parameter_arrivals;

#[path = "parameter_defaults.rs"]
mod parameter_defaults;

#[path = "parameter_definitions.rs"]
mod parameter_definitions;

#[path = "runtime_signatures.rs"]
mod runtime_signatures;

#[path = "signature_faces.rs"]
mod signature_faces;

#[path = "signature_layouts.rs"]
mod signature_layouts;

#[path = "typed_signature_calls.rs"]
mod typed_signature_calls;

#[path = "unfilled_signatures.rs"]
mod unfilled_signatures;
