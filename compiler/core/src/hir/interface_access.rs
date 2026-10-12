//! Prepared field access consumes the source planner's complete contract.
//!
//! Shaping a caller may recover its concrete class. Leave those direct loads
//! alone; only a remaining interface receiver needs indexed dispatch. Bodies
//! authorized to read a literal's own storage are recorded explicitly, since
//! its semantic interface identity does not make that storage virtual.

use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::{BTreeMap, BTreeSet};

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, TypeId};

mod storage_proofs;

#[derive(Debug, Clone)]
pub struct Entry {
    pub slot: u32,
    pub declared: String,
}

#[derive(Debug, Clone)]
pub struct Family {
    pub face: TypeId,
    pub member: String,
    pub field: Option<u32>,
    pub getter: Entry,
    pub setter: Option<Entry>,
    pub raising: Vec<Entry>,
    pub owners: Vec<TypeId>,
    /// Pure storage reads wait until concrete source copies have been made.
    pub pending: bool,
    /// The source family needs dispatch for its stored operations. This fact
    /// survives materialization so the verifier can check the backend choice.
    pub stored_dispatch: bool,
}

impl Family {
    pub(super) fn entries(&self) -> impl Iterator<Item = &Entry> {
        std::iter::once(&self.getter)
            .chain(self.setter.iter())
            .chain(self.raising.iter())
    }
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub families: Vec<Family>,
    pub storage_bodies: BTreeMap<String, TypeId>,
    /// Missing-field getters, with their ordinary/raising convention. This is
    /// permission to consider native sharing, never proof that a body is pure.
    pub default_bodies: BTreeMap<String, bool>,
    /// Non-prefix transfers source lowering admitted through field families.
    /// A live transfer retains its explicit `FieldView` operation through all
    /// copies; the JVM consumes that operation rather than deriving a cast.
    pub native_views: BTreeSet<(TypeId, TypeId)>,
    pub mode: Option<super::InterfaceAccess>,
    by_field: FxHashMap<(TypeId, u32), usize>,
    by_selector: FxHashMap<u32, usize>,
    selectors: FxHashSet<u32>,
}

impl Plan {
    pub(super) fn prune_views(&mut self, funcs: &[Func]) {
        let views: FxHashSet<_> = funcs
            .iter()
            .flat_map(|func| &func.values)
            .filter_map(|op| match op.kind {
                OpKind::FieldView { source, face, .. } => Some((source, face)),
                _ => None,
            })
            .collect();
        self.native_views.retain(|pair| views.contains(pair));
    }
    pub(super) fn note_selector(&mut self, slot: u32) {
        self.selectors.insert(slot);
    }

    #[must_use]
    pub fn contains_selector(&self, slot: u32) -> bool {
        self.selectors.contains(&slot)
    }

    pub(super) fn push(&mut self, family: Family) {
        if let Some(field) = family.field {
            self.by_field
                .insert((family.face, field), self.families.len());
        }
        for entry in family.entries() {
            self.by_selector.insert(entry.slot, self.families.len());
        }
        self.families.push(family);
    }

    /// A published declaration cannot vouch for a concrete getter whose body
    /// settling refused. Preserve the same all-or-none supply contract while
    /// named refusals propagate through calls, before pruning clears its row.
    pub(super) fn unavailable(
        &self,
        program: &Program,
        present: &FxHashSet<&str>,
    ) -> FxHashMap<u32, String> {
        let mut missing = FxHashMap::default();
        if self.families.is_empty() {
            return missing;
        }
        let layouts = super::fields::LayoutIndex::build(program);
        for (&slot, &family) in &self.by_selector {
            for owner in &self.families[family].owners {
                let target = layouts
                    .of_class(*owner)
                    .and_then(|at| program.layouts[at].methods.get(slot as usize))
                    .and_then(Option::as_deref);
                if let Some(target) = target.filter(|name| !present.contains(name)) {
                    missing.insert(slot, target.to_owned());
                    break;
                }
            }
        }
        missing
    }

    pub(super) fn missing_dependency<'a>(
        &self,
        func: &Func,
        kind: &OpKind,
        unavailable: &'a FxHashMap<u32, String>,
    ) -> Option<&'a str> {
        let slot = match kind {
            OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                ..
            } => *slot,
            _ => self.entry(func, kind)?.slot,
        };
        unavailable.get(&slot).map(String::as_str)
    }

    fn stored_entry<'a>(&'a self, func: &Func, kind: &OpKind) -> Option<(&'a Family, &'a Entry)> {
        let (object, field, writes) = match kind {
            OpKind::FieldGet { object, field } => (*object, *field, false),
            OpKind::FieldSet { object, field, .. } => (*object, *field, true),
            _ => return None,
        };
        let HirType::Managed(ManagedType::Object(face)) = func.value(object).ty else {
            return None;
        };
        if self.storage_bodies.get(&func.name) == Some(&face) {
            return None;
        }
        let family = self.families.get(*self.by_field.get(&(face, field))?)?;
        if !family.stored_dispatch {
            return None;
        }
        let entry = if writes {
            family.setter.as_ref()
        } else {
            Some(&family.getter)
        }?;
        Some((family, entry))
    }

    fn entry<'a>(&'a self, func: &Func, kind: &OpKind) -> Option<&'a Entry> {
        let (family, entry) = self.stored_entry(func, kind)?;
        family.pending.then_some(entry)
    }

    /// A field that will become a call already keeps its declaration and rows
    /// reachable. After materialization this permission is no longer needed.
    pub(super) fn future_targets<'a>(
        &'a self,
        program: &'a Program,
        func: &Func,
        kind: &OpKind,
    ) -> Vec<&'a str> {
        let Some(entry) = self.entry(func, kind) else {
            return Vec::new();
        };
        let mut targets = vec![entry.declared.as_str()];
        targets.extend(program.layouts.iter().filter_map(|layout| {
            layout
                .methods
                .get(entry.slot as usize)
                .and_then(Option::as_deref)
        }));
        targets
    }
}

/// Run after source shaping, before numeric storage and signature decisions.
pub(super) fn materialize(program: &mut Program, mode: super::InterfaceAccess) -> usize {
    program.interface_access.mode = Some(mode);
    if mode == super::InterfaceAccess::PreserveFieldAccess {
        // These are precisely the stored operations source shaping left for
        // main's positional implementation. Its guard below still stops a
        // disagreeing layout. Eager getter calls and FieldView operations were
        // already explicit at lowering and are not rewritten here.
        for family in &mut program.interface_access.families {
            family.pending = false;
        }
        return 0;
    }
    let direct = storage_proofs::direct_sites(program);
    let plan = &program.interface_access;
    let mut replaced = 0;
    for (func, direct) in program.funcs.iter_mut().zip(direct) {
        for at in 0..func.values.len() {
            if direct.contains(&super::ValueId(u32::try_from(at).unwrap_or(u32::MAX))) {
                continue;
            }
            let Some(entry) = plan.entry(func, &func.values[at].kind) else {
                continue;
            };
            let args = match &func.values[at].kind {
                OpKind::FieldGet { object, .. } => vec![*object],
                OpKind::FieldSet { object, value, .. } => vec![*object, *value],
                _ => continue,
            };
            func.values[at].kind = OpKind::Call {
                callee: Callee::Virtual {
                    slot: entry.slot,
                    declared: entry.declared.clone(),
                },
                args,
                frame: None,
            };
            replaced += 1;
        }
    }
    for family in &mut program.interface_access.families {
        family.pending = false;
    }
    replaced
}

pub(super) fn verify_mode(program: &Program, problems: &mut Vec<super::verify::Invalid>) {
    let Some(mode) = program.interface_access.mode else {
        return;
    };
    let direct = if mode == super::InterfaceAccess::Materialize {
        storage_proofs::direct_sites(program)
    } else {
        Vec::new()
    };
    for (at, func) in program.funcs.iter().enumerate() {
        for value in func.blocks.iter().flat_map(|block| &block.ops) {
            let op = func.value(*value);
            let invalid = match mode {
                super::InterfaceAccess::Materialize => {
                    program
                        .interface_access
                        .stored_entry(func, &op.kind)
                        .is_some()
                        && !direct[at].contains(value)
                }
                super::InterfaceAccess::PreserveFieldAccess => {
                    if let OpKind::Call {
                        callee: Callee::Virtual { slot, .. },
                        ..
                    } = op.kind
                    {
                        program
                            .interface_access
                            .by_selector
                            .get(&slot)
                            .is_some_and(|family| {
                                program.interface_access.families[*family].stored_dispatch
                            })
                    } else {
                        false
                    }
                }
            };
            if invalid {
                problems.push(super::verify::Invalid::InvalidInterfaceAccess {
                    reason: format!(
                        "{}: field operation disagrees with {mode:?} preparation",
                        func.name
                    ),
                });
            }
        }
    }
}
