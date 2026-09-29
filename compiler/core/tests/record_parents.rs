//! `Program::record_parents`: a declared relation the representation does not
//! carry, kept where nothing that decides a representation can read it.
//!
//! The JVM needs it and neither C nor LLVM does, which is the usual shape: a
//! bridge returning `interface DetailJSON extends EntryJSON` where `EntryJSON` is
//! declared verifies only between related classes, and a record layout has no
//! `Layout.base` for `narrows_return`'s ancestry walk to follow. Giving records a
//! `base` was tried and reverted, because `same_shape` requires equal bases and a
//! `{...}` literal typed at `DetailJSON` would then stop sharing `DetailJSON`'s
//! layout.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/record-parents/tsconfig.json")
        .canonicalize_utf8()
        .expect("the fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// Which types the map names, by the name the hierarchy gave them.
fn named(lowered: &hir::lower::Lowered) -> Vec<(String, String)> {
    let name = |ty: nts_semantic_schema::TypeId| {
        lowered
            .program
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
            .map_or_else(|| format!("{ty:?}"), |layout| layout.name.clone())
    };
    let mut rows: Vec<(String, String)> = lowered
        .program
        .record_parents
        .iter()
        .map(|(child, parent)| (name(*child), name(*parent)))
        .collect();
    rows.sort();
    rows
}

#[test]
fn one_declared_parent_is_recorded_and_two_are_not() {
    let Some(lowered) = lowered() else {
        return;
    };
    let rows = named(&lowered);
    assert!(
        rows.iter().any(|(child, parent)| child.contains("DetailJSON")
            && !child.contains("Timed")
            && parent.contains("EntryJSON")),
        "an interface extending exactly one interface is the case this exists for: {rows:?}",
    );
    // **Two parents is not "pick the first".** Which one a consumer would take is
    // the guess `relate_closures_to_signatures` declines to make for closures, on
    // reasoning that transfers word for word.
    assert!(
        !rows.iter().any(|(child, _)| child.contains("TimedDetailJSON")),
        "two declared parents records nothing: {rows:?}",
    );
    assert!(
        !rows.iter().any(|(child, _)| child.contains("Plain")),
        "no parent records nothing: {rows:?}",
    );
}

/// **No self-edges, and this is the arm the runtime corpora asked for.**
/// `AlsoSameShape extends SameShape` adds nothing, so `Layout::types` merges the
/// two ids into one layout -- and an entry there says a class extends itself,
/// which does not terminate an ancestry walk and is a `ClassCircularityError` on
/// the JVM. Six runtime modules produced exactly that (`ReadableByteStreamHost <-
/// ReadableByteStreamHost`) while the map was filled before the layouts were
/// final; `http` produced two entries naming types no layout answered for at all.
///
/// Asserted on the *layouts* rather than on the names, because the names were
/// what made the defect hard to see: the printout read as a type pointing at
/// itself and the ids were genuinely different.
#[test]
fn a_merged_shape_records_no_edge() {
    let Some(lowered) = lowered() else {
        return;
    };
    for (child, parent) in &lowered.program.record_parents {
        let layout = |ty: &nts_semantic_schema::TypeId| {
            lowered
                .program
                .layouts
                .iter()
                .position(|l| l.types.contains(ty))
        };
        let (Some(below), Some(above)) = (layout(child), layout(parent)) else {
            panic!("both ends of {child:?} <- {parent:?} resolve to a layout");
        };
        assert_ne!(
            below, above,
            "{child:?} <- {parent:?} is one layout, so there is no relation to \
             record: {}",
            lowered.program.layouts[below].name,
        );
    }
    // **And the merge actually happens**, or the loop above is a check over an
    // empty set that passes whatever the rule is. `Layout::types` must hold both
    // `SameShape` and `AlsoSameShape`, which is the precondition the self-edge
    // needed -- the runtime corpora had it and this fixture has to be shown to.
    let merged = lowered
        .program
        .layouts
        .iter()
        .any(|layout| layout.types.len() > 1 && layout.fields.len() == 1);
    assert!(
        merged,
        "`AlsoSameShape extends SameShape` adds nothing, so one layout holds both \
         ids -- without that this test asserts over nothing: {:?}",
        lowered
            .program
            .layouts
            .iter()
            .map(|l| (l.name.clone(), l.types.len()))
            .collect::<Vec<_>>(),
    );
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|func| func.name == "readsTheSameShape"),
        "and the merging pair is read by a function the program keeps",
    );
}

/// **The control, and it is the half that matters.** A class's `extends` is its
/// representation and `Layout.base` already says it. If it appeared here too,
/// two facts would describe one edge and the day they disagree is the day a
/// consumer reading either gets a different answer -- which is the defect this
/// map is shaped to avoid, arriving from inside it.
#[test]
fn a_classs_extends_stays_in_layout_base() {
    let Some(lowered) = lowered() else {
        return;
    };
    let rows = named(&lowered);
    assert!(
        !rows.iter().any(|(child, _)| child.contains("Derived")),
        "a class extending a class is `Layout.base`'s: {rows:?}",
    );
    assert!(
        !rows.iter().any(|(child, _)| child.contains("Implementer")),
        "a class implementing an interface is an `implements` edge: {rows:?}",
    );
    // And the relation a class *does* carry is still there, so this test fails
    // if `Derived` simply stopped being laid out rather than being excluded.
    let derived = lowered
        .program
        .layouts
        .iter()
        .find(|layout| layout.name.contains("Derived"))
        .expect("the fixture builds a `Derived`");
    assert!(
        derived.base.is_some(),
        "`Derived` keeps its `Layout.base`: {:?}",
        derived.name,
    );
}

/// **A skipped test reports `ok`.** Both tests above return early when `tsgo` is
/// not built, and a run that measured nothing is indistinguishable from a run
/// that passed -- which this repository has been bitten by. This one fails
/// instead, so a green `record_parents` means the fixture was actually lowered.
#[test]
fn the_fixture_lowered_at_all() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|func| func.name == "readsThem"),
        "the fixture's own function is in the program, so the two tests above \
         measured a lowering rather than an early return",
    );
    assert!(
        !lowered.program.record_parents.is_empty(),
        "and the map is non-empty, so `one_declared_parent_is_recorded` asserted \
         against something",
    );
}
