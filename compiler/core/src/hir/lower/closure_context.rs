//! Immutable closure facts shared by the builders of one program.

use std::{ops::Deref, rc::Rc};

use nts_semantic_schema::NodeId;
use rustc_hash::FxHashSet;

use super::{ClosureInfo, LoweringSnapshot};

#[derive(Debug, Default)]
struct Context {
    closures: Vec<ClosureInfo>,
    boxed: Rc<[u32]>,
    guarded: Rc<[u32]>,
    parameter_entries: Rc<FxHashSet<NodeId>>,
}

/// Source parameter membership precedes initialization and raising analysis.
/// Final variants share that membership and derive their own symbol positions.
#[derive(Clone, Debug, Default)]
pub(super) struct SharedClosures(Rc<Context>);

impl From<Vec<ClosureInfo>> for SharedClosures {
    fn from(closures: Vec<ClosureInfo>) -> Self {
        Self(Rc::new(Context {
            boxed: super::boxed_symbols(&closures).into(),
            guarded: super::guarded_symbols(&closures).into(),
            parameter_entries: Rc::default(),
            closures,
        }))
    }
}

impl SharedClosures {
    /// Once for the authored closures of this immutable lowering snapshot.
    pub(super) fn new(snapshot: &LoweringSnapshot<'_>, closures: Vec<ClosureInfo>) -> Self {
        let parameter_entries = super::parameter_entries::affected(snapshot, &closures);
        Self::with_entries(closures, Rc::new(parameter_entries))
    }

    /// Variants keep the authored node identity; runtime-made closures add no
    /// parameter environment. Reuse the one source-membership decision made
    /// before initialization and raising analysis.
    pub(super) fn with_entries(
        closures: Vec<ClosureInfo>,
        parameter_entries: Rc<FxHashSet<NodeId>>,
    ) -> Self {
        Self(Rc::new(Context {
            boxed: super::boxed_symbols(&closures).into(),
            guarded: super::guarded_symbols(&closures).into(),
            closures,
            parameter_entries,
        }))
    }

    pub(super) fn parameter_entries(&self) -> Rc<FxHashSet<NodeId>> {
        Rc::clone(&self.0.parameter_entries)
    }

    pub(super) fn needs_parameter_entry(&self, callable: NodeId) -> bool {
        self.0.parameter_entries.contains(&callable)
    }

    pub(super) fn boxed(&self) -> Rc<[u32]> {
        Rc::clone(&self.0.boxed)
    }

    pub(super) fn guarded(&self) -> Rc<[u32]> {
        Rc::clone(&self.0.guarded)
    }
}

impl Deref for SharedClosures {
    type Target = [ClosureInfo];

    fn deref(&self) -> &Self::Target {
        &self.0.closures
    }
}

impl<'a> IntoIterator for &'a SharedClosures {
    type Item = &'a ClosureInfo;
    type IntoIter = std::slice::Iter<'a, ClosureInfo>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
