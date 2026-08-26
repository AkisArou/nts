//! `SemanticSnapshot` — the compiler's only view of TypeScript.
//!
//! # Why this crate exists
//!
//! RFC §7.1 forbids any TypeScript compiler object from escaping the frontend.
//! In the proof of concept that rule was a discipline, because the compiler was
//! itself written in TypeScript and could reach a `ts.Type` at any point. Here it
//! is structural: the checker runs in another process, in another language, and
//! the only thing that crosses is [`SemanticSnapshot`].
//!
//! # This crate has no I/O
//!
//! Deliberately. It is pure data plus validation, so the whole compiler can
//! depend on it without depending on how a snapshot gets produced. `nts-frontend-ts`
//! is what talks to a checker; swapping that out touches nothing here.
//!
//! # Provenance is not optional
//!
//! Every node carries an [`Origin`] from v1 of this schema. RFC decision 20
//! requires source provenance on every HIR and MIR operation, and provenance is
//! the one property that cannot be retrofitted — once a lowering has run without
//! it, the mapping back to source is gone.

pub mod origin;
pub mod schema;

pub use origin::{GeneratedReason, Origin, ScopeId};
pub use schema::{
    CallTarget, LiteralValue, ModuleId, ModuleRecord, NodeData, NodeId, NodeKind, NodeRecord,
    ParameterRecord, SCHEMA_VERSION, SemanticSnapshot, SignatureId, SignatureRecord, SnapshotError,
    SymbolFlags, SymbolId, SymbolRecord, TypeId, TypeKind, TypeRecord,
};
