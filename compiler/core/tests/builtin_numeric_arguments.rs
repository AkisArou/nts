//! Primitive builtin conversion keeps the number path inline and folds an
//! exact number/erased/number round trip before any backend sees it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::SemanticSource;

fn snapshot() -> Option<nts_semantic_schema::SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/builtin-numeric-arguments/tsconfig.json");
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("the fixture typechecks");
    assert!(!snapshot.has_errors());
    Some(snapshot)
}

fn live(func: &hir::Func) -> impl Iterator<Item = &OpKind> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|id| &func.values[id.0 as usize].kind)
}

#[test]
fn an_erased_number_takes_a_branch_without_a_runtime_call() {
    let Some(snapshot) = snapshot() else { return };
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
    let Some(snapshot) = snapshot() else { return };
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
