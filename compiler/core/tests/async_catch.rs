//! `try { await p } catch { … }`.
//!
//! A rejected `await` inside a `try` has to reach that `try`'s handler. It went
//! to one shared exit that rejects the function's own promise, because until
//! `try`/`catch` existed that was the whole of what a rejection could do — so
//! `try { await failing() } catch { return -99 }` compiled, ran, and rejected.
//! A wrong answer, refused by name, at 89 occurrences across 17 sites.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// Every `await` in one function, with the handler its rejection reaches.
fn awaits(lowered: &hir::lower::Lowered, name: &str) -> Vec<Option<hir::Rejection>> {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/async-catch"))
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Await { rejects_to, .. } => Some(rejects_to.clone()),
            _ => None,
        })
        .collect()
}

/// An `await` inside a `try` with a `catch` records where its rejection goes.
///
/// Recorded at the lowering because that is the only place that knows:
/// exceptions here are fully lowered — a handler is a block and a `throw` is a
/// jump — so by the time `suspend` runs there is no `try` left to find.
#[test]
fn an_await_inside_a_try_records_its_handler() {
    let Some(lowered) = lowered("async-catch") else {
        return;
    };
    for name in ["caught", "boundReason", "bothEdges", "nested"] {
        let found = awaits(&lowered, name);
        assert!(!found.is_empty(), "`{name}` awaits something");
        assert!(
            found.iter().all(Option::is_some),
            "every `await` in `{name}` is inside its `try`: {found:?}",
        );
    }

    // Two awaits, two edges, and they are the *same* handler — one `try`.
    let two = awaits(&lowered, "twoAwaits");
    assert_eq!(two.len(), 2, "two awaits: {two:?}");
    let handlers: Vec<_> = two.iter().flatten().map(|it| it.handler).collect();
    assert_eq!(
        handlers.len(),
        2,
        "both record a handler rather than one: {two:?}",
    );
    assert_eq!(handlers[0], handlers[1], "and it is the same `try`");
}

/// An `await` with nothing to catch it records nothing.
///
/// The pair matters: recording a handler for every `await` would satisfy the
/// test above and send every rejection into a block that does not enclose it.
/// `failing` is an ordinary `async` function with no `try` in it at all.
#[test]
fn an_await_with_no_handler_records_none() {
    let Some(lowered) = lowered("async") else {
        return;
    };
    let uncaught: Vec<&hir::Func> = lowered
        .program
        .funcs
        .iter()
        .filter(|func| {
            func.values
                .iter()
                .any(|op| matches!(op.kind, OpKind::Await { .. }))
        })
        .collect();
    assert!(
        !uncaught.is_empty(),
        "examples/async awaits without catching",
    );
    for func in uncaught {
        for op in &func.values {
            if let OpKind::Await { rejects_to, .. } = &op.kind {
                assert!(
                    rejects_to.is_none(),
                    "`{}` has no `try`, so its rejection is the function's own: {rejects_to:?}",
                    func.name,
                );
            }
        }
    }
}

/// The rejection carries exactly what the handler's parameters want.
///
/// The handler's parameters are the thrown value followed by one per name the
/// edges into it disagreed about — and a rejection is one of those edges. Left
/// out of that computation, `bothEdges` gave the rejection path whatever the
/// `throw` path had left in `mark`.
#[test]
fn a_rejection_carries_the_handlers_parameters() {
    let Some(lowered) = lowered("async-catch") else {
        return;
    };
    let func = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == "bothEdges")
        .expect("exported from examples/async-catch");
    let rejection = func
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Await { rejects_to, .. } => rejects_to.clone(),
            _ => None,
        })
        .expect("its `await` is inside the `try`");

    let handler = &func.blocks[rejection.handler.0 as usize];
    assert_eq!(
        rejection.args.len(),
        handler.params.len(),
        "one argument per parameter",
    );
    // Two: the thrown value, and `mark`, which the `throw` and the rejection
    // disagree about. A handler computed from the `throw` alone has one.
    assert_eq!(
        handler.params.len(),
        2,
        "the reason, and the local the two edges disagree about",
    );
    assert_eq!(rejection.reason_at, 0, "the reason is pushed first");
}
