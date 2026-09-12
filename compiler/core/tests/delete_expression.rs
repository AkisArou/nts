//! What `delete o.x` lowers to, and what it declines.
//!
//! TypeScript permits `delete` only where the property is optional — `TS2790` —
//! so the slot always holds `T | undefined` and always has a tag. The deletion
//! writes that tag, and it also clears the property's **presence bit**: the tag
//! says the value is absent and the bit says the property is, and `{ x:
//! undefined }` proves those are different facts.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/delete"))
}

/// A deletion is a field store of `undefined` and a presence clear, and nothing
/// else.
///
/// Not a rebuild of the object, and no runtime call but the one. The assertion
/// is about *which* operations appear, because a `delete` that also called a
/// helper would agree with node on every case and cost a call per deletion.
///
/// It has asserted three different things, and each was right at the time.
///
/// **No call at all**, while `in`, `Object.keys` and `Object.hasOwn` all refused
/// on an optional property and the tag was the whole answer. **A set and a
/// clear**, when the presence bit arrived — that caught the deletion emitting a
/// `nts_presence_set`, which is a deletion recording a *write*. And no call
/// again now, for a different reason than the first: a bit is only maintained
/// where something reads it, and **nothing in this fixture asks `"maybe" in
/// bag`**.
///
/// So this is the pay-for-what-you-use gate rather than an absence of the
/// feature, and the two are told apart by `examples/an-optional-property`,
/// which does ask and does get its bit. Without that fixture beside it this
/// assertion would pass just as well on a compiler where presence was never
/// implemented.
#[test]
fn a_deletion_is_a_store_of_undefined() {
    let Some(lowered) = lowered("delete") else {
        return;
    };
    let function = func(&lowered, "deletesAndReads");

    let undefineds = function
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ConstUndefined))
        .count();
    assert!(undefineds > 0, "the deletion builds an `undefined`");

    let stores = function
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::FieldSet { .. }))
        .count();
    assert!(stores > 0, "and stores it: {stores}");

    // And reaches the runtime for none of it.
    let calls: Vec<&str> = function
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: hir::Callee::External(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        calls.is_empty(),
        "nothing in this fixture asks `\"maybe\" in bag`, so no bit is maintained: {calls:?}",
    );
}

/// The expression's value is a constant `true`.
///
/// In a strict-mode program every deletable property is configurable, and
/// TypeScript refused the rest — so there is nothing to test at run time.
#[test]
fn the_result_is_a_constant() {
    let Some(lowered) = lowered("delete") else {
        return;
    };
    let function = func(&lowered, "itsResult");
    let trues = function
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ConstBool(true)))
        .count();
    // Two deletions, each producing `true`.
    assert!(
        trues >= 2,
        "each deletion answers a constant `true`: {trues}",
    );
}

/// The fixture lowers with nothing refused.
///
/// Separately, because the two tests above look at one function each and would
/// pass while a third was declined.
#[test]
fn nothing_in_the_fixture_is_refused() {
    let Some(lowered) = lowered("delete") else {
        return;
    };
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        Vec::<&str>::new(),
    );
    assert_eq!(
        lowered
            .program
            .funcs
            .iter()
            .filter(|func| func.exported)
            .count(),
        8,
        "all eight exports survive",
    );
}

/// An `Object` static over a type with an optional property is refused.
///
/// This is what makes `delete` sound rather than a wrong answer: `Object.keys`
/// reports what an object *has*, and the deleted property's slot still exists.
/// Before this it answered from the declaration — `{ keep: 1 }` gave
/// `["keep", "maybe"]` where node gives `["keep"]` — which the differential
/// reported on 29 of 29 cases once a fixture asked.
#[test]
fn object_statics_refuse_an_optional_property() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    let reasons: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert!(
        reasons.iter().any(|reason| {
            reason.contains("an `Object` static over a type with the optional property")
        }),
        "the refusal names the property: {reasons:?}",
    );
}
