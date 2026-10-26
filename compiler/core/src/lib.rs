//! HIR and whole-program analysis.
//!
//! # Why one crate
//!
//! Lowering, reachability, specialization, escape and ownership analysis, and
//! reference counting are modules here rather than separate crates: they share
//! the IR arenas and would otherwise force a large `pub` surface between crates
//! that are edited together. rustc makes the same call for the same reason.
//!
//! # Invariants
//!
//! - Every HIR operation carries an [`nts_semantic_schema::Origin`]. Not
//!   conditionally, not in debug builds. A lowering that cannot name where an
//!   operation came from cannot get it back, and every diagnostic and line
//!   table built after it points nowhere.
//!
//! # Representation
//!
//! Index arenas and newtype ids, never `Rc<RefCell<_>>`. See
//! [`nts_semantic_schema::schema`] for the reasoning, which applies here too.

pub mod erasure;
pub mod hir;
pub mod inhabit;
pub mod number;
pub mod receivers;
/// Declaration reachability, which now lives in the schema crate: it is a pure
/// query over a snapshot, and the *frontend* needs it to seed its deep passes.
/// Re-exported here so nothing that already used it has to move.
pub use nts_semantic_schema::reachability;

pub use hir::{Func, HirType, OpKind, Program};
pub use nts_semantic_schema::reachability::Reachability;

/// Stack for a thread that runs a whole compilation, shared by the CLI and
/// corpus workers. Rust's default worker stack is smaller than the CLI's
/// original 8 MiB main stack and overflows on deep binary chains.
pub const COMPILER_STACK_BYTES: usize = 8 * 1024 * 1024;
