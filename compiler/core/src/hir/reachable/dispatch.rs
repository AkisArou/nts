//! A slot reaches source closure frames that can exist in this program.
//!
//! Generic templates can survive source specialization without any remaining
//! allocation. Keeping their entries solely because another closure uses the
//! same slot also keeps their otherwise unreachable calls and refusals.
//! Allocations and used slots therefore grow together. Explicit published or
//! runtime-callback entries activate their frames as well; their root rules
//! remain conservative. Ordinary class rows retain the existing contract.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::hir::fields::LayoutIndex;
use crate::hir::{Func, HirType, ManagedType, OpKind, Program};

pub(super) struct Dispatch<'p> {
    program: &'p Program,
    layouts: LayoutIndex,
    rows: FxHashMap<u32, Vec<(usize, &'p str)>>,
    entries: FxHashMap<&'p str, Vec<usize>>,
    closures: FxHashSet<usize>,
    active: FxHashSet<usize>,
    used: FxHashSet<u32>,
}

impl<'p> Dispatch<'p> {
    pub(super) fn build(program: &'p Program) -> Self {
        let mut rows: FxHashMap<u32, Vec<(usize, &str)>> = FxHashMap::default();
        let mut entries: FxHashMap<&str, Vec<usize>> = FxHashMap::default();
        let mut closures = FxHashSet::default();
        for (at, layout) in program.layouts.iter().enumerate() {
            let closure = layout
                .types
                .iter()
                .any(|ty| crate::hir::has_a_closure_body(*ty));
            if closure {
                closures.insert(at);
            }
            for (slot, name) in layout.methods.iter().enumerate() {
                let Some(name) = name.as_deref() else {
                    continue;
                };
                let Ok(slot) = u32::try_from(slot) else {
                    continue;
                };
                rows.entry(slot).or_default().push((at, name));
                if closure {
                    entries.entry(name).or_default().push(at);
                }
            }
        }
        Self {
            program,
            layouts: LayoutIndex::build(program),
            rows,
            entries,
            closures,
            active: FxHashSet::default(),
            used: FxHashSet::default(),
        }
    }

    pub(super) fn enter(&mut self, func: &Func) -> Vec<&'p str> {
        let mut frames = self
            .entries
            .get(func.name.as_str())
            .cloned()
            .unwrap_or_default();
        frames.extend(func.values.iter().filter_map(|op| {
            if matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ClosureStatic)
                && let HirType::Managed(ManagedType::Object(ty)) = op.ty
            {
                self.layouts.of_class(ty)
            } else {
                None
            }
        }));
        frames
            .into_iter()
            .flat_map(|at| self.activate(at))
            .collect()
    }

    fn activate(&mut self, at: usize) -> Vec<&'p str> {
        if !self.closures.contains(&at) || !self.active.insert(at) {
            return Vec::new();
        }
        self.program.layouts[at]
            .methods
            .iter()
            .enumerate()
            .filter(|(slot, _)| u32::try_from(*slot).is_ok_and(|slot| self.used.contains(&slot)))
            .filter_map(|(_, name)| name.as_deref())
            .collect()
    }

    pub(super) fn targets(&mut self, slot: u32) -> Vec<&'p str> {
        if !self.used.insert(slot) {
            return Vec::new();
        }
        self.rows
            .get(&slot)
            .into_iter()
            .flatten()
            .filter(|(at, _)| !self.closures.contains(at) || self.active.contains(at))
            .map(|(_, name)| *name)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Layout, TypeId};

    fn program() -> Program {
        let layout = |name: &str, ty, ordinary: &str, raises: &str| Layout {
            name: name.to_owned(),
            types: vec![TypeId(ty)],
            fields: Vec::new(),
            methods: vec![Some(ordinary.to_owned()), Some(raises.to_owned())],
            interfaces: Vec::new(),
            base: None,
        };
        Program {
            layouts: vec![
                layout("A", crate::hir::SYNTHETIC_CLOSURES, "a", "a_raising"),
                layout("B", crate::hir::SYNTHETIC_CLOSURES + 1, "b", "b_raising"),
                layout("ClosureLookingName", 1, "class", "class_raising"),
            ],
            ..Program::default()
        }
    }

    #[test]
    fn a_later_allocation_wakes_every_previously_used_slot() {
        let program = program();
        let mut dispatch = Dispatch::build(&program);
        assert_eq!(dispatch.targets(0), ["class"]);
        assert_eq!(dispatch.targets(1), ["class_raising"]);
        assert_eq!(dispatch.activate(1), ["b", "b_raising"]);
        assert!(dispatch.targets(0).is_empty());
        assert!(!dispatch.active.contains(&0));
    }

    #[test]
    fn a_slot_discovered_after_the_allocation_keeps_its_body() {
        let program = program();
        let mut dispatch = Dispatch::build(&program);
        assert!(dispatch.activate(0).is_empty());
        assert_eq!(dispatch.targets(0), ["a", "class"]);
        assert!(dispatch.activate(0).is_empty());
        assert!(!dispatch.active.contains(&1));
    }
}
