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
//!   - a **method** callee compiles too, and names the copy directly: a member no
//!     subclass overrides is already a `Callee::Direct`, so the copy is that name
//!     with the suffix and no dispatch slot is needed;
//!   - an **overridden** method compiles as well, through a dispatch slot of its
//!     own: a `Callee::Virtual` holds an index rather than a name, so the copy
//!     needs an index, and every overrider fills it — with its own copy, or with
//!     its ordinary entry where that override cannot raise;
//!   - a **constructor** callee still refuses, and it is the last of them: `new`
//!     names no function to suffix;
//!   - an **overloaded** callee compiles, which took the checker's answer and the
//!     lowering's agreeing about which declaration a copy is made of;
//!   - a callee that merely *passes a throw on* compiles too, through a copy of
//!     it and of what it calls — the copy set is closed over what a copy
//!     reaches, and `Throwing::copyable` is the greatest fixpoint that makes
//!     closing it safe.
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

/// A callee that only *passes a throw on*: compiled, through a copy of it and a
/// copy of what it calls.
///
/// Three frames as well as two, because two is satisfied by a closure that runs
/// one round and stops.
#[test]
fn a_chain_of_callees_compiles_through_copies_of_each() {
    let Some(lowered) = lowered() else {
        return;
    };
    for name in ["crossingTwoFrames", "crossingThreeFrames"] {
        assert!(compiled(&lowered, name), "{name} is emitted");
    }
    for name in ["passesItOn@raises", "passesItOnAgain@raises"] {
        assert!(compiled(&lowered, name), "{name} is emitted");
    }
}

/// What still refuses, and for the stated reason rather than for any reason at all.
///
/// By message *and* by count: asserting the whole diagnostic list is one string is what
/// catches a refusal arriving from somewhere else entirely, and what catches a second
/// one appearing when a copy stops being made. A count of 2 says the refusal grew a case
/// it should not have -- it did twice while being written -- and a count of 0 says the
/// boundary was lost.
///
/// **The subject has moved three times, which is the test earning its keep.** It pinned
/// "a method, and a raising copy is made of plain functions only" until a method became
/// copyable; then an **overridden** method, whose dispatch goes through a slot, until
/// that slot was numbered; and each time the example refused *nothing* and this
/// assertion was the only thing that said so. What is left is a `new`, which names no
/// function to suffix at all.
#[test]
fn the_last_callee_with_no_copy_is_a_constructor() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
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
            "a call inside a `try` whose `throw` would not reach this handler: a \
             constructor, and a raising copy is made of plain functions only is not \
             supported by this lowering yet"
        ],
        "one refusal, naming the call"
    );
    assert!(
        !compiled(&lowered, "crossingAConstructor"),
        "a `new` has no name to suffix"
    );
    // **Both directions of each boundary that moved**, because an assertion that only
    // says what refuses passes on a compiler that refuses everything. The overridden
    // pair needs *both* copies: the base's alone leaves the override's slot filled with
    // its ordinary entry, whose `throw` would end the program.
    for name in [
        "crossingAMethod",
        "Deeper#raise@raises",
        "crossingAnOverriddenMethod",
        "Overridable#raise@raises",
        "Overrides#raise@raises",
        "crossingAnOverrideThatCannotRaise",
        // A **narrower** override, which is `runtime/node`'s own shape:
        // `Readable#_read(size)` against `Transform#_read()`. Its copy declares one
        // parameter fewer than the entry the dispatch spells, and the example answers
        // `limit + 50` where the base answers `n * 2`, so a slot resolved up to `Wide`
        // fails the differential rather than working quietly.
        "crossingANarrowerOverride",
        "Wide#raise@raises",
        "Narrow#raise@raises",
    ] {
        assert!(compiled(&lowered, name), "{name} should be emitted");
    }
    // **And an override that cannot raise gets no copy**, which is the other half of
    // the same rule and the half that is an *answer* rather than a refusal: its slot
    // takes its ordinary entry, which runs and never raises. Read at the index the
    // base's own table puts its copy at, so this test does not know the number -- a
    // test that knew it could not notice a renumbering.
    assert!(
        !compiled(&lowered, "Quietly#raise@raises"),
        "`Quietly#raise` cannot raise, so no copy of it is made"
    );
    let table = |class: &str| {
        lowered
            .program
            .layouts
            .iter()
            .find(|layout| layout.name == class)
            .unwrap_or_else(|| panic!("{class} should have a layout"))
            .methods
            .clone()
    };
    let slot = table("Overridable")
        .iter()
        .position(|held| held.as_deref() == Some("Overridable#raise@raises"))
        .expect("`Overridable`'s table should hold its raising copy");
    assert_eq!(
        table("Quietly").get(slot).cloned().flatten().as_deref(),
        Some("Quietly#raise"),
        "`Quietly` fills that slot with its ordinary entry"
    );
    assert_eq!(
        table("Overrides").get(slot).cloned().flatten().as_deref(),
        Some("Overrides#raise@raises"),
        "and an override that can raise fills it with its copy"
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

/// An **overloaded** callee: the copy is made of the implementation, and the call
/// names it.
///
/// `call_targets` answers a call to an overloaded function with an overload
/// *signature*, and the lowering only ever lowers the declaration with a body. Keyed
/// on the resolved node the seed held the signature, nothing built a copy of it, and
/// the site named `overloaded@raises` anyway -- so this arm refused with `` which
/// nothing in this program defines ``, a cascade with no root, **even where the
/// implementation compiles**. It stood from `ac1533ca4` and surfaced in
/// `runtime/node/fs` only once methods had copies and the bodies around them lowered
/// far enough to reach it.
///
/// `crossing` is the control, asserted by
/// [`a_call_that_can_throw_compiles_through_a_raising_copy`]: the same shape with one
/// declaration.
#[test]
fn an_overloaded_callee_names_the_implementations_copy() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    assert!(
        compiled(&lowered, "crossingAnOverloadedCallee"),
        "a `try` around a call to an overloaded function compiles"
    );
    assert!(
        compiled(&lowered, "overloaded@raises"),
        "the copy is made of the implementation, under the name the call spells"
    );
}

/// A **member-shaped callee** inside a closure, which is where the gate's own
/// precision decided whether anything compiled.
///
/// `functions_used_as_values` excluded the callee *node*, so in `helper.same(x)` the
/// identifier `same` inside the property access counted as a mention of a value and
/// asked for a raising copy of a declaration that has none -- which turned the
/// program-global gate off. It cost **71 cases of `test262-cases`, one of them a
/// pass**, and the shape is `assert.sameValue`, which the harness writes in nearly
/// every file.
///
/// Both arms, because the pair is the measurement: the member call and the same
/// program with a plain callee. A compiler that refuses either has the gate off, and
/// a compiler that refuses neither for the wrong reason is caught by the refusal
/// count in `tooling/gate/example-refusals`, which stays at one.
///
/// **And this is the arm that catches a profile-dependent answer**, which is why an
/// IIFE belongs in a test that runs under `cargo test`. `calls_a_closure` compared
/// its reason with `std::ptr::eq` on a `const &'static str`: the release profile
/// merges the duplicated constants into one address and the dev profile does not, so
/// the compiler said "this is a closure call" for the gate and "it is not" for its
/// own test suite. Every release-profile instrument -- `example-refusals`, `agree`,
/// the censuses -- was blind to it by construction, and nothing in `examples/` had an
/// IIFE *and* an assertion here until now.
#[test]
fn a_member_shaped_callee_is_not_a_function_held_as_a_value() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    assert!(
        compiled(&lowered, "crossingAMemberCallInAClosure"),
        "a `try` reaching `helper.same` through a closure compiles"
    );
    assert!(
        compiled(&lowered, "crossingAnOverloadedCallInAClosure"),
        "and so does the control, whose callee is a plain name"
    );
}

/// The three shapes that were **escapes rather than refusals** after a method became
/// copyable, each a second place that decides something `callee_for` decides once.
///
///     a static method        `lower_static_call` names the member itself, so it
///                            needed the suffix and the flag test; 10 of 10 cases
///                            ended the program
///     a parameter default    evaluated in the CALLER, where JavaScript evaluates
///                            one, so a `throw` in it reaches the caller's handler --
///                            and `call_within` walks the `try`'s own body, where a
///                            default written in the callee's declaration is not
///     an element default     of a destructured parameter, bound inside the callee:
///                            the raise test there returns a dummy of the function's
///                            type, and `self.returns` was set *after* the parameter
///                            loop, so the dummy was absent and the copy was invalid
///                            HIR
///
/// Asserted by name because each was reachable only through a different path and a
/// single arm would have passed on two compilers that were wrong.
#[test]
fn a_static_and_a_parameter_default_compile() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    for name in [
        "crossingAStaticMethod",
        "Statics.raises@raises",
        "crossingAParameterDefault",
        "crossingADestructuredDefault",
        "withADestructuredDefault@raises",
    ] {
        assert!(compiled(&lowered, name), "{name} should be emitted");
    }
}
