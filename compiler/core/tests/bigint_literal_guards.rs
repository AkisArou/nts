//! Safe bigint literals avoid guards and the raising convention at callers.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, Callee, OpKind, Terminator};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn snapshot() -> Option<nts_semantic_schema::SemanticSnapshot> {
    let frontend = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/bigint-literal-guards/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    Some(snapshot)
}

#[test]
fn safe_literals_avoid_guards_and_raising_copies_but_controls_keep_them() {
    let Some(snapshot) = snapshot() else {
        return;
    };
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

#[test]
fn a_discarded_unsigned_mask_drops_storage_but_keeps_its_width_throw() {
    let Some(snapshot) = snapshot() else {
        return;
    };
    let prepared = hir::prepare(&snapshot).expect("valid prepared HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    assert!(prepared.program.uncompiled.is_empty());
    let body = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "discardedMask")
        .expect("the exported mask remains");
    // DCE removes instructions from blocks without compacting the value arena.
    let live: Vec<_> = body
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|id| &body.values[id.0 as usize])
        .collect();
    assert_eq!(
        live.iter()
            .filter(|value| matches!(
                &value.kind, OpKind::Call { callee: Callee::External(name), .. }
                    if name == "nts_bigint_as_uintn"
            ))
            .count(),
        0,
        "a discarded value needs no unsigned storage"
    );
    assert_eq!(
        live.iter()
            .filter(|value| matches!(
                &value.kind, OpKind::ConstString(text)
                    if text == "Invalid value: not (convertible to) a safe integer"
            ))
            .count(),
        1,
        "the real JavaScript throw must survive"
    );
    assert!(
        body.blocks
            .iter()
            .any(|block| matches!(block.terminator, Terminator::Branch { .. })),
        "the width check still decides whether to throw"
    );
}
