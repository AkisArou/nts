// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "callable_projection.rs"]
mod callable_projection;

#[path = "class_exports.rs"]
mod class_exports;

#[path = "entry_abi.rs"]
mod entry_abi;

#[path = "erased_bigint.rs"]
mod erased_bigint;

#[path = "llvm_class_exports.rs"]
mod llvm_class_exports;

#[path = "physical_names.rs"]
mod physical_names;
