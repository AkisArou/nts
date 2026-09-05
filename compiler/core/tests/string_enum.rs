//! A string enum member, which is a constant like a numeric one.
//!
//! The difference between them is what kind of constant. `Colour.Red` is an
//! immediate; `Label.Short` is a *managed* value, and the interned static a
//! string literal already gets is exactly what it wants. The checker gives the
//! member access the same `Literal(String("s"))` type it gives the literal, so
//! the two arrive at one constant rather than at two that happen to agree.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
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
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/string-enum"))
}

/// Every string constant a function builds, in the order it builds them.
fn strings(func: &hir::Func) -> Vec<&str> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::ConstString(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

/// A member lowers to its **value**, not its name and not a lookup.
///
/// The distinction the mutation cares about: `Label.Short = "s"` has a name
/// three characters long and a value one character long, and every fixture in
/// this example was written so the two can never be confused for each other.
#[test]
fn a_string_member_is_its_value() {
    let Some(lowered) = lowered("string-enum") else {
        return;
    };
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        Vec::<&str>::new(),
        "nothing in this fixture is refused",
    );
    let mut built = strings(func(&lowered, "pick"));
    built.sort_unstable();
    assert_eq!(
        built,
        vec!["long", "s"],
        "`pick` builds the two members' values and nothing else",
    );
}

/// The empty member is a constant, not an absence.
///
/// `Label.Empty = ""` is the one whose text is falsy and whose length is zero,
/// so a lowering that treated "no text" and "the empty text" alike answers the
/// same for both and is wrong for one. `emptyLength` multiplies the length and
/// adds the truthiness, which separates them in the answer as well as here.
#[test]
fn the_empty_member_is_a_constant() {
    let Some(lowered) = lowered("string-enum") else {
        return;
    };
    let built = strings(func(&lowered, "empty"));
    assert!(
        built.contains(&""),
        "the empty member is built as the empty string: {built:?}",
    );
    assert_eq!(built.len(), 2, "and it is one of the two: {built:?}");
}

/// A member's *type* is a managed string, not a number.
///
/// Worth pinning separately from its value because the two are decided in
/// different places: the value comes from the checker's literal type and the
/// representation from this lowering, and a member built with the right text at
/// the wrong representation would be a pointer read as a double.
#[test]
fn a_string_member_is_a_managed_string() {
    let Some(lowered) = lowered("string-enum") else {
        return;
    };
    let pick = func(&lowered, "pick");
    for (at, op) in pick.values.iter().enumerate() {
        if matches!(op.kind, OpKind::ConstString(_)) {
            assert_eq!(
                op.ty,
                HirType::Managed(ManagedType::String),
                "value {at} is a string constant and must be typed as one",
            );
        }
    }
    assert_eq!(
        pick.return_type,
        HirType::Managed(ManagedType::String),
        "and `pick` returns one",
    );
}

/// A `const enum`'s string member folds the same way.
///
/// It has to: a `const enum` has no run-time object at all, so a backend that
/// emitted a load for `Direction.Up` would be reading a member of nothing.
#[test]
fn a_const_enum_string_member_folds_too() {
    let Some(lowered) = lowered("string-enum") else {
        return;
    };
    let mut built = strings(func(&lowered, "heading"));
    built.sort_unstable();
    assert_eq!(built, vec!["down", "up"]);
}

/// And a numeric member is still an immediate.
///
/// The half a naive change breaks. `both` uses one of each, so a lowering that
/// sent every enum member through the string path would build three constants
/// here instead of two and type a number as a pointer.
#[test]
fn a_numeric_member_is_still_an_immediate() {
    let Some(lowered) = lowered("string-enum") else {
        return;
    };
    let both = func(&lowered, "both");
    let numbers = both
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ConstFloat(_)))
        .count();
    assert!(
        numbers >= 2,
        "`Colour.Red` and `Colour.Green` are immediates, saw {numbers}",
    );
    let mut built = strings(both);
    built.sort_unstable();
    built.dedup();
    assert!(
        built.contains(&"long") && built.contains(&"s") && !built.contains(&"1"),
        "the string members are strings and the numeric ones are not: {built:?}",
    );
}
