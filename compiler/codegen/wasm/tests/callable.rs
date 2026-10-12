//! A value of a function type is stored as the callable root, which holds
//! only the uniform entries: a typed call through one is refused by name.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, block, function, program, value};
use nts_core::hir::{Callee, ClassId, Func, HirType, Layout, ManagedType, OpKind, Terminator};

const SIGNATURE: u32 = 50;

fn object() -> HirType {
    HirType::Managed(ManagedType::Object(ClassId(SIGNATURE)))
}
fn declaration(name: &str, params: &[HirType], result: HirType) -> Func {
    let mut all = vec![object()];
    all.extend_from_slice(params);
    let mut f = function(name, &all, result);
    f.exported = false;
    f.abstract_declaration = true;
    f.blocks.push(block(&[], &[], Terminator::Unreachable));
    f
}

#[test]
fn a_typed_call_through_a_function_type_is_refused_by_name() {
    let mut run = function("run", &[object()], F64);
    run.exported = false;
    let receiver = value(&mut run, OpKind::Param(0), object());
    let one = value(&mut run, OpKind::ConstFloat(1.0), F64);
    let called = value(
        &mut run,
        OpKind::Call {
            callee: Callee::Closure { slot: 1 },
            args: vec![receiver, one],
            frame: None,
        },
        F64,
    );
    run.blocks.push(block(
        &[],
        &[receiver, one, called],
        Terminator::Return(Some(called)),
    ));
    let mut entry = function("entry", &[], F64);
    let none = value(&mut entry, OpKind::ConstNull, object());
    let result = value(
        &mut entry,
        OpKind::Call {
            callee: Callee::Direct("run".into()),
            args: vec![none],
            frame: None,
        },
        F64,
    );
    entry.blocks.push(block(
        &[],
        &[none, result],
        Terminator::Return(Some(result)),
    ));
    let mut p = program(vec![
        declaration("Signature#erased", &[HirType::Erased], HirType::Erased),
        declaration("Signature#typed", &[F64], F64),
        run,
        entry,
    ]);
    p.public_api.retain(|(name, _)| name == "entry");
    p.erased_call_slot = Some(0);
    p.layouts.push(Layout {
        types: vec![ClassId(SIGNATURE)],
        name: "Signature".into(),
        fields: vec![],
        methods: vec![
            Some("Signature#erased".into()),
            Some("Signature#typed".into()),
        ],
        interfaces: vec![],
        base: None,
    });
    let error = nts_codegen_wasm::emit(&p)
        .map(|_| ())
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("a typed call to slot 1 through the function type `Signature`"),
        "{error}"
    );
}
