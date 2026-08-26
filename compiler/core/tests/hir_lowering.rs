//! Lowering a real program to HIR.
//!
//! Runs the frontend, so it skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::{self, BinOp, Func, HirType, ManagedType, OpKind, lower::Lowered};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(fixture: &str) -> Option<Lowered> {
    let tsgo = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    let snapshot = TsgoApi::new(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a Lowered, name: &str) -> &'a Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("no function named {name}"))
}

#[test]
fn a_number_becomes_a_double() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // The conservative decision. `number` *is* an IEEE double in TypeScript, so
    // this is correct — and it is what specialization will improve on once
    // analysis can show a value is integral and in range.
    let add = func(&lowered, "add");
    assert_eq!(add.params[0].ty, HirType::Float { bits: 64 });
    assert_eq!(add.return_type, HirType::Float { bits: 64 });
}

#[test]
fn one_binding_becomes_one_value() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // `a + b` mentions `a` and `b` a second time. Both resolve to the parameter
    // values rather than to fresh loads, which is only possible because the two
    // identifiers carry the same symbol.
    let add = func(&lowered, "add");
    let (lhs, rhs) = add
        .ops
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Binary { lhs, rhs, .. } => Some((*lhs, *rhs)),
            _ => None,
        })
        .expect("the addition");

    assert!(matches!(add.ops[lhs.0 as usize].kind, OpKind::Param(0)));
    assert!(matches!(add.ops[rhs.0 as usize].kind, OpKind::Param(1)));
    assert_eq!(add.ops.len(), 4, "two params, one add, one return");
}

#[test]
fn plus_on_strings_is_not_the_same_operator_as_plus_on_numbers() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // The same `+` token. On numbers it is arithmetic; on strings it is
    // concatenation, and the two lower to nothing alike. Resolving it here means
    // no backend has to ask again.
    let op_of = |f: &Func| {
        f.ops
            .iter()
            .find_map(|op| match &op.kind {
                OpKind::Binary { op, .. } => Some(*op),
                _ => None,
            })
            .expect("a binary op")
    };

    assert_eq!(op_of(func(&lowered, "add")), BinOp::Add);
    assert_eq!(op_of(func(&lowered, "cat")), BinOp::Concat);
}

#[test]
fn a_string_is_a_managed_reference_and_a_number_is_not() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // The distinction a write barrier and a root slot are decided from.
    let textual = func(&lowered, "cat");
    assert_eq!(textual.params[0].ty, HirType::Managed(ManagedType::String));
    assert!(textual.params[0].ty.is_managed());
    assert!(!func(&lowered, "add").params[0].ty.is_managed());
}

#[test]
fn a_comparison_returns_a_bool_not_the_operand_type() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    let less = func(&lowered, "lt");
    assert_eq!(less.params[0].ty, HirType::Float { bits: 64 });
    assert_eq!(less.return_type, HirType::Bool);
}

#[test]
fn every_operation_carries_an_origin() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // RFC decision 20. Not conditional and not debug-only: once a lowering has
    // run without it the mapping back to source is gone for good.
    for f in &lowered.program.funcs {
        for op in &f.ops {
            let span = op.origin.location.span;
            assert!(
                span.start < span.end,
                "{} has an op with an empty span",
                f.name
            );
        }
    }
}

#[test]
fn exported_functions_are_marked_as_roots() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    assert!(lowered.program.funcs.iter().all(|f| f.exported));
}

#[test]
fn an_unsupported_construct_is_refused_rather_than_skipped() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    // The failure this guards is the quiet one. A lowering that emits nothing for
    // a statement it did not understand produces a function that compiles, runs,
    // and is wrong — with no signal anywhere.
    assert!(
        !lowered.is_complete(),
        "the `while` loop should have been refused",
    );
    assert_eq!(
        lowered.program.funcs.len(),
        1,
        "only the supported function"
    );
    assert!(lowered.diagnostics[0].code.starts_with("NTS"));

    let span = lowered.diagnostics[0].primary.span;
    assert!(span.start < span.end, "the refusal points somewhere real");
}
