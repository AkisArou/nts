//! A class member's refusal must not be published under the bare member name.
//!
//! `Program::uncompiled` is one flat namespace of names, and a member recorded
//! its bare name beside its qualified one -- so `Holder#names` and a
//! module-scope `function names` were one key, first writer wins. The cascade
//! then *prints* what it finds there as the cause of a call it has nothing to
//! do with.
//!
//! It cost a night on 2026-09-26: the raising-copy experiment lost 48 functions
//! in `runtime/node/http` and every one read "a super keyword is not supported
//! by this lowering yet", which is `EventEmitterAsyncResource#emit`'s reason
//! arriving under the bare key `emit`, while the function actually missing was
//! the *top-level* `emit` in `internal/async-hooks.ts`. A lowering for `super.m`
//! as a value was designed against that reading before the collision was found.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Prepared};
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// **`prepare_unverified` rather than `lower`, because the cascade is not
/// lowering's.** `drop_callers_of_refused` is what turns a call to a dropped
/// function into the NTS1003 sentence a reader sees, and it runs after
/// `lower`. A first version of this test asserted on `lower`'s diagnostics and
/// found three NTS1001s and no cascade at all -- the list was right and the
/// half that prints the wrong cause was not being run.
fn lower_at(relative: &str) -> Option<Prepared> {
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
    Some(hir::prepare_unverified(&snapshot, &hir::Options::default()))
}

fn held(lowered: &Prepared) -> Vec<&str> {
    lowered
        .program
        .uncompiled
        .iter()
        .map(|(at, _)| at.as_str())
        .collect()
}

fn reason_for<'a>(lowered: &'a Prepared, name: &str) -> Option<&'a str> {
    lowered
        .program
        .uncompiled
        .iter()
        .find(|(at, _)| at == name)
        .map(|(_, why)| why.as_str())
}

/// The two halves of the collision, in one lowering.
#[test]
fn a_member_does_not_publish_its_reason_under_the_bare_member_name() {
    let Some(lowered) = lower_at("tests/programs/shadowed-refusal") else {
        eprintln!("SKIP shadowed refusal: tsgo is required");
        return;
    };

    // **The controls first**: both refusals happened, and they are *different*
    // sentences. Without this the assertions below would pass on a program
    // where nothing was refused, which is the shape a fixture fails silently
    // in.
    assert_eq!(
        reason_for(&lowered, "Holder#names").map(|why| why.contains("regular expression")),
        Some(true),
        "the member must refuse for the regular expression; `uncompiled` holds {:?}",
        held(&lowered)
    );
    assert_eq!(
        reason_for(&lowered, "Tagger#tag").map(|why| why.contains("regular expression")),
        Some(true),
        "the second member must refuse the same way; `uncompiled` holds {:?}",
        held(&lowered)
    );

    // **The lost cause.** `names` is refused for reflection, not for a regular
    // expression, and before the fix the reflection sentence was recorded under
    // no name at all -- the key was taken.
    let why = reason_for(&lowered, "names").unwrap_or_else(|| {
        panic!(
            "the module-scope `names` refuses and must say why; `uncompiled` holds {:?}",
            held(&lowered)
        )
    });
    assert!(
        why.contains("getOwnPropertyNames"),
        "`names` must carry its own cause rather than the member's; it carries {why:?}"
    );
    assert!(
        !why.contains("regular expression"),
        "`names` carries the member's cause: {why:?}"
    );

    // And what a reader actually sees, which is the cascade rather than the
    // list: `caller` calls the module-scope `names`, so its sentence is the
    // reflection one.
    let Some(cascade) = lowered
        .diagnostics
        .iter()
        .find(|d| d.message.starts_with("`caller` cannot be compiled"))
        .map(|d| d.message.as_str())
    else {
        panic!(
            "`caller` calls a refused function and must cascade; diagnostics are {:?}",
            lowered
                .diagnostics
                .iter()
                .map(|d| d.message.as_str())
                .collect::<Vec<_>>()
        )
    };
    assert!(
        cascade.contains("getOwnPropertyNames"),
        "the cascade must name the callee's own cause; it says {cascade:?}"
    );

    // **The phantom.** `tag` compiles -- `usesTag` calls it and is emitted -- so
    // a `tag` entry is a claim about the output that is false, and a reader
    // asking why an export was dropped gets an answer about one that was not.
    assert!(
        lowered.program.funcs.iter().any(|f| f.name == "tag"),
        "the fixture's module-scope `tag` must compile, or the phantom half \
         measures nothing; emitted {:?}",
        lowered
            .program
            .funcs
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        reason_for(&lowered, "tag"),
        None,
        "`tag` compiled and must not be listed as uncompiled; `uncompiled` holds {:?}",
        held(&lowered)
    );
}

/// A static member is recorded under the name its *emitted* name uses.
///
/// `Owner.member` for a static and `Owner#member` for an instance method, which
/// is what a cascade asks with. Recorded under `#` a refused static was one
/// character from findable, and its caller read "which was refused above" with
/// nothing above -- the sentence `drop_callers_of_refused` itself calls a claim
/// that is not always true.
#[test]
fn a_static_members_refusal_is_recorded_under_its_emitted_name() {
    let Some(lowered) = lower_at("tests/programs/shadowed-refusal") else {
        eprintln!("SKIP shadowed refusal: tsgo is required");
        return;
    };

    assert_eq!(
        reason_for(&lowered, "Statics.named").map(|why| why.contains("regular expression")),
        Some(true),
        "a refused static belongs under `Statics.named`; `uncompiled` holds {:?}",
        held(&lowered)
    );
    assert_eq!(
        reason_for(&lowered, "Statics#named"),
        None,
        "and not under the instance spelling, which nothing asks with"
    );

    // The control for the pair: the instance member keeps `#`, so this test is
    // about the separator rather than about members in general.
    assert!(
        reason_for(&lowered, "Holder#names").is_some(),
        "an instance member keeps `#`; `uncompiled` holds {:?}",
        held(&lowered)
    );

    // And what the reader sees.
    let Some(cascade) = lowered
        .diagnostics
        .iter()
        .find(|d| d.message.starts_with("`viaStatic` cannot be compiled"))
        .map(|d| d.message.as_str())
    else {
        panic!(
            "`viaStatic` calls a refused static and must cascade; diagnostics are {:?}",
            lowered
                .diagnostics
                .iter()
                .map(|d| d.message.as_str())
                .collect::<Vec<_>>()
        )
    };
    assert!(
        cascade.contains("regular expression"),
        "the cascade must name the static's cause rather than \"refused above\"; \
         it says {cascade:?}"
    );
}

/// An accessor too, whose emitted name carries the keyword.
///
/// `Owner#get size` for an instance accessor and `Owner.get size` for a static
/// one, which is what `callee_for` and `static_accessor_place` build. Recorded
/// under the bare property name it was both unfindable *and* in collision with
/// any module-scope function of that name.
#[test]
fn an_accessors_refusal_is_recorded_under_its_emitted_name() {
    let Some(lowered) = lower_at("tests/programs/shadowed-refusal") else {
        eprintln!("SKIP shadowed refusal: tsgo is required");
        return;
    };

    assert_eq!(
        reason_for(&lowered, "Reader#get size").map(|why| why.contains("regular expression")),
        Some(true),
        "a refused getter belongs under `Reader#get size`; `uncompiled` holds {:?}",
        held(&lowered)
    );
    assert_eq!(
        reason_for(&lowered, "size"),
        None,
        "and not under the bare property name, which nothing asks with"
    );

    let Some(cascade) = lowered
        .diagnostics
        .iter()
        .find(|d| d.message.starts_with("`readsSize` cannot be compiled"))
        .map(|d| d.message.as_str())
    else {
        panic!(
            "`readsSize` reads a refused getter and must cascade; diagnostics are {:?}",
            lowered
                .diagnostics
                .iter()
                .map(|d| d.message.as_str())
                .collect::<Vec<_>>()
        )
    };
    assert!(
        cascade.contains("regular expression"),
        "the cascade must name the accessor's cause rather than \"refused above\"; \
         it says {cascade:?}"
    );
}
