// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../../test-support/scratch.rs"]
mod scratch;

#[path = "callable_projection.rs"]
mod callable_projection;

#[path = "class_exports.rs"]
mod class_exports;

#[path = "entry_abi.rs"]
mod entry_abi;

#[path = "erased_bigint.rs"]
mod erased_bigint;

#[path = "libc_named_exports.rs"]
mod libc_named_exports;

#[path = "llvm_class_exports.rs"]
mod llvm_class_exports;

#[path = "physical_names.rs"]
mod physical_names;

#[path = "published_consuming.rs"]
mod published_consuming;

#[path = "two_addons.rs"]
mod two_addons;

#[path = "landing_payload.rs"]
mod landing_payload;

#[path = "../../../test-support/landing_payload.rs"]
mod landing_payload_source;
