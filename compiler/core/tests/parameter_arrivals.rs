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
