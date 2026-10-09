//! Binding extraction may precede later incoming arguments. Every consumer
//! must retain the actual definitions and their unchanged positional ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn pattern_parameters_keep_narrowing_guards_and_ownership_on_actual_inputs() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-pattern-parameter-before-scalars/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let result = hir::prepare(&snapshot).expect("valid parameter ABI");
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    let program = result.program;
    let combine = program
        .funcs
        .iter()
        .find(|func| func.name == "combine")
        .expect("actual helper");
    let parameters = combine
        .complete_parameter_values()
        .expect("complete positional definitions");
    assert_eq!(
        parameters,
        vec![hir::ValueId(0), hir::ValueId(3), hir::ValueId(4)]
    );
    assert!(
        matches!(combine.values[1].kind, OpKind::ConstFloat(_)),
        "the binding index is not an argument"
    );
    for func in &program.funcs {
        if func.abstract_declaration {
            continue;
        }
        for (param, value) in func.params.iter().zip(
            func.complete_parameter_values()
                .expect("complete actual ABI"),
        ) {
            assert_eq!(
                param.ty,
                func.value(value).ty,
                "{} parameter definition",
                func.name
            );
        }
    }
    let mut wrong = program.clone();
    let target = wrong
        .funcs
        .iter_mut()
        .find(|func| func.name == "combine")
        .unwrap();
    target.values[parameters[1].0 as usize].ty = hir::HirType::Bool;
    let errors = hir::verify::verify(&wrong)
        .expect_err("a wrong actual input type must be caught before rendering");
    assert!(errors.iter().any(|error| matches!(
        error,
        hir::verify::Invalid::ParameterType { position: 1, .. }
    )));
}
