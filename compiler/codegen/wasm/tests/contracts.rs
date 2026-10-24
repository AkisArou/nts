//! Illegal typed projections and nullable receivers decline before engine traps.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{Absent, Callee, Func, HirType, ManagedType, OpKind, Terminator};

fn cast(name: &str, source: HirType, target: HirType, helper: Option<&str>) -> Func {
    let mut f = function(name, std::slice::from_ref(&source), target.clone());
    let input = value(&mut f, OpKind::Param(0), source);
    let erased = value(
        &mut f,
        OpKind::Erase {
            value: input,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let operation = helper.map_or(OpKind::unerase(erased), |name| OpKind::Call {
        callee: Callee::External(name.into()),
        args: vec![erased],
        frame: None,
    });
    let result = value(&mut f, operation, target);
    f.blocks.push(block(
        &[],
        &[input, erased, result],
        Terminator::Return(Some(result)),
    ));
    f
}
fn receiver(name: &str, undefined: bool, helper: Option<&str>) -> Func {
    let string = HirType::Managed(ManagedType::String);
    let mut f = function(
        name,
        &[],
        if helper.is_some() {
            string.clone()
        } else {
            U32
        },
    );
    let input = value(
        &mut f,
        if undefined {
            OpKind::ConstUndefined
        } else {
            OpKind::ConstNull
        },
        string,
    );
    let mut ops = vec![input];
    let operation = if let Some(helper) = helper {
        let index = value(&mut f, OpKind::ConstFloat(0.0), F64);
        ops.push(index);
        OpKind::Call {
            callee: Callee::External(helper.into()),
            args: vec![input, index],
            frame: None,
        }
    } else {
        OpKind::Length(input)
    };
    let result_type = f.return_type.clone();
    let result = value(&mut f, operation, result_type);
    ops.push(result);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(result))));
    f
}
#[test]
fn invalid_typed_contracts_are_named_refusals_not_traps_or_source_throws() {
    let string = HirType::Managed(ManagedType::String);
    let funcs = vec![
        cast("numberFromString", string.clone(), F64, None),
        cast("booleanFromNumber", F64, HirType::Bool, None),
        cast("stringFromBoolean", HirType::Bool, string, None),
        cast(
            "numberHelperFromBoolean",
            HirType::Bool,
            F64,
            Some("nts_value_number"),
        ),
        cast(
            "booleanHelperFromNumber",
            F64,
            HirType::Bool,
            Some("nts_value_boolean"),
        ),
        receiver("nullLength", false, None),
        receiver("undefinedLength", true, None),
        receiver("nullCharAt", false, Some("nts_str_char_at")),
    ];
    // Unchecked string reads require HIR's integral/in-range proof, so an
    // arbitrary f64 parameter cannot exercise a valid typed contract here.
    // string_units.rs covers proof-bearing reads, false bounds and checked
    // source inputs (including fractional and nonfinite indices) separately.
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let report = common::run(
        "contracts",
        &emitted,
        "tooling/wasm/check-contracts.mjs",
        &[],
    );
    assert_eq!(report["named_declines"], 8);
    assert_eq!(report["raw_traps"], 0);
}
