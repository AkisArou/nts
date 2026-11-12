// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../test-support/scratch.rs"]
mod scratch;

#[path = "compiler_providers.rs"]
mod compiler_providers;

#[path = "native_packages.rs"]
mod native_packages;

#[path = "provided_intrinsics.rs"]
mod provided_intrinsics;

#[path = "provider_identity.rs"]
mod provider_identity;

#[path = "provider_reached.rs"]
mod provider_reached;

#[path = "runtime_effects.rs"]
mod runtime_effects;

#[path = "standard_stream_writers.rs"]
mod standard_stream_writers;
