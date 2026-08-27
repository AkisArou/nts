//! The C backend.
//!
//! Emits readable C with `#line` directives and a sidecar `.ntsdbg` unit
//! (RFC §21.1).
//!
//! # Build this with a code builder, not string concatenation
//!
//! `docs/code-builder-macro.md` settles the approach before any of it is
//! written: `genco` for C — a whitespace-aware quasiquoter with built-in C
//! support — and a small typed IR model with an `llvm!` macro for LLVM, since
//! LLVM needs SSA validity that raw quasiquotation cannot enforce.
//!
//! The argument that matters most here is provenance. A builder shaped as
//! `block.at(origin).add(lhs, rhs)` attaches an `Origin` to every instruction
//! *structurally*, where a string emitter attaches it only when somebody
//! remembers to. RFC decision 20 is not a thing to remember at each call site,
//! and the proof of concept's own emitters are the argument against trying.
//!
//! # One decision, two backends
//!
//! This backend and the LLVM backend must never decide the same thing
//! independently. Anything a lowering chooses — what a foreign call's arguments,
//! result, failure, and shape become — is decided upstream in `nts-core` or
//! `nts-memory-lowering` and consumed identically here. The proof of concept measured what
//! happens otherwise: two emitters spelling one predicate two ways, and a
//! divergence that only a differential lane caught.

pub mod emit;

pub use emit::{
    Emitted, RUNTIME_HEADER, RUNTIME_HEADER_NAME, RUNTIME_SOURCE, RUNTIME_SOURCE_NAME,
    c_identifier, emit,
};
