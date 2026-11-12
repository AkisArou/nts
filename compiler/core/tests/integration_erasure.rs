// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../test-support/scratch.rs"]
mod scratch;

#[path = "erase_absence.rs"]
mod erase_absence;

#[path = "erased.rs"]
mod erased;

#[path = "erased_copies.rs"]
mod erased_copies;

#[path = "erased_null_slots.rs"]
mod erased_null_slots;

#[path = "erasure.rs"]
mod erasure;

#[path = "owned_view_kinds.rs"]
mod owned_view_kinds;

#[path = "tag_agreement.rs"]
mod tag_agreement;
