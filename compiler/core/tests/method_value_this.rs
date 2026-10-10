//! A method taken as a value takes the call's `this` where its body reads one.
//!
//! The implementation that runs is the object's it was read from, and a call
//! dispatches only on the receiver it passes (`FuncBuilder::method_receiver`).
//! So the two receivers are different code, and a program that agrees with
//! node cannot show the second: where a subclass overrides the method, a `this`
//! other than the read object stops by name, where node runs the read object's
//! implementation on it. What is asserted here is that each wrapper holds the
//! test its case needs.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/method-value-this/tsconfig.json")
        .canonicalize_utf8()
        .expect("the method-value-this program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// The body taking the call's `this` of the method value that calls `method`.
fn wrapper_calling<'a>(program: &'a hir::Program, method: &str) -> &'a hir::Func {
    program
        .funcs
        .iter()
        .filter(|func| func.name.ends_with("#call_this"))
        .find(|func| {
            func.values.iter().any(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } => name == method,
                OpKind::Call {
                    callee: Callee::Virtual { declared, .. },
                    ..
                } => declared == method,
                _ => false,
            })
        })
        .unwrap_or_else(|| panic!("a method value calling `{method}` takes its `this`"))
}

fn stops_by_name(func: &hir::Func) -> bool {
    func.values.iter().any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. } if name == "nts_refused")
    })
}

#[test]
fn a_method_value_proves_the_this_its_call_passes() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP method_value_this: tsgo is not built");
        return;
    };
    let program = &lowered.program;

    // Not overridden: the call's `this` is proven a `Plain` and passed.
    let plain = wrapper_calling(program, "Plain#get");
    assert!(
        plain
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::InstanceOf { .. })),
        "`Plain#get` through a value tests its `this`"
    );
    assert!(stops_by_name(plain), "and stops where it is not a `Plain`");

    // Overridden: the call's `this` must be the object it was read from.
    let base = wrapper_calling(program, "Base#area");
    assert!(
        base.values
            .iter()
            .any(|op| matches!(op.kind, OpKind::Binary { op: BinOp::Eq, .. })),
        "`Base#area` through a value compares its `this` with the object read"
    );
    assert!(stops_by_name(base), "and stops where they differ");
    assert!(
        !base
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::InstanceOf { .. })),
        "and dispatches on the object read, so it does not test the class"
    );
}
