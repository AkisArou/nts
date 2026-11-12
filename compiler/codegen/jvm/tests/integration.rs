// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "accumulators.rs"]
mod accumulators;

#[path = "android.rs"]
mod android;

#[path = "android_launcher_names.rs"]
mod android_launcher_names;

#[path = "callable_projection_override.rs"]
mod callable_projection_override;

#[path = "callable_storage.rs"]
mod callable_storage;

#[path = "callbacks.rs"]
mod callbacks;

#[path = "check_protocol.rs"]
mod check_protocol;

#[path = "class_publication.rs"]
mod class_publication;

#[path = "constructor_capabilities.rs"]
mod constructor_capabilities;

#[path = "dead_closures.rs"]
mod dead_closures;

#[path = "dispatch_source_identity.rs"]
mod dispatch_source_identity;

#[path = "empty_face.rs"]
mod empty_face;

#[path = "environment.rs"]
mod environment;

#[path = "erase_absence.rs"]
mod erase_absence;

#[path = "erased_length.rs"]
mod erased_length;

#[path = "execute.rs"]
mod execute;

#[path = "field_rows.rs"]
mod field_rows;

#[path = "field_views.rs"]
mod field_views;

#[path = "field_visibility.rs"]
mod field_visibility;

#[path = "foreign_key_format.rs"]
mod foreign_key_format;

#[path = "fused_answers.rs"]
mod fused_answers;

#[path = "generated_member_names.rs"]
mod generated_member_names;

#[path = "gzip.rs"]
mod gzip;

#[path = "identifier_parts.rs"]
mod identifier_parts;

#[path = "inbox.rs"]
mod inbox;

#[path = "inherited_faces.rs"]
mod inherited_faces;

#[path = "intrinsics.rs"]
mod intrinsics;

#[path = "java_surface.rs"]
mod java_surface;

#[path = "literal_assertions.rs"]
mod literal_assertions;

#[path = "memory.rs"]
mod memory;

#[path = "method_split.rs"]
mod method_split;

#[path = "mixed_equality.rs"]
mod mixed_equality;

#[path = "module_namespace_identity.rs"]
mod module_namespace_identity;

#[path = "number_to_string.rs"]
mod number_to_string;

#[path = "owned_interface_contracts.rs"]
mod owned_interface_contracts;

#[path = "possibly_undefined.rs"]
mod possibly_undefined;

#[path = "possibly_undefined_fields.rs"]
mod possibly_undefined_fields;

#[path = "proved_views.rs"]
mod proved_views;

#[path = "provides.rs"]
mod provides;

#[path = "refusals.rs"]
mod refusals;

#[path = "refused_names.rs"]
mod refused_names;

#[path = "runtime_agrees_with_hir.rs"]
mod runtime_agrees_with_hir;

#[path = "runtime_jar.rs"]
mod runtime_jar;

#[path = "runtime_regression.rs"]
mod runtime_regression;

#[path = "sabotage.rs"]
mod sabotage;

#[path = "store.rs"]
mod store;

#[path = "string_chains.rs"]
mod string_chains;

#[path = "string_keys.rs"]
mod string_keys;

#[path = "structural_adapters.rs"]
mod structural_adapters;

#[path = "tag_table.rs"]
mod tag_table;

#[path = "throwing_dispatch.rs"]
mod throwing_dispatch;

#[path = "transport.rs"]
mod transport;

#[path = "typed_face.rs"]
mod typed_face;

#[path = "unsigned.rs"]
mod unsigned;

#[path = "unsigned_const.rs"]
mod unsigned_const;

#[path = "unsigned_entries.rs"]
mod unsigned_entries;

#[path = "view_class_allocations.rs"]
mod view_class_allocations;

#[path = "whole_program.rs"]
mod whole_program;

#[path = "wide_cursor.rs"]
mod wide_cursor;
