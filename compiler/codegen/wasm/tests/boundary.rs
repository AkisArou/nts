//! Preserve logical scalar types and the assumptions behind specialization.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::{F64, I32, block, function, program, value};
use nts_core::hir::{Callee, HirType, OpKind, ParamShape, Terminator};

fn identity(name: &str, ty: &HirType) -> nts_core::hir::Func {
    let mut f = function(name, std::slice::from_ref(ty), ty.clone());
    let arg = value(&mut f, OpKind::Param(0), ty.clone());
    f.blocks
        .push(block(&[], &[arg], Terminator::Return(Some(arg))));
    f
}

#[test]
fn logical_types_facts_and_aliases_are_guarded_before_wasm_calls() {
    let mut funcs = vec![
        identity("boolean", &HirType::Bool),
        identity("f32", &HirType::Float { bits: 32 }),
        identity("f64", &F64),
    ];
    for bits in [8, 16, 32, 64] {
        for signed in [true, false] {
            funcs.push(identity(
                &format!("{}{}", if signed { "i" } else { "u" }, bits),
                &HirType::Int { bits, signed },
            ));
        }
    }
    let mut known = identity("known", &I32);
    known.params[0].known = nts_core::hir::facts::Facts::new(1.0, 3.0, true, false, false);
    funcs.push(known);
    let mut infinity = identity("infinityOnly", &F64);
    infinity.params[0].known =
        nts_core::hir::facts::Facts::new(f64::INFINITY, f64::INFINITY, true, false, false);
    funcs.push(infinity);
    let mut void = function("returnsUndefined", &[], HirType::Void);
    let undefined = value(&mut void, OpKind::ConstUndefined, HirType::Void);
    void.blocks
        .push(block(&[], &[undefined], Terminator::Return(None)));
    funcs.push(void);
    let mut large = function(
        "tooLarge",
        &[],
        HirType::Int {
            bits: 64,
            signed: false,
        },
    );
    let literal = value(
        &mut large,
        OpKind::ConstInt(i128::from(u64::MAX)),
        HirType::Int {
            bits: 64,
            signed: false,
        },
    );
    large
        .blocks
        .push(block(&[], &[literal], Terminator::Return(Some(literal))));
    funcs.push(large);
    let mut p = program(funcs);
    p.public_api
        .iter_mut()
        .find(|(name, _)| name == "f64")
        .unwrap()
        .1 = "renamed".to_owned();
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    println!(
        "{}",
        common::run("boundary", &emitted, "tooling/wasm/check-boundary.mjs", &[])
    );
}

#[test]
fn publication_uses_public_api_and_declines_public_default_parameters() {
    let mut private = identity("internal", &I32);
    private.params[0].shape = ParamShape::Defaulted;
    let mut public = function("public", &[I32], I32);
    let arg = value(&mut public, OpKind::Param(0), I32);
    let call = value(
        &mut public,
        OpKind::Call {
            callee: Callee::Direct("internal".to_owned()),
            args: vec![arg],
            frame: None,
        },
        I32,
    );
    public
        .blocks
        .push(block(&[], &[arg, call], Terminator::Return(Some(call))));
    let mut p = program(vec![private, public]);
    p.public_api = vec![("public".to_owned(), "published".to_owned())];
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert_eq!(emitted.manifest.exports.len(), 1);
    assert_eq!(emitted.manifest.exports[0].name, "published");
    p.public_api
        .push(("internal".to_owned(), "defaulted".to_owned()));
    let error = nts_codegen_wasm::emit(&p).unwrap_err();
    assert!(error.to_string().contains("NTS5001"));
    assert!(error.to_string().contains("defaulted"));
}
