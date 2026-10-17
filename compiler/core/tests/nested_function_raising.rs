//! A captured function declaration dispatches as a closure, including in a try.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn captured_and_plain_nested_functions_both_reach_their_handler() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/nested-function-raising/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot succeeds");
    let prepared = hir::prepare(&snapshot).expect("HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in ["capturing", "plain"] {
        let function = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .expect("export retained");
        assert!(function.values.iter().any(|op| matches!(
            &op.kind, OpKind::Call { callee: Callee::External(name), .. } if name == "nts_raise_take"
        )), "{name} must retain its handler edge");
        if name == "capturing" {
            assert!(
                function.values.iter().any(|op| {
                    if let OpKind::Call {
                        callee: Callee::Closure { slot },
                        ..
                    } = &op.kind
                    {
                        prepared.program.layouts.iter().any(|layout| {
                            layout
                                .methods
                                .get(*slot as usize)
                                .and_then(Option::as_deref)
                                .is_some_and(|entry| entry.ends_with("@raises"))
                        })
                    } else {
                        matches!(
                            &op.kind,
                            OpKind::Call { callee: Callee::Direct(entry), .. }
                                if entry.starts_with("Closure") && entry.ends_with("@raises")
                        )
                    }
                }),
                "the captured declaration must use its raising closure entry, resolved or dispatched"
            );
        } else {
            assert!(function.values.iter().any(|op| matches!(
                &op.kind, OpKind::Call { callee: Callee::Direct(name), .. } if name.ends_with("@raises")
            )), "the parameter-only control must keep its direct raising copy");
        }
    }
}
