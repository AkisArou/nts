//! Which reads may observe a hole of a typed array.
//!
//! A typed `ArrayNew { fill: ArrayFill::Holes }` is zero-filled storage, and a
//! number, boolean or reference slot has no `undefined` to leave in a hole: a
//! read of one before a store answers 0, false or null where JavaScript
//! answers `undefined`. [`observations`] names every op that may make such a
//! read, so a backend can refuse it by name (Wasm does) rather than answer
//! the zero.
//!
//! The proof is a forward must-analysis over the control-flow graph: a fact
//! holds at a point when it holds on every path from the allocation to there,
//! so a store on one branch only, or in a loop body the loop may skip, proves
//! nothing where the paths meet. Of each allocation not yet complete, it knows:
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
//! any other use (an alias, an escape, a block argument) needs every slot. A
//! helper that writes every slot (`fill`) or truncates to a constant 0
//! completes the array ([`super::fills_every_slot`], [`super::sets_length`]).

use super::{
    ArrayFill, BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId,
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
        callee: Callee::External(name),
        args,
        ..
    } = kind
    {
        (super::fills_every_slot(name)
            || (super::sets_length(name)
                && args.get(1).is_some_and(|id| constant(func, *id) == Some(0))))
            && args.first() == Some(&allocation)
            && !args[1..].contains(&allocation)
    } else {
        false
    }
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
    mut observed: Option<&mut Vec<ValueId>>,
) {
    let body = &func.blocks[block.0 as usize];
    for &id in &body.ops {
        let kind = &func.value(id).kind;
        for allocation in super::operands_of(kind) {
            let Some(written) = pending.get_mut(&allocation) else {
                continue;
            };
            match apply(func, kind, allocation, lengths[&allocation], written) {
                Use::Completes => {
                    pending.remove(&allocation);
                }
                Use::Refused => {
                    if let Some(observed) = observed.as_deref_mut() {
                        observed.push(id);
                    }
                }
                Use::Admitted => {}
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
    if let Some(observed) = observed {
        // A block argument or a returned value hands the array on whole: the
        // allocation stands for the use.
        observed.extend(
            super::operands_of_terminator(&body.terminator)
                .into_iter()
                .filter(|allocation| pending.contains_key(allocation)),
        );
    }
}

/// The ops that may observe a hole of a typed allocation (`fill: Holes`): an
/// element read of a slot no store is proven to have written on every path
/// to it, and an alias, escape or block argument of an allocation not yet
/// proven complete (the allocation itself stands for a terminator's use). In
/// a stable order: blocks in the emission order (`linearize::block_order`),
/// each block's ops, then its terminator. Empty where every observation is proven.
#[must_use]
pub fn observations(func: &Func) -> Vec<ValueId> {
    let lengths = allocations(func);
    if lengths.is_empty() {
        return Vec::new();
    }
    // The order a backend emits blocks in, so the first observation is the
    // one a backend meets first.
    let order = super::linearize::block_order(func);
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
            transfer(func, block, &lengths, &mut pending, None);
            if outs[block.0 as usize].as_ref() != Some(&pending) {
                outs[block.0 as usize] = Some(pending);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut observed = Vec::new();
    for &block in &order {
        let mut pending = entry(&outs, block);
        transfer(func, block, &lengths, &mut pending, Some(&mut observed));
    }
    observed
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::observations;
    use crate::hir::{
        ArrayFill, BinOp, Block, BlockId, Func, HirType, ManagedType, Op, OpKind, Terminator,
        ValueId,
    };
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    const I32: HirType = HirType::Int {
        bits: 32,
        signed: true,
    };
    const F64: HirType = HirType::Float { bits: 64 };

    /// A function under construction: its values, and the ops of the block
    /// being written.
    struct Build {
        func: Func,
        ops: Vec<ValueId>,
    }

    impl Build {
        fn new(params: usize) -> Self {
            let mut build = Self {
                func: Func {
                    name: "f".to_owned(),
                    params: Vec::new(),
                    return_type: F64,
                    written_return: None,
                    result_absent: crate::hir::Absent::Impossible,
                    written_return_elements: Vec::new(),
                    values: Vec::new(),
                    blocks: Vec::new(),
                    origin: origin(),
                    exported: false,
                    initializes_receiver: false,
                    abstract_declaration: false,
                    async_result: None,
                    frame: None,
                    obligations: Vec::new(),
                },
                ops: Vec::new(),
            };
            for at in 0..params {
                let at = u32::try_from(at).unwrap();
                build.op(OpKind::Param(at), I32);
            }
            build
        }
        fn value(&mut self, kind: OpKind, ty: HirType) -> ValueId {
            let id = ValueId(u32::try_from(self.func.values.len()).unwrap());
            self.func.values.push(Op {
                kind,
                ty,
                origin: origin(),
            });
            id
        }
        fn op(&mut self, kind: OpKind, ty: HirType) -> ValueId {
            let id = self.value(kind, ty);
            self.ops.push(id);
            id
        }
        fn int(&mut self, stored: i128) -> ValueId {
            self.op(OpKind::ConstInt(stored), I32)
        }
        /// `new Array<number>(length)`, holes and all.
        fn allocation(&mut self, length: ValueId) -> ValueId {
            self.op(
                OpKind::ArrayNew {
                    length,
                    fill: ArrayFill::Holes,
                },
                HirType::Managed(ManagedType::Array(Box::new(F64))),
            )
        }
        fn set(&mut self, array: ValueId, index: ValueId, value: ValueId) {
            self.op(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: true,
                },
                HirType::Void,
            );
        }
        fn get(&mut self, array: ValueId, index: ValueId) -> ValueId {
            self.op(
                OpKind::ArrayGet {
                    array,
                    index,
                    checked: true,
                },
                F64,
            )
        }
        fn binary(&mut self, op: BinOp, lhs: ValueId, rhs: ValueId, ty: HirType) -> ValueId {
            self.op(OpKind::Binary { op, lhs, rhs }, ty)
        }
        /// Ends the block being written, with `params`.
        fn end(&mut self, params: &[ValueId], terminator: Terminator) {
            let ops = std::mem::take(&mut self.ops);
            self.func.blocks.push(Block {
                params: params.to_vec(),
                ops,
                terminator,
            });
        }
        fn observed(&self) -> bool {
            !observations(&self.func).is_empty()
        }
    }

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }
    fn jump(target: u32, args: Vec<ValueId>) -> Terminator {
        Terminator::Jump {
            target: BlockId(target),
            args,
        }
    }
    fn branch(cond: ValueId, then: u32, otherwise: u32) -> Terminator {
        Terminator::Branch {
            cond,
            then_target: BlockId(then),
            then_args: Vec::new(),
            else_target: BlockId(otherwise),
            else_args: Vec::new(),
        }
    }

    #[test]
    fn a_literal_written_slot_by_slot_is_complete() {
        let mut b = Build::new(0);
        let two = b.int(2);
        let array = b.allocation(two);
        let zero = b.int(0);
        let one = b.int(1);
        let stored = b.op(OpKind::ConstFloat(17.0), F64);
        b.set(array, zero, stored);
        b.set(array, one, stored);
        let read = b.get(array, one);
        b.end(&[], Terminator::Return(Some(read)));
        assert!(!b.observed());
    }

    #[test]
    fn a_read_before_its_store_is_observed() {
        let mut b = Build::new(0);
        let two = b.int(2);
        let array = b.allocation(two);
        let zero = b.int(0);
        let stored = b.op(OpKind::ConstFloat(17.0), F64);
        let read = b.get(array, zero);
        b.set(array, zero, stored);
        b.end(&[], Terminator::Return(Some(read)));
        assert_eq!(observations(&b.func), vec![read]);
    }

    /// `then`: whether the first arm stores; `otherwise`: whether the second
    /// does, or (None) throws. Both meet in array read of slot 0.
    fn arms(then: bool, otherwise: Option<bool>) -> Build {
        let mut b = Build::new(0);
        let two = b.int(2);
        let array = b.allocation(two);
        let zero = b.int(0);
        let stored = b.op(OpKind::ConstFloat(17.0), F64);
        let cond = b.op(OpKind::ConstBool(true), HirType::Bool);
        b.end(&[], branch(cond, 1, 2));
        if then {
            b.set(array, zero, stored);
        }
        b.end(&[], jump(3, Vec::new()));
        match otherwise {
            Some(writes) => {
                if writes {
                    b.set(array, zero, stored);
                }
                b.end(&[], jump(3, Vec::new()));
            }
            None => b.end(&[], Terminator::Unreachable),
        }
        let read = b.get(array, zero);
        b.end(&[], Terminator::Return(Some(read)));
        b
    }

    #[test]
    fn stores_meet_by_intersection() {
        // Both arms store: written where they meet.
        assert!(!arms(true, Some(true)).observed());
        // One arm stores: nothing proven where they meet.
        assert!(arms(true, Some(false)).observed());
        // The other arm throws: only the storing path reaches the read.
        assert!(!arms(true, None).observed());
    }

    /// How array counted fill differs from `for (counter = 0; counter < 4; counter++) array[counter] = 17`,
    /// read at `array[3]` after the loop.
    #[derive(Clone, Copy, Default)]
    struct Fill {
        start: i128,
        step: i128,
        inclusive: bool,
        bound: Option<i128>,
        guarded: bool,
        breaks: bool,
    }

    /// b0 allocates and enters b1(counter); b1 tests `counter` and enters the body b2 or
    /// leaves for b5; b2 reaches the store b4 (or branches around it); b4
    /// stores and passes `counter` to the latch b3(stepped), which steps it back to b1.
    fn counted(fill: Fill) -> Build {
        let mut b = Build::new(0);
        let length = b.int(4);
        let array = b.allocation(length);
        let stored = b.op(OpKind::ConstFloat(17.0), F64);
        let start = b.int(fill.start);
        b.end(&[], jump(1, vec![start]));
        let counter = b.value(OpKind::BlockParam(0), I32);
        let bound = match (fill.bound, fill.inclusive) {
            (Some(other), _) => b.int(other),
            (None, true) => b.int(3),
            (None, false) => length,
        };
        let op = if fill.inclusive { BinOp::Le } else { BinOp::Lt };
        let cond = b.binary(op, counter, bound, HirType::Bool);
        b.end(&[counter], branch(cond, 2, 5));
        if fill.guarded || fill.breaks {
            let taken = b.op(OpKind::ConstBool(true), HirType::Bool);
            if fill.guarded {
                b.end(
                    &[],
                    Terminator::Branch {
                        cond: taken,
                        then_target: BlockId(4),
                        then_args: Vec::new(),
                        else_target: BlockId(3),
                        else_args: vec![counter],
                    },
                );
            } else {
                b.end(&[], branch(taken, 5, 4));
            }
        } else {
            b.end(&[], jump(4, Vec::new()));
        }
        let stepped = b.value(OpKind::BlockParam(0), I32);
        let step = b.int(if fill.step == 0 { 1 } else { fill.step });
        let next = b.binary(BinOp::Add, stepped, step, I32);
        b.end(&[stepped], jump(1, vec![next]));
        b.set(array, counter, stored);
        b.end(&[], jump(3, vec![counter]));
        let last = b.int(3);
        let read = b.get(array, last);
        b.end(&[], Terminator::Return(Some(read)));
        b
    }

    #[test]
    fn a_counted_fill_completes_on_its_exit_edge() {
        assert!(!counted(Fill::default()).observed());
    }

    #[test]
    fn a_fill_that_may_not_write_every_index_is_observed() {
        let base = Fill::default();
        for (what, fill) in [
            ("starts at 1", Fill { start: 1, ..base }),
            ("steps by 2", Fill { step: 2, ..base }),
            (
                "tests counter <= 3",
                Fill {
                    inclusive: true,
                    ..base
                },
            ),
            (
                "another bound",
                Fill {
                    bound: Some(3),
                    ..base
                },
            ),
            (
                "array guarded store",
                Fill {
                    guarded: true,
                    ..base
                },
            ),
            (
                "array break first",
                Fill {
                    breaks: true,
                    ..base
                },
            ),
        ] {
            assert!(counted(fill).observed(), "{what}");
        }
    }

    #[test]
    fn a_slot_reads_back_at_the_index_value_that_stored_it() {
        for (other, observed) in [(false, false), (true, true)] {
            let mut b = Build::new(2);
            let (slot, other_slot) = (ValueId(0), ValueId(1));
            let length = b.int(4);
            let array = b.allocation(length);
            let stored = b.op(OpKind::ConstFloat(17.0), F64);
            b.set(array, slot, stored);
            let read = b.get(array, if other { other_slot } else { slot });
            b.end(&[], Terminator::Return(Some(read)));
            assert_eq!(b.observed(), observed, "other index: {other}");
        }
    }

    #[test]
    fn a_store_at_the_last_index_alone_does_not_fill_the_rest() {
        // `array[slot] = 17; if (!(slot + 1 < 4)) array[0]`.
        let mut b = Build::new(1);
        let slot = ValueId(0);
        let length = b.int(4);
        let array = b.allocation(length);
        let stored = b.op(OpKind::ConstFloat(17.0), F64);
        b.set(array, slot, stored);
        let one = b.int(1);
        let next = b.binary(BinOp::Add, slot, one, I32);
        let below = b.binary(BinOp::Lt, next, length, HirType::Bool);
        b.end(&[], branch(below, 1, 2));
        let same = b.get(array, slot);
        b.end(&[], Terminator::Return(Some(same)));
        let zero = b.int(0);
        let first = b.get(array, zero);
        b.end(&[], Terminator::Return(Some(first)));
        assert_eq!(observations(&b.func), vec![first]);
    }

    #[test]
    fn a_filled_allocation_is_never_observed() {
        // `ArrayFill::Filled`: the lowering promises every slot is written
        // before any read, so nothing is proven or observed.
        let mut b = Build::new(0);
        let two = b.int(2);
        let array = b.op(
            OpKind::ArrayNew {
                length: two,
                fill: ArrayFill::Filled,
            },
            HirType::Managed(ManagedType::Array(Box::new(F64))),
        );
        let zero = b.int(0);
        let read = b.get(array, zero);
        b.end(&[], Terminator::Return(Some(read)));
        assert!(!b.observed());
    }
}
