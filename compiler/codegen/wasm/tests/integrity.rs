//! Unsupported behavior stays a named decline; corruption stays an integrity error.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, block, function, program, value};
use nts_codegen_wasm::EmitError;
use nts_core::hir::{BinOp, Callee, HirType, OpKind, ParamShape, Program, Terminator};

#[test]
fn a_counting_marker_after_host_gc_preparation_declines_at_its_origin() {
    let ty = HirType::Managed(nts_core::hir::ManagedType::String);
    let mut f = function("countingMismatch", std::slice::from_ref(&ty), HirType::Void);
    let arg = value(&mut f, OpKind::Param(0), ty);
    let retained = value(&mut f, OpKind::Retain(arg), HirType::Void);
    f.blocks
        .push(block(&[], &[arg, retained], Terminator::Return(None)));
    let EmitError::Declined(diagnostics) = nts_codegen_wasm::emit(&program(vec![f])).unwrap_err()
    else {
        panic!("expected provider decline")
    };
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "NTS2001");
    assert!(diagnostics[0].message.contains("countingMismatch"));
    assert!(diagnostics[0].message.contains("Retain"));
    assert_eq!(diagnostics[0].primary, common::hir::origin().location);
}

#[test]
fn external_runtime_calls_decline_by_name_with_source_origin() {
    let mut f = function("unsupportedMath", &[F64], F64);
    let arg = value(&mut f, OpKind::Param(0), F64);
    let call = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External("nts_math_cos".to_owned()),
            args: vec![arg],
            frame: None,
        },
        F64,
    );
    f.blocks
        .push(block(&[], &[arg, call], Terminator::Return(Some(call))));
    let EmitError::Declined(diagnostics) = nts_codegen_wasm::emit(&program(vec![f])).unwrap_err()
    else {
        panic!("expected classified decline")
    };
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "NTS5001");
    assert!(diagnostics[0].message.contains("unsupportedMath"));
    assert!(diagnostics[0].message.contains("nts_math_cos"));
    assert_eq!(diagnostics[0].primary, common::hir::origin().location);
}

#[test]
fn a_missing_direct_callee_is_an_integrity_failure() {
    let mut f = function("caller", &[], HirType::Void);
    let call = value(
        &mut f,
        OpKind::Call {
            callee: Callee::Direct("missing".to_owned()),
            args: vec![],
            frame: None,
        },
        HirType::Void,
    );
    f.blocks.push(block(&[], &[call], Terminator::Return(None)));
    assert!(matches!(
        nts_codegen_wasm::emit(&program(vec![f])),
        Err(EmitError::InvalidHir(_))
    ));
}

#[test]
fn every_unsupported_public_shape_is_named_even_without_function_origin() {
    let mut p = Program {
        public_api: vec![("missing".to_owned(), "published".to_owned())],
        uncompiled: vec![(
            "published".to_owned(),
            "declared callback is unavailable".to_owned(),
        )],
        ..Program::default()
    };
    let error = nts_codegen_wasm::emit(&p).unwrap_err();
    assert!(matches!(error, EmitError::UnsupportedSurface { .. }));
    assert!(error.to_string().contains("NTS5001"));
    assert!(error.to_string().contains("published"));
    assert!(error.to_string().contains("declared callback"));
    p.public_api.clear();
    p.public_namespaces.push(("namespace".to_owned(), vec![]));
    assert!(
        nts_codegen_wasm::emit(&p)
            .unwrap_err()
            .to_string()
            .contains("namespace")
    );
}

#[test]
fn optional_public_parameters_decline_without_filling_them_with_zero() {
    let mut f = function("optional", &[F64], F64);
    f.params[0].shape = ParamShape::Optional;
    let arg = value(&mut f, OpKind::Param(0), F64);
    f.blocks
        .push(block(&[], &[arg], Terminator::Return(Some(arg))));
    assert!(matches!(
        nts_codegen_wasm::emit(&program(vec![f])),
        Err(EmitError::Declined(_))
    ));
}

#[test]
fn a_shared_i32_slot_does_not_make_boolean_equal_to_number() {
    let mut f = function(
        "mixedEquality",
        &[HirType::Bool, common::hir::I32],
        HirType::Bool,
    );
    let lhs = value(&mut f, OpKind::Param(0), HirType::Bool);
    let rhs = value(&mut f, OpKind::Param(1), common::hir::I32);
    let out = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs,
            rhs,
        },
        HirType::Bool,
    );
    f.blocks
        .push(block(&[], &[lhs, rhs, out], Terminator::Return(Some(out))));
    let error = nts_codegen_wasm::emit(&program(vec![f])).unwrap_err();
    let EmitError::InvalidHir(problems) = error else {
        panic!("expected invalid mixed HIR")
    };
    assert!(problems.iter().any(|p| matches!(
        p,
        nts_core::hir::verify::Invalid::MixedOperands {
            left: HirType::Bool,
            right: HirType::Int { .. },
            ..
        }
    )));
}

#[test]
fn validator_rejects_bad_stack_types_and_unapproved_features() {
    use wasm_encoder::{
        CodeSection, ExportKind, ExportSection, Function, FunctionSection, Instruction as I,
        Module, TypeSection, ValType,
    };
    let mut types = TypeSection::new();
    types.ty().function([], [ValType::I32]);
    let mut functions = FunctionSection::new();
    functions.function(0);
    let mut exports = ExportSection::new();
    exports.export("bad", ExportKind::Func, 0);
    let mut body = Function::new([]);
    body.instruction(&I::F64Const(1.0.into()));
    body.instruction(&I::End);
    let mut code = CodeSection::new();
    code.function(&body);
    let mut module = Module::new();
    module.section(&types);
    module.section(&functions);
    module.section(&exports);
    module.section(&code);
    assert!(matches!(
        nts_codegen_wasm::validate(&module.finish()),
        Err(EmitError::InvalidWasm(_))
    ));
    // GC is part of M1b. Linear-memory memory64 remains outside its feature set.
    let mut memory = wasm_encoder::MemorySection::new();
    memory.memory(wasm_encoder::MemoryType {
        minimum: 0,
        maximum: None,
        memory64: true,
        shared: false,
        page_size_log2: None,
    });
    let mut module = Module::new();
    module.section(&memory);
    assert!(matches!(
        nts_codegen_wasm::validate(&module.finish()),
        Err(EmitError::InvalidWasm(_))
    ));
}
