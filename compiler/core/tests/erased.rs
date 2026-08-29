//! `unknown` as a value with a representation.
//!
//! Runs the frontend, so it skips only when `tsgo` is not built.
//!
//! `docs/records/0019` measures what programs do with erased values and
//! records the representation chosen from it. These are the three shapes that
//! measurement ranks — carried, tested, examined — and the refusals that bound
//! the first version of it.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, OpKind, lower::Lowered};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lower_at(relative: &str) -> Option<Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("no function named {name}"))
}

fn count(f: &hir::Func, want: fn(&OpKind) -> bool) -> usize {
    f.values.iter().filter(|op| want(&op.kind)).count()
}

/// An `unknown` parameter is one erased value, not a refusal.
#[test]
fn an_unknown_parameter_has_a_representation() {
    let Some(lowered) = lower_at("../../examples/unknown") else {
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "examples/unknown should lower clean: {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
    );
    assert_eq!(func(&lowered, "kind").params[0].ty, HirType::Erased);
}

/// A concrete value is *converted* on the way into an erased slot.
///
/// The verifier checks call argument types as of this change, which is how the
/// missing conversion was found rather than compiled: a value passed straight
/// into an erased parameter reaches C as a struct initialised from whatever it
/// was, and C accepts it.
#[test]
fn a_concrete_value_is_erased_at_the_boundary() {
    let Some(lowered) = lower_at("../../examples/unknown") else {
        return;
    };
    assert_eq!(
        count(func(&lowered, "tested"), |k| matches!(
            k,
            OpKind::Erase { .. }
        )),
        1,
        "the number is erased once, where it meets the parameter",
    );
    // Erased to erased is a copy: `keeps` takes and returns one, so nothing
    // along that path converts.
    assert_eq!(
        count(func(&lowered, "keeps"), |k| matches!(
            k,
            OpKind::Erase { .. } | OpKind::Unerase { .. }
        )),
        0,
        "a value that stays erased is not converted on the way through",
    );
}

/// `typeof` on an erased value reads its tag.
///
/// The refusal it replaces said `which needs a runtime tag`, and this is that
/// tag. `compiler/core/tests/programs/typeof-erased` still pins the refusal for
/// a value that has no tag to read.
#[test]
fn typeof_on_an_erased_value_reads_the_tag() {
    let Some(lowered) = lower_at("../../examples/unknown") else {
        return;
    };
    assert_eq!(
        count(func(&lowered, "kind"), |k| matches!(
            k,
            OpKind::TagOf { .. }
        )),
        1,
    );
}

/// The unerase appears only where the checker narrowed.
///
/// This is the one place in the feature where being wrong is silent: an unerase
/// on a path the test did not cover reads a payload the tag does not describe.
/// So `addOne` has exactly one, and its own entry block — before the branch —
/// has none.
#[test]
fn an_unerase_appears_only_inside_the_narrowed_branch() {
    let Some(lowered) = lower_at("../../examples/unknown") else {
        return;
    };
    let add_one = func(&lowered, "addOne");
    assert_eq!(
        count(add_one, |k| matches!(k, OpKind::Unerase { .. })),
        1,
        "one unerase, for the one narrowed read",
    );
    let entry: Vec<_> = add_one.entry().ops.iter().collect();
    assert!(
        !entry
            .iter()
            .any(|value| matches!(add_one.value(**value).kind, OpKind::Unerase { .. })),
        "and not before the tag has been tested",
    );
}

/// A reference goes into an erased value and comes back out.
///
/// Refused in both directions until the collector could see one. The difficulty
/// was never the union: it was that a payload which is *sometimes* a pointer
/// cannot be described by a fixed-offset reference table, so retain, release
/// and every cycle pass had no way to know whether to follow it.
///
/// The descriptor now carries a table of erased slots beside its table of
/// reference slots, and `nts_each_reference` reads the tag before visiting.
/// That it is the *single* traversal is the whole argument for storing an
/// erased value whole rather than decomposing it at every kind of storage:
/// one loop teaches release-contents and all four cycle passes at once.
///
/// The counting itself is checked in `runtime/c/tests/erased_refs.c`, under
/// reference counting. It cannot be checked here: the differential harness
/// builds `NoGC`, where nothing is ever released and every assertion about
/// releasing would pass against a runtime that had never learned any of this.
#[test]
fn a_reference_survives_being_erased() {
    let Some(lowered) = lower_at("../../examples/unknown-references") else {
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "examples/unknown-references should lower clean: {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
    );
    // A string in, and a string out: the erase and the unerase are both there,
    // and the unerase is what the earlier refusal made impossible.
    let width = func(&lowered, "widthOf");
    assert_eq!(
        count(width, |k| matches!(k, OpKind::Unerase { .. })),
        1,
        "the narrowed read reads the payload back",
    );
    assert_eq!(
        count(func(&lowered, "ofString"), |k| matches!(
            k,
            OpKind::Erase { .. }
        )),
        1,
        "and the string is erased where it meets the parameter",
    );
}
