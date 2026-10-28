//! Provider planning over checked declarations and recorded input observations.
//!
//! This module does not read the filesystem, inspect environment variables or
//! lower source. Its caller supplies the observations and reached-use union.
//! Discovery and lowering must share the semantic classifier that produces that
//! union, including aliases and escapes.

mod builtins;
mod manifest;
mod model;
mod resolve;

pub use builtins::{LoopAdapter, LoopOptions, builtin_profiles, runtime_manifest};
pub use manifest::{Claim, FeatureId, Manifest, ProviderKind, Use, parse_manifest};
pub use model::{
    Coverage, DecisionObservation, Demand, Digest, Disposition, EntryKind, HostObservation,
    ImplementationModule, InputPath, ObservedInputs, ProviderKey, Record, RecordInputs,
    RecordRejection, Requirements, Selector, Target,
};
pub use resolve::{
    AmbientTypes, Candidate, ChoiceReason, CurrentInputs, Evidence, PackageInstance, Plan, Profile,
    Rejection, RejectionReason, Request, ResolutionError, Selected, Unavailable, resolve,
};
