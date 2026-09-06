//! Overload signatures, and the implementation every call actually reaches.
//!
//! TypeScript matches a call against whichever *signature* fits, and those are
//! separate declarations with no bodies. Only the implementation is emitted, so
//! everything a call is built from — how many arguments it owes, what each of
//! them is represented as, where the rest begins, and whether the callee is
//! defined at all — has to come from the implementation rather than from the
//! signature the checker handed back.
//!
//! Four questions, four sites, and each of the first three broke on its own
//! before it was asked of the right list.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, Func, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` should be lowered"))
}

/// Every call in the program, as `(callee name, argument count)`.
fn calls(lowered: &hir::lower::Lowered) -> Vec<(String, usize)> {
    lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call { callee, args, .. } => {
                let name = match callee {
                    Callee::Direct(name) | Callee::External(name) => name.clone(),
                    other => format!("{other:?}"),
                };
                Some((name, args.len()))
            }
            _ => None,
        })
        .collect()
}

/// A call built against the overload it matched owes the implementation's
/// arity, not that overload's.
///
/// `p.pick(n)` matches `pick(a: number)` and lands on
/// `Picker#pick(this, a, b)`. Reading the omitted parameters off the resolved
/// signature says there are none, and the verifier says
/// `CallArgumentCount { expected: 3, found: 2 }` — invalid HIR out of a program
/// that reported no refusal at all.
///
/// Asserted through the verifier rather than by counting arguments, because
/// that is the instrument that failed: it is checking the same thing the C
/// backend would crash on, at the point the arity is decided.
#[test]
fn a_call_matching_an_overload_reaches_the_implementation() {
    let Some(lowered) = lowered("overloads") else {
        return;
    };
    if let Err(problems) = hir::verify::verify(&lowered.program) {
        panic!("overloads lowered to invalid HIR: {problems:#?}");
    }

    // And the arity is the implementation's rather than merely consistent:
    // three arguments to `pick`, from call sites written with one and with two.
    let picks: Vec<usize> = calls(&lowered)
        .into_iter()
        .filter(|(name, _)| name.ends_with("pick"))
        .map(|(_, args)| args)
        .collect();
    assert_eq!(
        picks,
        vec![3, 3],
        "`p.pick(n)` and `p.pick(n, 2)` both reach `pick(this, a, b)`",
    );

    // The middle signature of three, so the gap is more than one and the
    // fixture is not passing on an off-by-one that happens to land.
    let spans: Vec<usize> = calls(&lowered)
        .into_iter()
        .filter(|(name, _)| name.ends_with("span"))
        .map(|(_, args)| args)
        .collect();
    assert_eq!(spans, vec![4, 4, 4], "`span(this, a, b, c)` from all three");
}

/// An argument is coerced to the implementation's parameter, not the matched
/// signature's.
///
/// `pick(a: number, b: number)` and `pick(a: number, b?: number)` are the same
/// arity and a different **representation**: an optional parameter is erased
/// and carries a tag, and a required one is a bare `f64`. So a call matching
/// the two-argument signature built an `f64` for a slot that is `Erased` —
/// `CallArgumentType { at: 2, expected: Erased, found: Float }` — and the call
/// written with one argument found no parameter at index 1 at all, and was
/// refused as an omission with "nowhere to put `undefined`".
///
/// The arity above is right in both directions here, so this is the half of
/// the fix counting arguments cannot see.
#[test]
fn an_argument_is_coerced_to_the_implementation_s_parameter() {
    let Some(lowered) = lowered("overloads") else {
        return;
    };
    let pick = func(&lowered, "Picker#pick");
    let optional = pick
        .params
        .iter()
        .find(|param| param.name == "b")
        .expect("the implementation declares it");
    assert_eq!(
        optional.ty,
        hir::HirType::Erased,
        "`b?: number` is erased, which is what makes this distinguishable",
    );

    // And every argument reaching it was built at that representation, from
    // both call sites — the one that supplied a number and the one that
    // supplied nothing.
    let caller = func(&lowered, "oneOrTwo");
    let supplied: Vec<&hir::HirType> = caller
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call { callee: Callee::Direct(name), args, .. }
                if name.ends_with("pick") =>
            {
                args.get(2).map(|arg| &caller.values[arg.0 as usize].ty)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        supplied,
        vec![&hir::HirType::Erased, &hir::HirType::Erased],
        "`p.pick(n)` and `p.pick(n, 2)` both build the slot the callee has",
    );
}

/// The signatures are not functions, the implementation is, and nothing is
/// refused.
///
/// Two mutations, and they fail different halves. Lowering the signatures
/// produces three `pick`s — this is where it started, and refusing the whole
/// class produced none. *Refusing* the signatures instead of skipping them
/// leaves one `pick` and seven NTS1001s, for a construct handled exactly: a
/// call resolving to a signature is built against the implementation and
/// answers correctly, so a gap reported there is a gap that is not there. A
/// plain overloaded function's signatures never said anything, so the two paths
/// disagreed about the same construct.
#[test]
fn one_implementation_is_lowered_per_overload_set() {
    let Some(lowered) = lowered("overloads") else {
        return;
    };
    for name in ["pick", "span", "scaled"] {
        let found: Vec<&str> = lowered
            .program
            .funcs
            .iter()
            .map(|func| func.name.as_str())
            .filter(|func| func.ends_with(name))
            .collect();
        assert_eq!(found.len(), 1, "one `{name}` is emitted, not three: {found:?}");
    }

    let said: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|d| d.message.as_str())
        .collect();
    assert!(
        said.is_empty(),
        "and a program of nothing but overloads is complete: {said:?}",
    );
}

/// A plain overloaded function is defined, not external.
///
/// A method takes its name from the hierarchy, so `Picker#pick` was found
/// either way. A plain function has only the declaration to ask — and asking
/// the *signature* whether it has a body answers no, so `combine` was called
/// external and the linker said `undefined reference to 'combine'` on a program
/// that reported no refusal.
///
/// The pair is the test: a genuinely external callee must still be external, or
/// this passes on a lowering that calls everything direct.
#[test]
fn an_overloaded_function_is_defined() {
    let Some(lowered) = lowered("overloads") else {
        return;
    };
    let external: Vec<String> = lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            OpKind::Call { callee: Callee::External(name), .. } => Some(name.clone()),
            _ => None,
        })
        .collect();
    assert!(
        !external.iter().any(|name| name == "combine" || name == "total"),
        "both are declared in this program: {external:?}",
    );
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|func| func.name == "combine"),
        "and `combine` is emitted once, from the declaration that has the body",
    );
}

/// An implementation taking a rest gathers one, however the call matched.
///
/// `total(a: number, b: number)` sits beside
/// `total(a: number, ...rest: number[])` and has no rest of its own. Asking the
/// resolved signature where the rest begins answers *nowhere*, so nothing was
/// gathered and a bare `f64` reached a parameter wanting an array — which the
/// differential reported as
/// `a value of type Float { bits: 64 } where Managed(Array(Float { bits: 64 }))
/// is wanted`.
#[test]
fn a_rest_is_gathered_against_the_implementation() {
    let Some(lowered) = lowered("overloads") else {
        return;
    };
    let totals: Vec<usize> = calls(&lowered)
        .into_iter()
        .filter(|(name, _)| name == "total")
        .map(|(_, args)| args)
        .collect();
    assert_eq!(
        totals,
        vec![2, 2],
        "`total(n)` and `total(n, 7)` both pass one number and one array",
    );

    // And the second argument is the array, rather than the arity being right
    // for some other reason: an `ArrayNew` per call, including the one that
    // supplied no elements at all.
    let built = func(&lowered, "throughARest")
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ArrayNew { .. }))
        .count();
    assert_eq!(built, 2, "one per call, and the empty one is still an array");
}

/// A signature is told from a method whose body is merely missing.
///
/// The one shape that separates them: an **ambient** class declares two
/// same-named methods and no implementation, which is legal TypeScript. Both
/// are bodiless, and neither is a signature standing in front of something this
/// program emits.
///
/// Skipping on the name alone drops both silently, and the caller then reports
/// NTS1003 — "which was refused above" — with nothing refused above. That is
/// the failure a refusal count cannot show: one diagnostic instead of three,
/// and the one that survives points at a refusal that does not exist.
#[test]
fn an_ambient_overload_is_not_skipped() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    let bodiless = lowered
        .diagnostics
        .iter()
        .filter(|d| d.message.contains("a method without a body"))
        .count();
    assert_eq!(
        bodiless,
        2,
        "`declare class Platform` declares two, and neither has an implementation: {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
    );
}
