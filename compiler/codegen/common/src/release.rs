//! The owned managed edges of one physical layout, shared by native emitters.
//!
//! Foreign edges keep the runtime's finalization protocol. An erased slot is
//! visited only when its tag names managed storage; it is not a pointer field.
use nts_core::hir::{HirType, Layout};

#[derive(Debug, PartialEq, Eq)]
pub struct Fields {
    pub managed: Vec<usize>,
    pub erased: Vec<usize>,
}

impl Fields {
    #[must_use]
    pub fn of(layout: &Layout) -> Self {
        Self {
            managed: layout.pointer_fields(),
            erased: layout
                .fields
                .iter()
                .enumerate()
                .filter_map(|(at, field)| (field.ty == HirType::Erased).then_some(at))
                .collect(),
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.managed.is_empty() && self.erased.is_empty()
    }
}
