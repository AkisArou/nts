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
//! **A seventh shape, an overridden accessor, dispatches through a slot of its own**
//! rather than by name, and `an_overridden_accessor_dispatches_at_its_own_slot` asserts
//! that both the base's copy and the override's are emitted. Numbering that slot is
//! what made the base's copy reachable at all: before it, the entry existed and no
//! table and no call named it.
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

/// An **overridden** accessor dispatches at a raising slot of its own, and **both** the
/// base's copy and the override's exist.
///
/// The slot's three cases, and the third is the one that could be an escape.
///
/// This asserted a refusal until the slot was numbered, and it is the second time this
/// boundary moved: a member no subclass overrides was always a `Callee::Direct`, so the
/// virtual case was the one left, and `raising_member_slots` is what answers it.
///
///   * `Base#get overridden@raises` -- the root's copy, which the dispatch names;
///   * `Counting#get overridden@raises` -- an override that **can** raise gets one too,
///     which `raising_member_slots` is for: `raising_copies` is seeded from the callee
///     the *checker* resolved, and for a virtual call that is always the base;
///   * `Derived`, whose getter cannot raise, gets **no** copy and its slot holds its
///     **ordinary** entry. Asserted at the layout, because a slot filled with a name is
///     the only place that fact exists -- and filling it with an ancestor's copy instead
///     is the JVM lane's `SHADOWED`, a class running its ancestor's body with a happy
///     verifier and no `NoSuchMethodError`.
///
/// `examples/a-throwing-accessor-inside-a-try` carries the same three as **answers**,
/// which is the half this cannot do: a wrong dispatch here is a plausible number.
#[test]
fn an_overridden_accessor_dispatches_at_its_own_slot() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "nothing refuses now: {:?}",
        lowered.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
    );
    for name in [
        "anOverriddenGetter",
        "anOverrideThatAlsoThrows",
        "Base#get overridden@raises",
        "Counting#get overridden@raises",
    ] {
        assert!(compiled(&lowered, name), "{name} should be emitted");
    }
    assert!(
        !compiled(&lowered, "Derived#get overridden@raises"),
        "`Derived`'s getter cannot raise, so no copy of it is made"
    );

    // One table of a class, so what each fills a slot with is read rather than assumed.
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
    // The slot is the base's, taken from the base's own table: this test must not know
    // the index, because knowing it would stop it from noticing a renumbering.
    let slot = table("Base")
        .iter()
        .position(|held| held.as_deref() == Some("Base#get overridden@raises"))
        .expect("`Base`'s table should hold its raising copy");
    assert_eq!(
        table("Derived").get(slot).cloned().flatten().as_deref(),
        Some("Derived#get overridden"),
        "`Derived` fills that slot with its ordinary entry, which runs and never raises"
    );
    assert_eq!(
        table("Counting").get(slot).cloned().flatten().as_deref(),
        Some("Counting#get overridden@raises"),
        "and an override that can raise fills it with its copy"
    );
}
