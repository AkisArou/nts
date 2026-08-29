//! Module evaluation: the order modules run in, and what a cycle may do.
//!
//! Runs the frontend, so it skips only when `tsgo` is not built.
//!
//! The programs here are checked against node by `nts check` wherever node can
//! answer. One cannot: a read in its dead zone makes node throw rather than
//! print, so that fixture lives under `tests/programs` instead of `examples`
//! and its expected result is a diagnostic.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind, lower::Lowered};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lower_at(relative: &str, typechecks: bool) -> Option<Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert_eq!(!snapshot.has_errors(), typechecks, "fixture typechecks");
    Some(hir::lower::lower(&snapshot))
}

fn example(name: &str) -> Option<Lowered> {
    lower_at(&format!("../../examples/{name}"), true)
}

fn refusals(lowered: &Lowered) -> Vec<&str> {
    lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect()
}

/// Every legal cycle shape, lowered without a refusal.
///
/// Refusing cycles wholesale was this pass's first answer, and it was wrong in
/// the direction that matters: `node:fs` had four, every one of them crossed
/// only by a function, and refusing them cost those modules their entire
/// initialization to protect against something they were not doing.
#[test]
fn a_legal_cycle_lowers() {
    for name in [
        // Two modules, each calling into the other.
        "module-cycle",
        // A module importing itself: the smallest cycle there is.
        "module-cycle-self",
        // a -> b -> c -> a.
        "module-cycle-three",
        // A re-export inside a cycle, which binds an alias with an alias
        // behind it.
        "module-cycle-reexport",
        // A binding read across a cycle, from inside a function, which is the
        // legal way to write the program `module-cycle-tdz` gets wrong.
        "module-cycle-late",
    ] {
        let Some(lowered) = example(name) else {
            return;
        };
        assert!(
            lowered.diagnostics.is_empty(),
            "examples/{name} should lower clean, refused: {:?}",
            refusals(&lowered),
        );
    }
}

/// A read of a binding whose module has not evaluated, refused at compile time.
///
/// Node reports this program as `ReferenceError: Cannot access 'seed' before
/// initialization`, and only if the read executes. The order is known here
/// before anything runs, so the answer is available without running it -- and
/// without it the program compiles and answers `7`, because a module-scope
/// binding is a global whose static initializer is already in place.
#[test]
fn a_read_in_its_dead_zone_is_refused() {
    let Some(lowered) = lower_at("tests/programs/module-cycle-tdz", true) else {
        return;
    };
    let found: Vec<&nts_diagnostics::Diagnostic> = lowered
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "NTS1004")
        .collect();
    assert_eq!(
        found.len(),
        1,
        "one dead-zone read, saw: {:?}",
        refusals(&lowered),
    );
    assert!(
        found[0].message.contains("`seed`"),
        "the diagnostic should name the binding: {}",
        found[0].message,
    );
    // The declaring module, not the reading one: `b.ts` is where the read is,
    // and knowing that `a.ts` is what has not run yet is the actionable half.
    assert!(
        found[0].message.contains("a.ts"),
        "the diagnostic should name the module that has not evaluated: {}",
        found[0].message,
    );
}

/// The same dead zone, written as an initializer rather than a statement.
///
/// Worth its own test because the two reach the read by different paths. A
/// module-scope initializer is nested under a declaration list, which the
/// encoded AST wraps in a node list, and the first version of the walk stopped
/// at the first list it met -- so it caught `echo = seed;` and missed `const
/// derived = seed + 1`. The one it missed is the one people write.
#[test]
fn a_dead_zone_read_in_an_initializer_is_refused_too() {
    let Some(lowered) = lower_at("tests/programs/module-cycle-tdz-initializer", true) else {
        return;
    };
    let found: Vec<&nts_diagnostics::Diagnostic> = lowered
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "NTS1004")
        .collect();
    assert_eq!(
        found.len(),
        1,
        "one dead-zone read, saw: {:?}",
        refusals(&lowered),
    );
    assert!(
        found[0].message.contains("`seed`"),
        "the diagnostic should name the binding: {}",
        found[0].message,
    );
}

/// The same read, moved inside a function, is not refused.
///
/// The pair is the point. A check that refused both would be a check that
/// refuses cycles with a longer message.
#[test]
fn the_same_read_inside_a_function_is_allowed() {
    let Some(lowered) = example("module-cycle-late") else {
        return;
    };
    assert!(
        !lowered
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS1004"),
        "a read deferred into a function is not a dead-zone read: {:?}",
        refusals(&lowered),
    );
}

/// An imported binding reads the global the declaring module owns.
///
/// Not a copy and not a constant: one cell, so a write in either module is
/// visible in both. `throughAFunction` reaches the same value through a call
/// in the declaring module, and the example checks the two against each other
/// under `nts check`.
#[test]
fn an_imported_binding_is_the_declaring_module_s_global() {
    let Some(lowered) = example("module-bindings") else {
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "module-bindings should lower clean, refused: {:?}",
        refusals(&lowered),
    );
    let total = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == "total")
        .expect("`total` is exported");
    assert!(
        total
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::GlobalGet(_))),
        "reading an imported `let` is a load from the global it declares",
    );
}

/// Module evaluation runs, and runs in the order the import graph says.
///
/// `module-order` is a diamond whose answer is a four-digit number, one digit
/// per module in the order they ran. Node prints 1234 for it; the assertion
/// here is only that the initializer exists and does the writes, since the
/// order itself is what `nts check` compares against node.
#[test]
fn a_program_with_several_modules_has_one_initializer() {
    let Some(lowered) = example("module-order") else {
        return;
    };
    let inits: Vec<&str> = lowered
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .filter(|name| name.contains("#init"))
        .collect();
    assert_eq!(
        inits.len(),
        1,
        "the statements of every module are concatenated into one initializer",
    );
}
