// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "destructuring_reference.rs"]
mod destructuring_reference;

#[path = "hir_lowering.rs"]
mod hir_lowering;

#[path = "initialization.rs"]
mod initialization;

#[path = "printed.rs"]
mod printed;

#[path = "raw_preparation.rs"]
mod raw_preparation;
