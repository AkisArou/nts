//! `nts_refused` and `nts_assertion_failed`: a path the lowering could decide
//! only when a value arrived ends in the host's named input refusal, with the
//! reason the lowering gave, and never an answer.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, block, function, program, value};
use nts_core::hir::{Callee, Func, HirType, ManagedType, OpKind, Terminator};

/// `name(n)`: refuse through `helper` for `why` when `n` is positive, else
/// answer `n`.
fn refusing(name: &str, helper: &str, why: &str) -> Func {
    let mut f = function(name, &[F64], F64);
    let n = value(&mut f, OpKind::Param(0), F64);
    let zero = value(&mut f, OpKind::ConstFloat(0.0), F64);
    let positive = value(
        &mut f,
        OpKind::Binary {
            op: nts_core::hir::BinOp::Gt,
            lhs: n,
            rhs: zero,
        },
        HirType::Bool,
    );
    let reason = value(
        &mut f,
        OpKind::ConstString(why.into()),
        HirType::Managed(ManagedType::String),
    );
    let call = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External(helper.into()),
            args: vec![reason],
            frame: None,
        },
        HirType::Void,
    );
    f.blocks.push(block(
        &[],
        &[n, zero, positive],
        Terminator::Branch {
            cond: positive,
            then_target: nts_core::hir::BlockId(1),
            then_args: vec![],
            else_target: nts_core::hir::BlockId(2),
            else_args: vec![],
        },
    ));
    f.blocks
        .push(block(&[], &[reason, call], Terminator::Return(Some(n))));
    f.blocks.push(block(&[], &[], Terminator::Return(Some(n))));
    f
}

#[test]
fn a_run_time_refusal_is_named_and_never_answers() {
    let funcs = vec![
        refusing("refused", "nts_refused", "a thenable no job can call"),
        refusing(
            "assertionFailed",
            "nts_assertion_failed",
            "an input outside the asserted representation",
        ),
    ];
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let output = common::run(
        "run-time-refusals",
        &emitted,
        "tooling/wasm/check-run-time-refusals.mjs",
        &[],
    );
    assert_eq!(output["cases"], 6, "{output}");
}
