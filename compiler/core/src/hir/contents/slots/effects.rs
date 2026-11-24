//! Fixed transfer inputs, built once per function before the CFG fixpoint.

use super::{Aliases, Effect, effect};
use crate::hir::{
    self, ForeignReleases, Func, Global, HirType, Layout, ManagedType, OpKind, ValueId,
};

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
}

impl Inputs {
    /// `before` asks whether retaining a value can run program code, which
    /// only a foreign handle's retain does. `after` and `cleanup` ask whether
    /// giving one up can: a managed object whose layouts lead to a handle
    /// frees it synchronously ([`ForeignReleases`]). `after` charges a managed
    /// value only to its last operation in a block ([`counted_after`]).
    pub(in crate::hir) fn of(
        func: &Func,
        layouts: &[Layout],
        globals: &[Global],
        releases: &ForeignReleases,
    ) -> Self {
        let retained = foreign_values(func, retain_can_reenter);
        let given_up = foreign_values(func, |ty| releases.release_can_reenter(ty));
        let after = counted_after(func, &retained, &given_up);
        let counts = func
            .values
            .iter()
            .enumerate()
            .map(|(at, op)| {
                let (retain, cleanup) =
                    store_effects(func, layouts, globals, &op.kind, &retained, releases);
                Counts {
                    before: retain
                        || hir::operands_of(&op.kind)
                            .into_iter()
                            .any(|value| retained[value.0 as usize]),
                    after: after[at],
                    cleanup,
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

    pub(in crate::hir) fn cleanup(&self, value: ValueId) -> bool {
        self.counts[value.0 as usize].cleanup
    }

    pub(in crate::hir) fn reenters(&self) -> bool {
        self.counts
            .iter()
            .any(|count| count.before || count.after || count.cleanup)
    }
}

/// By operation: whether a native count right after it can run program code.
/// A value whose retain can re-enter is counted after its definition, when a
/// copy takes it over, and around any read of it, so every such operation
/// charges one. A managed value that leads to a handle re-enters only when
/// given up, and a release never precedes a read of the value: only the last
/// operation in its block that defines or reads it can be followed by its
/// release. A terminator's read is no operation, so a value a terminator reads
/// is charged to its last operation before it, and the delayed cleanup that
/// charge sets ends the block's facts before an edge can give the value up.
fn counted_after(func: &Func, retained: &[bool], given_up: &[bool]) -> Vec<bool> {
    let reads = |at: usize| hir::operands_of(&func.values[at].kind);
    let retains = |at: usize, operands: &[ValueId]| {
        retained[at] || operands.iter().any(|value| retained[value.0 as usize])
    };
    // An operation in no block never runs, and a parameter no block reads is
    // never stored, so never taken over: its caller's reference is the one
    // given up. Neither is charged a release; a retain-capable one keeps its
    // charge, as every definition and read of one does.
    let mut after: Vec<bool> = (0..func.values.len())
        .map(|at| retains(at, &reads(at)))
        .collect();
    let mut later = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        later.clear();
        for &op in block.ops.iter().rev() {
            let at = op.0 as usize;
            let operands = reads(at);
            after[at] = retains(at, &operands)
                || (given_up[at] && !later.contains(&op))
                || operands
                    .iter()
                    .any(|value| given_up[value.0 as usize] && !later.contains(value));
            later.extend(operands);
        }
    }
    after
}

/// Whether retaining a value of this type can run program code: only a
/// foreign handle's retain can, and an erased value can be one. Retaining a
/// managed object counts it and nothing else.
fn retain_can_reenter(ty: &HirType) -> bool {
    match ty {
        HirType::PossiblyUndefined(payload) => retain_can_reenter(payload),
        // An uncounted pointer view can keep a foreign-counted owner alive.
        // Its eventual cleanup is not represented by the view's own type.
        HirType::Erased | HirType::NativePointer(_) => true,
        _ => false,
    }
}

/// rc reads the declared slot type, which can be wider than the new value.
/// An erased slot may previously have held a foreign handle even when the
/// value now being stored is a managed object or null, and a managed old
/// value can lead to one.
fn store_effects(
    func: &Func,
    layouts: &[Layout],
    globals: &[Global],
    kind: &OpKind,
    retained: &[bool],
    releases: &ForeignReleases,
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
    (
        retained[stored.0 as usize],
        releases.release_can_reenter(old.unwrap_or(new)),
    )
}

/// Resolve explicit erasures once, including chains whose definitions are not
/// in value-table order. Every value is visited once; an invalid cycle can only
/// lose authority, never claim a managed-only payload.
fn foreign_values(func: &Func, foreign: impl Fn(&HirType) -> bool) -> Vec<bool> {
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
