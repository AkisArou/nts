//! The C backend.
//!
//! Emits readable C with `#line` directives and a sidecar `.ntsdbg` unit
//! (RFC §21.1).
//!
//! # One decision, two backends
//!
//! This backend and the LLVM backend must never decide the same thing
//! independently. Anything a lowering chooses — what a foreign call's arguments,
//! result, failure, and shape become — is decided upstream in `nts-core` or
//! `nts-memory-lowering` and consumed identically here. The proof of concept measured what
//! happens otherwise: two emitters spelling one predicate two ways, and a
//! divergence that only a differential lane caught.
