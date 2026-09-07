//! The plan's named sabotages, as tests rather than as things once run by hand.
//!
//! The integration plan asks for sabotage evidence for callback and storage
//! retirement, close races, and publication ordering, alongside the device
//! evidence beside them. All three had been *done* — by editing the runtime,
//! watching a driver go red, and editing it back — and none of them had been
//! checked in. That difference matters more than it sounds:
//!
//! - A sabotage run by hand is evidence about the tree on the afternoon it was
//!   run. It says nothing about the tree a month later, which is exactly when
//!   the property it protects gets optimised away.
//! - And a sabotage is only evidence at all if it breaks **the case it was
//!   aimed at**. Watching a suite go red does not establish that: one of the
//!   store's own sabotages turned out to throw before reaching the case it
//!   targeted, which reads identically to "the case caught it" if all you look
//!   at is an exit code.
//!
//! So each entry below names the cases it must break, and the names are matched
//! against the driver's own `FAIL` lines. An entry whose target has been
//! renamed fails on the match rather than quietly sabotaging nothing.
//!
//! # The publication one is the ARM item, in the half that is obtainable
//!
//! `docs/records/0181` is about an invariant that **cannot be falsified on
//! x86**: the inbox's publication edge is a `volatile` write, and x86-TSO does
//! not reorder stores, so the stress passes with or without the keyword. The
//! plan asks for sabotage evidence for ARM publication ordering and there is no
//! ARM host or device here — QEMU2 refuses an arm64 guest on an `x86_64` host.
//!
//! What *is* obtainable is the cause: `Stress` asserts by reflection that the
//! link is still volatile, and the sabotage below removes the keyword and
//! requires that assertion to fire. That is not the race. It is the guard that
//! would stop someone deleting the keyword on the machine they are sitting at,
//! and it is the strongest thing available without the hardware.

#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::{repository, tool, with_sabotage};

/// `(name, file, edits, driver, args, the cases that must break)`.
type Named = (
    &'static str,
    &'static str,
    &'static [(&'static str, &'static str)],
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
);

const NAMED: &[Named] = &[
    (
        // The plan's "callback/storage retirement". Nothing *inside* the
        // environment can retain anything once the environment itself is
        // unreachable, so the property is about what holds it from outside --
        // and the `ThreadLocal` is that. A closed environment left current
        // retains its queues and every callback they hold.
        "the runtime keeps a closed environment current",
        "nts/rt/NtsEnv.java",
        &[(
            "if (previous == null) { CURRENT.remove(); } else { CURRENT.set(previous); }",
            "CURRENT.set(env); // sabotaged: the closed environment stays current",
        )],
        "env/EnvTest.java",
        &[],
        &["after close, the runtime still retains "],
    ),
    (
        // The plan's "close races". Not the per-completion decrements -- close
        // overwrites `outstanding` with what it reclaims, so sabotaging those
        // changes nothing it can see, which took three attempts to learn. The
        // property is that **close waits for what is in flight**, and the
        // reclaim is where it waits.
        "close does not wait for what is in flight",
        "nts/rt/NtsEnv.java",
        &[(
            "int leaked = NtsInbox.reclaim(env.inbox, 2000.0);",
            "int leaked = 0; // sabotaged: close does not wait",
        )],
        "env/CloseRaceTest.java",
        &["60"],
        &["close returned "],
    ),
    (
        // The plan's "ARM publication ordering", in the half an x86 host can
        // reach: not the race, but the keyword the race depends on.
        "the publication edge stops being volatile",
        "nts/rt/NtsInbox.java",
        &[("        volatile Slot next;", "        Slot next;")],
        "inbox/Stress.java",
        &["4", "50"],
        &["NtsInbox.Slot.next is not volatile: the publication edge is gone"],
    ),
];

#[test]
fn every_named_sabotage_breaks_the_case_it_names() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let tests = repository().join("compiler/codegen/jvm/tests");

    for (name, file, edits, driver, args, must_fail) in NAMED {
        let args: Vec<String> = args.iter().map(|it| (*it).to_owned()).collect();
        let ran = with_sabotage(
            &javac,
            &java,
            name,
            file,
            edits,
            &tests.join(driver),
            &args,
        );
        let failed = ran.failed();
        for one in *must_fail {
            assert!(
                failed.iter().any(|it| it.contains(one)),
                "`{name}` should have broken `{one}` and did not.\nstdout:\n{}\nstderr:\n{}",
                ran.said,
                ran.stderr
            );
        }
        // And it must be *reported*, not merely fatal. A sabotage that takes the
        // driver down before its cases run is a different failure mode wearing a
        // control's clothes: something still throws long after the property it
        // protects has gone.
        assert!(
            !failed.is_empty(),
            "`{name}` did not report a failing case; it may have thrown first.\nstdout:\n{}\nstderr:\n{}",
            ran.said,
            ran.stderr
        );
    }
}

/// And the drivers pass when the runtime is not sabotaged.
///
/// The other half of every entry above, and the reason the suite cannot be
/// satisfied by a driver that fails always: each is run once through the same
/// path with an empty edit list.
#[test]
fn every_driver_passes_against_an_unsabotaged_runtime() {
    let (Some(javac), Some(java)) = (tool("javac"), tool("java")) else { return };
    let tests = repository().join("compiler/codegen/jvm/tests");

    for (name, file, _, driver, args, _) in NAMED {
        let args: Vec<String> = args.iter().map(|it| (*it).to_owned()).collect();
        let ran = with_sabotage(
            &javac,
            &java,
            &format!("{name} (control)"),
            file,
            &[],
            &tests.join(driver),
            &args,
        );
        assert!(
            ran.ok && ran.failed().is_empty(),
            "`{driver}` does not pass without a sabotage, so its red says nothing.\n\
             stdout:\n{}\nstderr:\n{}",
            ran.said,
            ran.stderr
        );
    }
}
