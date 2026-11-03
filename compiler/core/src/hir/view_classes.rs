//! Semantic typed-array class identity, indexed once and published in order.
//!
//! The index stores positions, never copied metadata: verifier mutations of an
//! element cannot leave a stale cached element for a backend to trust.

use super::{ClassId, ViewClass};
use rustc_hash::FxHashMap;

/// Ordered class records with one index keyed by semantic class identity.
#[derive(Debug, Clone, Default)]
pub struct ViewClasses {
    ordered: Vec<ViewClass>,
    by_class: FxHashMap<ClassId, usize>,
}

impl From<Vec<ViewClass>> for ViewClasses {
    fn from(mut ordered: Vec<ViewClass>) -> Self {
        ordered.sort_by_key(|view| view.class.0);
        let by_class = ordered
            .iter()
            .enumerate()
            .map(|(at, view)| {
                #[cfg(test)]
                work::note();
                (view.class, at)
            })
            .collect();
        Self { ordered, by_class }
    }
}

impl ViewClasses {
    #[must_use]
    pub fn get(&self, class: ClassId) -> Option<&ViewClass> {
        #[cfg(test)]
        work::note();
        self.by_class.get(&class).map(|at| &self.ordered[*at])
    }

    pub fn iter(&self) -> std::slice::Iter<'_, ViewClass> {
        self.ordered.iter()
    }

    /// Owned HIR can be deliberately malformed by an instrument. Check that
    /// its index still describes every current row before trusting lookups.
    pub(super) fn indexed(&self) -> bool {
        self.by_class.len() == self.ordered.len()
            && self
                .ordered
                .iter()
                .enumerate()
                .all(|(at, view)| self.by_class.get(&view.class) == Some(&at))
    }
}

impl<'a> IntoIterator for &'a ViewClasses {
    type Item = &'a ViewClass;
    type IntoIter = std::slice::Iter<'a, ViewClass>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl std::ops::Index<usize> for ViewClasses {
    type Output = ViewClass;
    fn index(&self, at: usize) -> &Self::Output {
        &self.ordered[at]
    }
}

impl std::ops::IndexMut<usize> for ViewClasses {
    fn index_mut(&mut self, at: usize) -> &mut Self::Output {
        &mut self.ordered[at]
    }
}

#[cfg(test)]
mod work {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::hir::HirType;
    use nts_semantic_schema::TypeId;
    use std::cell::Cell;

    thread_local! { static VISITS: Cell<usize> = const { Cell::new(0) }; }
    pub(super) fn note() {
        VISITS.with(|visits| visits.set(visits.get() + 1));
    }

    #[test]
    fn distinct_view_class_work_is_linear_and_metadata_is_not_copied() {
        let mut reports = Vec::new();
        for size in [16, 64, 256] {
            VISITS.with(|visits| visits.set(0));
            let mut classes: ViewClasses = (0..size)
                .rev()
                .map(|at| ViewClass {
                    class: TypeId(at),
                    name: format!("View{at}"),
                    source: None,
                    element: HirType::NUMBER,
                    base: (at > 0).then(|| TypeId(at - 1)),
                    species: None,
                })
                .collect::<Vec<_>>()
                .into();
            assert!(classes.indexed());
            for at in 0..size {
                assert_eq!(classes.get(TypeId(at)).unwrap().name, format!("View{at}"));
                assert!(classes.get(TypeId(size + at)).is_none());
            }
            let visits = VISITS.with(Cell::get);
            eprintln!("distinct view classes {size}: index+lookup visits {visits}");
            reports.push((size, visits));
            classes[0].element = HirType::Bool;
            assert_eq!(classes.get(TypeId(0)).unwrap().element, HirType::Bool);
        }
        for (size, visits) in reports {
            assert_eq!(visits, size as usize * 3);
        }
    }
}
