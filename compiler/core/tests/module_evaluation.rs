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

/// A module-scope binding whose initializer is code becomes a global that
/// `module#init` writes.
///
/// A global's `initial` has to be a number the artifact can carry, and
/// `scale(3)` is not one -- so the whole declaration was refused, and
/// `export const base = scale(3)` did not compile. It is the most ordinary
/// line in a module: 78 of them across the nineteen node profile modules,
/// present in every single one, `punycode` included.
#[test]
fn a_computed_module_binding_is_a_global_the_initializer_writes() {
    let Some(lowered) = example("module-computed") else {
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "module-computed should lower clean, refused: {:?}",
        refusals(&lowered),
    );
    let init = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name.contains("#init"))
        .expect("the module has an initializer");
    // Three: `base`, `doubled`, and `once`. `scale` and `bump` are functions
    // and `counter` folds, so nothing else needs a store.
    let stores = init
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::GlobalSet { .. }))
        .count();
    assert_eq!(
        stores, 3,
        "each computed binding is one store into its global",
    );
}

/// A binding whose initializer cannot lower is refused by itself.
///
/// It used to be, because it was never part of module evaluation. Now that it
/// is, folding the refusal into the initializer would let one unrepresentable
/// declaration take every other module's evaluation with it -- and `node:url`
/// has one, so this is not hypothetical. The pass tries each deferred
/// initializer in a builder of its own first, and refuses the declaration
/// rather than the program.
#[test]
fn a_binding_that_cannot_lower_does_not_cost_the_others_theirs() {
    let Some(lowered) = example("module-computed") else {
        return;
    };
    assert!(
        !lowered
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("loses in full")),
        "nothing here should cost the program its evaluation: {:?}",
        refusals(&lowered),
    );
}

/// One unsupported statement loses that statement, not the module's evaluation.
///
/// The blast radius was the bug, not any individual lowering gap. Eighteen of
/// the nineteen node profile modules lost *all* module evaluation to a single
/// `for...of` in `util/inspect`; when that line was fixed the number stayed at
/// eighteen, because the next unsupported statement in the same file took
/// over. Statement-level granularity took it to zero, and 183 named statements
/// took its place.
#[test]
fn one_unsupported_statement_does_not_darken_the_module() {
    let Some(lowered) = lower_at("tests/programs/module-partial", true) else {
        return;
    };
    assert!(
        !lowered
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("loses in full")),
        "one statement should not cost the module its evaluation: {:?}",
        refusals(&lowered),
    );
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic
                .message
                .contains("module evaluation therefore skips"))
            .count(),
        1,
        "exactly the one statement is skipped, and it is named: {:?}",
        refusals(&lowered),
    );
    // The statements on either side of it still run: `before = 1` and
    // `after = 2`, and nothing for the one in between.
    let init = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name.contains("#init"))
        .expect("the module still has an initializer");
    assert_eq!(
        init.values
            .iter()
            .filter(|op| matches!(op.kind, OpKind::GlobalSet { .. }))
            .count(),
        2,
        "the good statements on either side still run",
    );
}

/// A `yield` lowers, and this test used to say the opposite.
///
/// It was `a_yield_is_refused_by_name`, and its subject was the *message*: the
/// expression lowering's fallthrough names nothing, so every `yield` landed in
/// the same anonymous bucket as everything else unhandled and a work-list built
/// from these refusals could not see generators at all. Naming it was what made
/// the feature visible enough to build.
///
/// So the test is kept rather than deleted, pointed at the same program, with
/// the claim turned round: nothing here is refused. `syntax::YIELD_EXPRESSION`
/// is still pinned, harder than before — a wrong constant now means the
/// generator does not lower rather than that its refusal is anonymous.
#[test]
fn a_yield_lowers() {
    let Some(lowered) = lower_at("tests/programs/generators", true) else {
        return;
    };
    assert_eq!(
        refusals(&lowered),
        Vec::<String>::new(),
        "a generator and the `for...of` that walks it both lower",
    );
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|func| func.name == "total"),
        "the function walking the generator is in the program",
    );
}

/// Nothing is refused as "this expression" any more.
///
/// The expression lowering's fallthrough names no construct, and a refusal
/// nobody can group by is a refusal nobody can rank. Across the node profile
/// that bucket held 49 refusals at twelve distinct sites, and it was
/// structurally invisible: an entire language feature could sit in it -- and
/// `yield` did.
///
/// Each name here pins a syntax constant read off the checker's enum. A wrong
/// one puts the construct silently back in the bucket, which is exactly the
/// failure this guards.
#[test]
fn every_refused_expression_names_its_construct() {
    let Some(lowered) = lower_at("tests/programs/unnamed-expressions", true) else {
        return;
    };
    assert!(
        !lowered
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.starts_with("this expression")),
        "nothing should be refused anonymously: {:?}",
        refusals(&lowered),
    );
    for expected in ["`function` expression", "regular expression literal"] {
        assert!(
            lowered
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains(expected)),
            "expected a refusal naming {expected}, saw: {:?}",
            refusals(&lowered),
        );
    }
}

/// A `function` expression lowers exactly when it has no `this` of its own.
///
/// This used to be a question about the *wording* of a refusal -- neither form
/// lowered, and the message said which one an arrow could replace. Now the same
/// predicate decides whether it lowers at all, so getting it wrong is a wrong
/// program rather than a wrong suggestion. `util.deprecate` wraps a method by
/// writing `function (this: unknown, ...args)` and forwarding the caller's
/// receiver; an arrow there would silently rebind `this` to the module scope,
/// and a deprecated method quietly operating on the wrong object is worse than
/// a refusal by a wide margin.
///
/// Three cases, and the third is the one a simpler check gets wrong: a nested
/// *arrow* inherits `this` from the function expression around it, so a body
/// whose only `this` is a level down still uses one. Nested `function`s,
/// methods and accessors bind their own and do not count.
#[test]
fn a_function_expression_says_whether_an_arrow_would_do() {
    let Some(lowered) = lower_at("tests/programs/unnamed-expressions", true) else {
        return;
    };
    let says = |what: &str| {
        lowered
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.message.contains(what))
            .count()
    };
    assert_eq!(
        says("it uses no `this`"),
        0,
        "the convertible one lowers rather than suggesting a rewrite: {:?}",
        refusals(&lowered),
    );
    assert_eq!(
        says("uses its own `this`"),
        2,
        "two are not -- one by its `this` parameter, one through a nested arrow: {:?}",
        refusals(&lowered),
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

/// A module-scope `const` holding an arrow is typed by the *closure*, not by
/// the function type it was declared with.
///
/// The two are both `Managed(Object(..))`, which is why nothing between the
/// lowering and the backend objected when the global took the declared type:
/// clang did, refusing to assign an `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`.
/// So the assertion is about *which* object -- a closure id, from the synthetic
/// partition -- and not merely that the binding lowered.
#[test]
fn a_module_scope_const_arrow_is_typed_by_its_closure() {
    let Some(lowered) = example("module-functions") else {
        return;
    };
    assert_eq!(refusals(&lowered), Vec::<&str>::new(), "no refusal");

    let named = |want: &str| {
        lowered
            .program
            .globals
            .iter()
            .find(|global| global.name == want)
            .unwrap_or_else(|| panic!("`{want}` is a global"))
            .ty
            .clone()
    };

    // Every arrow binding in that file, by name, so adding one there does not
    // quietly go unchecked here.
    for name in [
        "double", "scaled", "inc", "twice", "early", "late", "fact", "negate", "seven", "add",
        "shout", "record", "clamp",
    ] {
        let hir::HirType::Managed(hir::ManagedType::Object(ty)) = named(name) else {
            panic!("`{name}` holds an object");
        };
        assert!(
            hir::is_closure_type(ty),
            "`{name}` holds a closure, not a value of its declared function type: {ty:?}",
        );
    }

    // The control, and it lands the other way. `thrice = triple` aliases a
    // *declared function*, and that needs no storage at all: the name resolves
    // to the function, and `thrice(n)` is a direct call. So the alias is not a
    // global, and this asserts that rather than assuming the two mechanisms
    // met -- they do not, and the assumption is what this test caught.
    assert!(
        !lowered
            .program
            .globals
            .iter()
            .any(|global| global.name == "thrice"),
        "an alias of a declared function needs no slot",
    );

    // A non-function `const` is untouched by any of it: `scale` folds to a
    // constant and is not a global at all.
    assert!(
        !lowered
            .program
            .globals
            .iter()
            .any(|global| global.name == "scale"),
        "a foldable const is still folded",
    );
}

/// A module-scope `let` holding a function is refused, and the reason says why
/// the `const` is different.
///
/// Not "a module-scope variable holding a function", which was true of both and
/// therefore useless: a second arrow is a second layout, and one slot cannot be
/// both. The refusal has to name reassignment or it does not distinguish the
/// case that works from the case that does not.
#[test]
fn a_module_scope_let_holding_a_function_is_refused() {
    let Some(lowered) = example("unsupported") else {
        return;
    };
    let reasons = refusals(&lowered);
    assert!(
        reasons.iter().any(|reason| {
            reason.contains("module-scope `let` holding a function")
                && reason.contains("reassigned")
        }),
        "the refusal names reassignment as the reason: {reasons:?}",
    );
    // And it is the `let` that is refused, not arrows at module scope
    // generally: nothing here says the `const` form is unsupported.
    assert!(
        !reasons
            .iter()
            .any(|reason| reason.contains("module-scope `const`")),
        "the const form is not refused: {reasons:?}",
    );
}
