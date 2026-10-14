//! The C backend.
//!
//! Emits readable C through `nts_codegen_common::writer::CodeWriter`, which
//! records the `Origin` of every line it writes (`CodeWriter::origins`). A
//! position is carried by the writer's shape, not by each call site
//! remembering to pass it -- the proof of concept's string emitters were the
//! argument against trusting memory. Nothing turns those origins into `#line`
//! directives or a debug sidecar yet.
//!
//! # One decision, two backends
//!
//! This backend and the LLVM backend must never decide the same thing
//! independently. Anything a lowering chooses -- what a foreign call's
//! arguments, result, failure, and shape become -- is decided upstream in
//! `nts-core` and consumed identically here. The proof of concept measured what
//! happens otherwise: two emitters spelling one predicate two ways, and a
//! divergence that only a differential lane caught.

pub mod emit;

pub use emit::{
    CF_HOST_HEADER, CF_HOST_HEADER_NAME, CF_HOST_SOURCE, CF_HOST_SOURCE_NAME, CUTILS_HEADER,
    CUTILS_HEADER_NAME, Emitted, GLIB_HOST_HEADER, GLIB_HOST_HEADER_NAME, GLIB_HOST_SOURCE,
    GLIB_HOST_SOURCE_NAME, GOBJECT_HEADER, GOBJECT_HEADER_NAME, GOBJECT_SOURCE,
    GOBJECT_SOURCE_NAME, GRISU_HEADER, GRISU_HEADER_NAME, GTK_HEADER, GTK_HEADER_NAME, GTK_SOURCE,
    GTK_SOURCE_NAME, LIBUNICODE_HEADER, LIBUNICODE_HEADER_NAME, LIBUNICODE_TABLE,
    LIBUNICODE_TABLE_NAME, LoopHost, MainShape, NATIVE_WITNESS_NAME, RUNTIME_HEADER,
    RUNTIME_HEADER_NAME, RUNTIME_SOURCE, RUNTIME_SOURCE_NAME, STRING_VIEW_HEADER,
    STRING_VIEW_HEADER_NAME, Support, UNICODE_HEADER, UNICODE_HEADER_NAME, UNICODE_SOURCE,
    UNICODE_SOURCE_NAME, UV_HOST_HEADER, UV_HOST_HEADER_NAME, UV_HOST_SOURCE, UV_HOST_SOURCE_NAME,
    WINRT_SOURCE, WINRT_SOURCE_NAME, c_global, c_identifier, c_member, emit,
    leaves_the_program_inconsistent, main_for, object_type_name, standalone_main,
    standalone_main_in_glib, support_files,
};
