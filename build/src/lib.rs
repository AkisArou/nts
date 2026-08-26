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
