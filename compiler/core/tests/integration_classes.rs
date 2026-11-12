// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "class_export_roots.rs"]
mod class_export_roots;

#[path = "class_values.rs"]
mod class_values;

#[path = "constructor_refusal.rs"]
mod constructor_refusal;

#[path = "field_widths.rs"]
mod field_widths;

#[path = "generic_classes.rs"]
mod generic_classes;

#[path = "member_names.rs"]
mod member_names;

#[path = "private_name_slots.rs"]
mod private_name_slots;

#[path = "record_member_keys.rs"]
mod record_member_keys;

#[path = "record_parents.rs"]
mod record_parents;
