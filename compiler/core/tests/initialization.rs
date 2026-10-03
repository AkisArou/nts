//! Retain the behavioral roots, and assert that initialization precision has an
//! observable code-cost consequence: later-only readers do not load a flag.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn module_initialization_preserves_subjects_and_leaves_safe_readers_unguarded() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-binding-read-before-its-declaration/tsconfig.json")
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
