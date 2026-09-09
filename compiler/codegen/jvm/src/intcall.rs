//! Helper results this target holds as an `int` rather than the `double` the
//! signature says.
//!
//! # The measurement this exists for
//!
//! A JavaScript `indexOf` answers a number, so `hir::runtime` types it `f64`
//! and all three backends agree about that -- correctly, because that table
//! must stay the single answer about conversions. On this backend the answer is
//! then almost always converted straight back:
//!
//! ```text
//! %65 = call.extern nts_array_index_of(%2, %97) : f64
//! %108 = convert %65 : i64
//! %106 = convert %108 : i32
//! %66 = add %57, %106 : i32
//! ```
//!
//! `benches/cases/array-methods` does that three times a round, 256 rounds.
//! Priced on the reference, which is the only way to price a replacement:
//! `indexOf` and `lastIndexOf` made to return `double` with the caller casting
//! back, one file, same checksum:
//!
//! ```text
//! original     1,426.7 ns
//! round trip   1,751.2 ns     +22.8%
//! ```
//!
//! More than the whole gap the row had, which is the third time this family has
//! come up -- records 0158 and 0165 are the other two -- and the first where
//! the helper's own loop was already counting in an `int` and widening on the
//! way out.
//!
//! # Why this is a representation and not a second answer
//!
//! The index is exact in an `int` by construction: it is the loop counter, or
//! -1. So the two forms answer the same number and choosing between them is the
//! same latitude this backend takes deciding an array is a `double[]` rather
//! than a wrapper. `hir::runtime` is untouched and every other lane sees the
//! `f64` it always saw.
//!
//! # What this may not assume
//!
//! A value is held as an `int` only if **every** use converts it to an integral
//! type. One use that wants the double back would have to widen it, which puts
//! the conversion where it was and adds a second spelling of the value. There
//! is no union-find here and there does not need to be: a call result is
//! defined once, by the call, so the class is the value.

use nts_core::hir::{BinOp, Callee, Func, HirType, OpKind, Terminator, ValueId, operands_of};
use rustc_hash::FxHashSet;

/// The helpers whose answer is an index, and so is exact in an `int`.
///
/// Named rather than inferred. A helper returns an integral double for a reason
/// particular to it, and a rule like "returns `f64`, used as an int" would also
/// catch `nts_array_pop`, whose answer is an element.
#[must_use]
pub(crate) fn integral_helper(name: &str) -> Option<&'static str> {
    Some(match name {
        "nts_array_index_of" | "nts_array_index_of_ref" => "arrayIndexOfI",
        "nts_array_index_of_str" => "arrayIndexOfStrI",
        "nts_array_last_index_of" | "nts_array_last_index_of_ref" => "arrayLastIndexOfI",
        "nts_array_last_index_of_str" => "arrayLastIndexOfStrI",
        _ => return None,
    })
}

/// The verification type such a result is held as.
///
/// Split out so `body::Emitter::new` reads one call rather than a branch, for
/// the reason `unbox::held_as` is.
#[must_use]
pub(crate) fn held_as(
    narrowed: &FxHashSet<ValueId>,
    value: ValueId,
) -> Option<nts_jvm_emitter::VType> {
    narrowed.contains(&value).then_some(nts_jvm_emitter::VType::Integer)
}

/// Call results declared `f64` that every use converts to an integer.
#[must_use]
pub(crate) fn narrowed(func: &Func) -> FxHashSet<ValueId> {
    let mut candidates = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        if !matches!(op.ty, HirType::Float { bits: 64 }) {
            continue;
        }
        let OpKind::Call { callee: Callee::External(name), .. } = &op.kind else { continue };
        if integral_helper(name).is_some() {
            candidates.insert(ValueId(u32::try_from(at).unwrap_or(0)));
        }
    }
    if candidates.is_empty() {
        return candidates;
    }

    // A conversion *between* the call and the integer the caller wants belongs
    // to the same value, and until this loop existed it did not get held the
    // same way. `hir` widens the `f64` to an `i64` and then narrows that to an
    // `i32`, so a result held as an `int` met its own two conversions as
    // `i2l` immediately followed by `l2i` -- which is the identity for any
    // `int`, with no range precondition, and which `array-methods` emitted
    // twice a round for 256 rounds.
    //
    // Marking the intermediate makes both of them nothing: the first converts
    // an `int` to an `int`, and so does the second. Nothing here decides that
    // the narrowing is *safe* -- the use check below still has to agree, and a
    // use wanting a real `i64` refuses the intermediate and leaves the `i2l`
    // exactly where it was.
    //
    // A fixpoint rather than a single step because the chain's length is the
    // middle end's business and not this pass's; two is what it emits today.
    loop {
        let mut added = false;
        for (at, op) in func.values.iter().enumerate() {
            let OpKind::Convert(source) = op.kind else { continue };
            if !candidates.contains(&source) || !matches!(op.ty, HirType::Int { .. }) {
                continue;
            }
            added |= candidates.insert(ValueId(u32::try_from(at).unwrap_or(0)));
        }
        if !added {
            break;
        }
    }

    // Any use that is not an integral conversion disqualifies the value: it
    // wants the double, and widening it back is the round trip this removes.
    let mut refused = FxHashSet::default();
    let mut converted: FxHashSet<ValueId> = FxHashSet::default();
    for op in &func.values {
        if let OpKind::Convert(source) = op.kind
            && candidates.contains(&source)
            && matches!(op.ty, HirType::Int { .. })
        {
            converted.insert(source);
            continue;
        }
        for operand in operands_of(&op.kind) {
            if candidates.contains(&operand) {
                refused.insert(operand);
            }
        }
    }
    for block in &func.blocks {
        for operand in nts_core::hir::operands_of_terminator(&block.terminator) {
            if candidates.contains(&operand) {
                refused.insert(operand);
            }
        }
    }
    candidates.retain(|value| converted.contains(value) && !refused.contains(value));
    candidates
}

/// Helpers that take or answer an **index into a collection**, which is exact
/// in an `int` for the same reason `integral_helper`'s answers are.
///
/// **Not wired in.** See `cursors` below for the measurement that justifies it
/// and the emitter mismatch that stopped it.
///
/// `(name, the argument that is a cursor, the `int` variant)`. A `None`
/// position means the helper answers a cursor but takes none.
#[must_use]
#[allow(dead_code, reason = "the analysis is measured and correct; the emitter wiring is not")]
pub(crate) fn cursor_helper(name: &str) -> Option<(Option<usize>, bool, &'static str)> {
    Some(match name {
        // `nts_map_next(map, from)` -- takes a cursor and answers the next one.
        "nts_map_next" => (Some(1), true, "nextI"),
        // `nts_map_key_at(map, at)` -- takes one, answers a key.
        "nts_map_key_at" => (Some(1), false, "keyAtI"),
        _ => return None,
    })
}

/// The cursor class: `f64` values that are always exact integers because a
/// cursor helper produced them and nothing but cursor arithmetic touches them.
///
/// # The measurement
///
/// `benches/cases/array-from` walks a 256-element set 2000 times through
/// `nts_map_next` and `nts_map_key_at`, and the cursor between them is an `f64`
/// because `hir::runtime` types it so -- correctly, because that table is the
/// single answer about conversions for three backends. Per element the walk
/// therefore computes `(double) base + at`, adds `1.0`, and casts back with
/// `(int) at`.
///
/// Holding it in an `int` instead, with the identical protocol and the same two
/// calls and tests an element:
///
/// ```text
/// walked (f64 cursor)      919 ns
/// walkedInt (int cursor)   301 ns
/// bulk (no protocol)       149 ns
/// ```
///
/// **3.05x, and 672 of the 770ns that separates the walk from having no
/// protocol at all.** The walk is about 1.84ms of that row's 2.09ms against a
/// reference at 986us, so this is most of a 2.12x row.
///
/// # Why this needs more than `narrowed` above
///
/// That one holds a *single value* whose every use is a conversion. A cursor is
/// none of those things: it flows in a **cycle** through the loop's block
/// parameters, and its uses are an `add` and being handed back to the helper.
/// So the class is closed over block-parameter edges in both directions and
/// over addition by an integer constant, and then every member is checked.
///
/// # What it may not assume
///
/// The whole class is refused unless **every** use of **every** member is one
/// this pass understands. One use wanting the double back would need it widened
/// where it was, which is the round trip this removes -- and one unrecognised
/// use is a value doing something nobody checked, which is how a silent wrong
/// answer gets in.
#[must_use]
#[allow(dead_code, reason = "see the note at the end of this doc comment")]
pub(crate) fn cursors(func: &Func) -> FxHashSet<ValueId> {
    let mut class = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        let OpKind::Call { callee: Callee::External(name), .. } = &op.kind else { continue };
        if cursor_helper(name).is_some_and(|(_, answers, _)| answers)
            && matches!(op.ty, HirType::Float { bits: 64 })
        {
            class.insert(ValueId(u32::try_from(at).unwrap_or(0)));
        }
    }
    if class.is_empty() {
        return class;
    }

    // Grow across the edges a cursor actually travels: a block parameter and
    // the jump arguments feeding it are one value in two spellings, and `+ 1`
    // is still the same cursor.
    loop {
        let mut grew = false;
        for block in &func.blocks {
            let mut edge = |target: &nts_core::hir::BlockId, args: &[ValueId]| {
                let params = &func.blocks[target.0 as usize].params;
                for (at, arg) in args.iter().enumerate() {
                    let Some(param) = params.get(at) else { continue };
                    if class.contains(arg) {
                        grew |= class.insert(*param);
                    }
                    if class.contains(param) {
                        grew |= class.insert(*arg);
                    }
                }
            };
            match &block.terminator {
                Terminator::Jump { target, args } => edge(target, args),
                Terminator::Branch { then_target, then_args, else_target, else_args, .. } => {
                    edge(then_target, then_args);
                    edge(else_target, else_args);
                }
                _ => {}
            }
        }
        // The `from` a cursor helper is *given* is a cursor too, and the loop's
        // first one is a literal. `nts_map_next(map, 0)` pushes that literal
        // per its `f64` type while the call declares `I`, and the emitter's own
        // accounting caught it: `depth 0 -> 3 -> 2` where the descriptor says
        // two words go in and one comes back.
        for op in &func.values {
            let OpKind::Call { callee: Callee::External(name), args, .. } = &op.kind else {
                continue;
            };
            let Some((Some(position), _, _)) = cursor_helper(name) else { continue };
            if let Some(argument) = args.get(position)
                && whole_constant(func, *argument)
            {
                grew |= class.insert(*argument);
            }
        }
        // The literal a cursor is *compared* against, for the same reason: the
        // loop header tests `cursor >= 0`, and a class member loaded as an int
        // beside a literal spelled as a double is a comparison of three words
        // where two or four were wanted. `b13 ended with 1 word(s) on the
        // operand stack` is what that looks like from the block's end.
        for op in &func.values {
            let OpKind::Binary {
                op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne,
                lhs,
                rhs,
            } = op.kind
            else {
                continue;
            };
            for (side, other) in [(lhs, rhs), (rhs, lhs)] {
                if class.contains(&side) && whole_constant(func, other) {
                    grew |= class.insert(other);
                }
            }
        }
        for (at, op) in func.values.iter().enumerate() {
            let OpKind::Binary { op: BinOp::Add, lhs, rhs } = op.kind else { continue };
            if !matches!(op.ty, HirType::Float { bits: 64 }) {
                continue;
            }
            // The step's literal joins too, and forgetting it produced `a
            // `Add` whose operands are Int and Double but whose result is Int`
            // -- the emitter refusing a mixed addition it would have had to
            // balance by guessing. Three literals in one loop, each admitted
            // separately: the one a cursor starts from, the one it is compared
            // against, and the one it steps by.
            for (member, literal) in [(lhs, rhs), (rhs, lhs)] {
                if class.contains(&member) && whole_constant(func, literal) {
                    grew |= class.insert(literal);
                    grew |= class.insert(ValueId(u32::try_from(at).unwrap_or(0)));
                }
            }
        }
        if !grew {
            break;
        }
    }

    if !uses_are_known(func, &class) {
        class.clear();
    }
    class
}



/// Whether every use of every cursor is one this pass understands.
///
/// Split from `cursors` because that function crossed a hundred lines, and this
/// is the half that decides rather than the half that discovers.
#[allow(dead_code)]
fn uses_are_known(func: &Func, class: &FxHashSet<ValueId>) -> bool {
    // **Every use of every member, or none of them.** The closure above says
    // what a cursor flows through; this says nothing else touches it. One use
    // wanting the `double` back would need it widened where it stands, which is
    // the round trip this exists to remove -- and one use nobody recognised is
    // a value doing something unchecked, which is how a wrong answer gets in
    // quietly. Refusing the whole class costs a row's optimisation; admitting
    // an unknown use costs an answer.
    let mut refused = false;
    for (at, op) in func.values.iter().enumerate() {
        let here = ValueId(u32::try_from(at).unwrap_or(0));
        match &op.kind {
            OpKind::Binary { op: BinOp::Add, lhs, rhs } if class.contains(&here) => {
                // Already admitted by the closure, and only as `cursor + const`.
                if !((class.contains(lhs) && whole_constant(func, *rhs))
                    || (class.contains(rhs) && whole_constant(func, *lhs)))
                {
                    refused = true;
                }
            }
            OpKind::Binary { op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne, lhs, rhs } => {
                // A comparison consumes the cursor without producing one, and
                // is sound against a whole constant or another cursor.
                for (side, other) in [(lhs, rhs), (rhs, lhs)] {
                    if class.contains(side) && !(whole_constant(func, *other) || class.contains(other)) {
                        refused = true;
                    }
                }
            }
            OpKind::Call { callee: Callee::External(name), args, .. } => {
                let position = cursor_helper(name).and_then(|(at, _, _)| at);
                for (index, arg) in args.iter().enumerate() {
                    if class.contains(arg) && position != Some(index) {
                        refused = true;
                    }
                }
            }
            other => {
                for operand in operands_of(other) {
                    if class.contains(&operand) {
                        refused = true;
                    }
                }
            }
        }
    }
    // Terminator operands are fine exactly where the closure put them: a jump
    // argument whose parameter is also in the class. Anything else -- a
    // `return`, a branch condition -- is a use this pass does not understand.
    for block in &func.blocks {
        match &block.terminator {
            Terminator::Jump { target, args } => refused |= stray(func, class, *target, args),
            Terminator::Branch { cond, then_target, then_args, else_target, else_args } => {
                refused |= class.contains(cond)
                    || stray(func, class, *then_target, then_args)
                    || stray(func, class, *else_target, else_args);
            }
            Terminator::Return(Some(value)) => refused |= class.contains(value),
            _ => {}
        }
    }
    !refused
}

/// A jump argument whose parameter is not in the class -- a cursor leaving it.
#[allow(dead_code)]
fn stray(func: &Func, class: &FxHashSet<ValueId>, target: nts_core::hir::BlockId, args: &[ValueId]) -> bool {
    let params = &func.blocks[target.0 as usize].params;
    args.iter()
        .enumerate()
        .any(|(at, arg)| class.contains(arg) && params.get(at).is_none_or(|p| !class.contains(p)))
}

/// A `const` that is an exact integer, so an `int` spells it unchanged.
#[allow(dead_code, reason = "used only by `cursors`, which is not wired in")]
fn whole_constant(func: &Func, value: ValueId) -> bool {
    match func.values[value.0 as usize].kind {
        OpKind::ConstFloat(n) => n.fract() == 0.0 && n.abs() <= f64::from(i32::MAX),
        OpKind::ConstInt(n) => i32::try_from(n).is_ok(),
        _ => false,
    }
}
