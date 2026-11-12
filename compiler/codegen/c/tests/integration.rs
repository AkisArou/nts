// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../../test-support/scratch.rs"]
mod scratch;

#[path = "support/node_deps.rs"]
mod node_deps;

#[path = "../../common/test-support/c_symbols.rs"]
mod c_symbols;

#[path = "bitwise.rs"]
mod bitwise;

#[path = "class_factories.rs"]
mod class_factories;

#[path = "com.rs"]
mod com;

#[path = "com_failure.rs"]
mod com_failure;

#[path = "com_output_kinds.rs"]
mod com_output_kinds;

#[path = "com_status.rs"]
mod com_status;

#[path = "dispatch_abi.rs"]
mod dispatch_abi;

#[path = "entry_publication.rs"]
mod entry_publication;

#[path = "entry_role_intersections.rs"]
mod entry_role_intersections;

#[path = "execute.rs"]
mod execute;

#[path = "export_kinds.rs"]
mod export_kinds;

#[path = "external_erased_fields.rs"]
mod external_erased_fields;

#[path = "foreign_callback_overloads.rs"]
mod foreign_callback_overloads;

#[path = "foreign_window.rs"]
mod foreign_window;

#[path = "header.rs"]
mod header;

#[path = "native.rs"]
mod native;

#[path = "objc.rs"]
mod objc;

#[path = "ownership.rs"]
mod ownership;

#[path = "possibly_undefined.rs"]
mod possibly_undefined;

#[path = "published_empty.rs"]
mod published_empty;

#[path = "refused_names.rs"]
mod refused_names;

#[path = "remainder.rs"]
mod remainder;

#[path = "runtime_checkpoint.rs"]
mod runtime_checkpoint;

#[path = "runtime_effects.rs"]
mod runtime_effects;

#[path = "runtime_sabotage.rs"]
mod runtime_sabotage;

#[path = "tag_range.rs"]
mod tag_range;

#[path = "value_publication.rs"]
mod value_publication;
