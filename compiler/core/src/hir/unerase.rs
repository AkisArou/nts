//! Removing erasure from a site that never needed it.
//!
//! # The measurement this exists for
//!
//! An erased array costs about 11% against a typed one, and the cost is the
//! per-element tag test — NaN-boxing the value to half its size was built,
//! measured, and moved the number by 0.1%, which is what proved it. The only
//! thing that removes a tag test is not having a tag.
//!
//! `docs/records/0019` counts what real code does with `unknown`: 41% of
//! parameters are *carried* and never read, 14% are *tested* and read only
//! through the test. Both of those want a representation smaller than the
//! general one, and this is the first pass that gives one.
//!
//! # What it does, and the one thing it must not get wrong
//!
//! An array whose element type is erased, allocated here and never escaping,
//! every store of which erases a value of the same representation `R`: the
//! element becomes `R`, the erasures before the stores go, and the reads come
//! back as `R` rather than as a tag and a payload.
//!
//! The thing it must not get wrong is *aliasing*. If the array escapes, some
//! other function may store a string into it, and an element typed `f64` would
//! then be read as a double that was never written — silently. So escape
//! analysis decides, and a value it cannot prove frame-local is left alone.
//!
//! Conservative twice over: every use of a read must be an unerase or a tag
//! read. A read that flows anywhere else is a use that expects the general
//! representation, and one of those sinks the whole array.

use rustc_hash::{FxHashMap, FxHashSet};

use super::escape::Escapes;
use super::{Func, HirType, ManagedType, OpKind, ValueId};

/// Specialize the erased arrays a function allocates and keeps. Reports how
/// many.
pub fn narrow_arrays(func: &mut Func, escapes: &Escapes) -> usize {
    let candidates: Vec<ValueId> = (0..func.values.len())
        .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
        .filter(|value| {
            matches!(func.value(*value).kind, OpKind::ArrayNew { .. })
                && func.value(*value).ty
                    == HirType::Managed(ManagedType::Array(Box::new(HirType::Erased)))
                && escapes.is_frame_local(*value)
        })
        .collect();
    if candidates.is_empty() {
        return 0;
    }

    let mut narrowed = 0;
    for array in candidates {
        if let Some(element) = single_representation(func, array) {
            rewrite(func, array, &element);
            narrowed += 1;
        }
    }
    narrowed
}

/// The one representation every store puts into an array, if there is one.
///
/// `None` the moment two disagree, or a store is of something other than a
/// fresh erasure, or a read is used as anything but an unerase or a tag. Each
/// of those is a use that wants the general representation, and wanting it once
/// is wanting it.
fn single_representation(func: &Func, array: ValueId) -> Option<HirType> {
    let mut found: Option<HirType> = None;
    let mut reads: FxHashSet<ValueId> = FxHashSet::default();

    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match &func.value(id).kind {
            OpKind::ArraySet {
                array: target,
                value,
                ..
            } if *target == array => {
                // Only a *fresh* erasure. A value that was already erased
                // elsewhere has a tag this pass did not choose, and unwrapping
                // it would be asserting something about the other site.
                let OpKind::Erase { value: source } = func.value(*value).kind else {
                    return None;
                };
                let representation = func.value(source).ty.clone();
                match &found {
                    Some(seen) if *seen != representation => return None,
                    Some(_) => {}
                    None => found = Some(representation),
                }
            }
            OpKind::ArrayGet { array: target, .. } if *target == array => {
                reads.insert(id);
            }
            _ => {}
        }
    }

    // Every read has to be consumed by something that would have unwrapped it
    // anyway.
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        let uses_a_read = |value: &ValueId| reads.contains(value);
        match &func.value(id).kind {
            OpKind::Unerase { value } | OpKind::TagOf { value } if uses_a_read(value) => {}
            other => {
                if super::verify::operands(other).iter().any(uses_a_read) {
                    return None;
                }
            }
        }
    }
    // A read whose value leaves through a terminator is the same problem.
    for block in &func.blocks {
        if super::verify::terminator_operands(&block.terminator)
            .iter()
            .any(|value| reads.contains(value))
        {
            return None;
        }
    }

    found
}

/// Retype the array and unwrap every erasure around it.
fn rewrite(func: &mut Func, array: ValueId, element: &HirType) {
    let tag = super::tags::of_representation(element);
    func.values[array.0 as usize].ty =
        HirType::Managed(ManagedType::Array(Box::new(element.clone())));

    // The stores lose their erasure, the reads come back concrete.
    let mut reads: FxHashSet<ValueId> = FxHashSet::default();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match func.values[index].kind.clone() {
            OpKind::ArraySet {
                array: target,
                index: at,
                value,
                checked,
            } if target == array => {
                let OpKind::Erase { value: source } = func.value(value).kind else {
                    continue;
                };
                func.values[index].kind = OpKind::ArraySet {
                    array,
                    index: at,
                    value: source,
                    checked,
                };
            }
            OpKind::ArrayGet { array: target, .. } if target == array => {
                func.values[index].ty = element.clone();
                reads.insert(id);
            }
            _ => {}
        }
    }

    // An unerase of a concrete read is the identity; a tag read is a constant.
    // Both are left as operations rather than deleted, because `simplify` and
    // `fold` remove those and this pass should not also be a peephole.
    let mut replacements: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match func.values[index].kind {
            OpKind::Unerase { value } if reads.contains(&value) => {
                replacements.insert(id, value);
            }
            OpKind::TagOf { value } if reads.contains(&value) => {
                func.values[index].kind = OpKind::ConstInt(i64::from(tag));
            }
            _ => {}
        }
    }
    if replacements.is_empty() {
        return;
    }
    let of = |value: ValueId| replacements.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        super::simplify::substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        super::simplify::substitute_terminator(&mut block.terminator, of);
    }
}
