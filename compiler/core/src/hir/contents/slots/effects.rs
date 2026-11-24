//! Fixed transfer inputs, built once per function before the CFG fixpoint.

use super::{Aliases, Effect, effect};
use crate::hir::rc::last_use::{self, Holding, Leaning};
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
    /// frees it synchronously ([`ForeignReleases`]). A managed value is
    /// charged only around the operations rc can release it after
    /// ([`released_around`]).
    pub(in crate::hir) fn of(
        func: &Func,
        layouts: &[Layout],
        globals: &[Global],
        releases: &ForeignReleases,
    ) -> Self {
        let retained = foreign_values(func, retain_can_reenter);
        let given_up = foreign_values(func, |ty| releases.release_can_reenter(ty));
        let charged = released_around(func, &given_up);
        let counts = func
            .values
            .iter()
            .enumerate()
            .map(|(at, op)| {
                let (retain, cleanup) =
                    store_effects(func, layouts, globals, &op.kind, &retained, releases);
                let operands = hir::operands_of(&op.kind);
                Counts {
                    before: retain
                        || charged.before[at]
                        || operands.iter().any(|value| retained[value.0 as usize]),
                    after: retained[at]
                        || charged.after[at]
                        || operands.iter().any(|value| retained[value.0 as usize]),
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

/// By operation: whether a release that can run program code can come
/// right before it or right after it.
///
/// A value whose retain can re-enter is counted after its definition, when a
/// copy takes it over, and around any read of it, so every such operation is
/// charged one where [`Inputs::of`] reads its operands. A managed value that
/// leads to a handle re-enters only when given up, and rc gives it up after
/// the last operation in a block that reads it (`rc::last_use::reads_of`):
/// one that defines it or names it as an operand, or reads anything leaning on
/// it. What leans on what depends on ownership, which is not settled yet, so
/// this asks the same question with every choice still open
/// ([`Holding::Unsettled`]): any value that is not a scalar copy may lean on
/// what it was made from, any store may move, any erasure may repackage, and
/// any callee may store any argument into another.
///
/// Which of those reads is the last one rc sees is not known either, so every
/// one of them that can be is charged: every operation from the last that
/// defines the value or names it as an operand on. Nothing before that can be,
/// because rc's reads always include those. Each is charged after, and after
/// the end of a region call that follows it (`last_use::released_after`).
/// One that reaches the value only through an operand made from it is
/// charged before as well, because rc reads that operand's definition at the
/// retain it puts before the operation: `x = wrap(h); retain x; release h;
/// o.f = x`. Where no operation in the block defines or names the value, rc
/// can release it on entry, before the first operation.
///
/// A value no operation in a block reads is released there on entry, at the
/// block's end or on an edge. Whatever defines it was charged in a block
/// before, and that charge's delayed cleanup is sticky, so the facts of every
/// block after it end at the block's end. A block parameter is in no block's
/// operations but is bound on every edge into its block; what each edge hands
/// it is defined before the edge, so the same holds for it. A function
/// parameter no block reads is never stored, so never taken over: its
/// caller's reference is the one given up, after the call returns.
fn released_around(func: &Func, given_up: &[bool]) -> Released {
    let mut released = Released {
        before: vec![false; func.values.len()],
        after: vec![false; func.values.len()],
    };
    if !given_up.contains(&true) {
        return released;
    }
    // A callee whose stores are not known stores any argument into any other,
    // which names a superset of what rc's summaries name.
    let Ok(frame_names) = last_use::frame_names(func, &|_| None) else {
        // Past liveness's budget nothing here is placed, so every operation
        // in a block may be followed or preceded by a release.
        for block in &func.blocks {
            for op in &block.ops {
                released.before[op.0 as usize] = true;
                released.after[op.0 as usize] = true;
            }
        }
        return released;
    };
    let arriving = last_use::arriving(func);
    let mut last_named: rustc_hash::FxHashMap<ValueId, usize> = rustc_hash::FxHashMap::default();
    for block in &func.blocks {
        // The last operation that defines or names each value: rc's last read
        // of it is never earlier.
        last_named.clear();
        for (index, op) in block.ops.iter().enumerate() {
            last_named.insert(*op, index);
            for operand in hir::operands_of(&func.values[op.0 as usize].kind) {
                last_named.insert(operand, index);
            }
        }
        let mut leaning = Leaning::new(func, Holding::Unsettled, &arriving, &block.ops);
        for (index, &op) in block.ops.iter().enumerate() {
            let operands = hir::operands_of(&func.values[op.0 as usize].kind);
            for value in last_use::reads_of(&mut leaning, &frame_names, op) {
                if !given_up[value.0 as usize] {
                    continue;
                }
                match last_named.get(&value) {
                    Some(&last) if index < last => continue,
                    Some(_) => {}
                    None => released.before[block.ops[0].0 as usize] = true,
                }
                released.after[op.0 as usize] = true;
                released.after
                    [block.ops[last_use::released_after(func, &block.ops, index)].0 as usize] =
                    true;
                if value != op && !operands.contains(&value) {
                    released.before[op.0 as usize] = true;
                }
            }
        }
    }
    released
}

struct Released {
    before: Vec<bool>,
    after: Vec<bool>,
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
