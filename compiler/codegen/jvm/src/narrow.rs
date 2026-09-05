//! `i64` values this target can hold in an `int` slot.
//!
//! The mirror of [`crate::widen`], and it exists for the opposite reason. That
//! one widens an `i32` to a `double` because a JVM slot is a slot and an `i2d`
//! at every use buys nothing. This one narrows an `i64` to an `int` because a
//! *loop counter* is not a slot question at all: it decides whether C2 sees a
//! counted loop, and a counted loop is the difference between scalar and packed
//! code.
//!
//! # The measurement
//!
//! The same loop written twice in Java over the same `double[]`, differing only
//! in the counter -- `int i` with `xs[i]` against `long i` with `xs[(int) i]`.
//! Instructions per call, fixed-count driver, two-point:
//!
//! ```text
//! int counter     1,414,434     0.67 instructions per element
//! long counter   18,513,608     8.8  instructions per element    13.1x
//! ```
//!
//! An `int` counter bounded by `xs.length` is a counted loop: C2 eliminates the
//! range check, unrolls, and emits packed doubles. A `long` counter is not a
//! counted loop under any circumstances, so none of that happens. `elementwise`
//! is that loop and nothing else -- a bare `double[]`, no wrapper, no erasure --
//! and it is 7.61x hand-written Java.
//!
//! On `array-predicates`, where the loop is not vectorisable anyway, the same
//! change is still 32%.
//!
//! # Why this is the backend's to decide
//!
//! `array.len` is typed `i64` in HIR. On this lane it is `arraylength`, which
//! **is** an `int`, and a growable array's length is an `int` field -- so a
//! value derived from one is provably in `[0, 2^31-9]` whatever HIR says. The
//! IR is untouched, every lane still receives the same program, and what
//! differs is how this backend realises an `i64`: the same latitude `widen`
//! takes with an `i32` and the array emission takes with `managed<[f64]>`.
//!
//! If the upstream type changes, every value here arrives `i32` already, this
//! pass finds nothing, and it should be deleted rather than kept as a fallback.
//!
//! # What is proved, and what is not
//!
//! Two disjoint arguments, because they are proved differently.
//!
//! **Acyclic** ([`Bounds`]): a constant, a `Length`, a `Convert` from a narrower
//! integer, and `+`, `-`, `*` over those, by interval arithmetic. A value joins
//! only when its operands are already in -- so a cycle can never talk itself in,
//! which is the failure a fixpoint over intervals would have.
//!
//! **The counted index**: a block parameter whose loop guard bounds it. Interval
//! arithmetic cannot reach this one; `P = join(0, P + 1)` widens to unbounded
//! and stays there. What bounds it is the branch: a header testing `P < L` with
//! `L` acyclically bounded, every entry to `P` either a small non-negative
//! constant or `P + k`, means `P <= hi(L) + k` at the header. That is checked
//! arithmetically rather than assumed, so a `k` large enough to carry the sum
//! past `i32::MAX` declines instead of wrapping.
//!
//! Descending loops, `*=` counters and anything else are simply not recognised.
//! They stay `long`, which is what they are today.

use nts_codegen_common::destruct;
use nts_core::hir::{BinOp, BlockId, Func, HirType, ManagedType, OpKind, Terminator, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};

/// The interval a value is known to lie in, in `i128` so the arithmetic that
/// decides whether it fits an `int` cannot itself overflow.
type Bounds = (i128, i128);

const INT_MIN: i128 = i32::MIN as i128;
const INT_MAX: i128 = i32::MAX as i128;

/// The widest array either array representation can address.
///
/// `arraylength` is an `int` and that is the whole of what is promised: the
/// runtime's own `MAX_ARRAY` is `Integer.MAX_VALUE - 8`, but a bare `boolean[]`
/// is allocated by `newarray` and is bounded only by the VM's own limit, which
/// no specification pins below `INT_MAX`. Assuming the runtime's tighter cap
/// held for both was the headroom `P + k` was being given, and it was not
/// there to give -- so the headroom comes from the guard instead, which
/// [`narrowable`] takes from `<` rather than from the array.
const MAX_ARRAY: i128 = INT_MAX;

/// Whether a value's declared type is the 64-bit integer this pass is about.
fn is_wide(func: &Func, value: ValueId) -> bool {
    matches!(func.values[value.0 as usize].ty, HirType::Int { bits: 64, .. })
}

/// Whether an interval is representable in the `int` slot we would give it.
///
/// An *unsigned* 64-bit value carries -1 as `2^64 - 1`, and an `int` carries it
/// as -1, so the two disagree on exactly the values a negative bound admits.
/// Unsigned therefore needs a non-negative interval; signed only needs to fit.
fn fits(func: &Func, value: ValueId, (lo, hi): Bounds) -> bool {
    let signed = matches!(func.values[value.0 as usize].ty, HirType::Int { signed: true, .. });
    lo >= if signed { INT_MIN } else { 0 } && hi <= INT_MAX
}

/// The interval of a value that is not itself wide, where one is known.
///
/// A constant answers exactly. Falling back to the declared range instead is
/// what kept `xs.length - 1` wide: an `i32` one has the range of an `i32`, so
/// the subtraction came out `[-2^31 + 1, MAX_ARRAY + 2^31]` and did not fit.
/// Only integers narrower than 64 bits otherwise, because those are the ones a
/// `Convert` widens from and the ones an operand of a wide `+` can be.
fn narrow_operand(func: &Func, value: ValueId) -> Option<Bounds> {
    if let Some(exact) = constant(func, value) {
        return Some((exact, exact));
    }
    match func.values[value.0 as usize].ty {
        HirType::Int { bits, signed } if bits <= 32 => {
            let width = i128::from(bits);
            Some(if signed {
                (-(1 << (width - 1)), (1 << (width - 1)) - 1)
            } else {
                (0, (1 << width) - 1)
            })
        }
        _ => None,
    }
}

/// Every wide value whose interval this backend can prove acyclically.
///
/// Grown from seeds and never revisited downward, so a value enters only after
/// its operands have -- which is what keeps a loop counter out of here.
fn acyclic(func: &Func) -> FxHashMap<ValueId, Bounds> {
    let mut known: FxHashMap<ValueId, Bounds> = FxHashMap::default();
    let mut changed = true;
    while changed {
        changed = false;
        for (at, op) in func.values.iter().enumerate() {
            let value = ValueId(u32::try_from(at).unwrap_or(0));
            if known.contains_key(&value) || !is_wide(func, value) {
                continue;
            }
            let bounds = match &op.kind {
                OpKind::ConstInt(number) => Some((*number, *number)),
                // `arraylength`, or an `int` length field. Both lanes of the
                // array representation answer inside this.
                OpKind::Length(of)
                    if matches!(
                        func.values[of.0 as usize].ty,
                        HirType::Managed(ManagedType::Array(_))
                    ) =>
                {
                    Some((0, MAX_ARRAY))
                }
                OpKind::Convert(from) => {
                    known.get(from).copied().or_else(|| narrow_operand(func, *from))
                }
                OpKind::Binary { op: kind @ (BinOp::Add | BinOp::Sub | BinOp::Mul), lhs, rhs } => {
                    let left = known.get(lhs).copied().or_else(|| narrow_operand(func, *lhs));
                    let right = known.get(rhs).copied().or_else(|| narrow_operand(func, *rhs));
                    match (left, right) {
                        (Some(left), Some(right)) => Some(combine(*kind, left, right)),
                        _ => None,
                    }
                }
                _ => None,
            };
            if let Some(bounds) = bounds
                && fits(func, value, bounds)
            {
                known.insert(value, bounds);
                changed = true;
            }
        }
    }
    known
}

/// Interval arithmetic for the three operations that have one here.
fn combine(op: BinOp, (a_lo, a_hi): Bounds, (b_lo, b_hi): Bounds) -> Bounds {
    match op {
        BinOp::Add => (a_lo.saturating_add(b_lo), a_hi.saturating_add(b_hi)),
        BinOp::Sub => (a_lo.saturating_sub(b_hi), a_hi.saturating_sub(b_lo)),
        _ => {
            let corners = [
                a_lo.saturating_mul(b_lo),
                a_lo.saturating_mul(b_hi),
                a_hi.saturating_mul(b_lo),
                a_hi.saturating_mul(b_hi),
            ];
            (
                corners.iter().copied().min().unwrap_or(i128::MIN),
                corners.iter().copied().max().unwrap_or(i128::MAX),
            )
        }
    }
}

/// Follow the block-parameter copies a jump makes, to whatever the value
/// originally was.
///
/// `jump b7(%9)` into `b7(%10: i64)` is a copy and nothing else, and the
/// increment reads the copy rather than the header's own parameter. Without
/// this the cycle looks open.
fn source(
    func: &Func,
    incoming: &FxHashMap<ValueId, Vec<(BlockId, ValueId)>>,
    mut value: ValueId,
) -> ValueId {
    for _ in 0..func.values.len() {
        let Some(args) = incoming.get(&value) else { return value };
        match args.as_slice() {
            [(_, only)] if *only != value => value = *only,
            _ => return value,
        }
    }
    value
}

/// Every value a block parameter can receive, with the block it comes from.
///
/// The block is not decoration. Whether an increment is bounded by the loop
/// guard depends on which edge it arrives by, and a list of values alone cannot
/// say.
fn incoming_values(func: &Func) -> FxHashMap<ValueId, Vec<(BlockId, ValueId)>> {
    let mut incoming: FxHashMap<ValueId, Vec<(BlockId, ValueId)>> = FxHashMap::default();
    for (at, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(at).unwrap_or(0));
        for (target, args) in destruct::outgoing(&block.terminator) {
            let params = &func.blocks[target.0 as usize].params;
            for (param, arg) in params.iter().zip(args) {
                incoming.entry(*param).or_default().push((from, arg));
            }
        }
    }
    incoming
}

/// The blocks reachable from `start` without passing through `barrier`.
///
/// Used for one question: can the block that increments the counter be entered
/// other than by the guard's *true* edge? If it can, the guard does not bound
/// the increment -- the program would be one that keeps counting on the arm
/// that was supposed to leave -- and the counter stays a `long`.
fn reachable_avoiding(func: &Func, start: BlockId, barrier: BlockId) -> FxHashSet<BlockId> {
    let mut seen = FxHashSet::default();
    let mut stack = vec![start];
    while let Some(block) = stack.pop() {
        if block == barrier || !seen.insert(block) {
            continue;
        }
        for (target, _) in destruct::outgoing(&func.blocks[block.0 as usize].terminator) {
            stack.push(target);
        }
    }
    seen
}

/// The wide values this backend will hold in an `int` slot.
#[must_use]
pub(crate) fn narrowable(func: &Func) -> FxHashSet<ValueId> {
    let bounds = acyclic(func);
    let incoming = incoming_values(func);
    let mut chosen: FxHashSet<ValueId> = bounds.keys().copied().collect();

    // The counted indices, which the intervals above cannot reach.
    for (at, block) in func.blocks.iter().enumerate() {
        let header = BlockId(u32::try_from(at).unwrap_or(0));
        let Terminator::Branch { cond, then_target, else_target, .. } = &block.terminator else {
            continue;
        };
        let OpKind::Binary { op: guard @ (BinOp::Lt | BinOp::Le), lhs, rhs } =
            &func.values[cond.0 as usize].kind
        else {
            continue;
        };
        let counter = *lhs;
        if !is_wide(func, counter) || !block.params.contains(&counter) {
            continue;
        }
        let Some(&(_, limit)) = bounds.get(rhs) else { continue };
        let Some(entries) = incoming.get(&counter) else { continue };
        // Everything the guard did *not* let through. An increment arriving
        // from one of these has not been tested against the limit.
        let untested = reachable_avoiding(func, *else_target, header);
        let guarded = reachable_avoiding(func, *then_target, header);

        // Every way in is either a start or a step, and the step's size is what
        // decides whether the guard's bound leaves room.
        let mut low = 0i128;
        let mut step = 0i128;
        let mut cycle = vec![counter];
        let admissible = entries.iter().all(|(from, entry)| {
            if let OpKind::ConstInt(start) = func.values[entry.0 as usize].kind {
                if !(0..=MAX_ARRAY).contains(&start) {
                    return false;
                }
                low = low.min(start);
                cycle.push(*entry);
                return true;
            }
            let OpKind::Binary { op: BinOp::Add, lhs: base, rhs: by } =
                &func.values[entry.0 as usize].kind
            else {
                return false;
            };
            let Some(size) = constant(func, *by) else { return false };
            if !(1..=8).contains(&size) || source(func, &incoming, *base) != counter {
                return false;
            }
            if untested.contains(from) || !guarded.contains(from) {
                return false;
            }
            step = step.max(size);
            cycle.push(*entry);
            cycle.push(*base);
            true
        });
        // What reaches the header is either a start or `prev + step`, and
        // `prev` got past the guard -- so under `<` it was at most `limit - 1`
        // and the sum is at most `limit - 1 + step`. That one subtraction is
        // the difference between a counter over a full-length array narrowing
        // and wrapping: with `limit` at `INT_MAX` and a step of 1, `<` lands
        // exactly on `INT_MAX` and `<=` lands one past it.
        let reached = match guard {
            BinOp::Lt => limit.saturating_sub(1).saturating_add(step),
            _ => limit.saturating_add(step),
        };
        if admissible && reached <= INT_MAX && low >= 0 {
            chosen.extend(cycle);
        }
    }

    // Shrink until every chosen value is one whose own inputs are chosen too,
    // and until no arithmetic straddles the two representations. Only removal
    // happens here, so it settles.
    loop {
        let mut doomed: FxHashSet<ValueId> = chosen
            .iter()
            .copied()
            .filter(|value| !supported(func, &incoming, &chosen, *value))
            .collect();
        doomed.extend(straddling(func, &chosen));
        doomed.extend(mismatched_edges(func, &incoming, &chosen));
        doomed.extend(read_by_declaration(func, &chosen));
        if doomed.is_empty() {
            return chosen;
        }
        for value in doomed {
            chosen.remove(&value);
        }
    }
}

/// Values something reads by their *declared* type rather than by how they are
/// held.
///
/// A `putfield` names `J` in its descriptor, a `return` names the method's, and
/// a call names its parameter's -- and each of those sites loads the operand and
/// hands it straight to the instruction. An `int` where a `long` is declared is
/// one word where two are wanted, which is why every one of these was caught by
/// the emitter's stack accounting rather than by the verifier, and why none of
/// them produced a class at all.
///
/// **The default is unsafe.** An operation this does not name keeps its operands
/// wide, so a kind added later costs a missed narrowing and never a wrong
/// answer. That is the direction to fail in: the safe list is what has been
/// read, and it is short enough to read again.
fn read_by_declaration(func: &Func, chosen: &FxHashSet<ValueId>) -> FxHashSet<ValueId> {
    let mut give_up = FxHashSet::default();
    for op in &func.values {
        let risky: Vec<ValueId> = match &op.kind {
            // Each of these asks `kind_of` for the representation and converts:
            // `binary` from the result's kind, `unary` and the subscripts
            // through `push_as`, `conversion` by putting the operand back in
            // its declaration first.
            OpKind::Binary { .. }
            | OpKind::Unary { .. }
            | OpKind::Convert(_)
            | OpKind::Length(_)
            | OpKind::ArrayNew { .. }
            | OpKind::ArrayGet { .. } => Vec::new(),
            // The subscript adapts and the stored element does not.
            OpKind::ArraySet { value, .. } => vec![*value],
            other => nts_core::hir::operands_of(other),
        };
        give_up.extend(risky.into_iter().filter(|value| chosen.contains(value)));
    }
    for block in &func.blocks {
        // A jump's arguments become block parameters through `apply`, which
        // reads both ends. A `return` hands the value to the method descriptor.
        if let Terminator::Return(Some(value)) = &block.terminator
            && chosen.contains(value)
        {
            give_up.insert(*value);
        }
    }
    give_up
}

/// Wide values written across an edge into a parameter held differently.
///
/// `apply` moves a block argument with one kind: it loads by the *source's*
/// kind and stores into the *target's* slot. [`supported`] covers the case
/// where the parameter is chosen and an argument is not; this covers the other
/// one, which would load an `int` and store it as a `long` and leave the class
/// for `-Xverify:all` to reject.
fn mismatched_edges(
    func: &Func,
    incoming: &FxHashMap<ValueId, Vec<(BlockId, ValueId)>>,
    chosen: &FxHashSet<ValueId>,
) -> FxHashSet<ValueId> {
    let mut give_up = FxHashSet::default();
    for (param, args) in incoming {
        if !is_wide(func, *param) || chosen.contains(param) {
            continue;
        }
        for (_, arg) in args {
            if chosen.contains(arg) {
                give_up.insert(*arg);
            }
        }
    }
    give_up
}

/// Wide values feeding arithmetic that does not agree with them about how a
/// wide value is held.
///
/// `binary` refuses an operation whose operand kinds and result kind differ
/// rather than inserting a conversion, deliberately: where the middle end and
/// this backend disagree the symptom is an unbalanced stack several
/// instructions later, so the second place that must agree asserts. That makes
/// a half-narrowed operation this pass's problem to prevent, not its problem to
/// paper over.
fn straddling(func: &Func, chosen: &FxHashSet<ValueId>) -> FxHashSet<ValueId> {
    let mut give_up = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        let result = ValueId(u32::try_from(at).unwrap_or(0));
        let OpKind::Binary { op: kind, lhs, rhs } = &op.kind else { continue };
        let wide: Vec<ValueId> =
            [*lhs, *rhs].into_iter().filter(|operand| is_wide(func, *operand)).collect();
        // A comparison answers a `bool`, so there is no result to agree with --
        // only the two operands, which have to be held alike to be compared.
        let together = if crate::body::comparison(*kind).is_some() {
            wide.iter().all(|operand| chosen.contains(operand))
                || wide.iter().all(|operand| !chosen.contains(operand))
        } else if is_wide(func, result) {
            // Each operand against the result, not the conjunction against it.
            // Written the other way, `mul` of an unchosen counter by a chosen
            // constant with an unchosen result read as agreement -- *none of
            // them all chosen* and *the result not chosen* are both false -- and
            // the emitter met a `Long` and an `Int` under one opcode.
            let held = chosen.contains(&result);
            wide.iter().all(|operand| chosen.contains(operand) == held)
        } else {
            continue;
        };
        if !together {
            give_up.extend(wide);
            give_up.insert(result);
        }
    }
    give_up.retain(|value| chosen.contains(value));
    give_up
}

/// The constant a value is, where it is one.
fn constant(func: &Func, value: ValueId) -> Option<i128> {
    match func.values[value.0 as usize].kind {
        OpKind::ConstInt(number) => Some(number),
        OpKind::Convert(from) => constant(func, from),
        _ => None,
    }
}

/// Whether a chosen value's own inputs are chosen, so that nothing is loaded as
/// an `int` and written as a `long`.
fn supported(
    func: &Func,
    incoming: &FxHashMap<ValueId, Vec<(BlockId, ValueId)>>,
    chosen: &FxHashSet<ValueId>,
    value: ValueId,
) -> bool {
    let wide_and_unchosen =
        |operand: &ValueId| is_wide(func, *operand) && !chosen.contains(operand);
    match &func.values[value.0 as usize].kind {
        OpKind::ConstInt(_) | OpKind::Length(_) | OpKind::Convert(_) => true,
        OpKind::Binary { op: BinOp::Add | BinOp::Sub | BinOp::Mul, lhs, rhs } => {
            !wide_and_unchosen(lhs) && !wide_and_unchosen(rhs)
        }
        OpKind::BlockParam(_) => incoming
            .get(&value)
            .is_none_or(|args| !args.iter().any(|(_, arg)| wide_and_unchosen(arg))),
        _ => false,
    }
}
