// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "allocation_placement.rs"]
mod allocation_placement;

#[path = "counting_moves.rs"]
mod counting_moves;

#[path = "host_gc.rs"]
mod host_gc;

#[path = "identity_forwarding.rs"]
mod identity_forwarding;

#[path = "memory_analysis.rs"]
mod memory_analysis;

#[path = "memory_safety.rs"]
mod memory_safety;

#[path = "placement_sites.rs"]
mod placement_sites;

#[path = "promise_payload_is_borrowed.rs"]
mod promise_payload_is_borrowed;

#[path = "region_sites.rs"]
mod region_sites;

#[path = "written_storage.rs"]
mod written_storage;
