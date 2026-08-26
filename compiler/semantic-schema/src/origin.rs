//! Source provenance, per RFC §20.3.
//!
//! An [`Origin`] travels with a construct from the snapshot, through HIR and
//! MIR, into the backend, and out into the `.ntsdbg` debug map. RFC decision 20
//! states that every HIR and MIR operation carries one.
//!
//! The reason this is defined here rather than in `nts-core` is ordering: the
//! frontend is the first thing that can observe a source position, so the type
//! that records it must exist before the IR does.

use nts_diagnostics::Location;
use serde::{Deserialize, Serialize};

/// Where a construct came from.
///
/// Not every field is meaningful at every stage. A snapshot node has a
/// [`Location`] and nothing else; an async resume point acquires an
/// [`Origin::async_parent`] during lowering; an inlined call acquires an
/// [`Origin::inline_chain`] during optimization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Origin {
    /// Where in the original source this came from.
    pub location: Location,
    /// The lexical scope enclosing it, if analysis has assigned one.
    pub scope: Option<ScopeId>,
    /// Innermost-first chain of call sites this was inlined through.
    pub inline_chain: Vec<Location>,
    /// For a resumed async frame, the `await` site that suspended it.
    pub async_parent: Option<Location>,
    /// Set when the compiler synthesized this rather than lowering user source.
    pub generated: Option<GeneratedReason>,
}

impl Origin {
    /// The ordinary case: a construct lowered directly from user source.
    #[must_use]
    pub const fn source(location: Location) -> Self {
        Self {
            location,
            scope: None,
            inline_chain: Vec::new(),
            async_parent: None,
            generated: None,
        }
    }

    /// A construct the compiler synthesized, attributed to the source that
    /// caused it. A GC barrier is attributed to the store that needed it.
    #[must_use]
    pub const fn generated(location: Location, reason: GeneratedReason) -> Self {
        Self {
            location,
            scope: None,
            inline_chain: Vec::new(),
            async_parent: None,
            generated: Some(reason),
        }
    }

    /// Whether a debugger should step into this by default.
    ///
    /// Generated frames are filtered out of user-facing stack traces unless the
    /// debug profile asks for them; a user stepping through their own code
    /// should not land inside a write barrier.
    #[must_use]
    pub const fn is_user_visible(&self) -> bool {
        self.generated.is_none()
    }
}

/// Identity of a lexical scope, assigned during analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ScopeId(pub u32);

/// Why the compiler synthesized a construct, per RFC §20.3.
///
/// This list is closed on purpose. A new lowering that synthesizes operations
/// adds a variant here, which forces the debug map, the stack-trace filter, and
/// the devtools frame view to acknowledge it rather than silently showing a
/// frame with no explanation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GeneratedReason {
    ClosureLowering,
    AsyncResume,
    NativeAdapter,
    ModuleInitialization,
    ReactRefreshWrapper,
    GcBarrier,
    Safepoint,
    ExceptionCleanup,
    AbiProjection,
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_diagnostics::{SourceId, Span};

    fn loc() -> Location {
        Location {
            file: SourceId(0),
            span: Span::new(10, 20),
        }
    }

    #[test]
    fn source_origins_are_user_visible() {
        assert!(Origin::source(loc()).is_user_visible());
    }

    #[test]
    fn generated_origins_are_filtered_from_user_frames() {
        let barrier = Origin::generated(loc(), GeneratedReason::GcBarrier);
        assert!(!barrier.is_user_visible());
        // The barrier still points at the store that caused it, so a heap
        // devtool can explain *why* it exists.
        assert_eq!(barrier.location, loc());
    }
}
