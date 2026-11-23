//! One refused statement must not cost a module its whole evaluation.
//!
//! `module#init` is lowered as a single function, so a module-scope statement
//! calling something refused made the *whole* initializer a caller of a refused
//! function. `drop_callers_of_refused` dropped it, every module-scope binding
//! stayed at its zero, and every export reading one was dropped as reading an
//! unwritten global.
//!
//! Twelve of the twenty-two modules in `runtime/node` lost their evaluation
//! that way, and the shape was always the same: one statement near the end
//! calls something refused. `os` lost ten exports to a `readConstants` on its
//! last line, and `channel` darkened five modules by itself.
//!
//! # Why this is a test and not only an example
//!
//! `tests/programs/module-evaluation` checks that what survives *computes what node
//! computes*, which is the invariant that matters and is not this one. It
//! cannot check that anything survived: with the excision removed the harness
//! compares two functions instead of five and reports agreement on both, which
//! is a green step that measured less. So the count is asserted here, where
//! losing it fails rather than shrinks.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

fn prepared() -> hir::Prepared {
    prepared_program("module-evaluation")
}

fn prepared_program(name: &str) -> hir::Prepared {
    prepared_at(&format!("../../tests/programs/{name}"))
}

fn prepared_at(relative: &str) -> hir::Prepared {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::prepare(&snapshot, nts_core::hir::backend::Backend::C).expect("prepared HIR should verify")
}

fn has(prepared: &hir::Prepared, name: &str) -> bool {
    prepared.program.funcs.iter().any(|func| func.name == name)
}

/// The statements that do not depend on the refused call still run, and the
/// exports that read them are still compiled.
#[test]
fn a_refused_statement_costs_only_what_depends_on_it() {
    let prepared = prepared();
    for name in [
        "readDoubled",
        "readLabel",
        "readTotal",
        "readFromTable",
        "readScaled",
    ] {
        assert!(
            has(&prepared, name),
            "`{name}` reads nothing that depends on the refused call and must survive",
        );
    }
    assert!(
        has(&prepared, "module#init"),
        "the module initializer itself must survive; without it every global \
         stays at its zero and the exports above are answering from one",
    );
}

/// And the one that *does* depend on it is dropped rather than left answering
/// from an unwritten global.
///
/// The half that makes the other half safe. Keeping the initializer while
/// letting a reader of an excised binding compile is worse than dropping
/// everything: the program runs and answers zero, which is a wrong answer where
/// the old behaviour was a missing one.
#[test]
fn the_export_that_reads_the_excised_binding_is_dropped() {
    let prepared = prepared();
    assert!(
        !has(&prepared, "readPattern"),
        "`readPattern` reads a binding whose initializer was excised, so it \
         would answer from the global's zero rather than from what node computes",
    );
}

/// The excision declines where it cannot be sound, and says so by keeping the
/// old behaviour rather than by inventing one.
///
/// Not asserted against a fixture, because the shape needs a module-scope
/// branch whose condition came from the refused call and that is a second
/// example's worth of setup. Recorded here so the next reader knows the
/// fallback exists and is deliberate: `runtime/node/http` takes it.
#[test]
fn the_initializer_writes_every_binding_that_survived() {
    let prepared = prepared();
    let Some(init) = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "module#init")
    else {
        return;
    };
    let written: Vec<u32> = init
        .blocks
        .iter()
        .flat_map(|block| block.ops.iter())
        .filter_map(|value| match init.values[value.0 as usize].kind {
            hir::OpKind::GlobalSet { global, .. } => Some(global),
            _ => None,
        })
        .collect();
    for (at, global) in prepared.program.globals.iter().enumerate() {
        if !global.deferred {
            continue;
        }
        let at = u32::try_from(at).unwrap_or(u32::MAX);
        assert!(
            written.contains(&at) || global.name == "pattern",
            "`{}` is deferred and the surviving initializer never assigns it, \
             so anything reading it answers from its zero",
            global.name,
        );
    }
}

/// An exported `const` with a folding initializer is still a global.
///
/// A `const` that folds is a value rather than storage, which is right for a
/// name only this module reads and wrong for one it publishes: `publish_surface`
/// publishes a **global**, so folding the constant away left nothing for the
/// export table to point at and the name was silently absent from the artifact.
///
/// The asymmetry is what makes it a defect rather than a policy. `export const
/// a = 50` vanished and `export const b = 50 + 0` did not, differing only in
/// whether the value was written down or arrived at — and a backend declining
/// to export values would have declined both. The node lane found it by
/// isolating one variable at a time; a first pass with nine exports in one file
/// gave the opposite answer and read as a rule about small integers.
///
/// `buffer` published one of its fifteen exports and two of the missing
/// fourteen were this.
///
/// Asserted here rather than in the example because a differential drives
/// exported *functions*: it cannot see an export table at all, so the example
/// agreeing says nothing about whether the name is in the artifact.
#[test]
fn an_exported_literal_constant_is_a_global() {
    let prepared = prepared();
    for name in ["literalConst", "computedConst"] {
        let global = prepared
            .program
            .globals
            .iter()
            .find(|global| global.name == name)
            .unwrap_or_else(|| {
                panic!(
                    "`{name}` is exported and needs a global to publish: {:?}",
                    prepared
                        .program
                        .globals
                        .iter()
                        .map(|g| &g.name)
                        .collect::<Vec<_>>()
                )
            });
        assert!(
            global.exported,
            "`{name}` is published, so its global carries external linkage",
        );
    }

    // And the folded one keeps its value as the global's initial, so nothing
    // has to run for a reader outside to see 50 rather than zero.
    let literal = prepared
        .program
        .globals
        .iter()
        .find(|global| global.name == "literalConst")
        .expect("checked above");
    assert!(
        (literal.initial - 50.0).abs() < f64::EPSILON,
        "the constant is the global's initial value, not something `module#init` assigns: {}",
        literal.initial,
    );
}

/// Where the cut statement is, as a fact of the program and not only a
/// sentence: a whole-program comparison (`tooling/differential`) runs the
/// program only when evaluation runs every statement its source does.
#[test]
fn a_cut_statement_is_recorded_as_a_change_to_module_evaluation() {
    let prepared = prepared();
    assert!(
        !prepared.program.module_evaluation_cuts.is_empty(),
        "the refused statement was cut from module evaluation"
    );
    for cut in &prepared.program.module_evaluation_cuts {
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.primary == *cut),
            "each cut is also a diagnostic at the same place: {cut:?}"
        );
    }
}

/// The control: a refusal no evaluation reaches -- an exported generic no
/// call instantiates -- is a diagnostic and changes nothing evaluation runs.
#[test]
fn a_refusal_evaluation_never_reaches_cuts_nothing() {
    let prepared = prepared_program("advanced");
    assert!(
        !prepared.diagnostics.is_empty(),
        "`advanced` still refuses its uninstantiated generic exports"
    );
    assert_eq!(prepared.program.module_evaluation_cuts, Vec::new());
}

/// An initializer lowering refuses is skipped by evaluation, so it is a cut,
/// though no statement was excised: `refused_initializers` marks its binding,
/// and `lower_module_binding` stores nothing for it.
#[test]
fn a_refused_module_initializer_is_recorded_as_a_cut() {
    let prepared =
        prepared_at("tests/programs/an-unlowerable-initializer-is-cut-from-module-evaluation");
    assert!(
        has(&prepared, "module#init"),
        "the rest of evaluation still runs"
    );
    assert_eq!(
        prepared.program.module_evaluation_cuts.len(),
        1,
        "the one refused initializer: {:?}",
        prepared.diagnostics
    );
}
