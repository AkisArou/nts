//! Owned source-interface contracts which remain physical JVM classes.
//! This index grants a method spelling, never assignability or a field view.
use nts_core::hir::{Func, HirType, Layout, ManagedType};
use nts_semantic_schema::TypeId;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{JvmProgram, types};

#[derive(Debug, Default)]
pub(super) struct Contracts {
    owners: FxHashMap<usize, usize>,
    denied: FxHashSet<usize>,
    physical: FxHashSet<usize>,
}

impl Contracts {
    pub(super) fn new(program: &JvmProgram<'_>, functions: &FxHashMap<&str, &Func>) -> Self {
        let mut identities: FxHashMap<TypeId, Option<u32>> = FxHashMap::default();
        for identity in &program.interface_identities {
            for &ty in &identity.types {
                identities
                    .entry(ty)
                    .and_modify(|known| {
                        if *known != Some(identity.symbol) {
                            *known = None;
                        }
                    })
                    .or_insert(Some(identity.symbol));
            }
        }
        let nominal: FxHashSet<_> = program
            .classes
            .iter()
            .flat_map(|class| class.types.iter().copied())
            .collect();
        let foreign: FxHashSet<_> = program
            .foreign_classes
            .iter()
            .map(|class| class.name.as_str())
            .collect();
        let mut out = Self::default();
        for (at, layout) in program.layouts.iter().enumerate() {
            if super::interface_surface(program, layout) {
                out.physical.extend(
                    layout
                        .methods
                        .iter()
                        .enumerate()
                        .filter_map(|(slot, entry)| entry.is_some().then_some(slot)),
                );
                continue;
            }
            if !layout.types.iter().any(|ty| identities.contains_key(ty)) {
                continue;
            }
            let owned = owned(program, layout, &identities, &nominal, &foreign);
            let inherited = inherited_receivers(program, layout);
            for (slot, entry) in layout.methods.iter().enumerate() {
                let Some(entry) = entry else {
                    continue;
                };
                let Some(func) = functions.get(entry.as_str()) else {
                    out.denied.insert(slot);
                    continue;
                };
                let receiver = func.params.first().and_then(|param| match &param.ty {
                    HirType::Managed(ManagedType::Object(ty)) => Some(*ty),
                    _ => None,
                });
                if !owned || !func.abstract_declaration {
                    out.denied.insert(slot);
                    continue;
                }
                if receiver.is_some_and(|ty| inherited.contains(&ty)) {
                    // A proved inherited declaration introduces no new owner.
                    // Its existing interface/companion keeps that authority.
                    continue;
                }
                if receiver.is_none_or(|ty| !layout.types.contains(&ty)) {
                    out.denied.insert(slot);
                    continue;
                }
                if let Some(prior) = out.owners.insert(slot, at)
                    && prior != at
                {
                    out.denied.insert(slot);
                }
            }
        }
        out
    }

    pub(super) fn blocked(&self, slot: usize) -> bool {
        self.denied.contains(&slot)
            || (self.owners.contains_key(&slot) && self.physical.contains(&slot))
    }

    pub(super) fn owner(&self, slot: usize) -> Option<usize> {
        if self.blocked(slot) {
            None
        } else {
            self.owners.get(&slot).copied()
        }
    }

    /// Only the explicit source edge, including its superclass's edges. It
    /// does not say that the classes extend one another in the JVM.
    pub(super) fn reaches(&self, program: &JvmProgram<'_>, layout: &Layout, slot: usize) -> bool {
        let Some(owner) = self.owner(slot).and_then(|at| program.layouts.get(at)) else {
            return false;
        };
        crate::hierarchy::ancestry(program, layout)
            .iter()
            .any(|at| at.interfaces.iter().any(|id| owner.types.contains(id)))
    }
}

fn owned(
    program: &JvmProgram<'_>,
    layout: &Layout,
    identities: &FxHashMap<TypeId, Option<u32>>,
    nominal: &FxHashSet<TypeId>,
    foreign: &FxHashSet<&str>,
) -> bool {
    let symbol = layout
        .types
        .first()
        .and_then(|ty| identities.get(ty))
        .copied()
        .flatten();
    symbol.is_some()
        && layout
            .types
            .iter()
            .all(|ty| identities.get(ty) == Some(&symbol) && !nominal.contains(ty))
        && layout.base.is_none()
        && program.declared_proved(layout)
        && !foreign.contains(layout.name.as_str())
        && !nts_core::hir::runtime::is_foreign_layout_name(&layout.name)
        && layout.types.iter().all(|ty| {
            types::object_reference(types::DEFAULT_PACKAGE, program, *ty)
                == types::class_name(types::DEFAULT_PACKAGE, layout)
        })
}

fn inherited_receivers(program: &JvmProgram<'_>, layout: &Layout) -> FxHashSet<TypeId> {
    let mut pending = program.declared_parents(layout);
    let mut types = FxHashSet::default();
    while let Some(parent) = pending.pop() {
        if parent.types.iter().any(|ty| types.contains(ty)) {
            continue;
        }
        types.extend(parent.types.iter().copied());
        pending.extend(program.declared_parents(parent));
    }
    types
}
