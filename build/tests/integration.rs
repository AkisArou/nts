// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "node_deps.rs"]
mod node_deps;

#[path = "provider_manifest.rs"]
mod provider_manifest;

#[path = "provider_profiles.rs"]
mod provider_profiles;

#[path = "provider_record.rs"]
mod provider_record;
