//! A `throw` that leaves the frame it was raised in.
//!
//! The handler's block is a branch target inside one function, so a callee's
//! `throw` had no edge to it: the callee ended the process and the caller's
//! `catch` never ran. `try { return deep(n) } catch { return -1 }` compiled to
//! `v1 = deep(v0); return v1;` — a `try`/`catch` compiled to neither, with no
//! diagnostic — so the call was refused instead.
//!
//! **A callee a `try` reaches now gets a raising copy** (record 0343), which
//! records the value and returns rather than ending the program, and the call
//! names it and tests afterwards. So `crossing` compiles, and what is asserted
//! here is the shape of the bound rather than the shape of the refusal:
//!
//!   - a plain function callee compiles, and its copy is emitted;
//!   - a **method** callee still refuses — `function_copies` is consulted for
//!     function declarations and a method has no copy to name;
//!   - a callee that merely *passes a throw on* still refuses, because its copy
//!     would call the plain callee and end the program anyway.
//!
//! What the refusal must *not* reach is still the greater part of this test.
//! Three shapes that work were broken by two successive versions of it: a
//! `throw` and its handler in one function, a call to a callee that cannot
//! raise, and an `await` of a rejecting async function, whose rejection is a
//! real edge into the handler. Each is one arm of
//! `examples/a-throw-that-stays-in-its-function` and each is asserted here by
//! name.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

const EXAMPLE: &str = "a-throw-that-stays-in-its-function";

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(EXAMPLE)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{EXAMPLE} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn compiled(lowered: &hir::lower::Lowered, name: &str) -> bool {
    lowered.program.funcs.iter().any(|func| func.name == name)
}

/// A plain function a `try` calls: compiled, through a copy of the callee.
///
/// Both halves are asserted. `crossing` being emitted says the refusal lifted;
/// `raises@raises` being emitted says it lifted *because the copy exists*,
/// which is the only reason that makes the `catch` reachable. A version that
/// emitted `crossing` and no copy would pass the first assertion and be the
/// defect the refusal existed for.
#[test]
fn a_call_that_can_throw_compiles_through_a_raising_copy() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(compiled(&lowered, "crossing"), "`crossing` is emitted");
    assert!(
        compiled(&lowered, "raises@raises"),
        "and its callee's raising copy with it"
    );
}

/// What still refuses, and for the two stated reasons rather than for any
/// reason at all.
///
/// By count *and* by message: the old version of this test asserted the whole
/// diagnostic list was one string, which is the assertion that catches a
/// refusal arriving from somewhere else entirely.
#[test]
fn a_callee_with_no_copy_is_still_refused() {
    let Some(lowered) = lowered() else {
        return;
    };
    let reasons: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert_eq!(
        reasons,
        vec![
            "a call inside a `try`, whose `throw` would not reach this handler is not supported by this lowering yet",
            "a call inside a `try`, whose `throw` would not reach this handler is not supported by this lowering yet",
        ],
        "two refusals, naming the calls"
    );
    assert!(
        !compiled(&lowered, "crossingAMethod"),
        "a method callee has no raising copy"
    );
    assert!(
        !compiled(&lowered, "crossingTwoFrames"),
        "a callee that passes a throw on has none either"
    );
}

/// A `throw` and its handler in one function. The commonest shape there is, and
/// the first version of the refusal took it.
#[test]
fn a_throw_within_one_function_still_compiles() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(compiled(&lowered, "sameFunction"));
}

/// A callee that cannot raise. Refusing on "is it compiled code" alone cost
/// `examples/array-buffer` six tests, which is what the `throwing` set exists
/// to prevent.
#[test]
fn a_call_that_cannot_throw_still_compiles() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(compiled(&lowered, "callingSomethingPure"));
}

/// An `async` callee. A `throw` in one rejects the promise it already returned,
/// and `examples/async-catch` is eight functions proving that edge is wired —
/// admitting async callees to the `throwing` set refused all eight.
#[test]
fn awaiting_a_rejection_still_compiles() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(compiled(&lowered, "awaitingARejection"));
}
