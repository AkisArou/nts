//! What a program does with its `any` and `unknown` values.
//!
//! Runs the frontend, so it skips only when `tsgo` is not built.
//!
//! The fixture is deliberately two files. `docs/any-unknown.md` argues that the
//! cheapest representation for `console`'s `unknown` is decided by a use in
//! `node:util`, and a one-file fixture could not tell a whole-program analysis
//! from a per-file one.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::erasure::{self, Analysis, Checker, Erasure, Verdict};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn classified() -> Option<Erasure> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/erasure/tsconfig.json")
        .canonicalize_utf8()
        .expect("the erasure fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(erasure::classify(&snapshot))
}

fn site<'a>(erasure: &'a Erasure, name: &str) -> &'a erasure::Site {
    erasure
        .sites
        .iter()
        .find(|site| format!("{}.{}", site.owner, site.name) == name)
        .unwrap_or_else(|| {
            let all: Vec<String> = erasure
                .sites
                .iter()
                .map(|s| format!("{}.{}", s.owner, s.name))
                .collect();
            panic!("no site named {name}, saw {all:?}")
        })
}

/// A value that is only written somewhere is carried.
///
/// The pair with `<module>.kept` is the point: the parameter reaches the
/// module-scope binding, and *that* binding is what nothing reads. Either one
/// alone would be a weaker claim.
#[test]
fn a_value_that_is_only_moved_is_carried() {
    let Some(erasure) = classified() else { return };
    assert_eq!(site(&erasure, "carries.value").verdict, Verdict::Carried);
    assert_eq!(site(&erasure, "<module>.kept").verdict, Verdict::Carried);
}

/// A value written into a binding inherits what reads of that binding do.
///
/// `stashes` and `carries` are the same three lines. The only difference is
/// that something reads `stashed` and nothing reads `kept`, and that is the
/// whole of what separates a pointer from general erasure here. An earlier
/// version of this pass had the two match arms for `=` in the wrong order, so
/// the propagating one was unreachable and both came out carried; the pair is
/// here so that cannot happen quietly.
#[test]
fn a_value_written_into_a_binding_inherits_the_reads_of_it() {
    let Some(erasure) = classified() else { return };
    assert_eq!(
        site(&erasure, "<module>.stashed").verdict,
        Verdict::Examined
    );
    let stashes = site(&erasure, "stashes.value");
    assert_eq!(
        stashes.verdict,
        Verdict::Examined,
        "because: {}",
        stashes.because
    );
    assert!(
        stashes.because.contains("stashed"),
        "the diagnosis should name the binding it reached: {}",
        stashes.because,
    );
}

/// `typeof` is a test, and what the narrowed value does afterwards is not an
/// examination of the erased one.
///
/// Both halves matter. The first pins `syntax::TYPE_OF_EXPRESSION`, which is a
/// bare number read off the checker's enum and would silently misclassify
/// every type test if it were wrong. The second is the distinction the
/// representation planner exists to make: `value + 1` inside a `typeof` guard
/// reads a `number`, and counting it as a read of the `unknown` collapses
/// "tested" into "examined" -- which is what a first version of this pass did,
/// and it is the difference between a tag and general erasure.
#[test]
fn a_type_test_is_a_test_and_the_read_after_it_is_not() {
    let Some(erasure) = classified() else { return };
    let tested = site(&erasure, "tests.value");
    assert_eq!(
        tested.verdict,
        Verdict::Tested,
        "because: {}",
        tested.because
    );
    assert!(
        tested.because.contains("typeof"),
        "the deciding use should be the test itself: {}",
        tested.because,
    );
}

/// Reading a property is an examination.
#[test]
fn a_property_read_examines() {
    let Some(erasure) = classified() else { return };
    let examined = site(&erasure, "examines.value");
    assert_eq!(examined.verdict, Verdict::Examined);
    assert_eq!(examined.checker, Checker::Any);
}

/// A value handed to another module inherits what that module does with it.
///
/// This is the document's central claim as a test. `forwards` reads nothing;
/// judged on its own uses it is indistinguishable from `carries`. It is
/// `reads`, in a different file, that decides its representation.
#[test]
fn a_forwarded_value_inherits_what_the_receiver_does() {
    let Some(erasure) = classified() else { return };
    let forwarded = site(&erasure, "forwards.value");
    assert_eq!(forwarded.verdict, Verdict::Examined);
    assert!(
        forwarded.decided_elsewhere,
        "the deciding use is in another file: {}",
        forwarded.because,
    );
    assert!(
        forwarded.because.contains("reads"),
        "the diagnosis should name the receiver: {}",
        forwarded.because,
    );
}

/// The two analyses disagree, and the disagreement is in the unsafe direction.
///
/// Judging each site by its own uses is what a per-signature rule could do, and
/// it calls `forwards` carried -- the *cheap* answer, and the wrong one. So the
/// whole-program analysis the document specifies is not an optimization that
/// finds cheaper representations; its first job is soundness. A local rule is
/// optimistic, and a representation chosen from it would be too small.
#[test]
fn the_local_analysis_is_optimistic_where_it_differs() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/erasure/tsconfig.json")
        .canonicalize_utf8()
        .expect("the erasure fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let whole = erasure::classify_as(&snapshot, Analysis::WholeProgram);
    let local = erasure::classify_as(&snapshot, Analysis::Local);

    assert_eq!(site(&whole, "forwards.value").verdict, Verdict::Examined);
    assert_eq!(site(&local, "forwards.value").verdict, Verdict::Carried);

    // Wherever they differ, the local answer is the cheaper one. If that ever
    // stops holding, a local rule is not merely incomplete but unpredictable,
    // and this assertion is where that shows up.
    for site_of in &whole.sites {
        let Some(alone) = local
            .sites
            .iter()
            .find(|other| other.location == site_of.location)
        else {
            continue;
        };
        assert!(
            alone.verdict <= site_of.verdict,
            "`{}.{}` is {} on its own uses and {} whole-program",
            site_of.owner,
            site_of.name,
            alone.verdict.as_str(),
            site_of.verdict.as_str(),
        );
    }
}
