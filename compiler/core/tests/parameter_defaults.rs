//! A parameter default that reads the parameters before it.
//!
//! JavaScript evaluates a default in the **callee's** scope; this compiler
//! evaluates it at the **call**. That is the same moment and a different scope,
//! and the difference was refused rather than reconciled — as *"a parameter
//! default that reads `a`, another parameter"*, 77 distinct sites in
//! `runtime/node`.
//!
//! It did not need to be. The caller has already computed every argument the
//! default can read, so binding the callee's names to those values for the
//! length of one expression is the whole of it. TypeScript refuses a default
//! that reads a *later* parameter itself (TS2372), so the only direction that
//! reaches here is the one that works.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
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

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is in examples/parameter-defaults"))
}

/// Every argument count of a call to a defaulted signature is filled here.
fn calls_to<'a>(func: &'a hir::Func, callee: &str) -> Vec<&'a Vec<hir::ValueId>> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } if name == callee => Some(args),
            _ => None,
        })
        .collect()
}

/// Nothing in the fixture is refused, which is the whole claim.
#[test]
fn a_default_may_read_the_parameters_before_it() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        Vec::<&str>::new(),
    );
}

/// Every call is filled to the signature's arity, whatever it wrote.
///
/// `twoBack(n)`, `twoBack(n, x)` and `twoBack(n, x, y)` are three call sites
/// with one, two and three arguments, and all three reach a function of three
/// parameters. A default left unfilled is invalid HIR rather than a wrong
/// answer, which is why this is checked structurally as well as by the
/// differential.
#[test]
fn every_call_is_filled_to_the_signature() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    let calls = calls_to(func(&lowered, "everyArity"), "twoBack");
    assert_eq!(calls.len(), 3, "three call sites, at three arities");
    for args in calls {
        assert_eq!(args.len(), 3, "each filled to three: {args:?}");
    }
}

/// The default's value is **derived from the argument**, not read afresh.
///
/// `oneBack(n, step = n + 1)` called as `oneBack(n)` must compute `n + 1` from
/// the same value it passed as the first argument. A lowering that bound the
/// callee's `n` to something else — the caller's own `n`, a fresh parameter
/// read, the wrong index — would produce an `Add` on a different value, and
/// this is what says which.
#[test]
fn the_default_reads_the_argument_the_call_passed() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    let caller = func(&lowered, "everyArity");
    let calls = calls_to(caller, "twoBack");
    let one_argument = calls
        .iter()
        .find(|args| {
            // The site that wrote one argument still passes three; its second
            // and third are the defaults.
            args.len() == 3
        })
        .expect("a call site exists");
    let first = one_argument[0];
    let second = one_argument[1];
    let derived = matches!(
        caller.values[second.0 as usize].kind,
        OpKind::Binary { lhs, rhs, .. } if lhs == first || rhs == first
    );
    assert!(
        derived || second == first,
        "the default is computed from the argument the call passed",
    );
}

/// A recursive call does not corrupt the caller's own binding.
///
/// `count(n, acc = n)` calling `count(n - 1, acc + n)` is the one case where the
/// caller has its own binding for the symbol the default names — they are the
/// same function. Binding without restoring would leave `count`'s own `n`
/// pointing at the argument it just passed, and every use of `n` after the call
/// would read it.
///
/// The recursive site supplies both arguments, so the binding is not even
/// needed there; what this pins is that the *outer* call's binding was undone.
#[test]
fn a_recursive_call_restores_the_binding_it_shadowed() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    let counter = func(&lowered, "count");
    for args in calls_to(counter, "count") {
        assert_eq!(args.len(), 2, "the recursive call supplies both");
    }
    // And the entry point that omits it reaches the same function.
    let outer = calls_to(func(&lowered, "recursiveDefault"), "count");
    assert_eq!(outer.len(), 1);
    assert_eq!(outer[0].len(), 2, "the omitted `acc` is filled");

    // The shape that actually needs the restore: `deep` calls itself while
    // omitting the default, then reads its own `n` afterwards. The binding put
    // `n` on the argument `n - 1`; if it stayed, the addition below reads that.
    //
    // `count` does *not* have this shape — its recursive call supplies both
    // arguments, so no default is lowered there and nothing is shadowed. The
    // mutation that never restored passed every test and every differential
    // case until this function existed.
    let deep = func(&lowered, "deep");
    let recursive = calls_to(deep, "deep");
    assert_eq!(recursive.len(), 1, "one recursive call");
    let passed = recursive[0][0];
    let after = deep
        .values
        .iter()
        .filter(|op| {
            matches!(
                op.kind,
                OpKind::Binary { lhs, rhs, .. } if lhs == passed || rhs == passed
            )
        })
        .count();
    assert_eq!(
        after, 1,
        "`n - 1` feeds the call and nothing else; the `+ n` after it reads `n`",
    );
}

/// The *second* default reads the *second* parameter, not the first.
///
/// The half a reversed or off-by-one binding gets away with. `twoBack(n, x)`
/// omits only `span = step * 2`, and `step` is the argument the call wrote —
/// so a binding that indexed from the wrong end would compute `n * 2` here and
/// still be right for every one-argument call, where the two indices coincide.
///
/// The mutation that motivated it reversed the index and **passed every test in
/// this file**; only the differential noticed, on 26 cases.
#[test]
fn the_second_default_reads_the_second_argument() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    let caller = func(&lowered, "everyArity");
    // The call site that wrote two arguments: its third is the only default.
    // Found by looking for the one whose second argument is not derived from
    // its first, which is what "the call wrote it" means here.
    let calls = calls_to(caller, "twoBack");
    let two_written = calls
        .iter()
        .find(|args| {
            !matches!(
                caller.values[args[1].0 as usize].kind,
                OpKind::Binary { lhs, rhs, .. } if lhs == args[0] || rhs == args[0]
            )
        })
        .expect("one call site writes its second argument");
    let (second, third) = (two_written[1], two_written[2]);
    assert!(
        matches!(
            caller.values[third.0 as usize].kind,
            OpKind::Binary { lhs, rhs, .. } if lhs == second || rhs == second
        ),
        "`span = step * 2` is computed from `step`, which the call wrote",
    );
}

/// The argument is evaluated **once**, however many defaults read it.
///
/// This is the hazard the refusal named: *"filling it would evaluate `a` twice,
/// and twice is a different program whenever it has an effect."* True of
/// re-lowering the argument *expression*, and false of binding the value it
/// produced — which is what happens here, so the call to `bump` appears once
/// and both defaults read its result.
#[test]
fn the_argument_is_evaluated_once_however_many_defaults_read_it() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    let caller = func(&lowered, "theArgumentIsEvaluatedOnce");
    assert_eq!(
        calls_to(caller, "bump").len(),
        1,
        "the argument expression is lowered once",
    );
    let call = calls_to(caller, "readsItTwice");
    assert_eq!(call.len(), 1);
    assert_eq!(call[0].len(), 3, "and both defaults are filled from it");
}

/// A method's receiver is argument zero, so the declared parameters start at
/// one — and the binding has to agree.
///
/// `widen(by, times = by + 1)` called as `s.widen(2)` passes `this`, `2`, and
/// the default. An off-by-one binds `times`'s default to the *receiver*, which
/// is an object where a number belongs.
#[test]
fn a_methods_receiver_does_not_shift_the_binding() {
    let Some(lowered) = lowered("parameter-defaults") else {
        return;
    };
    let caller = func(&lowered, "throughAMethod");
    let calls = calls_to(caller, "Span#widen");
    assert_eq!(calls.len(), 2, "two call sites");
    for args in &calls {
        assert_eq!(args.len(), 3, "receiver, `by`, `times`");
        assert!(
            !matches!(
                caller.values[args[2].0 as usize].ty,
                hir::HirType::Managed(hir::ManagedType::Object(_))
            ),
            "the third argument is a number, not the receiver",
        );
    }
}
