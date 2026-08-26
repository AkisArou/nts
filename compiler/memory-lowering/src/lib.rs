//! Memory providers.
//!
//! Lowers the abstract `managed.*` operations of MIR into a concrete memory
//! discipline (RFC §7.2, §9).
//!
//! Providers, in the order they land:
//!
//! - `nogc` — bring-up only. RFC §9.1: never selected silently for an application.
//! - `rc-cycle` — the first shipping native provider (RFC §9.2, decision 3).
//! - `mmtk` — experimental, gated behind RFC §3.7. Not in this crate yet.
//!
//! # Invariant
//!
//! No provider type may appear in HIR, general MIR, a public ABI, or a platform
//! host (RFC §9.3). The provider is selected at build composition time and
//! specializes fast paths during code generation, so an optimized build performs
//! no virtual call on a field store.
