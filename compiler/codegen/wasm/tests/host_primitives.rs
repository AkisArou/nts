//! Captured non-raising host primitives retain number and string semantics.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, block, function, program, value};
use nts_core::hir::{Callee, Func, HirType, ManagedType, OpKind, Terminator};

fn wrapper(name: &str, params: &[HirType], result: HirType) -> Func {
    let mut f = function(name, params, result.clone());
    let mut args = params
        .iter()
        .enumerate()
        .map(|(at, ty)| {
            value(
                &mut f,
                OpKind::Param(u32::try_from(at).unwrap()),
                ty.clone(),
            )
        })
        .collect::<Vec<_>>();
    let call = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External(name.into()),
            args: args.clone(),
            frame: None,
        },
        result,
    );
    args.push(call);
    f.blocks
        .push(block(&[], &args, Terminator::Return(Some(call))));
    f
}

#[test]
fn captured_math_formatting_and_parsing_agree_and_ignore_later_global_mutation() {
    let mut funcs = Vec::new();
    for name in [
        "acos", "asin", "atan", "cbrt", "cos", "cosh", "exp", "expm1", "fround", "log", "log10",
        "log1p", "log2", "sign", "sin", "sinh", "tan", "tanh",
    ] {
        funcs.push(wrapper(&format!("nts_math_{name}"), &[F64], F64));
    }
    for name in ["atan2", "hypot", "imul", "pow"] {
        funcs.push(wrapper(&format!("nts_math_{name}"), &[F64, F64], F64));
    }
    let string = HirType::Managed(ManagedType::String);
    funcs.push(wrapper("nts_number_to_string", &[F64], string.clone()));
    funcs.push(wrapper(
        "nts_parse_float",
        std::slice::from_ref(&string),
        F64,
    ));
    funcs.push(wrapper("nts_parse_int", &[string, F64], F64));
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    assert_eq!(emitted.manifest.imports.len(), 25);
    assert!(emitted.manifest.builtins.is_empty() && emitted.manifest.features.is_empty());
    let report = common::run(
        "host-primitives",
        &emitted,
        "tooling/wasm/check-host-primitives.mjs",
        &[],
    );
    assert!(report["cases"].as_u64().unwrap() > 1000);
}
