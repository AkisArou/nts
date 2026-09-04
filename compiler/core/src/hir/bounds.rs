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
pub fn eliminate_checks(
    func: &mut Func,
    analysis: &Analysis,
    field_lengths: &super::fields::FieldFacts,
) -> usize {
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
            }
            | OpKind::StringUnitAt {
                string: array,
                index: index_value,
                checked: true,
            }) = func.values[value.0 as usize].kind
            else {
                continue;
            };
            if !provably_in_bounds(func, analysis, field_lengths, at, array, index_value) {
                continue;
            }
            match &mut func.values[value.0 as usize].kind {
                OpKind::ArrayGet { checked, .. }
                | OpKind::ArraySet { checked, .. }
                | OpKind::StringUnitAt { checked, .. } => {
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
    field_lengths: &super::fields::FieldFacts,
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
    // Two independent sources, and either alone can settle it: what the
    // container's *shape* says, and what the program proved about a length it
    // read for itself. `BOTTOM` from the first means "nothing structural to
    // say" rather than an empty set, so it is not narrowed into.
    let structural = length_facts(func, analysis, field_lengths, at, array);
    let computed = computed_length(func, analysis, at, array);
    let length = if structural.is_bottom() {
        computed
    } else {
        structural.narrow(computed)
    };
    if !length.is_bottom() && facts.hi < length.lo {
        return true;
    }

    // Otherwise the index must be guarded by this array's own length. The
    // interval domain cannot see that -- both are unknown numbers -- but the
    // comparison that guards the block relates them.
    let growable = analysis.growable();
    analysis.guarded_by(at, index, |candidate| {
        names_the_length_of(func, growable, array, candidate)
    })
}

/// Whether a value *is* this array's length, however it is spelled.
///
/// `Length(a)` is the obvious spelling. The other one is the value `a` was
/// allocated with, which is the same number and is the one actually compared
/// against in the shape `xs.map(f)` lowers to:
///
/// ```text
/// n = Length(xs); ys = ArrayNew(n); for (i = 0; i < n; i++) { ys[i] = ... }
/// ```
///
/// The guard names `n`, and `n` is `Length(xs)` rather than `Length(ys)`, so
/// asking only the obvious question left a bounds check on every store into an
/// array that cannot be too small by construction.
///
/// Only where the allocated length is exact: a growable array's length is what
/// `push` has made it, not what it was asked for.
/// Whether two values name the same array.
///
/// Two loads of one global are two SSA values and one array.
/// `for (i = 0; i < A.length; i++) A[i]` reads a module-level `A` twice, once
/// for the length and once for the element, so comparing the ids alone left
/// every bounds check standing -- while the identical loop over a *parameter*
/// had none, because there the array is one value.
///
/// Sound while nothing writes that global. A store between the two reads could
/// leave a shorter array in the slot, and then the length proved of the first
/// does not bound the second. Asked of the whole function rather than of the
/// span between them, which is coarser and needs no order.
fn same_array(func: &Func, a: ValueId, b: ValueId) -> bool {
    if a == b {
        return true;
    }
    let (OpKind::GlobalGet(one), OpKind::GlobalGet(two)) = (
        &func.values[a.0 as usize].kind,
        &func.values[b.0 as usize].kind,
    ) else {
        return false;
    };
    one == two
        && !func.values.iter().any(|op| {
            matches!(op.kind, OpKind::GlobalSet { global, .. } if global == *one)
        })
}

fn names_the_length_of(func: &Func, growable: bool, array: ValueId, candidate: ValueId) -> bool {
    if let OpKind::Length(of) = func.values[candidate.0 as usize].kind
        && same_array(func, of, array)
    {
        return true;
    }
    matches!(
        func.values[array.0 as usize].kind,
        OpKind::ArrayNew { length, .. } if length == candidate
    ) && super::allocated_length_is_exact(func, array, growable)
}

/// A length the program computed for itself, refined by whatever guarded this
/// block.
///
/// `if (word.length > 0) { word.charCodeAt(0) }` is the shape, and nothing
/// structural can prove it: a slice's length is `[0, n]` whatever it was cut
/// from, and it is the *branch* that rules out the empty case. The fact is
/// already there — `word.length` is an ordinary value and the comparison
/// narrowed it — so all this does is look.
///
/// # Why only for a string
///
/// A string's length is fixed for its lifetime, so `Length(s)` is the same
/// number wherever it is read and a fact proved about it anywhere holds here.
/// An array's is not: `push` makes a length read from before it a fact about
/// the past, and using one to bound a later index would remove a check that
/// can fail.
fn computed_length(func: &Func, analysis: &Analysis, at: BlockId, array: ValueId) -> Facts {
    if !matches!(
        func.values[array.0 as usize].ty,
        super::HirType::Managed(super::ManagedType::String)
    ) {
        return Facts::TOP;
    }
    let mut known = Facts::TOP;
    for (index, value) in func.values.iter().enumerate() {
        if matches!(value.kind, OpKind::Length(of) if of == array) {
            let length = analysis.get_at(at, ValueId(u32::try_from(index).unwrap_or(0)));
            if !length.is_bottom() {
                known = known.narrow(length);
            }
        }
    }
    known
}

/// What is known about an array's — or a string's — length.
///
/// A literal's is written down in the literal, which is what makes a scan over
/// one provably in bounds without any reasoning about the loop. The count is of
/// UTF-16 code units and not of characters, because that is what `length` means:
/// an emoji is two.
fn length_facts(
    func: &Func,
    analysis: &Analysis,
    field_lengths: &super::fields::FieldFacts,
    at: BlockId,
    array: ValueId,
) -> Facts {
    match &func.values[array.0 as usize].kind {
        // The array a field points at, whose length `hir::fields` works out
        // over the whole program -- the only way to know it, since a method
        // that reads `this.flags` has no allocation in front of it to look at.
        OpKind::FieldGet { object, field } => match &func.values[object.0 as usize].ty {
            super::HirType::Managed(super::ManagedType::Object(ty)) => field_lengths
                .get(&(*ty, *field))
                .copied()
                .unwrap_or(Facts::BOTTOM),
            _ => Facts::BOTTOM,
        },
        OpKind::ArrayNew { length, .. }
            if super::allocated_length_is_exact(func, array, analysis.growable()) =>
        {
            analysis.get_at(at, *length)
        }
        // The array a *parameter* points at, whose length the callers say. The
        // only way to know it inside a function handed a buffer to work on.
        OpKind::Param(slot) => analysis.param_length(*slot),
        OpKind::ConstString(text) => {
            let units = text.encode_utf16().count();
            Facts::constant(f64::from(u32::try_from(units).unwrap_or(u32::MAX)))
        }
        _ => Facts::BOTTOM,
    }
}
