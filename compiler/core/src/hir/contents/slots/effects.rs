//! Fixed transfer inputs, built once per function before the CFG fixpoint.

use super::{Aliases, Effect, effect};
use crate::hir::{self, Func, Global, HirType, Layout, ManagedType, OpKind, ValueId};

#[derive(Debug)]
pub(in crate::hir) struct Inputs {
    pub(super) aliases: Aliases,
    counts: Vec<Counts>,
}

#[derive(Debug)]
struct Counts {
    before: bool,
    after: bool,
    cleanup: bool,
    foreign: bool,
}

impl Inputs {
    pub(in crate::hir) fn of(func: &Func, layouts: &[Layout], globals: &[Global]) -> Self {
        let families = foreign_values(func);
        let counts = func
            .values
            .iter()
            .enumerate()
            .map(|(at, op)| {
                let (retain, cleanup) = store_effects(func, layouts, globals, &op.kind, &families);
                let operands = hir::operands_of(&op.kind)
                    .into_iter()
                    .any(|value| families[value.0 as usize]);
                let foreign = families[at];
                Counts {
                    before: retain || operands,
                    after: foreign || operands,
                    cleanup,
                    foreign,
                }
            })
            .collect();
        Self {
            aliases: Aliases::of(func),
            counts,
        }
    }

    pub(in crate::hir) fn before(&self, value: ValueId) -> bool {
        self.counts[value.0 as usize].before
    }

    pub(in crate::hir) fn after(&self, value: ValueId) -> bool {
        self.counts[value.0 as usize].after
    }

    pub(super) fn foreign(&self, value: ValueId) -> bool {
        self.counts[value.0 as usize].foreign
    }

    pub(in crate::hir) fn cleanup(&self, value: ValueId) -> bool {
        self.counts[value.0 as usize].cleanup
    }

    pub(in crate::hir) fn reenters(&self) -> bool {
        self.counts
            .iter()
            .any(|count| count.before || count.after || count.cleanup)
    }
}

fn foreign(ty: &HirType) -> bool {
    match ty {
        HirType::Erased => true,
        HirType::PossiblyUndefined(payload) => foreign(payload),
        // An uncounted pointer view can keep a foreign-counted owner alive.
        // Its eventual cleanup is not represented by the view's own type.
        HirType::NativePointer(_) => true,
        _ => false,
    }
}

/// rc reads the declared slot type, which can be wider than the new value.
/// An erased slot may previously have held a foreign handle even when the
/// value now being stored is a managed object or null.
fn store_effects(
    func: &Func,
    layouts: &[Layout],
    globals: &[Global],
    kind: &OpKind,
    families: &[bool],
) -> (bool, bool) {
    let (stored, old) = match effect(kind) {
        Effect::FieldWrite {
            object,
            field,
            stored,
        } => {
            let old = match &func.value(object).ty {
                HirType::Managed(ManagedType::Object(ty)) => layouts
                    .iter()
                    .find(|layout| layout.types.contains(ty))
                    .and_then(|layout| layout.fields.get(field as usize))
                    .map(|field| &field.ty),
                _ => None,
            };
            (stored, old)
        }
        Effect::ElementWrite { array, stored, .. } => {
            let old = match &func.value(array).ty {
                HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) => {
                    Some(element.as_ref())
                }
                _ => None,
            };
            (stored, old)
        }
        Effect::GlobalWrite { global, stored } => (
            stored,
            globals.get(global as usize).map(|global| &global.ty),
        ),
        _ => return (false, false),
    };
    let new = &func.value(stored).ty;
    (families[stored.0 as usize], foreign(old.unwrap_or(new)))
}

/// Resolve explicit erasures once, including chains whose definitions are not
/// in value-table order. Every value is visited once; an invalid cycle can only
/// lose authority, never claim a managed-only payload.
fn foreign_values(func: &Func) -> Vec<bool> {
    let mut known = vec![None; func.values.len()];
    let mut visiting = vec![false; func.values.len()];
    let mut path = Vec::new();
    for start in 0..func.values.len() {
        path.clear();
        let mut at = start;
        let answer = loop {
            if let Some(answer) = known[at] {
                break answer;
            }
            if visiting[at] {
                break true;
            }
            visiting[at] = true;
            path.push(at);
            let op = &func.values[at];
            match op.kind {
                OpKind::Erase { value, .. } => at = value.0 as usize,
                OpKind::ConstNull | OpKind::ConstUndefined => break false,
                _ => break foreign(&op.ty),
            }
        };
        for &at in &path {
            known[at] = Some(answer);
        }
    }
    known
        .into_iter()
        .map(|answer| answer.unwrap_or(true))
        .collect()
}
