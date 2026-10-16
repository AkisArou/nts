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
//! `benchmarks/cases/array-methods` does that three times a round, 256 rounds.
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
pub(crate) fn integral_helper(name: &str, owner: &str) -> Option<&'static str> {
    // **The owner decides the spelling, because there are two and they are not
    // derived from each other.** `NtsRuntime` takes a bare `double[]` and names
    // these `arrayIndexOfI`; a *growable* array is a class with a backing store
    // and the same helper on it is `indexOfI`. This function used to answer the
    // first spelling unconditionally while the call site took the owner from
    // `growable_external` -- so a narrowed `indexOf` on a grown array asked
    // `NtsArrayD` for a method only `NtsRuntime` has:
    //
    // ```text
    // java.lang.NoSuchMethodError:
    //     'int nts.rt.NtsArrayD.arrayIndexOfI(nts.rt.NtsArrayD, double)'
    // ```
    //
    // Two tables both answering and disagreeing, which is worse than a missing
    // row: a missing row is `NTS4001` at build time, and this was a crash at
    // run time. So one function knows both spellings and the pair cannot drift
    // -- the owner it is asked about is the owner the call will name.
    let on_runtime = owner == crate::body::RUNTIME;
    Some(match (name, on_runtime) {
        ("nts_array_index_of" | "nts_array_index_of_ref", true) => "arrayIndexOfI",
        ("nts_array_index_of" | "nts_array_index_of_ref", false) => "indexOfI",
        ("nts_array_index_of_str", true) => "arrayIndexOfStrI",
        ("nts_array_index_of_str", false) => "indexOfStrI",
        ("nts_array_last_index_of" | "nts_array_last_index_of_ref", true) => "arrayLastIndexOfI",
        ("nts_array_last_index_of" | "nts_array_last_index_of_ref", false) => "lastIndexOfI",
        ("nts_array_last_index_of_str", true) => "arrayLastIndexOfStrI",
        ("nts_array_last_index_of_str", false) => "lastIndexOfStrI",
        _ => return None,
    })
}

/// Whether a helper has an integral form at all, on either owner.
///
/// `narrowed` runs over HIR and decides candidacy **before** an owner is known
/// -- the owner falls out of `growable_external` or `external` in the emitter,
/// much later. So this asks the set question rather than the spelling one.
///
/// **Derived from `integral_helper` rather than restated**, because a second
/// list of the same names is the defect this pair was just repaired for. Every
/// arm there answers for both owners, so asking about either settles the set;
/// `the_two_spellings_cover_the_same_helpers` holds that invariant rather than
/// leaving it as this sentence.
#[must_use]
pub(crate) fn has_integral_form(name: &str) -> bool {
    integral_helper(name, crate::body::RUNTIME).is_some()
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
    narrowed
        .contains(&value)
        .then_some(nts_jvm_emitter::VType::Integer)
}

/// Call results declared `f64` that every use converts to an integer.
#[must_use]
pub(crate) fn narrowed(func: &Func) -> FxHashSet<ValueId> {
    let mut candidates = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        if !matches!(op.ty, HirType::Float { bits: 64 }) {
            continue;
        }
        let OpKind::Call {
            callee: Callee::External(name),
            ..
        } = &op.kind
        else {
            continue;
        };
        if has_integral_form(name) {
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
            let OpKind::Convert(source) = op.kind else {
                continue;
            };
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The helpers `narrowed` may pick, named once so the test below has a
    /// population rather than an opinion.
    const INTEGRAL: [&str; 6] = [
        "nts_array_index_of",
        "nts_array_index_of_ref",
        "nts_array_index_of_str",
        "nts_array_last_index_of",
        "nts_array_last_index_of_ref",
        "nts_array_last_index_of_str",
    ];

    /// **Both owners answer for exactly the same helpers.**
    ///
    /// `has_integral_form` asks about one owner and `narrowed` acts on the
    /// answer for every array, growable or not. That is only sound while the
    /// two spellings cover the same set -- and when they did not, the call site
    /// took the owner from one table and the name from another and produced
    ///
    /// ```text
    /// java.lang.NoSuchMethodError:
    ///     'int nts.rt.NtsArrayD.arrayIndexOfI(nts.rt.NtsArrayD, double)'
    /// ```
    ///
    /// a run-time crash rather than a refusal, because both tables answered and
    /// disagreed. A missing row is `NTS4001` at build time; this was worse.
    #[test]
    fn the_two_spellings_cover_the_same_helpers() {
        for name in INTEGRAL {
            let runtime = integral_helper(name, crate::body::RUNTIME);
            let grown = integral_helper(name, "nts/rt/NtsArrayD");
            assert!(runtime.is_some(), "{name} has no runtime spelling");
            assert!(grown.is_some(), "{name} has no growable spelling");
            assert_ne!(
                runtime, grown,
                "{name} answers the same method for both owners, which means one of them \
                 does not have it"
            );
        }
    }

    /// A helper with no integral form answers for neither owner.
    #[test]
    fn a_helper_with_no_integral_form_is_absent_from_both() {
        for name in ["nts_array_push", "nts_array_sort_str", "nts_str_index_of"] {
            assert_eq!(integral_helper(name, crate::body::RUNTIME), None, "{name}");
            assert_eq!(integral_helper(name, "nts/rt/NtsArrayL"), None, "{name}");
            assert!(!has_integral_form(name), "{name}");
        }
    }
}
