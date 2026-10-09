//! A generic function used as a value gets a typed context per receiving
//! signature, up to a cap, beside one erased root. Both examples compare
//! answers with node, which the erased root gives correctly on its own, so
//! these assert the contexts themselves: each survives preparation, which
//! prunes what nothing reaches, and the cap is where the copies stop.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

// The eight-copies example has eleven receiving signatures; a cap at or above
// that would leave it testing nothing past the cap.
const _: () = assert!(hir::generics::VALUE_CONTEXT_CAP < 11);

fn prepared(example: &str) -> Option<hir::Prepared> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../examples/{example}/tsconfig.json"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some(hir::prepare(&snapshot).expect("valid HIR"))
}

fn named<'a>(prepared: &'a hir::Prepared, prefix: &str) -> Vec<&'a str> {
    prepared
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .filter(|name| name.starts_with(prefix) && !name.ends_with("@raises"))
        .collect()
}

#[test]
fn each_receiving_signature_reaches_its_own_typed_context() {
    let Some(prepared) = prepared("a-generic-function-value-keeps-one-erased-root") else {
        return;
    };
    for context in [
        "basicReducer<value-f64@",
        "basicReducer<value-str@",
        "basicReducer<value-bool@",
        "identity<value-f64@",
        "identity<value-str@",
        "identity<value-obj",
    ] {
        assert!(
            !named(&prepared, context).is_empty(),
            "no reachable {context}…> context: {:?}",
            named(&prepared, "basicReducer<")
        );
    }
    let typed = prepared
        .program
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
        named(&prepared, "identity<value-erased>").len(),
        1,
        "one erased root"
    );
}

#[test]
fn copies_stop_at_the_cap_and_the_rest_share_the_erased_root() {
    let Some(prepared) =
        prepared("a-generic-function-value-uses-the-erased-root-after-eight-copies")
    else {
        return;
    };
    // Eleven receiving signatures, one per `Box` class: more than the cap (a
    // compile-time assertion above), or this would not reach the root.
    let typed: Vec<_> = named(&prepared, "identity<value-")
        .into_iter()
        .filter(|name| *name != "identity<value-erased>")
        .collect();
    assert_eq!(typed.len(), hir::generics::VALUE_CONTEXT_CAP, "{typed:?}");
    assert_eq!(
        named(&prepared, "identity<value-erased>").len(),
        1,
        "the root past the cap"
    );
}
