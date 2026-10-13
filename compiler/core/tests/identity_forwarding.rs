//! That a call to an exact identity **is its argument**, and that the erasure
//! it exposes folds.
//!
//! `widen(value: unknown) { return value }` kept the erasure, its tag read and
//! its unerase behind a call, and the Wasm lane's `eraseNumbers` kernel ran 7.5x
//! behind node; C matched only because clang inlined it. Every correctness test
//! passes with the forwarding off -- the answer is the same -- so this asserts
//! the shape, with a control that differs in one thing: an identity that also
//! counts its calls is not one, and keeps all three.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::SemanticSource;

fn prepared() -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/identity-forwarding/tsconfig.json")
        .canonicalize_utf8()
        .expect("the fixture is checked in");
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    // The options `nts hir --prepared` uses, and verified: a decided branch
    // that strands its other arm is invalid HIR, which is a finding here.
    let options = hir::Options {
        provider: hir::Provider::NoGc,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::new(hir::InterfaceAccess::Materialize)
    };
    match hir::prepare_with(&snapshot, &options) {
        Ok(prepared) => Some(prepared.program),
        Err(unprepared) => panic!("the fixture should prepare: {unprepared:?}"),
    }
}

/// The operations a function and its specialised copies (`name#whole`) still
/// hand a backend, by kind. A call names its callee, and a call from the
/// function into one of its own copies is the specialisation's dispatch, not
/// part of the loop.
fn kinds(program: &hir::Program, name: &str) -> Vec<String> {
    let copy = format!("{name}#");
    let copies: Vec<&hir::Func> = program
        .funcs
        .iter()
        .filter(|func| func.name == name || func.name.starts_with(&copy))
        .collect();
    assert!(!copies.is_empty(), "`{name}` should be compiled");
    copies
        .into_iter()
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .filter_map(|value| match &func.values[value.0 as usize].kind {
                    OpKind::Call {
                        callee: hir::Callee::Direct(callee),
                        ..
                    } if callee.starts_with(&copy) => None,
                    OpKind::Call {
                        callee: hir::Callee::Direct(callee),
                        ..
                    } => Some(format!("call {callee}")),
                    OpKind::Call { .. } => Some("call".to_owned()),
                    OpKind::TagOf { .. } => Some("tag.of".to_owned()),
                    OpKind::Unerase { .. } => Some("unerase".to_owned()),
                    OpKind::Erase { .. } => Some("erase".to_owned()),
                    _ => None,
                })
        })
        .collect()
}

#[test]
fn an_identity_call_is_its_argument_and_the_erasure_folds() {
    let Some(program) = prepared() else {
        return;
    };
    assert_eq!(
        kinds(&program, "eraseNumbers"),
        Vec::<String>::new(),
        "the kernel's loop keeps no call, erasure, tag read or unerase",
    );
    // The control: same loop, one difference -- the callee counts its calls.
    let control = kinds(&program, "eraseCounted");
    for kind in ["call counted", "tag.of", "unerase"] {
        assert!(
            control.iter().any(|have| have == kind),
            "an identity with an effect is a call, and keeps its `{kind}`: {control:?}",
        );
    }
}

#[test]
fn a_tag_the_erasure_decides_removes_the_arm_it_rules_out() {
    let Some(program) = prepared() else {
        return;
    };
    // `typeof value === "string"` on an erased number is false, and the arm
    // that read `value.length` through an unerase is reached by nothing: gone,
    // not stranded -- `prepared` verifies, and a block left behind is
    // `Invalid::Unreachable`.
    assert_eq!(kinds(&program, "decidedAway"), Vec::<String>::new());
}

/// Two callers of an `unknown` parameter, one passing a number through the
/// identity: once the call is its argument both pass a number, and the
/// parameter is a `double`. Through an identity with an effect the second
/// caller passes an erased value whose tag was chosen elsewhere, which is the
/// disagreement `shed_erasure` surveys every call site for, and it stays erased.
#[test]
fn a_caller_through_an_identity_agrees_with_one_passing_the_value() {
    let Some(program) = prepared() else {
        return;
    };
    let parameter = |name: &str| {
        program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .unwrap_or_else(|| panic!("`{name}` should be compiled"))
            .params[0]
            .ty
            .clone()
    };
    assert_eq!(parameter("kindOf"), hir::HirType::Float { bits: 64 });
    assert_eq!(parameter("kindOfCounted"), hir::HirType::Erased);
}
