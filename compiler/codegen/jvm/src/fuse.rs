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
    // built, and nothing can build it after the call did not. What the uses
    // are is `hir::erased_uses`'s answer, the one Wasm's typed reads ask too,
    // over live ops only: a call is kept if it is read, every read unerases
    // it to a float, and nothing reads its tag, its truthiness or the box.
    let asked: std::collections::BTreeSet<ValueId> = candidates.iter().copied().collect();
    let uses = nts_core::hir::erased_uses(func, &asked);
    candidates.retain(|value| {
        uses.get(value).is_some_and(|uses| {
            !uses.unerased_to.is_empty()
                && uses
                    .unerased_to
                    .iter()
                    .all(|ty| matches!(ty, HirType::Float { .. }))
                && !uses.erased
                && !uses.tag
                && !uses.truthiness
        })
    });
    candidates
}

/// How an operand a map helper takes unboxed is held, which decides the form
/// it may take: `sameKey` compares a `STRING` by `equals`, a `NUMBER` by
/// `SameValueZero` and every other reference by identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Unboxed {
    /// Any reference but a string, compared by identity (`findObject`).
    Object,
    /// A string, compared by its contents (`findString`).
    String,
    /// A number, passed as a `double`: a key (`findNumber`) or a value a
    /// table stores in a number column (`storeNumber`).
    Number,
}

/// A map helper that reads its key *through* the box, and keeps the box, if
/// at all, only as a key or a value it stores: where the key and the value sit,
/// the class that declares its unboxed forms, and each form.
///
/// The mirror of `scalar_form` above: that one is about an answer nobody wants
/// boxed, this one about arguments nobody wants boxed.
struct Keyed {
    name: &'static str,
    key_at: usize,
    /// Where it takes the value it stores, for a helper that stores one.
    value_at: Option<usize>,
    /// The class named at the call: `NtsMap` for the forms declared on
    /// `NtsTable`, which resolves to them and is what the boxed forms have
    /// always named, so a program with no number table emits what it did.
    owner: &'static str,
    /// The key's kind, the value's where it is unboxed too, the member and
    /// its descriptor.
    forms: &'static [(Unboxed, Option<Unboxed>, &'static str, &'static str)],
}

/// Every such helper, one row each, so a helper that reads a key in a new way
/// is one more row and [`unboxed_operands`] reads its positions from here.
///
/// No object form for `set`: an object key is stored as its box, and nothing
/// measured wants one. A number key has a form everywhere, because a number
/// key column stores no box at all (`NtsTable`'s columns); a number value has
/// one beside a number key, the only table whose values have a number column.
const KEYED: &[Keyed] = &[
    Keyed {
        name: "nts_map_get",
        key_at: 1,
        value_at: None,
        owner: crate::types::MAP,
        forms: &[
            (
                Unboxed::Object,
                None,
                "getObject",
                "(Lnts/rt/NtsTable;Ljava/lang/Object;)Lnts/rt/NtsValue;",
            ),
            (
                Unboxed::String,
                None,
                "getString",
                "(Lnts/rt/NtsTable;Ljava/lang/String;)Lnts/rt/NtsValue;",
            ),
            (
                Unboxed::Number,
                None,
                "getNumber",
                "(Lnts/rt/NtsTable;D)Lnts/rt/NtsValue;",
            ),
        ],
    },
    Keyed {
        name: "nts_map_has",
        key_at: 1,
        value_at: None,
        owner: crate::types::MAP,
        forms: &[
            (
                Unboxed::Object,
                None,
                "hasObject",
                "(Lnts/rt/NtsTable;Ljava/lang/Object;)Z",
            ),
            (
                Unboxed::String,
                None,
                "hasString",
                "(Lnts/rt/NtsTable;Ljava/lang/String;)Z",
            ),
            (Unboxed::Number, None, "hasNumber", "(Lnts/rt/NtsTable;D)Z"),
        ],
    },
    Keyed {
        name: "nts_map_delete",
        key_at: 1,
        value_at: None,
        owner: crate::types::MAP,
        forms: &[(
            Unboxed::Number,
            None,
            "deleteNumber",
            "(Lnts/rt/NtsTable;D)Z",
        )],
    },
    Keyed {
        name: "nts_map_set",
        key_at: 1,
        value_at: Some(2),
        owner: crate::types::MAP,
        forms: &[
            (
                Unboxed::String,
                None,
                "setString",
                "(Lnts/rt/NtsMap;Ljava/lang/String;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;",
            ),
            (
                Unboxed::Number,
                None,
                "setNumber",
                "(Lnts/rt/NtsMap;DLnts/rt/NtsValue;)Lnts/rt/NtsMap;",
            ),
            (
                Unboxed::Number,
                Some(Unboxed::Number),
                "setNumber",
                "(Lnts/rt/NtsMap;DD)Lnts/rt/NtsMap;",
            ),
        ],
    },
    Keyed {
        name: "nts_set_add",
        key_at: 1,
        value_at: None,
        owner: crate::types::SET,
        forms: &[(
            Unboxed::Number,
            None,
            "addNumber",
            "(Lnts/rt/NtsSet;D)Lnts/rt/NtsSet;",
        )],
    },
];

fn keyed(name: &str) -> Option<&'static Keyed> {
    KEYED.iter().find(|row| row.name == name)
}

/// The form of the helper `name` that takes its key as `key` and its value as
/// `value`, `None` for a value passed boxed: the class, the member and its
/// descriptor.
#[must_use]
pub(crate) fn unboxed_form(
    name: &str,
    key: Unboxed,
    value: Option<Unboxed>,
) -> Option<(&'static str, &'static str, &'static str)> {
    let row = keyed(name)?;
    row.forms
        .iter()
        .find(|form| form.0 == key && form.1 == value)
        .map(|form| (row.owner, form.2, form.3))
}

/// Where the helper `name` takes its key and, for one that stores a value,
/// its value.
#[must_use]
pub(crate) fn operands_at(name: &str) -> Option<(usize, Option<usize>)> {
    keyed(name).map(|row| (row.key_at, row.value_at))
}

/// Erasures whose every use is a key or a value one of those helpers can take
/// unboxed: the value each one erases, and how it is held.
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
/// reference's 15,408. A number key or value is the same box, and
/// `map-and-set` built one per key and value it passed.
#[must_use]
pub(crate) fn unboxed_operands(func: &Func) -> rustc_hash::FxHashMap<ValueId, (ValueId, Unboxed)> {
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
            Some(HirType::Managed(nts_core::hir::ManagedType::String)) => Unboxed::String,
            Some(HirType::Managed(_)) => Unboxed::Object,
            Some(HirType::Float { bits: 64 }) => Unboxed::Number,
            _ => continue,
        };
        candidates.insert(ValueId(u32::try_from(at).unwrap_or(0)), (value, kind));
    }
    if candidates.is_empty() {
        return candidates;
    }

    // Every use, or none -- `fused`'s rule, for the same reason: the box is not
    // built, so a use that wants one has nothing to want. An operand whose
    // helper has no form for it wants the box too.
    //
    // **Live uses only**, as `hir::erased_uses` counts them: an op no block
    // holds is never emitted, so it wants nothing. Asking every value refused
    // the key of the `in` in `countLiteral`
    // (tests/programs/a-record-keyed-by-strings-built-at-run-time), whose one
    // live use is `nts_map_has`.
    let mut refused = FxHashSet::default();
    for block in &func.blocks {
        for operand in nts_core::hir::operands_of_terminator(&block.terminator) {
            if candidates.contains_key(&operand) {
                refused.insert(operand);
            }
        }
    }
    let live: Vec<&nts_core::hir::Op> = func
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|value| &func.values[value.0 as usize])
        .collect();
    // **Until nothing more is refused**, because whether a value goes unboxed
    // depends on its call's key: there is no form for a boxed key and an
    // unboxed value, so refusing a key at one call refuses the value beside
    // it, and that value may be an erasure another call shares. Refusals only
    // grow, so this ends.
    loop {
        let before = refused.len();
        for op in &live {
            if let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &op.kind
                && let Some((key_at, value_at)) = operands_at(name)
            {
                let held = |at: usize| {
                    args.get(at)
                        .filter(|operand| !refused.contains(*operand))
                        .and_then(|operand| candidates.get(operand))
                        .map(|&(_, kind)| kind)
                };
                let key = held(key_at);
                let value = value_at.and_then(held);
                let (key_kept, value_kept) = match key {
                    Some(key) if unboxed_form(name, key, value).is_some() => {
                        (true, value.is_some())
                    }
                    Some(key) if unboxed_form(name, key, None).is_some() => (true, false),
                    _ => (false, false),
                };
                for (at, operand) in args.iter().enumerate() {
                    if !candidates.contains_key(operand) {
                        continue;
                    }
                    let kept = (at == key_at && key_kept) || (Some(at) == value_at && value_kept);
                    if !kept {
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
        if refused.len() == before {
            break;
        }
    }
    candidates.retain(|value, _| !refused.contains(value));
    candidates
}
