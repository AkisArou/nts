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

use nts_core::hir::{Callee, Func, HirType, OpKind, ValueId, operands_of};
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
