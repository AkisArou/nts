// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../test-support/scratch.rs"]
mod scratch;

#[path = "reads.rs"]
mod reads;

#[path = "runs.rs"]
mod runs;
