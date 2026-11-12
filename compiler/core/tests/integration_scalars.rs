// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "bigint_literal_guards.rs"]
mod bigint_literal_guards;

#[path = "literal_assertions.rs"]
mod literal_assertions;

#[path = "native_assertions.rs"]
mod native_assertions;

#[path = "native_bigint_constants.rs"]
mod native_bigint_constants;

#[path = "native_bitfields.rs"]
mod native_bitfields;

#[path = "native_scalars.rs"]
mod native_scalars;

#[path = "provided_constants.rs"]
mod provided_constants;

#[path = "string_enum.rs"]
mod string_enum;

#[path = "symbol_values.rs"]
mod symbol_values;

#[path = "void_default.rs"]
mod void_default;
