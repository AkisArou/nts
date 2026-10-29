//! Declaration contracts are metadata until callers or checks prove them.

use camino::Utf8Path;
use nts_core::hir::{self, OpKind, Terminator};
use nts_frontend_ts::Frontend;

#[test]
fn exported_literal_claims_are_unknown_but_actual_literal_callers_still_fold() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-declared-value-is-not-an-arrival-proof/tsconfig.json")
        .canonicalize_utf8()
        .expect("arrival fixture is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture arrival fixture");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let raw = hir::lower::lower(&snapshot).program;
    assert!(raw.uncompiled.is_empty(), "{:?}", raw.uncompiled);
    let analyses = hir::interprocedural::analyze_program(&raw, hir::reachable::Roots::EveryExport);
    for name in ["claimed", "unionClaim", "enumClaim"] {
        let at = raw
            .funcs
            .iter()
            .position(|func| func.name == name)
            .expect("declared numeric export survives raw lowering");
        let function = &raw.funcs[at];
        let parameter =
            function.parameter_values().expect("ordinary parameters")[0].expect("value parameter");
        assert_ne!(
            function.params[0].known,
            hir::facts::Facts::TOP,
            "{name} has a contract"
        );
        assert_eq!(
            analyses[at].get(parameter),
            hir::facts::Facts::TOP,
            "{name}: unchecked arrival"
        );
    }
    let prepared = hir::prepare(&snapshot).expect("prepare arrival fixture");
    let function = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "proved")
        .expect("the private callee has only the actual literal caller");
    assert!(
        function.blocks.iter().any(|block| {
            let Terminator::Return(Some(value)) = block.terminator else {
                return false;
            };
        matches!(function.value(value).kind, OpKind::ConstFloat(value) if value.to_bits() == 65.0_f64.to_bits())
                || matches!(function.value(value).kind, OpKind::ConstInt(65))
        }),
        "the actual literal call must still fold: {function:?}"
    );
}

#[test]
fn literal_union_indices_need_actual_arrival_proofs() {
    for (fixture, checked) in [
        ("outcomes/a-literal-union-index-is-not-a-bounds-proof", true),
        (
            "outcomes/a-local-array-index-trusted-from-a-literal-union",
            true,
        ),
        (
            "programs/a-local-array-index-proved-by-literal-callers",
            false,
        ),
    ] {
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../tests/{fixture}/tsconfig.json"))
            .canonicalize_utf8()
            .expect("bounds arrival fixture is checked in");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("capture bounds arrival fixture");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = hir::prepare(&snapshot).expect("prepare bounds arrival fixture");
        assert_eq!(prepared.program.uncompiled, []);
        let pick = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == "pick")
            .expect("the indexed callee survives preparation");
        let checks: Vec<_> = pick
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .filter_map(|value| match pick.value(*value).kind {
                OpKind::ArrayGet { checked, .. } => Some(checked),
                _ => None,
            })
            .collect();
        assert_eq!(checks, [checked], "{fixture}: {pick:?}");
        if checked {
            assert_eq!(
                pick.params[0].ty,
                hir::HirType::NUMBER,
                "an unchecked arrival must not truncate fractional indices: {fixture}"
            );
        }
    }
}

#[test]
fn typed_local_literal_assertions_are_not_value_proofs() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-typed-literal-assertion-keeps-its-value/tsconfig.json")
        .canonicalize_utf8()
        .expect("typed assertion fixture is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture typed literal assertions");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let raw = hir::lower::lower(&snapshot).program;
    assert_eq!(raw.uncompiled, []);
    let analyses = hir::interprocedural::analyze_program(&raw, hir::reachable::Roots::EveryExport);
    for name in [
        "numberClaim",
        "unionClaim",
        "enumClaim",
        "fieldClaim",
        "globalClaim",
        "stringLengthClaim",
    ] {
        let index = raw
            .funcs
            .iter()
            .position(|func| func.name == name)
            .expect("the typed local assertion remains exported");
        let func = &raw.funcs[index];
        let mut returns = 0;
        for block in &func.blocks {
            if let Terminator::Return(Some(value)) = block.terminator {
                let facts = analyses[index].get(value);
                if name == "stringLengthClaim" {
                    assert!(
                        !facts.is_singleton(),
                        "a string literal claim must not prove its length: {facts:?}"
                    );
                } else {
                    assert_eq!(
                        facts,
                        hir::facts::Facts::TOP,
                        "{name}: a typed claim must not seed the returned value"
                    );
                }
                returns += 1;
            }
        }
        assert_eq!(returns, 1);
    }
    let prepared = hir::prepare(&snapshot).expect("prepare typed literal assertions");
    for func in &prepared.program.funcs {
        for block in &func.blocks {
            if let Terminator::Return(Some(value)) = block.terminator {
                assert!(
                    !matches!(
                        func.value(value).kind,
                        OpKind::ConstInt(_) | OpKind::ConstFloat(_) | OpKind::ConstString(_)
                    ),
                    "a literal claim must not replace the value: {func:?}"
                );
            }
        }
    }
}
