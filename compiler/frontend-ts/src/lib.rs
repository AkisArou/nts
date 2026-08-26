//! The TypeScript frontend.
//!
//! Owns the boundary RFC §7.1 draws: everything that knows what a TypeScript
//! checker is lives here, and nothing downstream of [`nts_semantic_schema`] does.
//!
//! The semantic authority is `tsgo` — the Go implementation of TypeScript, pinned
//! by [`tsgo::PINNED_TSGO`]. We speak its API protocol over a pipe rather than
//! linking it, so the checker's memory, GC, and crashes stay in another process.

pub mod source;
pub mod tsgo;

pub use source::{FrontendStats, SemanticSource};
pub use tsgo::TsgoApi;
