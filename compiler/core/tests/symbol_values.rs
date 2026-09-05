//! A symbol as a value, whose identity is the address of its cell.
//!
//! This is a different feature from a symbol as a *member name*, and the two
//! have to keep not being each other. `examples/symbol-keys` resolves `[kRefed]`
//! to a field at compile time and never makes a symbol at all — that row is
//! shipped, measured at 1.02x C++, and a representation for symbol *values*
//! must not turn it into a map lookup. The last test here is that.
//!
//! What the feature was worth: 393 refusal sites in `runtime/node` named a
//! property of unrepresentable type `a union of Map<string | symbol, ...> |
//! undefined`, and **318 of them were one property** — `EventEmitter._events`,
//! inherited by every class that extends it. The `string | symbol` key was the
//! sole blocker: `Map<string, A | B>` and `Map<string | number, V>` both
//! lowered already.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind};
use nts_frontend_ts::SemanticSource;

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
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
        .unwrap_or_else(|| panic!("`{name}` is exported"))
}

fn calls(func: &hir::Func) -> Vec<&str> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::External(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

/// A symbol has a representation, and it is its own.
///
/// Not an object: `typeof` must answer `"symbol"`, which it can only do if the
/// type is distinguishable. The wildcard `HirType::Managed(_) => "object"` in
/// `spelling_of` caught it before this, and 56 differential cases disagreed
/// with node — a default that is right for its neighbours being wrong for the
/// newcomer.
#[test]
fn a_symbol_is_not_an_object() {
    let Some(lowered) = lowered("symbol-values") else {
        return;
    };
    assert_eq!(lowered.diagnostics, [], "nothing here may be refused");

    let made = func(&lowered, "freshSymbolsDiffer");
    assert!(
        made.values.iter().any(|op| matches!(
            op.ty,
            HirType::Managed(ManagedType::Symbol)
        )),
        "`Symbol(\"tag\")` produces a value of symbol type"
    );

    // And `typeof` folds to the right spelling rather than to "object".
    let asked = func(&lowered, "typeofASymbol");
    assert!(
        asked.values.iter().any(|op| matches!(
            &op.kind,
            OpKind::ConstString(spelling) if spelling == "symbol"
        )),
        "`typeof` on a symbol folds to `symbol`"
    );
    assert!(
        !asked.values.iter().any(|op| matches!(
            &op.kind,
            OpKind::ConstString(spelling) if spelling == "object"
        )),
        "and never to `object`"
    );
}

/// `Symbol()` allocates and `Symbol.for` interns, and they are different calls.
///
/// The distinction is the whole of what the registry is for: two `Symbol("a")`
/// are different values and two `Symbol.for("a")` are one. A lowering that
/// routed both through either helper would answer one of the two wrongly, and
/// both answers look plausible.
#[test]
fn a_fresh_symbol_and_a_registered_one_are_different_calls() {
    let Some(lowered) = lowered("symbol-values") else {
        return;
    };
    assert!(
        calls(func(&lowered, "freshSymbolsDiffer")).contains(&"nts_symbol_new"),
        "`Symbol(d)` allocates"
    );
    let registered = calls(func(&lowered, "registeredSymbolsAreShared"));
    assert!(
        registered.contains(&"nts_symbol_for"),
        "`Symbol.for(k)` interns, in {registered:?}"
    );
    assert!(
        registered.contains(&"nts_symbol_new"),
        "and the same function's `Symbol(\"shared\")` still allocates, in {registered:?}"
    );
}

/// A symbol-keyed map is a map, not a special case.
///
/// The runtime needed no symbol-specific code for this: `nts_hash_key` already
/// hashes an unrecognised reference by its pointer and `nts_key_eq` already
/// compares one by its pointer, which for a symbol is exactly right rather than
/// merely adequate.
#[test]
fn a_symbol_keys_an_ordinary_map() {
    let Some(lowered) = lowered("symbol-values") else {
        return;
    };
    for export in ["twoSymbolsAreTwoKeys", "aMixedKeyMap"] {
        let built = func(&lowered, export);
        assert!(
            built.values.iter().any(|op| matches!(
                &op.ty,
                HirType::Managed(ManagedType::Map(_, _))
            )),
            "`{export}` builds a map"
        );
    }
}

/// A symbol as a **member name** is still a field, not a lookup.
///
/// `examples/symbol-keys` is the shipped row, measured at 1.02x C++ against a
/// plain struct, and its whole claim is that `[kRefed]` costs exactly what
/// `_refed` would. Giving symbols a runtime representation must not turn that
/// into a map: the uniqueness of a `unique symbol` is a *type-level* fact the
/// checker uses to tell one member name from another, and it says nothing about
/// the machine value.
#[test]
fn a_symbol_member_name_is_still_a_field() {
    let Some(lowered) = lowered("symbol-keys") else {
        return;
    };
    assert_eq!(lowered.diagnostics, [], "the shipped row still lowers");
    for func in &lowered.program.funcs {
        assert!(
            !calls(func).iter().any(|name| name.starts_with("nts_map_")),
            "`{}` reads a symbol-keyed member and must not build a map",
            func.name
        );
        assert!(
            !func.values.iter().any(|op| matches!(
                op.ty,
                HirType::Managed(ManagedType::Symbol)
            )),
            "`{}` never makes a symbol at run time -- the name is resolved at \
             compile time",
            func.name
        );
    }
    // And the members are still ordinary field accesses.
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .any(|func| func.values.iter().any(|op| matches!(
                op.kind,
                OpKind::FieldGet { .. } | OpKind::FieldSet { .. }
            ))),
        "a symbol-keyed member is a field"
    );
}
