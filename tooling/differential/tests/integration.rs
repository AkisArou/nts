// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../../compiler/test-support/scratch.rs"]
mod scratch;

#[path = "jvm_sabotage.rs"]
mod jvm_sabotage;
