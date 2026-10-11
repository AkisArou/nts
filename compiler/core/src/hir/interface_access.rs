//! Prepared field access consumes the source planner's complete contract.
//!
//! Shaping a caller may recover its concrete class. Leave those direct loads
//! alone; only a remaining interface receiver needs indexed dispatch. Bodies
//! authorized to read a literal's own storage are recorded explicitly, since
//! its semantic interface identity does not make that storage virtual.

use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::BTreeMap;

use super::{Callee, Func, HirType, ManagedType, OpKind, Program, TypeId};

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
    pub owners: Vec<TypeId>,
    /// Pure storage reads wait until concrete source copies have been made.
    pub pending: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub families: Vec<Family>,
    pub storage_bodies: BTreeMap<String, TypeId>,
    by_field: FxHashMap<(TypeId, u32), usize>,
    selectors: FxHashSet<u32>,
}

impl Plan {
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
        self.families.push(family);
    }

    fn entry<'a>(&'a self, func: &Func, kind: &OpKind) -> Option<&'a Entry> {
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
        if !family.pending {
            return None;
        }
        if writes {
            family.setter.as_ref()
        } else {
            Some(&family.getter)
        }
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
pub(super) fn materialize(program: &mut Program) -> usize {
    let plan = &program.interface_access;
    let mut replaced = 0;
    for func in &mut program.funcs {
        for at in 0..func.values.len() {
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
