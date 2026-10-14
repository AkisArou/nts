//! Refuse observable typed holes which prepared HIR's zero fill cannot represent.
//!
//! A typed `ArrayNew { fill: ArrayFill::Holes }` holds zeros, not `undefined`, so a slot
//! may be observed only once a store has written it. The proof is a forward
//! must-analysis over the control-flow graph: a fact holds at a point when it
//! holds on every path from the allocation to there, so a store on one branch
//! only, or in a loop body the loop may skip, proves nothing where the paths
//! meet. Of each allocation not yet complete, it knows:
//! - the constant slots written: an array literal's, with the stores after a
//!   branch inside an element (a ternary, `??`, a guard that throws);
//! - written prefixes `[0, p)` and `[0, i]`, named by SSA values: a counted
//!   fill `for (i = 0; i < length; i++) a[i] = …` carries `[0, i)` around its
//!   loop in the header's parameter, and its exit edge (`i < length` false,
//!   `length` the allocation's own) completes the array;
//! - the index values stored, so `a[at] = v; … a[at]` reads a written slot.
//!
//! A fact naming a value is forgotten when that value is computed again, and a
//! block parameter takes its argument's facts along each incoming edge. The
//! length may be read before initialization; an element read needs its slot;
//! any other use (an alias, an escape, a block argument) needs every slot.

use crate::{EmitError, error::Failure};
use nts_core::hir::{
    ArrayFill, BinOp, BlockId, Func, HirType, ManagedType, OpKind, Terminator, ValueId,
};
use rustc_hash::FxHashMap;
use std::collections::BTreeSet;

/// What is proven written of one allocation that is not yet complete.
#[derive(Clone, Default, PartialEq, Eq)]
struct Written {
    /// Constant slots.
    slots: BTreeSet<u32>,
    /// Values `p` with every index below `p` written.
    below: BTreeSet<ValueId>,
    /// Values `i` with every index up to and including `i` written.
    through: BTreeSet<ValueId>,
    /// Index values a store wrote.
    at: BTreeSet<ValueId>,
    /// The value that is the allocation's length, while it still is.
    length: Option<ValueId>,
}

impl Written {
    fn meet(&mut self, other: &Self) {
        self.slots.retain(|slot| other.slots.contains(slot));
        self.below.retain(|value| other.below.contains(value));
        self.through.retain(|value| other.through.contains(value));
        self.at.retain(|value| other.at.contains(value));
        if self.length != other.length {
            self.length = None;
        }
    }

    /// `value` is computed again: what named its old value no longer holds.
    fn forget(&mut self, value: ValueId) {
        self.below.remove(&value);
        self.through.remove(&value);
        self.at.remove(&value);
        if self.length == Some(value) {
            self.length = None;
        }
    }

    fn written(&self, func: &Func, index: ValueId) -> bool {
        constant(func, index).is_some_and(|slot| self.slots.contains(&slot))
            || self.at.contains(&index)
            || self.through.contains(&index)
    }
}

/// Each allocation not yet complete. A complete allocation has no entry, and
/// neither has one not yet made: either admits every use, so absence is the
/// analysis's top.
type Pending = FxHashMap<ValueId, Written>;

/// An allocation's length: its value, and the number when that is constant.
#[derive(Clone, Copy)]
struct Length {
    value: ValueId,
    constant: Option<u32>,
}

/// One edge out of a block: where it goes, what it passes, and the branch
/// condition's value on it.
struct Edge<'f> {
    target: BlockId,
    args: &'f [ValueId],
    test: Option<(ValueId, bool)>,
}

fn edges(terminator: &Terminator) -> Vec<Edge<'_>> {
    match terminator {
        Terminator::Jump { target, args } => vec![Edge {
            target: *target,
            args,
            test: None,
        }],
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => vec![
            Edge {
                target: *then_target,
                args: then_args,
                test: Some((*cond, true)),
            },
            Edge {
                target: *else_target,
                args: else_args,
                test: Some((*cond, false)),
            },
        ],
        Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => Vec::new(),
    }
}

fn constant(func: &Func, id: ValueId) -> Option<u32> {
    let op = func.value(id);
    match op.kind {
        OpKind::ConstInt(n) => u32::try_from(n).ok(),
        OpKind::ConstFloat(mut n) => {
            if op.ty == (HirType::Float { bits: 32 }) {
                #[allow(clippy::cast_possible_truncation)]
                {
                    n = f64::from(n as f32);
                }
            }
            if !(n >= 0.0 && n <= f64::from(u32::MAX) && n.fract() == 0.0) {
                return None;
            }
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            Some(n as u32)
        }
        _ => None,
    }
}

fn harmless(func: &Func, kind: &OpKind, allocation: ValueId) -> bool {
    match kind {
        OpKind::Length(array) => *array == allocation,
        OpKind::ArraySet {
            array,
            index,
            value,
            ..
        } => *array == allocation && *index != allocation && *value != allocation,
        kind if readies(func, kind, allocation) => true,
        // Every other use needs a complete array, including aliases which
        // could otherwise hide a later element read from this proof.
        _ => false,
    }
}

fn readies(func: &Func, kind: &OpKind, allocation: ValueId) -> bool {
    if let OpKind::Call {
        callee: nts_core::hir::Callee::External(name),
        args,
        ..
    } = kind
    {
        crate::array_methods::external(name).is_some_and(|method| {
            method.initializes()
                || (method.truncates()
                    && args.get(1).is_some_and(|id| constant(func, *id) == Some(0)))
        }) && args.first() == Some(&allocation)
            && !args[1..].contains(&allocation)
    } else {
        false
    }
}

fn decline(func: &Func, id: ValueId) -> EmitError {
    Failure::Unsupported("typed array holes: observed slots are not proven initialized".into())
        .at(&func.name, &func.value(id).origin)
}

/// Each typed allocation that may hold holes, with its length.
fn allocations(func: &Func) -> FxHashMap<ValueId, Length> {
    let mut lengths = FxHashMap::default();
    for block in &func.blocks {
        for &id in &block.ops {
            let op = func.value(id);
            if let OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            } = op.kind
                && let HirType::Managed(ManagedType::Array(element)) = &op.ty
                && element.as_ref() != &HirType::Erased
            {
                let constant = constant(func, length);
                lengths.insert(
                    id,
                    Length {
                        value: length,
                        constant,
                    },
                );
            }
        }
    }
    lengths
}

/// What holds on entry to a block: a fact holds only where it holds along
/// every incoming edge. An edge from a block not yet visited constrains
/// nothing.
fn meet(mut ins: impl Iterator<Item = Pending>) -> Pending {
    let mut met = ins.next().unwrap_or_default();
    for one in ins {
        for (allocation, written) in one {
            match met.get_mut(&allocation) {
                Some(have) => have.meet(&written),
                None => {
                    met.insert(allocation, written);
                }
            }
        }
    }
    met
}

/// Whether taking `edge` out of `from` proves `i >= length` for a written
/// prefix `[0, i)`: the edge is `i < length` false or `i >= length` true,
/// tested in `from` itself, against the allocation's own length.
fn exits(func: &Func, from: BlockId, edge: &Edge<'_>, length: Length, written: &Written) -> bool {
    let Some((cond, taken)) = edge.test else {
        return false;
    };
    if !func.blocks[from.0 as usize].ops.contains(&cond) {
        return false;
    }
    let OpKind::Binary { op, lhs, rhs } = func.value(cond).kind else {
        return false;
    };
    matches!((op, taken), (BinOp::Lt, false) | (BinOp::Ge, true))
        && written.below.contains(&lhs)
        && (written.length == Some(rhs)
            || (length.constant.is_some() && constant(func, rhs) == length.constant))
}

/// The facts `out` gives the block `edge` enters: none for an allocation the
/// edge completes, and to each parameter its argument's.
fn along(
    func: &Func,
    from: BlockId,
    edge: &Edge<'_>,
    lengths: &FxHashMap<ValueId, Length>,
    out: &Pending,
) -> Pending {
    let params = &func.blocks[edge.target.0 as usize].params;
    let mut next = Pending::default();
    for (&allocation, written) in out {
        if exits(func, from, edge, lengths[&allocation], written) {
            continue;
        }
        let mut gained = Written::default();
        for (&param, &arg) in params.iter().zip(edge.args) {
            // `[0, 0)` is written of every array.
            if written.below.contains(&arg) || constant(func, arg) == Some(0) {
                gained.below.insert(param);
            }
            if written.through.contains(&arg) {
                gained.through.insert(param);
            }
            if written.at.contains(&arg) {
                gained.at.insert(param);
            }
        }
        let mut written = written.clone();
        for &param in params {
            written.forget(param);
        }
        written.below.extend(gained.below);
        written.through.extend(gained.through);
        written.at.extend(gained.at);
        next.insert(allocation, written);
    }
    next
}

/// What one use of a pending allocation does.
enum Use {
    Admitted,
    Completes,
    Refused,
}

/// A use of `allocation` by `kind`, updating its facts for a store.
fn apply(
    func: &Func,
    kind: &OpKind,
    allocation: ValueId,
    length: Length,
    written: &mut Written,
) -> Use {
    if readies(func, kind, allocation) {
        return Use::Completes;
    }
    match *kind {
        OpKind::ArraySet { array, index, .. }
            if array == allocation && harmless(func, kind, allocation) =>
        {
            if let Some(slot) = constant(func, index) {
                if length.constant.is_none_or(|n| slot < n) {
                    written.slots.insert(slot);
                    if length
                        .constant
                        .is_some_and(|n| written.slots.len() == n as usize)
                    {
                        return Use::Completes;
                    }
                }
            } else {
                written.at.insert(index);
                if written.below.contains(&index) {
                    written.through.insert(index);
                }
            }
            Use::Admitted
        }
        OpKind::ArrayGet { array, index, .. } if array == allocation => {
            if written.written(func, index) {
                Use::Admitted
            } else {
                Use::Refused
            }
        }
        _ if harmless(func, kind, allocation) => Use::Admitted,
        _ => Use::Refused,
    }
}

/// Runs `block` over `pending`. With `check`, a use the facts do not admit
/// declines.
fn transfer(
    func: &Func,
    block: BlockId,
    lengths: &FxHashMap<ValueId, Length>,
    pending: &mut Pending,
    check: bool,
) -> Result<(), EmitError> {
    let body = &func.blocks[block.0 as usize];
    for &id in &body.ops {
        let kind = &func.value(id).kind;
        for allocation in nts_core::hir::operands_of(kind) {
            let Some(written) = pending.get_mut(&allocation) else {
                continue;
            };
            match apply(func, kind, allocation, lengths[&allocation], written) {
                Use::Completes => {
                    pending.remove(&allocation);
                }
                Use::Refused if check => return Err(decline(func, id)),
                // An unadmitted use declines in the checking pass.
                Use::Admitted | Use::Refused => {}
            }
        }
        for written in pending.values_mut() {
            written.forget(id);
        }
        // `i + 1` after `[0, i]` is written: `[0, i + 1)`.
        if let OpKind::Binary {
            op: BinOp::Add,
            lhs,
            rhs,
        } = *kind
        {
            for written in pending.values_mut() {
                if (written.through.contains(&lhs) && constant(func, rhs) == Some(1))
                    || (written.through.contains(&rhs) && constant(func, lhs) == Some(1))
                {
                    written.below.insert(id);
                }
            }
        }
        if let Some(length) = lengths.get(&id)
            && length.constant != Some(0)
        {
            let written = Written {
                length: Some(length.value),
                ..Written::default()
            };
            pending.insert(id, written);
        }
    }
    if check
        && let Some(allocation) = nts_core::hir::operands_of_terminator(&body.terminator)
            .into_iter()
            .find(|allocation| pending.contains_key(allocation))
    {
        return Err(decline(func, allocation));
    }
    Ok(())
}

pub(crate) fn check(func: &Func) -> Result<(), EmitError> {
    let lengths = allocations(func);
    if lengths.is_empty() {
        return Ok(());
    }
    let order = nts_codegen_common::block_order(func);
    let all: Vec<Vec<Edge<'_>>> = func.blocks.iter().map(|b| edges(&b.terminator)).collect();
    let mut incoming = vec![Vec::new(); func.blocks.len()];
    for &block in &order {
        for (at, edge) in all[block.0 as usize].iter().enumerate() {
            incoming[edge.target.0 as usize].push((block, at));
        }
    }
    let mut outs: Vec<Option<Pending>> = vec![None; func.blocks.len()];
    let entry = |outs: &[Option<Pending>], block: BlockId| {
        meet(incoming[block.0 as usize].iter().filter_map(|&(from, at)| {
            let out = outs[from.0 as usize].as_ref()?;
            Some(along(func, from, &all[from.0 as usize][at], &lengths, out))
        }))
    };
    // To a fixed point: facts only shrink, so a loop settles in a few passes.
    loop {
        let mut changed = false;
        for &block in &order {
            let mut pending = entry(&outs, block);
            transfer(func, block, &lengths, &mut pending, false)?;
            if outs[block.0 as usize].as_ref() != Some(&pending) {
                outs[block.0 as usize] = Some(pending);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for &block in &order {
        let mut pending = entry(&outs, block);
        transfer(func, block, &lengths, &mut pending, true)?;
    }
    Ok(())
}
