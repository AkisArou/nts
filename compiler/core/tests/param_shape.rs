//! What a parameter's declaration said, beyond its type.
//!
//! The type does not carry it: `...args: number[]` and `args: number[]` are the
//! same `Managed(Array(f64))`, and `x?: number` and `x: number = 1` are both an
//! `f64` slot the callee always has. `lower_param` was computing both halves —
//! the rest check reads `DOT_DOT_DOT_TOKEN`, the default check calls
//! `default_of` — and discarding them.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, ParamShape};
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

/// The shapes of one function's parameters, receiver excluded.
fn shapes(lowered: &hir::lower::Lowered, name: &str) -> Vec<ParamShape> {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` should be lowered"))
        .params
        .iter()
        .filter(|param| param.name != "this")
        .map(|param| param.shape)
        .collect()
}

/// A rest parameter is recorded as one, and an ordinary array parameter is not.
///
/// The pair is the test. Both are `Managed(Array(..))`, so an assertion about
/// the rest alone would pass on a lowering that called every array parameter a
/// rest — which is the approximation the N-API backend was making, and the
/// reason this field exists.
#[test]
fn a_rest_parameter_is_told_from_an_array_parameter() {
    let Some(lowered) = lowered("parameter-shapes") else {
        return;
    };
    let rests: usize = lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.params)
        .filter(|param| param.shape == ParamShape::Rest)
        .count();
    assert!(rests > 0, "examples/parameter-shapes declares one");

    let arrays: usize = lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.params)
        .filter(|param| {
            matches!(param.ty, hir::HirType::Managed(hir::ManagedType::Array(_)))
                && param.shape == ParamShape::Ordinary
        })
        .count();
    assert!(
        arrays > 0,
        "and an ordinary array parameter, which is the same type and not a rest",
    );
}

/// An optional parameter and a defaulted one are told apart.
///
/// Not the same case, and the difference is observable: an omitted optional is
/// `undefined` inside the callee, and an omitted default is never observable at
/// all because the *caller* evaluates the initializer. A boundary that is not a
/// compiled call site can supply the first and cannot supply the second.
#[test]
fn optional_and_defaulted_are_not_one_case() {
    let Some(defaults) = lowered("parameter-shapes") else {
        return;
    };
    let all: Vec<ParamShape> = defaults
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.params)
        .map(|param| param.shape)
        .collect();
    assert!(
        all.contains(&ParamShape::Defaulted),
        "examples/parameter-shapes declares one: {all:?}",
    );

    assert!(
        all.contains(&ParamShape::Optional),
        "and an optional parameter is recorded as one: {all:?}",
    );
    // The two appear in one signature nowhere in TypeScript -- `x?: T = e` is
    // not legal -- so the assertion is that the *fixture* has both, in
    // different functions, and the lowering keeps them apart.
    assert!(
        all.contains(&ParamShape::Rest),
        "and the rest, so all four shapes are exercised: {all:?}",
    );
}

/// A receiver is not a declared parameter.
#[test]
fn a_receiver_is_ordinary() {
    let Some(lowered) = lowered("parameter-shapes") else {
        return;
    };
    for func in &lowered.program.funcs {
        for param in func.params.iter().filter(|param| param.name == "this") {
            assert_eq!(
                param.shape,
                ParamShape::Ordinary,
                "the receiver of `{}` is not declared",
                func.name,
            );
        }
    }
    // And the ordinary parameters beside it are too, so the assertion above is
    // not passing because everything is `Ordinary`.
    assert_eq!(
        shapes(&lowered, "everything"),
        vec![
            ParamShape::Ordinary,
            ParamShape::Defaulted,
            ParamShape::Rest
        ],
        "one signature, three shapes, in declaration order",
    );
}
