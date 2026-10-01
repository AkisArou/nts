//! An accessor's raising copy: that it is **made**, and that each of the six shapes
//! that reach one names it.
//!
//! An accessor is reached by a read or a write rather than through `callee_for`, so it
//! is named in places a call is not: a plain read, an assignment, a compound
//! assignment that does both, a `static` one addressed by its class, a spread, a
//! destructuring. None of them goes through `push_call`, and the setter write is not a
//! call node at all -- which is why `Place::Setter` carries the access node the callee
//! was resolved for, and why these are asserted by *name* rather than by answer.
//!
//! **The answers cannot catch two of the three defects this found.** A setter write
//! whose flag nobody read returned the success value, which is a plausible number; and
//! a quiet getter refused, which is a refusal rather than a wrong answer. Only the
//! differential saw the first and only this kind of assertion pins the second.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

const EXAMPLE: &str = "a-throwing-accessor-inside-a-try";

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

/// The copy is made for a `get`, for a `set`, and for a `static` pair.
#[test]
fn an_accessor_reached_by_a_try_gets_a_raising_copy() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    for name in [
        "Box#get doubled@raises",
        "Box#set checked@raises",
        "Box#get checked@raises",
        "Statics.get guarded@raises",
        "Statics.set guarded@raises",
    ] {
        assert!(compiled(&lowered, name), "{name} should be emitted");
    }
    for arm in [
        "readingAGetter",
        "writingASetter",
        "compoundThroughAnAccessor",
        "aStaticAccessor",
        "aQuietGetter",
    ] {
        assert!(compiled(&lowered, arm), "{arm} should compile");
    }
}

/// **A quiet accessor needs no copy**, and must not be refused for the want of one.
///
/// `a_call_that_can_raise` reads `children(node).first()`, which is the callee of a
/// call and the *object* of an access -- so an access asked about whatever the receiver
/// is. `return box.plain` was refused beside the throwing getter until the question was
/// asked of the member, and a getter that cannot throw is in no `copyable` set, so
/// there is no copy for it to find.
#[test]
fn a_quiet_accessor_is_not_refused_for_want_of_a_copy() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    assert!(compiled(&lowered, "aQuietGetter"), "a getter that cannot throw compiles");
    assert!(
        !compiled(&lowered, "Box#get plain@raises"),
        "and gets no copy, because it has nothing to carry"
    );
}

/// An **overridden** accessor is the boundary, and the only arm still refused.
#[test]
fn an_overridden_accessor_is_still_refused() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    assert!(
        !compiled(&lowered, "anOverriddenGetter"),
        "a virtual dispatch has no name to suffix"
    );
    let reasons: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert_eq!(
        reasons,
        vec![
            "a `get` of `overridden` inside a `try`, which a subclass overrides: the \
             dispatch goes through a slot and a raising copy is reached by name is not \
             supported by this lowering yet"
        ],
        "one refusal, naming the accessor and why"
    );
}
