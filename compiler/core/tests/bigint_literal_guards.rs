//! Safe bigint literals avoid guards and the raising convention at callers.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, Callee, OpKind, Terminator};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn safe_literals_avoid_guards_and_raising_copies_but_controls_keep_them() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/bigint-literal-guards/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    let program = lowered.program;
    assert!(program.uncompiled.is_empty(), "{:?}", program.uncompiled);
    for (names, guarded) in [
        (
            &[
                "divide",
                "remainder",
                "power",
                "zeroPower",
                "divideAssigned",
                "remainderAssigned",
                "powerAssigned",
                "hexDivisor",
                "separatedDivisor",
                "parenthesizedExponent",
                "octalAssigned",
            ][..],
            false,
        ),
        (
            &[
                "zeroDivisor",
                "zeroRemainder",
                "negativeExponent",
                "variableDivisor",
                "variableRemainder",
                "variableExponent",
                "zeroAssignedDivisor",
                "zeroAssignedRemainder",
                "negativeAssignedExponent",
            ][..],
            true,
        ),
    ] {
        for name in names {
            let body = program.funcs.iter().find(|f| f.name == *name).expect(name);
            assert!(
                body.values.iter().any(|value| match &value.kind {
                    OpKind::Binary {
                        op: BinOp::Div | BinOp::Rem,
                        ..
                    } => true,
                    OpKind::Call {
                        callee: Callee::External(helper),
                        ..
                    } => helper == "nts_bigint_pow",
                    _ => false,
                }),
                "{name}: the bigint operation must remain present"
            );
            let messages = body
                .values
                .iter()
                .filter(|value| {
                    matches!(
                        &value.kind, OpKind::ConstString(text)
                            if text == "Division by zero" || text == "undefined must be positive"
                    )
                })
                .count();
            assert_eq!(messages, usize::from(guarded), "{name}: guard count");
            assert_eq!(
                body.blocks
                    .iter()
                    .filter(|block| matches!(block.terminator, Terminator::Branch { .. }))
                    .count(),
                usize::from(guarded),
                "{name}: comparison and branch work",
            );
            assert_eq!(
                program
                    .funcs
                    .iter()
                    .filter(|f| f.name == format!("{name}@raises"))
                    .count(),
                usize::from(guarded),
                "{name}: callers need a raising entry only for a possible throw",
            );
        }
    }
}
