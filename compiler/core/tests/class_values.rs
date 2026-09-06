//! A class used as a value rather than as a type.
//!
//! `err.constructor === TypeError` is how a program asks which error it caught.
//! Every one of them was refused — 1,865 occurrences in `runtime/node`, the
//! largest single refusal there — with "`TypeError` used as a value rather than
//! as a type", which was true and was not a question about capability.
//!
//! What a value of a class has to be is what a named function used as a value
//! already is: one immortal object per class, the same one wherever the name is
//! written, tagged `FUNCTION`, comparable by identity.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, ManagedType, OpKind};
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

/// Every type a `ClosureStatic` in this program is built at.
fn tokens(lowered: &hir::lower::Lowered) -> Vec<hir::ClassId> {
    lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter(|op| matches!(op.kind, OpKind::ClosureStatic))
        .filter_map(|op| match &op.ty {
            hir::HirType::Managed(ManagedType::Object(ty)) => Some(*ty),
            _ => None,
        })
        .collect()
}

/// Two mentions of one class are one object, and two classes are two.
///
/// Both halves, because either alone passes on a lowering that is wrong in the
/// other direction: one token for everything satisfies "the same one twice",
/// and a fresh token per mention satisfies "different classes differ".
#[test]
fn a_class_has_one_identity_and_each_class_its_own() {
    let Some(lowered) = lowered("class-values") else {
        return;
    };
    let used = tokens(&lowered);
    assert!(!used.is_empty(), "the example writes four class names");

    let mut distinct = used.clone();
    distinct.sort_unstable_by_key(|ty| ty.0);
    distinct.dedup();
    assert!(
        distinct.len() >= 4,
        "`Error`, `TypeError`, `RangeError` and `URIError` are four: {distinct:?}",
    );
    assert!(
        used.len() > distinct.len(),
        "and a class written twice is the same token twice: {used:?}",
    );

    // In the closure band, which is what gives the value the `FUNCTION` tag:
    // `typeof TypeError` is `"function"`, and that falls out of the id rather
    // than from a rule about classes.
    for ty in &distinct {
        assert!(
            hir::is_closure_type(*ty),
            "a class value answers `typeof` as a function: {ty:?}",
        );
        assert!(
            hir::is_constructor_token(*ty),
            "and is a constructor token rather than a closure: {ty:?}",
        );
    }
}

/// Each token gets a layout of its own.
///
/// A token holds nothing, so `Layout::same_shape` says every one of them is
/// every other one — and `err.constructor === TypeError` would then be true of
/// a `RangeError`, which is the wrong answer the *error classes themselves*
/// gave before they were given a nominal guard.
///
/// The third family with that problem, and record 0096 said it would recur: a
/// shape with nothing in it cannot answer a nominal question.
#[test]
fn two_tokens_do_not_merge() {
    let Some(lowered) = lowered("class-values") else {
        return;
    };
    let mut named: Vec<&str> = lowered
        .program
        .layouts
        .iter()
        .filter(|layout| layout.name.starts_with("Ctor_"))
        .map(|layout| layout.name.as_str())
        .collect();
    named.sort_unstable();
    let distinct = {
        let mut it = named.clone();
        it.dedup();
        it
    };
    assert_eq!(
        named.len(),
        distinct.len(),
        "one layout per class, not one shared: {named:?}",
    );
    assert!(
        named.len() >= 4,
        "the example writes four of them: {named:?}",
    );

    // And no layout carries two of the tokens, which is what merging looks
    // like from the other side: the names would stay distinct and the `types`
    // list would grow.
    for layout in &lowered.program.layouts {
        if !layout.name.starts_with("Ctor_") {
            continue;
        }
        assert_eq!(
            layout.types.len(),
            1,
            "`{}` is one class: {:?}",
            layout.name,
            layout.types,
        );
    }
}

/// A class value is a constant, not an allocation.
///
/// It is emitted rather than built — static, immortal, nothing in it but the
/// header — so there is no `ObjectNew` anywhere for one. A lowering that
/// allocated a fresh token per mention would break identity *and* allocate, and
/// `tooling/memory/cases/class-value` is the other half of this.
#[test]
fn a_class_value_allocates_nothing() {
    let Some(lowered) = lowered("class-values") else {
        return;
    };
    let allocated = lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. }))
        .filter(|op| match &op.ty {
            hir::HirType::Managed(ManagedType::Object(ty)) => hir::is_constructor_token(*ty),
            _ => false,
        })
        .count();
    assert_eq!(allocated, 0, "a token is emitted, never allocated");
}
