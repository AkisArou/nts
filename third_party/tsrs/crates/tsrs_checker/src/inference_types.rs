//! Non-function declarations of `inference.go`.

use crate::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct InferenceKey {
    pub source: TypeId,
    pub target: TypeId,
    pub priority: InferencePriority,
    pub contravariant: bool,
    pub bivariant: bool,
}

impl std::hash::Hash for InferenceKey {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        // Preserve every key field in two words, avoiding a separate hash mix for each small field.
        let types = u64::from(self.source.0) | (u64::from(self.target.0) << 32);
        let inference = u64::from(self.priority.memo_bits())
            | (u64::from(self.contravariant) << 32)
            | (u64::from(self.bivariant) << 33);
        state.write_u64(types);
        state.write_u64(inference);
    }
}

/// Arena handle (`P<InferenceState>`), pooled through `Checker::freeinference_state` like Go.
#[derive(Default)]
pub struct InferenceState {
    pub inferences: RefCell<Vec<P<InferenceInfo>>>,
    pub original_source: Cell<Option<P<Type>>>,
    pub original_target: Cell<Option<P<Type>>>,
    pub priority: Cell<InferencePriority>,
    pub inference_priority: Cell<InferencePriority>,
    pub contravariant: Cell<bool>,
    pub bivariant: Cell<bool>,
    pub expanding_flags: Cell<ExpandingFlags>,
    pub propagation_type: Cell<Option<P<Type>>>,
    // Scratch owned by this checker's inference-state pool. Forks start with an empty pool, so a
    // frozen seed's unused states are never reused and this table needs no shared-graph overlay.
    pub visited: RefCell<FxHashMap<InferenceKey, InferencePriority>>,
    pub source_stack: RefCell<Vec<P<Type>>>,
    pub target_stack: RefCell<Vec<P<Type>>>,
    pub next: Cell<Option<P<InferenceState>>>,
    /// The walk called `clear_cached_inferences` (the inference memo, infermemo.rs).
    pub cleared_inferences: Cell<bool>,
}
