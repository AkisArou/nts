// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "advanced_types.rs"]
mod advanced_types;

#[path = "c_memory_contracts.rs"]
mod c_memory_contracts;

#[path = "calls.rs"]
mod calls;

#[path = "capture_planning.rs"]
mod capture_planning;

#[path = "checker_invariance.rs"]
mod checker_invariance;

#[path = "constants.rs"]
mod constants;

#[path = "declaration_identities.rs"]
mod declaration_identities;

#[path = "decomposition.rs"]
mod decomposition;

#[path = "diagnostic_scope.rs"]
mod diagnostic_scope;

#[path = "diagnostics.rs"]
mod diagnostics;

#[path = "fresh_resolution.rs"]
mod fresh_resolution;

#[path = "frontend_stamp.rs"]
mod frontend_stamp;

#[path = "generated_files.rs"]
mod generated_files;

#[path = "global_bindings.rs"]
mod global_bindings;

#[path = "imports.rs"]
mod imports;

#[path = "jsx_and_assignability.rs"]
mod jsx_and_assignability;

#[path = "jvm_attributes.rs"]
mod jvm_attributes;

#[path = "libraries.rs"]
mod libraries;

#[path = "modifiers.rs"]
mod modifiers;

#[path = "native_frontend.rs"]
mod native_frontend;

#[path = "native_inputs.rs"]
mod native_inputs;

#[path = "native_invariants.rs"]
mod native_invariants;

#[path = "representation.rs"]
mod representation;

#[path = "snapshot_identity.rs"]
mod snapshot_identity;

#[path = "source_inspection.rs"]
mod source_inspection;

#[path = "source_transform.rs"]
mod source_transform;

#[path = "surfaces.rs"]
mod surfaces;

#[path = "symbols.rs"]
mod symbols;

#[path = "workspace_uris.rs"]
mod workspace_uris;
