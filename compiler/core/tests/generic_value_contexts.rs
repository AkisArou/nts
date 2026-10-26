//! A generic function used as a value gets a typed context per receiving
//! signature, up to a cap, beside one erased root. Both examples compare
//! answers with node, which the erased root gives correctly on its own, so
//! these assert the contexts themselves: lowering makes them, the cap is where
//! the copies stop, and preparation keeps those still called. `identity`'s are
//! exact identities, so a call to one is its argument (`forward_identities`)
//! and preparation keeps none of them; a reducer's are kept.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

// The eight-copies example has eleven receiving signatures; a cap at or above
// that would leave it testing nothing past the cap.
const _: () = assert!(hir::generics::VALUE_CONTEXT_CAP < 11);

/// The example's program as lowering made it, and as preparation hands it on.
fn programs(example: &str) -> (hir::Program, hir::Program) {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../tests/programs/{example}/tsconfig.json"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowered = hir::lower::lower(&snapshot).program;
    let prepared = hir::prepare(&snapshot).expect("valid HIR").program;
    (lowered, prepared)
}

fn named<'a>(program: &'a hir::Program, prefix: &str) -> Vec<&'a str> {
    program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .filter(|name| name.starts_with(prefix) && !name.ends_with("@raises"))
        .collect()
}

#[test]
fn each_receiving_signature_reaches_its_own_typed_context() {
    let (lowered, prepared) = programs("a-generic-function-value-keeps-one-erased-root");
    for context in [
        "basicReducer<value-f64@",
        "basicReducer<value-str@",
        "basicReducer<value-bool@",
        "identity<value-f64@",
        "identity<value-str@",
        "identity<value-obj",
    ] {
        assert!(
            !named(&lowered, context).is_empty(),
            "no {context}…> context made: {:?}",
            named(&lowered, "identity<")
        );
    }
    let typed = lowered
        .funcs
        .iter()
        .find(|func| func.name.starts_with("identity<value-f64@"))
        .expect("a number context");
    assert_eq!(
        typed.params[0].ty,
        hir::HirType::NUMBER,
        "the context is not typed"
    );
    assert_eq!(
        named(&lowered, "identity<value-erased>").len(),
        1,
        "one erased root"
    );
    // Still called after preparation, so still there: a reducer is not an
    // identity. `identity`'s contexts are, and every call to one became its
    // argument, which left none of them anything to do.
    for context in [
        "basicReducer<value-f64@",
        "basicReducer<value-str@",
        "basicReducer<value-bool@",
    ] {
        assert!(
            !named(&prepared, context).is_empty(),
            "no reachable {context}…> context: {:?}",
            named(&prepared, "basicReducer<")
        );
    }
    assert!(
        named(&prepared, "identity<").is_empty(),
        "an identity context outlived the forwarding of its calls: {:?}",
        named(&prepared, "identity<")
    );
}

#[test]
fn copies_stop_at_the_cap_and_the_rest_share_the_erased_root() {
    let (lowered, _) = programs("a-generic-function-value-uses-the-erased-root-after-eight-copies");
    // Eleven receiving signatures, one per `Box` class: more than the cap (a
    // compile-time assertion above), or this would not reach the root. Counted
    // where lowering makes them -- preparation forwards every call to an
    // identity, so it keeps none of these.
    let typed: Vec<_> = named(&lowered, "identity<value-")
        .into_iter()
        .filter(|name| *name != "identity<value-erased>")
        .collect();
    assert_eq!(typed.len(), hir::generics::VALUE_CONTEXT_CAP, "{typed:?}");
    assert_eq!(
        named(&lowered, "identity<value-erased>").len(),
        1,
        "the root past the cap"
    );
}
