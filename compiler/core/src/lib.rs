//! HIR, MIR, and whole-program analysis.
//!
//! # Why one crate
//!
//! RFC §35 lists `hir/`, `mir/`, `reachability/`, `specialization/`, `effects/`,
//! `ownership/`, and `escape-analysis/` under `compiler/core/`. Those are modules
//! here rather than separate crates: they share the IR arenas and would otherwise
//! force a large `pub` surface between crates that are edited together. rustc
//! makes the same call for the same reason.
//!
//! # Invariants
//!
//! - RFC decision 20: every HIR and MIR operation carries an
//!   [`nts_semantic_schema::Origin`]. Not conditionally, not in debug builds. A
//!   lowering that cannot name where an operation came from has already lost the
//!   debug map.
//! - RFC §7.2: MIR must not encode reference counting as the *meaning* of a
//!   managed reference. Operations stay abstract — `managed.alloc`,
//!   `managed.store`, `managed.root.enter`, `managed.safepoint` — and
//!   `nts-memory-lowering` turns them into a discipline.
//! - Analysis results are immutable inputs to lowering. A pass may describe the
//!   program; no pass may mutate it. That is what lets results be cached across an
//!   incremental build without a staleness question.
//!
//! # Representation
//!
//! Index arenas and newtype ids, never `Rc<RefCell<_>>`. See
//! [`nts_semantic_schema::schema`] for the reasoning — it applies with more force
//! here, because MIR is what gets cached, diffed for incremental builds, and
//! serialized into HMR generations.

pub mod erasure;
pub mod hir;
/// Declaration reachability, which now lives in the schema crate: it is a pure
/// query over a snapshot, and the *frontend* needs it to seed its deep passes.
/// Re-exported here so nothing that already used it has to move.
pub use nts_semantic_schema::reachability;

pub use hir::{Func, HirType, OpKind, Program};
pub use nts_semantic_schema::reachability::Reachability;
