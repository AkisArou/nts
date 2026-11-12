// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "arguments.rs"]
mod arguments;

#[path = "bind_gir_request.rs"]
mod bind_gir_request;

#[path = "bind_gir_struct.rs"]
mod bind_gir_struct;

#[path = "bind_winmd.rs"]
mod bind_winmd;

#[path = "build.rs"]
mod build;

#[path = "case_roots.rs"]
mod case_roots;

#[path = "cast_family_alias.rs"]
mod cast_family_alias;

#[path = "check_report.rs"]
mod check_report;

#[path = "com_ownership.rs"]
mod com_ownership;

#[path = "config_roots.rs"]
mod config_roots;

#[path = "contents_census.rs"]
mod contents_census;

#[path = "determinism.rs"]
mod determinism;

#[path = "entry_roots.rs"]
mod entry_roots;

#[path = "expect_ir.rs"]
mod expect_ir;

#[path = "gir_for_project.rs"]
mod gir_for_project;

#[path = "host_gc.rs"]
mod host_gc;

#[path = "jvm_bindings.rs"]
mod jvm_bindings;

#[path = "multi_emit.rs"]
mod multi_emit;

#[path = "node_dependencies.rs"]
mod node_dependencies;

#[path = "platform_build_skips.rs"]
mod platform_build_skips;

#[path = "refused_virtual_slots.rs"]
mod refused_virtual_slots;

#[path = "region_placements.rs"]
mod region_placements;

#[path = "stats.rs"]
mod stats;

#[path = "stdlib_beside_throws.rs"]
mod stdlib_beside_throws;

#[path = "vfunc_slot_witness.rs"]
mod vfunc_slot_witness;

#[path = "wasm.rs"]
mod wasm;
