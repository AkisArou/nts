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
/// tag. Nothing pins that refusal any more: a value with one absence is
/// answered by a branch on the pointer, and one with two is erased and reaches
/// here, so `typeof` no longer refuses anything the lowering can produce.
/// `examples/absent` holds both.
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

/// `typeof v === "number"` is an integer compare, not a string allocation.
///
/// Lowering emits `TagOf` and then `nts_tag_name`, which **allocates a
/// string**, and compares strings. Almost every `typeof` in real code compares
/// against a literal, so that allocation sits on the common path — and the tag
/// the comparison is really about is already in hand.
///
/// The fold is a peephole rather than a case inside lowering, because doing it
/// there means matching on the *parent* of the `typeof` while lowering it, and
/// the shape of that parent is not lowering's business. Here the pattern is
/// already in the IR.
///
/// Asserted after `prepare`, which is where the optimisation pipeline runs —
/// `nts hir` dumps the lowering's output and would show the unfolded form.
#[test]
fn a_typeof_comparison_is_folded_to_an_integer_compare() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/unknown")
        .join("tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/unknown is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let prepared = nts_core::hir::prepare(&snapshot).expect("valid HIR");

    // Through the *blocks*, not the value arena. Dead-code elimination drops a
    // value from the block that held it and leaves the definition behind, so
    // the arena still contains what nothing emits -- and the emitter walks
    // blocks. Checking the arena passes for the wrong reason and fails for the
    // wrong reason, which this test did on its first run.
    let names: Vec<&str> = prepared
        .program
        .funcs
        .iter()
        .flat_map(|f| {
            f.blocks
                .iter()
                .flat_map(move |b| b.ops.iter().map(move |v| f.value(*v)))
        })
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: nts_core::hir::Callee::External(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        !names.contains(&"nts_tag_name"),
        "the string allocation should be gone, saw calls: {names:?}",
    );

    // And the tag is still read -- the comparison was rewritten, not deleted.
    let reads = prepared
        .program
        .funcs
        .iter()
        .flat_map(|f| {
            f.blocks
                .iter()
                .flat_map(move |b| b.ops.iter().map(move |v| f.value(*v)))
        })
        .filter(|op| matches!(op.kind, OpKind::TagOf { .. }))
        .count();
    assert!(reads > 0, "the tag is still what the comparison asks about");
}

fn prepared_at(relative: &str) -> Option<nts_core::hir::Prepared> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(nts_core::hir::prepare(&snapshot).expect("valid HIR"))
}

fn erased_arrays(prepared: &nts_core::hir::Prepared) -> usize {
    use nts_core::hir::{HirType, ManagedType};
    prepared
        .program
        .funcs
        .iter()
        .flat_map(|f| &f.values)
        .filter(|op| {
            matches!(&op.ty, HirType::Managed(ManagedType::Array(element))
                if **element == HirType::Erased)
        })
        .count()
}

/// An `unknown[]` holding one kind of value stops being erased at all.
///
/// The measurement this pass exists for: an erased array cost 11% against a
/// typed one, and the cost was the per-element tag test -- NaN-boxing the value
/// to half its size moved the number by 0.1%, which is what proved it. So the
/// win is not a smaller tag, it is no tag.
///
/// `benches/cases/erasure-stored-unknown` is the same program as
/// `erasure-stored-typed` but for `unknown`, and its gap closed to nothing.
#[test]
fn an_array_of_one_kind_is_not_erased() {
    let Some(prepared) = prepared_at("../../benches/cases/erasure-stored-unknown") else {
        return;
    };
    assert_eq!(
        erased_arrays(&prepared),
        0,
        "every store is a number, so the array should hold numbers",
    );
    let tags = prepared
        .program
        .funcs
        .iter()
        .flat_map(|f| {
            f.blocks
                .iter()
                .flat_map(move |b| b.ops.iter().map(move |v| f.value(*v)))
        })
        .filter(|op| matches!(op.kind, OpKind::TagOf { .. }))
        .count();
    assert_eq!(tags, 0, "and there is no tag left to read");
}

/// A mixed one keeps its tags, and this is the more important half.
///
/// Narrowing an array that really does hold two kinds would read a string's
/// pointer as a double -- silently, since nothing at run time would notice.
/// The pass declines when the stores disagree, when the array escapes, and
/// when a read is used as anything but an unerase or a tag read.
#[test]
fn an_array_of_two_kinds_keeps_its_tags() {
    let Some(prepared) = prepared_at("tests/programs/erased-mixed") else {
        return;
    };
    assert!(
        erased_arrays(&prepared) > 0,
        "numbers and strings share this array, so it needs a tag per element",
    );
}

/// A parameter every caller reaches with the same kind stops being erased.
///
/// The cross-function half. `addOne` in `examples/unknown` is called once, with
/// a number, so its parameter becomes a `double` and the tag it read becomes a
/// constant.
///
/// `kind` in the same file must *not*: it is called both with a number and with
/// the result of `keeps`, which is erased and carries a tag chosen elsewhere.
/// Two callers disagreeing is the case that would be wrong rather than missed,
/// and it is the reason this pass surveys every call site before deciding.
#[test]
fn a_parameter_with_one_kind_of_caller_is_not_erased() {
    let Some(prepared) = prepared_at("../../examples/unknown") else {
        return;
    };
    let parameter = |name: &str| {
        prepared
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .unwrap_or_else(|| panic!("no function {name}"))
            .params[0]
            .ty
            .clone()
    };
    assert_eq!(
        parameter("addOne"),
        nts_core::hir::HirType::Float { bits: 64 },
        "one caller, one kind, so no tag",
    );
    assert_eq!(
        parameter("kind"),
        nts_core::hir::HirType::Erased,
        "a number and an already-erased value reach this one",
    );
}

/// A returned `unknown` every caller only tests stops being erased.
///
/// The mirror of [`a_parameter_with_one_kind_of_caller_is_not_erased`]: the
/// producer is the body and the consumers are the callers, so the two
/// conditions are asked of the opposite ends. All four outcomes are in the one
/// example, because three of them are the ones that would be *wrong* rather
/// than merely missed.
#[test]
fn a_return_of_one_kind_every_caller_unwraps_is_not_erased() {
    let Some(prepared) = prepared_at("../../examples/unknown-returns") else {
        return;
    };
    let returns = |name: &str| {
        prepared
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .unwrap_or_else(|| panic!("no function {name}"))
            .return_type
            .clone()
    };
    assert_eq!(
        returns("pick"),
        HirType::Float { bits: 64 },
        "both returns erase a number and the one caller only tests it",
    );
    assert_eq!(
        returns("mixed"),
        HirType::Erased,
        "a number and a string, so there is no one representation to pick",
    );
    assert_eq!(
        returns("open"),
        HirType::Erased,
        "exported, so this pass cannot see every caller",
    );
    assert_eq!(
        returns("agreeing"),
        HirType::Erased,
        "the returns agree, but the caller hands the result on rather than \
         unwrapping it",
    );
}

/// And the caller stops paying for the tag it no longer needs.
///
/// The signature changing is only half of it. If the call site kept unerasing
/// a value that is no longer erased, the pass would have moved the cost rather
/// than removed it -- which is what the first placement of `narrow_arrays` did,
/// after the peepholes instead of before them.
#[test]
fn the_caller_stops_unwrapping_a_narrowed_result() {
    let Some(prepared) = prepared_at("../../examples/unknown-returns") else {
        return;
    };
    let unwrapped = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "unwrapped")
        .expect("`unwrapped` is in the program");
    // Ops the blocks still hold, not entries in the value table: `dce` prunes
    // the first and leaves the second, so counting values would count the
    // orphan the narrowing just made.
    let live = |want: fn(&OpKind) -> bool| {
        unwrapped
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .filter(|value| want(&unwrapped.value(**value).kind))
            .count()
    };
    assert_eq!(
        live(|kind| matches!(kind, OpKind::Unerase { .. })),
        0,
        "nothing left to unerase",
    );
    assert_eq!(
        live(|kind| matches!(kind, OpKind::TagOf { .. })),
        0,
        "and no tag to read",
    );
}

/// Every kind of narrowing, counted where the compiler counts it.
///
/// `Prepared::narrowed` is what a measurement reads, so it has to agree with
/// what the passes actually did. Two here: `pick`'s return, and `addOne`'s
/// parameter is in the other example — this one has one array, one parameter
/// and one return between them.
#[test]
fn the_narrowing_count_matches_what_changed() {
    let Some(prepared) = prepared_at("../../examples/unknown-returns") else {
        return;
    };
    let narrowed_returns = prepared
        .program
        .funcs
        .iter()
        .filter(|f| f.name == "pick")
        .count();
    assert_eq!(narrowed_returns, 1, "`pick` survives to be narrowed");
    assert!(
        prepared.narrowed >= 1,
        "the count should include `pick`'s return, got {}",
        prepared.narrowed,
    );
}
