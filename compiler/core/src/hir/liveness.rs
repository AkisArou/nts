//! Where each value is still needed.
//!
//! # What it is for
//!
//! Reference counting. A managed value has to be released when nothing will
//! read it again, and "nothing will read it again" is exactly what liveness
//! answers. Getting it wrong in one direction leaks; in the other it frees
//! memory something still holds, which is the risk of reference counting done
//! by a compiler.
//!
//! # The algorithm
//!
//! Backward dataflow to a fixpoint, which is the textbook one:
//!
//! ```text
//! live_out(b) = union of live_in(s) for every successor s
//! live_in(b)  = (used(b) ∪ live_out(b)) \ defined(b)
//! ```
//!
//! SSA makes `defined` trivial — a value is defined once, in one block — and
//! block parameters are defined by the block that declares them, not by the
//! edges that supply them. An argument on an edge is *used* by the block that
//! jumps, which is where it is read.
//!
//! The subtraction covers `used` and not only `live_out`, which is the whole
//! content of the textbook's "upward-exposed uses". A value defined in a block
//! and read by that same block's terminator — every loop-carried value is one,
//! since the back edge passes it — is not live on entry: it does not exist yet.
//! Writing `used ∪ (live_out \ defined)` instead makes such a value live at the
//! top of its own loop, and therefore *available* at the loop header, where it
//! is not yet defined. Dominance says a block cannot name it there, so the
//! mistake shows up as a release the verifier rejects rather than as anything
//! subtle — but only once a program carries an object around a loop.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{BlockId, Callee, Func, OpKind, Terminator, ValueId};

/// A hard bound on the fixpoint. Liveness converges in at most one pass per
/// block over a reducible graph; reaching this means a bug, and looping forever
/// would hide it.
const ROUND_CAP: usize = 1024;

/// Which values are live where.
#[derive(Debug, Clone)]
pub struct Liveness {
    live_in: Vec<FxHashSet<ValueId>>,
    live_out: Vec<FxHashSet<ValueId>>,
    /// Values a block can name: those arriving live, and those it defines.
    ///
    /// Kept here rather than recomputed from the function, so that a caller
    /// rebuilding a function's blocks can still ask where a live range ends —
    /// which is exactly when it needs to.
    available: Vec<FxHashSet<ValueId>>,
}

impl Liveness {
    /// Values that must already hold on entry to a block.
    #[must_use]
    pub fn live_in(&self, block: BlockId) -> &FxHashSet<ValueId> {
        &self.live_in[block.0 as usize]
    }

    /// Values that must still hold when a block ends.
    #[must_use]
    pub fn live_out(&self, block: BlockId) -> &FxHashSet<ValueId> {
        &self.live_out[block.0 as usize]
    }

    /// Values a block can name: those arriving live, and those it defines.
    #[must_use]
    pub fn available(&self, block: BlockId) -> &FxHashSet<ValueId> {
        &self.available[block.0 as usize]
    }

    /// Hold a value live until every exit.
    ///
    /// A borrow is only good while the place it came from is, so a local that
    /// *anchors* one has to outlive it. Stretching the range here rather than
    /// special-casing it where releases are placed means every rule that reads
    /// liveness agrees about it -- where a release goes, and whether handing a
    /// value on is a move or a copy. Two rules disagreeing about one value is
    /// how a reference gets consumed twice.
    ///
    /// Only sound for a value the *entry* block defines, which runs exactly
    /// once, so the value names one object for the whole call. A value defined
    /// in a loop names a different one each time round and must die each time
    /// round with it.
    pub fn hold_to_every_exit(&mut self, func: &Func, value: ValueId) {
        self.hold_through(func, value, |_| true);
    }

    /// Hold a value live through the blocks `through` names, to each exit
    /// among them: [`Self::hold_to_every_exit`] for a value defined partway
    /// through the function, whose blocks are those its definition reaches
    /// and dominates. An exit before the definition has nothing to release.
    pub fn hold_through(&mut self, func: &Func, value: ValueId, through: impl Fn(usize) -> bool) {
        for (index, block) in func.blocks.iter().enumerate() {
            if !through(index) {
                continue;
            }
            self.available[index].insert(value);
            if index != 0 {
                self.live_in[index].insert(value);
            }
            if block.terminator.successors().is_empty() {
                // Nowhere left to go, so this is where it dies and where the
                // release belongs.
                self.live_out[index].remove(&value);
            } else {
                self.live_out[index].insert(value);
            }
        }
    }

    /// Whether a value's last read is inside this block.
    ///
    /// True when it is available in the block — defined there, or arriving live
    /// — and dead by the end of it. This is where a release belongs.
    #[must_use]
    pub fn dies_in(&self, block: BlockId, value: ValueId) -> bool {
        let index = block.0 as usize;
        self.available[index].contains(&value) && !self.live_out[index].contains(&value)
    }
}

/// Compute liveness for a function.
#[must_use]
pub fn analyze(func: &Func) -> Liveness {
    analyze_with(func, &|_| None)
}

/// What a call's callee stores of its arguments into its other arguments, as
/// `(what, into)` argument slots -- `escape::stores_into`, read off the body
/// -- or `None` where that is not known here, which [`object_names_with`] answers
/// by assuming any argument may go into any other.
pub(super) type CalleeStores<'a> = dyn Fn(&Callee) -> Option<Vec<(u32, u32)>> + 'a;

/// [`analyze`], told what each callee stores where, so a frame object passed
/// to a call is named by the argument it goes into rather than by all of them.
/// See [`object_names_with`].
#[must_use]
#[expect(
    clippy::expect_used,
    reason = "the unbounded control never rejects a charge"
)]
pub(super) fn analyze_with(func: &Func, stores: &CalleeStores<'_>) -> Liveness {
    analyze_using(func, stores, &mut Control::<false> { charge: None })
        .expect("unbounded liveness cannot exhaust a work budget")
}

/// The same analysis, with conservative graph/set work charged before it runs.
/// Exhaustion or a non-converged fixed point is Unknown, never partial liveness.
/// A unit reserves at most one element visit or set-membership comparison;
/// charges may overestimate work, and are not instruction or CPU counts.
#[must_use]
pub fn analyze_limited(func: &Func, charge: &mut dyn FnMut(usize) -> bool) -> Option<Liveness> {
    analyze_using(
        func,
        &|_| None,
        &mut Control::<true> {
            charge: Some(charge),
        },
    )
}

struct Control<'a, const LIMITED: bool> {
    charge: Option<&'a mut dyn FnMut(usize) -> bool>,
}
impl<const LIMITED: bool> Control<'_, LIMITED> {
    fn take(&mut self, units: usize) -> Option<()> {
        if !LIMITED {
            return Some(());
        }
        if self.charge.as_mut().is_none_or(|charge| charge(units)) {
            Some(())
        } else {
            None
        }
    }
}

fn analyze_using<const LIMITED: bool>(
    func: &Func,
    stores: &CalleeStores<'_>,
    control: &mut Control<'_, LIMITED>,
) -> Option<Liveness> {
    let count = func.blocks.len();
    let values = func.values.len();
    control.take(
        values
            .saturating_mul(values)
            .saturating_mul(4)
            .saturating_add(count.saturating_mul(values)),
    )?;
    let mut live_in: Vec<FxHashSet<ValueId>> = vec![FxHashSet::default(); count];
    let mut live_out: Vec<FxHashSet<ValueId>> = vec![FxHashSet::default(); count];

    // Precomputed per block, since the fixpoint revisits them.
    let used: Vec<FxHashSet<ValueId>> = (0..count).map(|index| reads(func, index)).collect();
    let defined: Vec<FxHashSet<ValueId>> = (0..count).map(|index| writes(func, index)).collect();
    // Only *frame* objects, and only because their retain is a no-op: an
    // immortal header has no count to raise, so a name cannot keep one alive
    // and the frame has to. See `super::undominated_names` for the objects this
    // cannot be done for, which `place_allocations` keeps off the frame.
    let names = object_names_using(func, stores, control)?;
    // A counted handle converted to a type nothing counts -- a `GObject *`
    // passed where C takes a `GTypeInstance *` or a `void *` -- is read through
    // the conversion afterwards, which holds no reference: the handle is live
    // wherever that view is, exactly as a frame object is wherever a name for
    // it is. Without this the handle's last read is the conversion, and a
    // temporary is released before the call it was converted for.
    //
    // And converted to another counted type -- a `GtkBox *` as the
    // `GtkWidget *` a method's `this` takes -- which may hold no reference of
    // its own either (`own::views_borrow`): the same rule, for the same
    // reason. Where the view does take one, the handle living longer costs a
    // later release and nothing else.
    let viewed: FxHashMap<ValueId, ValueId> = func
        .values
        .iter()
        .enumerate()
        .filter_map(|(at, op)| match op.kind {
            OpKind::Convert(operand) | OpKind::FieldView { value: operand, .. }
                if func.values[operand.0 as usize].ty.counting().is_some() =>
            {
                Some((ValueId(u32::try_from(at).unwrap_or(u32::MAX)), operand))
            }
            _ => None,
        })
        .collect();
    let mut frame_named_by: FxHashMap<ValueId, Vec<ValueId>> = FxHashMap::default();
    for (alias, roots) in &names {
        let framed: Vec<ValueId> = roots
            .iter()
            .copied()
            .filter(|root| {
                matches!(
                    func.values[root.0 as usize].kind,
                    OpKind::ObjectNew { frame: true }
                )
            })
            .collect();
        if !framed.is_empty() {
            frame_named_by.insert(*alias, framed);
        }
    }

    let mut converged = false;
    for _ in 0..ROUND_CAP {
        let mut changed = false;
        // Backward, so a block's successors are usually settled before it.
        for index in (0..count).rev() {
            // Successor unions, live/used/defined sets, and every possible
            // frame-name relation are bounded by this function's value set.
            control.take(
                values
                    .saturating_mul(values)
                    .saturating_add(values.saturating_mul(12))
                    .saturating_add(1),
            )?;
            let mut out = FxHashSet::default();
            for successor in func.blocks[index].terminator.successors() {
                out.extend(live_in[successor.0 as usize].iter().copied());
            }

            let mut entering = out.clone();
            entering.extend(used[index].iter().copied());
            // A frame object is kept alive by whatever names it, and a name is
            // not a reference here.
            //
            // The gap this closes is one `throw` wide. `throw new
            // RangeError("Invalid code point " + n)` puts the error in the
            // frame, packs it into an erased value to throw, and the erased
            // value is what the `catch` reads -- so the object died at the
            // `Erase` and `rc::release_value` gave its message string back
            // while the handler was still about to concatenate it. Under
            // `NTS_RC=1` the next allocation reused the freed buffer and the
            // answer came back `range:range:d code point 2147483647` where node
            // says `range:Invalid code point 2147483647`. Six cases, in the one
            // lane that counts, and nothing in the corpus reached it: the shape
            // needs a computed message, a frame-placed error, and a `catch`
            // that reads it back.
            for value in entering.iter().copied().collect::<Vec<_>>() {
                if let Some(named) = frame_named_by.get(&value) {
                    entering.extend(named.iter().copied());
                }
                if let Some(handle) = viewed.get(&value) {
                    entering.insert(*handle);
                }
            }
            for value in &defined[index] {
                entering.remove(value);
            }

            if out != live_out[index] || entering != live_in[index] {
                live_out[index] = out;
                live_in[index] = entering;
                changed = true;
            }
        }
        if !changed {
            converged = true;
            break;
        }
    }
    if LIMITED && !converged {
        return None;
    }

    let available = (0..count)
        .map(|index| {
            let mut here = live_in[index].clone();
            here.extend(defined[index].iter().copied());
            here
        })
        .collect();

    Some(Liveness {
        live_in,
        live_out,
        available,
    })
}

/// Values a block reads, including the arguments its terminator passes on.
///
/// An edge argument is read by the block that *jumps*, not by the one that
/// receives it: that is where the value is loaded from.
fn reads(func: &Func, index: usize) -> FxHashSet<ValueId> {
    let block = &func.blocks[index];
    let mut used = FxHashSet::default();
    for value in &block.ops {
        used.extend(super::operands_of(&func.values[value.0 as usize].kind));
    }
    used.extend(super::operands_of_terminator(&block.terminator));
    used
}

/// Which objects each value can still reach.
///
/// `Erase` and `Unerase` rename rather than copy -- `own::repackages` says so
/// and borrows on the strength of it -- and a block parameter renames whatever
/// each edge hands it. Both are followed, to a fixpoint, because a name of a
/// name is still a name. Conversions preserve the same reference too.
///
/// A field or array slot can also keep an object reachable. A frame object's
/// immortal header cannot take a count when stored, so its fields must stay
/// live until the container and references loaded from it stop reaching it.
/// Following stores here makes that obligation cross block boundaries; the
/// counting pass's block-local store walk alone cannot keep it live on an edge.
///
/// A store a callee makes is one too: `new Holder(item)` stores `item` into
/// the holder inside the constructor. `stores` says which argument a callee
/// stores into which; where it cannot, every argument names every other.
///
/// Two callers, asking opposite questions of the same relation.
/// [`analyze`] uses it to keep a *frame* object live for as long as anything
/// can still reach it; [`super::undominated_names`] uses it to find the objects
/// for which that is impossible.
#[expect(
    clippy::expect_used,
    reason = "the unbounded control never rejects a charge"
)]
pub(super) fn object_names_with(
    func: &Func,
    callee_stores: &CalleeStores<'_>,
) -> FxHashMap<ValueId, Vec<ValueId>> {
    object_names_using(func, callee_stores, &mut Control::<false> { charge: None })
        .expect("unbounded aliases cannot exhaust a work budget")
}

fn object_names_using<const LIMITED: bool>(
    func: &Func,
    callee_stores: &CalleeStores<'_>,
    control: &mut Control<'_, LIMITED>,
) -> Option<FxHashMap<ValueId, Vec<ValueId>>> {
    let mut named: FxHashMap<ValueId, Vec<ValueId>> = FxHashMap::default();

    let mut converged = false;
    for _ in 0..ROUND_CAP {
        let mut changed = false;
        for block in &func.blocks {
            control.take(
                block
                    .ops
                    .len()
                    .saturating_add(block.params.len())
                    .saturating_add(1),
            )?;
            for value in &block.ops {
                let op = &func.values[value.0 as usize];
                match &op.kind {
                    OpKind::Erase { value: inner, .. }
                    | OpKind::Unerase { value: inner, .. }
                    | OpKind::FieldView { value: inner, .. }
                    | OpKind::Convert(inner) => {
                        changed |= note_name(func, &mut named, *value, *inner, control)?;
                    }
                    OpKind::FieldSet {
                        object: container,
                        value: stored,
                        ..
                    }
                    | OpKind::ArraySet {
                        array: container,
                        value: stored,
                        ..
                    } => {
                        changed |= note_name(func, &mut named, *container, *stored, control)?;
                    }
                    OpKind::FieldGet {
                        object: container, ..
                    }
                    | OpKind::ArrayGet {
                        array: container, ..
                    } if op.ty.may_hold_a_reference() => {
                        changed |= note_name(func, &mut named, *value, *container, control)?;
                    }
                    // **A store a callee makes is a store too.** See
                    // [`names_through_a_call`].
                    OpKind::Call { callee, args, .. }
                        if !matches!(callee, Callee::External(_) | Callee::Native(_)) =>
                    {
                        changed |= names_through_a_call(
                            func,
                            &mut named,
                            (*value, callee, args),
                            callee_stores,
                            control,
                        )?;
                    }
                    _ => {}
                }
            }
            let edges: Vec<(BlockId, &Vec<ValueId>)> = match &block.terminator {
                Terminator::Jump { target, args } => vec![(*target, args)],
                Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                } => vec![(*then_target, then_args), (*else_target, else_args)],
                Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {
                    Vec::new()
                }
            };
            for (target, args) in edges {
                for (slot, argument) in args.iter().enumerate() {
                    let Some(param) = func.blocks[target.0 as usize].params.get(slot) else {
                        continue;
                    };
                    changed |= note_name(func, &mut named, *param, *argument, control)?;
                }
            }
        }
        if !changed {
            converged = true;
            break;
        }
    }
    if LIMITED && !converged {
        return None;
    }
    Some(named)
}

/// Record that `alias` names whatever `of` is or names. Whether it grew.
fn note_name<const LIMITED: bool>(
    func: &Func,
    named: &mut FxHashMap<ValueId, Vec<ValueId>>,
    alias: ValueId,
    of: ValueId,
    control: &mut Control<'_, LIMITED>,
) -> Option<bool> {
    let roots = named
        .get(&of)
        .map_or(1, |roots| roots.len().saturating_add(1));
    let existing = named.get(&alias).map_or(0, Vec::len);
    control.take(roots.saturating_mul(existing.saturating_add(roots).saturating_add(2)))?;
    let mut roots = named.get(&of).cloned().unwrap_or_default();
    if matches!(func.values[of.0 as usize].kind, OpKind::ObjectNew { .. }) && !roots.contains(&of) {
        roots.push(of);
    }
    if roots.is_empty() {
        return Some(false);
    }
    let here = named.entry(alias).or_default();
    let mut grew = false;
    for root in roots {
        if !here.contains(&root) {
            here.push(root);
            grew = true;
        }
    }
    Some(grew)
}

/// The names a call into a body this program has makes. Whether any grew.
///
/// **A store a callee makes is a store too.** `new Holder(item)` runs
/// `this.value = item` inside the constructor, so the holder names the item
/// exactly as a `FieldSet` here would -- and `holder.value.name` read after the
/// item's last direct use was a read of a frame object whose fields had already
/// been given back. The argument a callee stores another into names it
/// (`callee_stores`); where that is not known, every argument that can hold a
/// reference names what the others name. A result that can hold one names
/// every argument -- a result is made at the call, after all of them, so this
/// only lengthens a life and never names an object before it exists.
///
/// Only a call into a body this program has: a runtime helper or a native
/// function says which arguments it keeps (`escape::kept_slots`), and what it
/// keeps escapes, so is never in the frame for this to protect.
fn names_through_a_call<const LIMITED: bool>(
    func: &Func,
    named: &mut FxHashMap<ValueId, Vec<ValueId>>,
    (result, callee, args): (ValueId, &Callee, &[ValueId]),
    callee_stores: &CalleeStores<'_>,
    control: &mut Control<'_, LIMITED>,
) -> Option<bool> {
    control.take(
        args.len()
            .saturating_mul(args.len())
            .saturating_add(args.len())
            .saturating_add(1),
    )?;
    let pairs: Vec<(usize, usize)> = match callee_stores(callee) {
        Some(pairs) => pairs
            .into_iter()
            .map(|(what, into)| (what as usize, into as usize))
            .collect(),
        None => (0..args.len())
            .flat_map(|what| (0..args.len()).map(move |into| (what, into)))
            .filter(|(what, into)| what != into)
            .collect(),
    };
    let mut changed = false;
    for (what, into) in pairs {
        if let (Some(kept), Some(container)) = (args.get(what), args.get(into))
            && func.values[container.0 as usize].ty.may_hold_a_reference()
        {
            changed |= note_name(func, named, *container, *kept, control)?;
        }
    }
    if func.values[result.0 as usize].ty.may_hold_a_reference() {
        for kept in args {
            changed |= note_name(func, named, result, *kept, control)?;
        }
    }
    Some(changed)
}

/// Values a block defines: its operations and its own parameters.
fn writes(func: &Func, index: usize) -> FxHashSet<ValueId> {
    let block = &func.blocks[index];
    let mut defined: FxHashSet<ValueId> = block.ops.iter().copied().collect();
    defined.extend(block.params.iter().copied());
    defined
}

#[cfg(test)]
pub(in crate::hir) mod tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, OpKind, Param, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    pub(super) fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind) -> Op {
        Op {
            kind,
            ty: HirType::Float { bits: 64 },
            origin: origin(),
        }
    }

    /// `f(a) { %1 = a + a; if (..) { use %1 } ; return }`
    ///
    /// `%1` is defined in the entry and read only in one arm, so it is live
    /// out of the entry and dies in that arm.
    fn branching() -> Func {
        let values = vec![
            op(OpKind::Param(0)), // %0
            op(OpKind::Binary {
                // %1
                op: crate::hir::BinOp::Add,
                lhs: ValueId(0),
                rhs: ValueId(0),
            }),
            op(OpKind::Binary {
                // %2  the test
                op: crate::hir::BinOp::Lt,
                lhs: ValueId(0),
                rhs: ValueId(0),
            }),
            op(OpKind::Binary {
                // %3  reads %1
                op: crate::hir::BinOp::Mul,
                lhs: ValueId(1),
                rhs: ValueId(1),
            }),
        ];
        Func {
            name: "f".to_owned(),
            params: vec![Param {
                name: "a".to_owned(),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
                written: None,
                shape: crate::hir::ParamShape::Ordinary,
            }],
            return_type: HirType::Float { bits: 64 },
            values,
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(1), ValueId(2)],
                    terminator: Terminator::Branch {
                        cond: ValueId(2),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(3)],
                    terminator: Terminator::Return(Some(ValueId(3))),
                },
                Block {
                    params: Vec::new(),
                    ops: Vec::new(),
                    terminator: Terminator::Return(Some(ValueId(0))),
                },
            ],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    #[test]
    fn bounded_liveness_matches_the_same_unbounded_analysis() {
        let func = branching();
        let expected = analyze(&func);
        let mut charged = 0usize;
        let actual = analyze_limited(&func, &mut |units| {
            charged = charged.checked_add(units).expect("small control");
            true
        })
        .expect("complete control");
        assert!(charged > 0);
        assert_eq!(actual.live_in, expected.live_in);
        assert_eq!(actual.live_out, expected.live_out);
        assert_eq!(actual.available, expected.available);
        assert!(
            analyze_limited(&func, &mut |_| false).is_none(),
            "exhaustion must never return a partial answer"
        );
        let mut left = charged - 1;
        assert!(
            analyze_limited(&func, &mut |units| {
                let Some(remaining) = left.checked_sub(units) else {
                    return false;
                };
                left = remaining;
                true
            })
            .is_none()
        );
    }

    #[test]
    fn bounded_liveness_rejects_a_non_converged_reverse_numbered_graph() {
        let mut func = branching();
        func.values.truncate(1);
        func.params.truncate(1);
        let count = ROUND_CAP + 2;
        func.blocks = (0..count)
            .map(|index| Block {
                params: Vec::new(),
                ops: if index == 0 {
                    vec![ValueId(0)]
                } else {
                    Vec::new()
                },
                terminator: if index == 1 {
                    Terminator::Return(Some(ValueId(0)))
                } else {
                    Terminator::Jump {
                        target: BlockId(
                            u32::try_from(if index == 0 { count - 1 } else { index - 1 })
                                .expect("small graph"),
                        ),
                        args: Vec::new(),
                    }
                },
            })
            .collect();
        assert!(
            analyze_limited(&func, &mut |_| true).is_none(),
            "a fixed-point cap is Unknown even with enough work fuel"
        );
    }

    /// Two objects thrown from two arms and caught at one handler.
    ///
    /// `f(a) { if (..) { throw %1 } else { throw %4 } }` with the handler as a
    /// block parameter -- the shape `merged` in `tests/programs/code-points` has, and
    /// the one `undominated_names` exists for.
    pub(in crate::hir) fn joining() -> Func {
        let values = vec![
            op(OpKind::Param(0)),                  // %0
            op(OpKind::ObjectNew { frame: true }), // %1  thrown from one arm
            op(OpKind::Erase {
                value: ValueId(1),
                absent: super::super::Absent::Impossible,
                slots: super::super::Absent::Impossible,
            }), // %2
            op(OpKind::Binary {
                op: crate::hir::BinOp::Lt,
                lhs: ValueId(0),
                rhs: ValueId(0),
            }), // %3
            op(OpKind::ObjectNew { frame: true }), // %4  thrown from the other
            op(OpKind::Erase {
                value: ValueId(4),
                absent: super::super::Absent::Impossible,
                slots: super::super::Absent::Impossible,
            }), // %5
            op(OpKind::unerase(ValueId(6))),       // %7  read in the handler
        ];
        let mut values = values;
        values.insert(6, op(OpKind::BlockParam(0))); // %6  the handler's parameter
        Func {
            name: "f".to_owned(),
            params: vec![Param {
                name: "a".to_owned(),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
                written: None,
                shape: crate::hir::ParamShape::Ordinary,
            }],
            return_type: HirType::Float { bits: 64 },
            values,
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0), ValueId(3)],
                    terminator: Terminator::Branch {
                        cond: ValueId(3),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(1), ValueId(2)],
                    terminator: Terminator::Jump {
                        target: BlockId(3),
                        args: vec![ValueId(2)],
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(4), ValueId(5)],
                    terminator: Terminator::Jump {
                        target: BlockId(3),
                        args: vec![ValueId(5)],
                    },
                },
                Block {
                    params: vec![ValueId(6)],
                    ops: vec![ValueId(7)],
                    terminator: Terminator::Return(Some(ValueId(0))),
                },
            ],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    #[test]
    fn an_erased_value_names_the_object_inside_it() {
        let named = object_names_with(&joining(), &|_| None);
        assert_eq!(
            named.get(&ValueId(2)).map(Vec::as_slice),
            Some(&[ValueId(1)][..])
        );
        assert_eq!(
            named.get(&ValueId(5)).map(Vec::as_slice),
            Some(&[ValueId(4)][..])
        );
    }

    /// The half that ordinary liveness cannot supply: a name arrives at a block
    /// parameter, and the parameter names whatever every edge hands it.
    #[test]
    fn a_block_parameter_names_both_objects_that_reach_it() {
        let named = object_names_with(&joining(), &|_| None);
        let mut roots = named.get(&ValueId(6)).cloned().unwrap_or_default();
        roots.sort_unstable();
        assert_eq!(roots, vec![ValueId(1), ValueId(4)]);
        // And a name of a name is still a name, which is why this is a
        // fixpoint rather than one pass.
        let mut through = named.get(&ValueId(7)).cloned().unwrap_or_default();
        through.sort_unstable();
        assert_eq!(through, vec![ValueId(1), ValueId(4)]);
    }

    /// `const h = new Holder(item); h.value` with both in the frame: the
    /// constructor stores `item` into `h`, so `h`, and what is read out of it,
    /// names `item` -- and `item` is live, its fields kept, until that read is
    /// done. The control differs in one thing: a callee that stores nothing.
    #[test]
    fn a_store_a_callee_makes_names_what_it_stored() {
        let object = HirType::Managed(crate::hir::ManagedType::Object(
            nts_semantic_schema::TypeId(1),
        ));
        let typed = |kind: OpKind, ty: &HirType| Op {
            kind,
            ty: ty.clone(),
            origin: origin(),
        };
        let mut func = joining();
        func.params = Vec::new();
        func.values = vec![
            typed(OpKind::ObjectNew { frame: true }, &object), // %0  the holder
            typed(OpKind::ObjectNew { frame: true }, &object), // %1  the item
            typed(
                OpKind::Call {
                    callee: crate::hir::Callee::Direct("Holder#constructor".to_owned()),
                    args: vec![ValueId(0), ValueId(1)],
                    frame: None,
                },
                &HirType::Void,
            ), // %2
            typed(
                OpKind::FieldGet {
                    object: ValueId(0),
                    field: 0,
                },
                &object,
            ), // %3  `h.value`
        ];
        func.blocks = vec![Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
            terminator: Terminator::Return(Some(ValueId(3))),
        }];
        let names_item = |stores: &CalleeStores<'_>, at: ValueId| {
            object_names_with(&func, stores)
                .get(&at)
                .is_some_and(|roots| roots.contains(&ValueId(1)))
        };
        let into_the_receiver = |_: &crate::hir::Callee| Some(vec![(1, 0)]);
        assert!(names_item(&into_the_receiver, ValueId(0)), "the holder");
        assert!(names_item(&into_the_receiver, ValueId(3)), "the read");
        let nothing = |_: &crate::hir::Callee| Some(Vec::new());
        assert!(
            !names_item(&nothing, ValueId(3)),
            "a callee that keeps nothing"
        );
    }

    /// A frame object stays live for as long as anything names it. Without
    /// this, `%1` dies at the `Erase` in block 1 and `rc::release_value` gives
    /// its fields back before block 3 reads them.
    #[test]
    fn a_frame_object_outlives_the_erase_that_names_it() {
        let live = analyze(&joining());
        assert!(live.live_out(BlockId(1)).contains(&ValueId(1)));
        assert!(live.live_in(BlockId(3)).contains(&ValueId(1)));
    }

    #[test]
    fn a_value_is_live_along_the_path_that_reads_it() {
        let func = branching();
        let live = analyze(&func);

        // %1 is read only in block 1, so it must survive the branch.
        assert!(live.live_out(BlockId(0)).contains(&ValueId(1)));
        assert!(live.live_in(BlockId(1)).contains(&ValueId(1)));

        // ...and not down the other arm, which never mentions it. This is the
        // asymmetry a release has to respect: freeing `%1` at the end of block 0
        // would free something block 1 goes on to read.
        assert!(!live.live_in(BlockId(2)).contains(&ValueId(1)));
    }

    #[test]
    fn a_live_range_ends_where_the_last_read_is() {
        let func = branching();
        let live = analyze(&func);

        // `%1` arrives live in block 1, is read there, and nothing follows.
        assert!(live.dies_in(BlockId(1), ValueId(1)));
        // It does not die in block 0: block 1 still needs it.
        assert!(!live.dies_in(BlockId(0), ValueId(1)));
        // And it was never available in block 2 at all.
        assert!(!live.dies_in(BlockId(2), ValueId(1)));
    }

    #[test]
    fn a_loop_keeps_its_carried_values_live_around_the_back_edge() {
        // The case a fixpoint is needed for: a value defined in the body and
        // passed back to the header is live *out* of the body, which one
        // backward pass in block order would not see.
        let values = vec![
            op(OpKind::ConstFloat(0.0)), // %0
            op(OpKind::BlockParam(0)),   // %1
            op(OpKind::Binary {
                // %2
                op: crate::hir::BinOp::Lt,
                lhs: ValueId(1),
                rhs: ValueId(0),
            }),
            op(OpKind::Binary {
                // %3  the back edge's argument
                op: crate::hir::BinOp::Add,
                lhs: ValueId(1),
                rhs: ValueId(0),
            }),
        ];
        let func = Func {
            name: "loop".to_owned(),
            params: Vec::new(),
            return_type: HirType::Float { bits: 64 },
            values,
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0)],
                    },
                },
                Block {
                    params: vec![ValueId(1)],
                    ops: vec![ValueId(2)],
                    terminator: Terminator::Branch {
                        cond: ValueId(2),
                        then_target: BlockId(2),
                        then_args: Vec::new(),
                        else_target: BlockId(3),
                        else_args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(3)],
                    terminator: Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(3)],
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: Vec::new(),
                    terminator: Terminator::Return(Some(ValueId(1))),
                },
            ],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        };

        let live = analyze(&func);
        // The header parameter is read in the body and in the exit, so it is
        // live across the whole loop.
        assert!(live.live_out(BlockId(1)).contains(&ValueId(1)));
        assert!(live.live_in(BlockId(2)).contains(&ValueId(1)));
        // `%0` is the constant the loop compares against every iteration, so it
        // stays live around the back edge -- which is exactly what one backward
        // pass in block order would miss.
        assert!(live.live_in(BlockId(2)).contains(&ValueId(0)));

        // `%3` is defined in the body and read by the body's own terminator, so
        // it is not live on entry to the body: it does not exist yet. Getting
        // this wrong makes it live in the body, therefore live out of the
        // header, therefore *available* at the header -- a block that cannot
        // name it, because the definition does not dominate. Under reference
        // counting that becomes a release the SSA verifier rejects, which is a
        // long way from the mistake. Every loop that carries an object has this
        // shape.
        assert!(!live.live_in(BlockId(2)).contains(&ValueId(3)));
        assert!(!live.live_in(BlockId(1)).contains(&ValueId(3)));
        assert!(!live.available(BlockId(1)).contains(&ValueId(3)));
        // It is available in the body and dies there. Not "live out": the back
        // edge *reads* it, and a read is where a live range ends, not something
        // that extends it past the terminator. The header's parameter is a
        // different value that the edge supplies. This is what lets reference
        // counting hand the reference on as a move -- the value is transferred
        // and dying at the same point, so it needs neither a retain nor a
        // release.
        assert!(!live.live_out(BlockId(2)).contains(&ValueId(3)));
        assert!(live.available(BlockId(2)).contains(&ValueId(3)));
        assert!(live.dies_in(BlockId(2), ValueId(3)));
    }
}
