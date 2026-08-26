//! Removing bounds checks that cannot fail.
//!
//! # Why this belongs next to the range analysis
//!
//! A bounds check asks whether `0 <= index < length`. That is a question about
//! intervals, and proving it is what an interval domain is *for* — so the
//! analysis that made loop counters into integers answers this one too, at no
//! extra cost.
//!
//! # What the check costs, and why it stays where it is not proven
//!
//! An unproven access keeps its test. Reading past the end would not fail on
//! its own: the allocator hands out large chunks, so the memory is mapped and
//! the read would quietly return whatever happened to be next. A missing check
//! is not a crash, it is a wrong answer — which is the failure this compiler
//! exists to avoid.
//!
//! # What is provable
//!
//! Two shapes, and between them most real indexing:
//!
//! - **A known length.** `[1, 2, 3][0]` and a loop over an array allocated in
//!   the same function: the length is a constant, so the guard `i < xs.length`
//!   refines `i` to a constant range and the interval settles it.
//! - **A guarded index.** `for (i = 0; i < xs.length; i++)` over an array that
//!   arrived from outside. The length is unknown, so no interval bounds it —
//!   what proves this is that the *same value* guards the loop, which is a
//!   relation rather than a range. See [`super::flow::Analysis::guarded_by`].

use super::facts::Facts;
use super::flow::Analysis;
use super::{BlockId, Func, OpKind, ValueId};

/// Turn off the checks that cannot fail, and report how many.
pub fn eliminate_checks(func: &mut Func, analysis: &Analysis) -> usize {
    let mut removed = 0;
    let blocks = std::mem::take(&mut func.blocks);

    for (index, block) in blocks.iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(0));
        for value in &block.ops {
            let (OpKind::ArrayGet {
                array,
                index: index_value,
                checked: true,
            }
            | OpKind::ArraySet {
                array,
                index: index_value,
                checked: true,
                ..
            }) = func.values[value.0 as usize].kind
            else {
                continue;
            };
            if !provably_in_bounds(func, analysis, at, array, index_value) {
                continue;
            }
            match &mut func.values[value.0 as usize].kind {
                OpKind::ArrayGet { checked, .. } | OpKind::ArraySet { checked, .. } => {
                    *checked = false;
                    removed += 1;
                }
                _ => {}
            }
        }
    }

    func.blocks = blocks;
    removed
}

/// Whether an index is provably a valid slot of an array.
fn provably_in_bounds(
    func: &Func,
    analysis: &Analysis,
    at: BlockId,
    array: ValueId,
    index: ValueId,
) -> bool {
    // Asked *at this block*, since what proves an index in bounds is usually
    // the guard that let control in rather than anything about its definition.
    let facts = analysis.get_at(at, index);
    // The index has to name a slot at all: a whole number, not NaN, not
    // negative. `-0` would be a valid slot but the flag means "may be", and a
    // may-be is not a proof.
    if facts.is_bottom() || !facts.whole || facts.maybe_nan || facts.lo < 0.0 {
        return false;
    }

    // Where the length is known, the interval settles it. The *smallest*
    // possible length is what has to exceed the index, since a larger one only
    // helps.
    let length = length_facts(func, analysis, at, array);
    if !length.is_bottom() && facts.hi < length.lo {
        return true;
    }

    // Otherwise the index must be guarded by this array's own length. The
    // interval domain cannot see that -- both are unknown numbers -- but the
    // comparison that guards the block relates them.
    analysis.guarded_by(at, index, |candidate| {
        matches!(func.values[candidate.0 as usize].kind, OpKind::ArrayLen(of) if of == array)
    })
}

/// What is known about an array's length.
fn length_facts(func: &Func, analysis: &Analysis, at: BlockId, array: ValueId) -> Facts {
    match func.values[array.0 as usize].kind {
        OpKind::ArrayNew { length } => analysis.get_at(at, length),
        _ => Facts::BOTTOM,
    }
}
