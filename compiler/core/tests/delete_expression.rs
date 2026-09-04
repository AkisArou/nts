//! What `delete o.x` lowers to, and what it declines.
//!
//! TypeScript permits `delete` only where the property is optional — `TS2790` —
//! so the slot always holds `T | undefined` and always has a tag. The deletion
//! is writing that tag, and the tests are about it being a *store* rather than
//! anything else.
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

/// A deletion is a field store of `undefined`, and nothing else.
///
/// Not a runtime call, not a rebuild of the object. The assertion is about
/// *which* operations appear, because a `delete` that also called a helper
/// would agree with node on every case and cost a call per deletion.
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
        "a deletion is a store, not a call: {calls:?}",
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
