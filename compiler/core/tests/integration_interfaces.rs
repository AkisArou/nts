// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "inferred_implements.rs"]
mod inferred_implements;

#[path = "interface_fields.rs"]
mod interface_fields;

#[path = "interface_identities.rs"]
mod interface_identities;

#[path = "interface_parents.rs"]
mod interface_parents;

#[path = "optional_interface_arguments.rs"]
mod optional_interface_arguments;

#[path = "raising_interface_seeds.rs"]
mod raising_interface_seeds;

#[path = "structural_adapters.rs"]
mod structural_adapters;

#[path = "upcast.rs"]
mod upcast;
