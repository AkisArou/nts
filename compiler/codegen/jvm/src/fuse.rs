//! Erased helper answers that are read as a scalar on the very next
//! instruction, and so never need to exist.
//!
//! # The measurement this exists for, and it is an ART measurement
//!
//! `benches/cases/array-methods` calls `xs.at(-1)` 256 times an operation. The
//! lowering emits `nts_array_at_value`, which answers an `NtsValue`, and the
//! next instruction is `getfield num` -- so a box is built and read once:
//!
//! ```text
//! %83 = call.extern nts_array_at_value(%2, %82) : erased
//! %84 = unerase %83 : f64
//! ```
//!
//! **On `HotSpot` this costs nothing and I measured it and said so.** `C2` inlines
//! the helper and scalar-replaces the result: 144 bytes an operation, which is
//! the case's `new double[16]` and not one of the 256 boxes. The fusion below
//! was written, priced at zero, and abandoned.
//!
//! **On ART it costs 6,144 bytes an operation.** Same program, same entry,
//! same iteration count:
//!
//! ```text
//! array-methods    `HotSpot` 144    ART 6288      43.7x
//! ```
//!
//! and `6288 - 144 = 6144 = 256 * 24`, one `NtsValue` a round at 24 bytes.
//! ART's escape analysis does not see through the call boundary that C2's
//! inlining removes. Seven other cases -- both `erasure-*` pairs, `objects`,
//! `arrays`, `symbol-keyed-map` -- allocate the same on both, so this is not
//! "ART is worse" but "ART loses the ones that need inlining first".
//!
//! # Why this is sound with no precondition
//!
//! The two runtime methods are the same function. `NtsRuntime.arrayAt` is
//!
//! ```java
//! int at = NtsArrays.offset(index, a.length); return at < 0 ? Double.NaN : a[at];
//! ```
//!
//! and `arrayAtValue(...).num` is `at < 0 ? ABSENT_NUMBER.num : ofNumber(a[at]).num`,
//! where `ABSENT_NUMBER` is `NaN`. Same offset, same out-of-range answer, same
//! value in range -- so substituting one for the other cannot change a result,
//! and this pass does not have to prove the index is in range.
//!
//! # What it may not assume
//!
//! The box is skipped only if **every** use of the call's answer is an
//! `Unerase` to a float. One use wanting the `NtsValue` -- a `TagOf`, a store,
//! a merge with an absence -- needs the box that was not built, and there is
//! no way to build it late.

use nts_core::hir::{Callee, Func, HirType, OpKind, ValueId, operands_of};
use rustc_hash::FxHashSet;

/// The helper whose answer is a box around a number, and the one that answers
/// the number.
///
/// Named rather than inferred, for `intcall::integral_helper`'s reason: a
/// helper answers an erased value for a reason particular to it, and a rule
/// like "returns `erased`, read as a float" would also catch a map lookup,
/// whose absence is a real answer a caller may be testing for.
#[must_use]
pub(crate) fn scalar_form(name: &str) -> Option<&'static str> {
    Some(match name {
        "nts_array_at_value" => "nts_array_at",
        _ => return None,
    })
}

/// Calls whose erased answer is only ever read as a float.
#[must_use]
pub(crate) fn fused(func: &Func) -> FxHashSet<ValueId> {
    let mut candidates = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        let OpKind::Call { callee: Callee::External(name), .. } = &op.kind else { continue };
        if scalar_form(name).is_some() && matches!(op.ty, HirType::Erased) {
            candidates.insert(ValueId(u32::try_from(at).unwrap_or(0)));
        }
    }
    if candidates.is_empty() {
        return candidates;
    }

    // Every use, or none: a single use wanting the box needs one that was not
    // built, and nothing can build it after the call did not.
    let mut refused = FxHashSet::default();
    let mut read = FxHashSet::default();
    for op in &func.values {
        if let OpKind::Unerase { value } = op.kind
            && candidates.contains(&value)
            && matches!(op.ty, HirType::Float { .. })
        {
            read.insert(value);
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
    candidates.retain(|value| read.contains(value) && !refused.contains(value));
    candidates
}
