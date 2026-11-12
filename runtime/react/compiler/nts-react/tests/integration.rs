// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "children_table.rs"]
mod children_table;

#[path = "stage.rs"]
mod stage;

#[path = "transform.rs"]
mod transform;
