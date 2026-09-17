//! Build planning and execution.
//!
//! A native build is not one compiler invocation. It is a deterministic DAG of
//! IR, objects, archives, generated sources, metadata, resources, platform
//! compilation, linking, and packaging (RFC §6).
//!
//! Lowering produces typed artifact nodes; it does not write files as a side
//! effect. The planner validates the whole graph before the executor runs any
//! external tool, so an invalid build fails before it has half-written an output.
//!
//! # Cache keys
//!
//! Every action key folds in `nts_semantic_schema::SCHEMA_VERSION`. A schema change
//! therefore invalidates derived artifacts without separate bookkeeping.
//!
//! # What is actually here
//!
//! [`config`], and nothing else yet. This crate was fourteen lines of the
//! paragraphs above and no code, depended on by nobody -- a description of a
//! build planner that did not exist, which reads as capability the same way a
//! config field nothing reaches does.
//!
//! [`config`] is its first content because it is the first thing the DAG above
//! needs: the planner cannot lower artifact nodes until something says what the
//! artifacts are. `nts emit-c` reads a product's `exports` through it today.
//!
//! [`dependencies`] is the second, and it is the half of a build graph that is
//! not ours: what a package needs that this compiler did not produce. It reads
//! each ecosystem's pinned output and never runs a resolver.

pub mod config;
pub mod dependencies;
