//! Retain the behavioral roots, and assert that initialization precision has an
//! observable code-cost consequence: later-only readers do not load a flag.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn module_initialization_preserves_subjects_and_leaves_safe_readers_unguarded() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-binding-read-before-its-declaration/tsconfig.json")
        .canonicalize_utf8()
        .expect("the example exists");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot succeeds");
    let prepared = hir::prepare(&snapshot).expect("HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in [
        "earlyNamed",
        "foldedConstant",
        "laterOnly",
        "futureValueIsUnavailable",
        "repeatedCaller",
        "individualBindings",
        "individualPatternBindings",
        "directRead",
        "typeofRead",
        "earlyWrite",
        "ownInitializer",
        "shadowedBuiltin",
        "foldedCondition",
        "earlyClass",
        "classInnerName",
        "classOuterName",
        "staticMethodValue",
        "laterStaticMethod",
        "earlyCallableAlias",
        "foldedInitializer",
        "localLoopPattern",
        "safeVarClosure",
        "ordinaryControl",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == name && func.exported),
            "missing {name}"
        );
    }
    let flags: Vec<_> = prepared
        .program
        .globals
        .iter()
        .enumerate()
        .filter(|(_, global)| global.name.contains("#initialized"))
        .map(|(index, _)| u32::try_from(index).expect("global index fits"))
        .collect();
    assert!(!flags.is_empty(), "the early reads need readiness storage");
    for name in ["laterReader", "readFirst", "readPatternFirst"] {
        let func = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .expect("reader retained");
        assert!(func.blocks.iter().flat_map(|block| &block.ops).all(|op| {
            !matches!(func.values[op.0 as usize].kind, OpKind::GlobalGet(global) if flags.contains(&global))
        }), "a proven-safe reader must not load a readiness flag: {name}");
    }
    for name in [
        "futureValue",
        "first",
        "patternFirst",
        "InnerName",
        "varCallback",
        "laterMethodValue",
    ] {
        assert!(
            prepared
                .program
                .globals
                .iter()
                .all(|global| global.name != format!("{name}#initialized")),
            "unexpected flag for {name}"
        );
    }
}

#[test]
fn a_folded_module_initializer_retains_its_exception() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/module-initializer-tdz/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot succeeds");
    let prepared = hir::prepare(&snapshot).expect("HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let init = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "module#init")
        .expect("the folded initializer still evaluates");
    assert!(
        init.values.iter().any(|value| matches!(
            &value.kind,
            OpKind::Call { callee: Callee::External(name), .. } if name == "nts_uncaught"
        )),
        "the initializer's ReferenceError must not disappear with its folded value"
    );
    let error = prepared
        .program
        .layouts
        .iter()
        .find(|layout| layout.name == "Error")
        .expect("the Error catch representation exists");
    let reference_error = prepared
        .program
        .layouts
        .iter()
        .find(|layout| layout.name == "ReferenceError")
        .expect("the initialization check builds ReferenceError");
    assert!(
        reference_error
            .base
            .is_some_and(|base| error.types.contains(&base)),
        "a synthesized ReferenceError must carry its Error ancestry"
    );
}

#[test]
fn captured_initialization_throws_and_proven_late_readers_need_no_flag() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/captured-initialization/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot succeeds");
    let prepared = hir::prepare(&snapshot).expect("HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let program = &prepared.program;
    for name in [
        "earlyNamed",
        "earlyTypeof",
        "passedBefore",
        "earlyClass",
        "hoistedClassReader",
        "classTypeof",
        "staticClassRead",
    ] {
        let function = program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .expect("reader retained");
        assert!(function.values.iter().any(|op| matches!(
            &op.kind, OpKind::Call { callee: Callee::External(name), .. } if name == "nts_raise_take"
        )), "{name} must retain a handler edge for the synthesized throw");
    }
    assert!(
        program
            .funcs
            .iter()
            .flat_map(|func| &func.values)
            .all(|op| !matches!(op.kind, OpKind::CellReady { .. })),
        "lexical cells throw through ordinary HIR, without a backend stop"
    );
    for name in ["lateNamed", "lateArrow"] {
        let function = program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .expect("reader retained");
        let cells: Vec<_> = function
            .values
            .iter()
            .filter_map(|op| {
                if matches!(op.kind, OpKind::ObjectNew { .. })
                    && let HirType::Managed(ManagedType::Object(ty)) = op.ty
                    && let Some(layout) = program.layout(ty)
                    && layout.name.starts_with("Cell")
                {
                    Some(layout)
                } else {
                    None
                }
            })
            .collect();
        assert!(
            !cells.is_empty(),
            "{name} still captures the forward binding"
        );
        assert!(
            cells.iter().all(|layout| layout.fields.len() == 1),
            "{name}'s proven-ready cell must not carry readiness storage"
        );
    }
    let late = program
        .funcs
        .iter()
        .find(|func| func.name == "lateClass")
        .expect("class control retained");
    assert!(
        late.values
            .iter()
            .filter_map(|op| {
                if let HirType::Managed(ManagedType::Object(ty)) = op.ty {
                    program.layout(ty)
                } else {
                    None
                }
            })
            .all(|layout| !layout.name.starts_with("Cell")),
        "a proven-late class reader must carry no readiness cell"
    );
}

#[test]
fn captured_var_typeof_observes_assignment_without_loading_an_unwritten_value() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/captured-var-observations/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot succeeds");
    let prepared = hir::prepare(&snapshot).expect("HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let values: Vec<_> = prepared
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .collect();
    assert!(
        values
            .iter()
            .all(|op| !matches!(op.kind, OpKind::CellReady { .. })),
        "typeof never reads the uninitialized payload through a stop"
    );
    assert!(
        values
            .iter()
            .any(|op| matches!(&op.kind, OpKind::ConstString(text) if text == "undefined")),
        "the entry value must remain an observable typeof answer"
    );
    let assigned = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "assignedBeforeDeclaration")
        .expect("assignment control retained");
    assert_eq!(
        assigned
            .values
            .iter()
            .filter(|op| matches!(op.kind, OpKind::FieldSet { field: 1, .. }))
            .count(),
        1,
        "an assignment sets readiness, and var without an initializer does not reset it"
    );
}
