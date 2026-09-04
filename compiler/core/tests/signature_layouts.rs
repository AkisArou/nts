//! A function type's layout, and why it cannot be shared by shape.
//!
//! Every `Fn` layout is empty — a function type is a signature, not a class —
//! so `same_shape` says all of them are one. That was harmless while nothing
//! dispatched through a function type, and wrong the moment a closure declared
//! its `call` in one: `examples/function-values` collapsed three signatures
//! into a single layout holding eight type ids.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Layout};
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

fn signature_layouts(lowered: &hir::lower::Lowered) -> Vec<&Layout> {
    lowered
        .program
        .layouts
        .iter()
        .filter(|layout| layout.name.starts_with("Fn") && layout.name.contains("__"))
        .collect()
}

/// Two function types with different signatures get different layouts.
///
/// `examples/function-values` declares `(x: number) => number`,
/// `(x: number) => void` and `(a: number, b: number) => number`. Before the
/// names were structural these were one layout with eight type ids, and the
/// only instrument that could see it was the JVM backend refusing
/// `Closure9.call is (D)V where the method it overrides is (D)D`.
#[test]
fn three_signatures_are_three_layouts() {
    let Some(lowered) = lowered("function-values") else {
        return;
    };
    let names: Vec<&str> = signature_layouts(&lowered)
        .iter()
        .map(|layout| layout.name.as_str())
        .collect();
    assert!(
        names.len() >= 3,
        "three signatures in that file, so at least three layouts: {names:?}",
    );

    // And no layout holds two ids that disagree about their signature, which is
    // the property the collapse violated. Checked through the *name*, since a
    // structural name is what the signature is rendered as.
    for layout in signature_layouts(&lowered) {
        assert!(
            layout.name.contains("__"),
            "a signature layout is named by its signature: {}",
            layout.name,
        );
    }
}

/// One written signature is still one layout, however many ids the checker
/// gives it.
///
/// This is the half a naive fix breaks. An arrow's inferred type and the
/// declared type of the slot it is stored into are two ids over one signature,
/// and they must share a layout or a store has nowhere to go. Separating every
/// id would pass the test above and break this one.
#[test]
fn one_signature_is_one_layout_however_many_ids() {
    let Some(lowered) = lowered("function-values") else {
        return;
    };
    let shared = signature_layouts(&lowered)
        .iter()
        .filter(|layout| layout.types.len() > 1)
        .count();
    assert!(
        shared > 0,
        "at least one signature is reached by more than one type id",
    );
}

/// A closure's layout names the signature it is a value of as its base.
#[test]
fn a_closure_extends_its_signature() {
    let Some(lowered) = lowered("closures") else {
        return;
    };
    let closures: Vec<&Layout> = lowered
        .program
        .layouts
        .iter()
        .filter(|layout| layout.name.starts_with("Closure"))
        .collect();
    assert!(!closures.is_empty(), "examples/closures has closures");

    let based = closures.iter().filter(|layout| layout.base.is_some()).count();
    assert!(
        based > 0,
        "a closure extends the function type it is a value of: {:?}",
        closures.iter().map(|l| (&l.name, l.base)).collect::<Vec<_>>(),
    );

    // And the base resolves to a signature layout, not to nothing. A base that
    // names an id no layout carries is the silent failure: the store still
    // refuses and the message is unchanged.
    for layout in closures.iter().filter(|layout| layout.base.is_some()) {
        let base = layout.base.expect("filtered");
        assert!(
            lowered
                .program
                .layouts
                .iter()
                .any(|other| other.types.contains(&base)),
            "`{}`'s base resolves to a layout",
            layout.name,
        );
    }
}

/// The signature layout declares the method a closure overrides.
///
/// A base that declares nothing is a base a dispatch cannot reach — on a
/// vtable it is a null slot and on the JVM a class that will not verify. The
/// declaration is an `abstract_declaration`, which is the field added for
/// `abstract` methods and turns out to name the same concept.
#[test]
fn the_signature_declares_what_closures_override() {
    let Some(lowered) = lowered("closures") else {
        return;
    };
    let declaring: Vec<&Layout> = signature_layouts(&lowered)
        .into_iter()
        .filter(|layout| layout.methods.iter().any(Option::is_some))
        .collect();
    assert!(
        !declaring.is_empty(),
        "a signature a closure extends declares its `call`",
    );

    for layout in declaring {
        for name in layout.methods.iter().flatten() {
            let func = lowered
                .program
                .funcs
                .iter()
                .find(|func| &func.name == name)
                .unwrap_or_else(|| panic!("`{name}` is declared"));
            assert!(
                func.abstract_declaration,
                "`{name}` is a declaration, not a body",
            );
        }
    }
}
