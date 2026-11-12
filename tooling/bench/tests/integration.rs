// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "count.rs"]
mod count;

#[path = "layouts.rs"]
mod layouts;
