// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "an_accessor_crosses_a_try.rs"]
mod an_accessor_crosses_a_try;

#[path = "async_catch.rs"]
mod async_catch;

#[path = "carried_iteration_return.rs"]
mod carried_iteration_return;

#[path = "dead_code.rs"]
mod dead_code;

#[path = "destinations.rs"]
mod destinations;

#[path = "entry_surface.rs"]
mod entry_surface;

#[path = "generators.rs"]
mod generators;

#[path = "refusal_kinds.rs"]
mod refusal_kinds;

#[path = "refused_virtual_slots.rs"]
mod refused_virtual_slots;

#[path = "shadowed_refusal.rs"]
mod shadowed_refusal;

#[path = "specialized_throws.rs"]
mod specialized_throws;

#[path = "throw_across_a_call.rs"]
mod throw_across_a_call;
