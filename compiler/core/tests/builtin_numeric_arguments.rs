//! Primitive builtin conversion keeps the number path inline and folds an
//! exact number/erased/number round trip before any backend sees it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind, UnOp};

fn snapshot() -> nts_semantic_schema::SemanticSnapshot {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/builtin-numeric-arguments/tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the fixture typechecks");
    assert!(!snapshot.has_errors());
    snapshot
}

fn live(func: &hir::Func) -> impl Iterator<Item = &OpKind> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|id| &func.values[id.0 as usize].kind)
}

#[test]
fn an_erased_number_takes_a_branch_without_a_runtime_call() {
    let snapshot = snapshot();
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    let func = lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name == "erasedFast")
        .unwrap();
    assert!(
        func.entry()
            .ops
            .iter()
            .any(|id| matches!(func.value(*id).kind, OpKind::TagOf { .. }))
    );
    let hir::Terminator::Branch { then_target, .. } = func.entry().terminator else {
        panic!("the number tag selects the fast branch");
    };
    let fast = &func.blocks[then_target.0 as usize];
    assert!(
        fast.ops
            .iter()
            .any(|id| matches!(func.value(*id).kind, OpKind::Unerase { .. }))
    );
    assert!(
        !fast
            .ops
            .iter()
            .any(|id| matches!(func.value(*id).kind, OpKind::Call { .. }))
    );
}

#[test]
fn a_static_number_round_trip_reaches_no_backend() {
    let snapshot = snapshot();
    let options = hir::Options {
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    let prepared = hir::prepare_with(&snapshot, &options).expect("valid prepared HIR");
    for name in ["nativeNumber", "numericRoundTrip"] {
        let copies: Vec<_> = prepared
            .program
            .funcs
            .iter()
            .filter(|f| f.name == name || f.name.starts_with(&format!("{name}#")))
            .collect();
        assert!(!copies.is_empty(), "{name} must still be emitted");
        for func in copies {
            for op in live(func) {
                assert!(
                    !matches!(
                        op,
                        OpKind::TagOf { .. } | OpKind::Erase { .. } | OpKind::Unerase { .. }
                    ),
                    "{} retained {op:?}",
                    func.name
                );
                assert!(
                    !matches!(op, OpKind::Call { callee: hir::Callee::External(name), .. }
                    if name == "nts_value_to_number"),
                    "{} retained ToNumber",
                    func.name
                );
            }
        }
    }
}

#[test]
fn constant_digits_reach_the_formatter_without_a_conversion_merge() {
    let snapshot = snapshot();
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    for (name, expected) in [
        ("fixedThree", 3.0_f64),
        ("fixedNegativeFraction", 0.0),
        ("fixedPositiveFraction", 100.0),
        ("fixedZero", 0.0),
        ("fixedNegativeZero", 0.0),
        ("fixedNan", 0.0),
        ("fixedInfinity", f64::INFINITY),
        ("fixedNegativeInfinity", f64::NEG_INFINITY),
    ] {
        let func = lowered
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .unwrap();
        let digits = live(func)
            .find_map(|op| match op {
                OpKind::Call {
                    callee: hir::Callee::External(name),
                    args,
                    ..
                } if name == "nts_number_to_fixed" => Some(args[1]),
                _ => None,
            })
            .expect("the raw lowering includes the formatter after its bounds check");
        let OpKind::ConstFloat(actual) = func.value(digits).kind else {
            panic!("{name}: a constant digit count must not need a conversion merge");
        };
        assert_eq!(actual.to_bits(), expected.to_bits(), "{name}");
        assert!(
            !live(func).any(|op| matches!(
                op,
                OpKind::Unary {
                    op: UnOp::Trunc | UnOp::Abs,
                    ..
                }
            )),
            "{name}"
        );
    }
    let dynamic = lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name == "fixedDynamic")
        .unwrap();
    assert!(live(dynamic).any(|op| matches!(
        op,
        OpKind::Unary {
            op: UnOp::Trunc,
            ..
        }
    )));
    assert!(live(dynamic).any(|op| matches!(op, OpKind::Unary { op: UnOp::Abs, .. })));
}
