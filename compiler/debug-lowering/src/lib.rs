//! Debug provenance and the NTS Debug Map.
//!
//! RFC §20: source maps are one *export* of a larger model, not the canonical
//! format. This crate owns the provenance graph running from an original source
//! span through HIR, MIR, and backend operations to a linked address or DEX
//! offset, and writes it as `.ntsdbg`.
//!
//! ECMA-426 source maps, DWARF, CodeView/PDB, dSYM, and JVM SMAP are all
//! projections of that graph rather than parallel sources of truth.
