//! Erased helper answers that are read as a scalar on the very next
//! instruction, and so never need to exist.
//!
//! # The measurement this exists for, and it is an ART measurement
//!
//! `benchmarks/cases/array-methods` calls `xs.at(-1)` 256 times an operation. The
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
        let OpKind::Call {
            callee: Callee::External(name),
            ..
        } = &op.kind
        else {
            continue;
        };
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

/// How a map key held unboxed is compared, which decides the form it may take:
/// `sameKey` compares a `STRING` by `equals` and every other reference by
/// identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyKind {
    /// Any reference but a string, compared by identity (`findObject`).
    Object,
    /// A string, compared by its contents (`findString`).
    String,
}

/// A map helper that compares its key *through* the box, and keeps the box, if
/// at all, only as a key it inserts: where the key sits, and the form that
/// takes it unboxed for each kind.
///
/// The mirror of `scalar_form` above: that one is about an answer nobody wants
/// boxed, this one about an argument nobody wants boxed.
struct Keyed {
    name: &'static str,
    key_at: usize,
    object: Option<(&'static str, &'static str)>,
    string: Option<(&'static str, &'static str)>,
}

/// Every such helper, one row each, so a helper that reads a key in a new way
/// is one more row and [`unboxed_keys`] reads its key position from here.
///
/// No object form for `set`: an object key is stored as its box, and nothing
/// measured wants one.
const KEYED: &[Keyed] = &[
    Keyed {
        name: "nts_map_get",
        key_at: 1,
        object: Some((
            "getObject",
            "(Lnts/rt/NtsTable;Ljava/lang/Object;)Lnts/rt/NtsValue;",
        )),
        string: Some((
            "getString",
            "(Lnts/rt/NtsTable;Ljava/lang/String;)Lnts/rt/NtsValue;",
        )),
    },
    Keyed {
        name: "nts_map_has",
        key_at: 1,
        object: Some(("hasObject", "(Lnts/rt/NtsTable;Ljava/lang/Object;)Z")),
        string: Some(("hasString", "(Lnts/rt/NtsTable;Ljava/lang/String;)Z")),
    },
    Keyed {
        name: "nts_map_set",
        key_at: 1,
        object: None,
        string: Some((
            "setString",
            "(Lnts/rt/NtsMap;Ljava/lang/String;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;",
        )),
    },
];

/// Where the helper `name` takes its key, if it is one of those.
#[must_use]
pub(crate) fn key_at(name: &str) -> Option<usize> {
    KEYED
        .iter()
        .find(|row| row.name == name)
        .map(|row| row.key_at)
}

/// The form of the helper `name` that takes a key of `kind` unboxed: the
/// member and its descriptor.
#[must_use]
pub(crate) fn unboxed_key_form(name: &str, kind: KeyKind) -> Option<(&'static str, &'static str)> {
    let row = KEYED.iter().find(|row| row.name == name)?;
    match kind {
        KeyKind::Object => row.object,
        KeyKind::String => row.string,
    }
}

/// Erasures of a reference whose every use is a key one of those helpers can
/// take unboxed: the reference each one erases, and how it compares.
///
/// # Why a string has a form of its own
///
/// `Erase` picks its constructor from the type: `Managed(String)` becomes
/// `ofString` and tags `STRING`, everything else `ofObject` and tags `OBJECT`.
/// `sameKey` compares a `STRING` by `equals` and an `OBJECT` by reference, so a
/// string sent to the identity form would silently stop finding keys that are
/// equal without being identical, and strings were left out here at first.
/// They have `findString` now, which compares by contents, and the key's kind
/// picks the form.
///
/// # Why it is worth something on `HotSpot` after all
///
/// The object form was priced on ART: C2 inlines the lookup and
/// scalar-replaces the box. It does so only where the lookup inlines, and in a
/// hot loop `find` and `insert` are "already compiled into a big method":
/// `benchmarks/cases/record-word-counts` erases a string key 1,600 times a run,
/// 38 KB at 24 bytes a box, of the 70,768 bytes it allocated against the Java
/// reference's 15,408.
#[must_use]
pub(crate) fn unboxed_keys(func: &Func) -> rustc_hash::FxHashMap<ValueId, (ValueId, KeyKind)> {
    let mut candidates = rustc_hash::FxHashMap::default();
    for (at, op) in func.values.iter().enumerate() {
        // **Only an erase that cannot be null.** This fuses an erasure into
        // an unboxed reference, which throws the tag away -- and for a nullable
        // operand the tag is the *only* thing that says whether a null pointer
        // is `null` or `undefined`. Silently permissive here would be a wrong
        // answer rather than a missed optimisation.
        let OpKind::Erase {
            value,
            absent: nts_core::hir::Absent::Impossible,
            ..
        } = op.kind
        else {
            continue;
        };
        let kind = match func.values.get(value.0 as usize).map(|it| &it.ty) {
            Some(HirType::Managed(nts_core::hir::ManagedType::String)) => KeyKind::String,
            Some(HirType::Managed(_)) => KeyKind::Object,
            _ => continue,
        };
        candidates.insert(ValueId(u32::try_from(at).unwrap_or(0)), (value, kind));
    }
    if candidates.is_empty() {
        return candidates;
    }

    // Every use, or none -- `fused`'s rule, for the same reason: the box is not
    // built, so a use that wants one has nothing to want. A key whose helper
    // has no form for its kind wants the box too.
    //
    // **Live uses only**, as `hir::erased_uses` counts them: an op no block
    // holds is never emitted, so it wants nothing. Asking every value refused
    // the key of the `in` in `countLiteral`
    // (tests/programs/a-record-keyed-by-strings-built-at-run-time), whose one
    // live use is `nts_map_has`.
    let mut refused = FxHashSet::default();
    let live = func
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|value| &func.values[value.0 as usize]);
    for op in live {
        if let OpKind::Call {
            callee: Callee::External(name),
            args,
            ..
        } = &op.kind
            && let Some(key) = key_at(name)
        {
            for (at, operand) in args.iter().enumerate() {
                let Some(&(_, kind)) = candidates.get(operand) else {
                    continue;
                };
                if at != key || unboxed_key_form(name, kind).is_none() {
                    refused.insert(*operand);
                }
            }
            continue;
        }
        for operand in operands_of(&op.kind) {
            if candidates.contains_key(&operand) {
                refused.insert(operand);
            }
        }
    }
    for block in &func.blocks {
        for operand in nts_core::hir::operands_of_terminator(&block.terminator) {
            if candidates.contains_key(&operand) {
                refused.insert(operand);
            }
        }
    }
    candidates.retain(|value, _| !refused.contains(value));
    candidates
}
