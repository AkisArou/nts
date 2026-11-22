//! An `await` of a call that settled inside it (`hir::settled`).
//!
//! `tests/programs/an-await-of-a-call-that-settled-in-it` checks the ordering
//! against node; this checks which awaits take the path at all. A callee that
//! suspends, rejects or adopts keeps its promise, and so does a promise the
//! program holds and awaits twice -- each the control beside a case that does
//! not.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, OpKind};
use nts_frontend_ts::Frontend;

const FIXTURE: &str = "an-await-of-a-call-that-settled-in-it";

/// The program as `lower` and `hir::suspend` leave it.
fn machine() -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(FIXTURE)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{FIXTURE} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let mut lowered = hir::lower::lower(&snapshot);
    assert!(
        lowered.diagnostics.is_empty(),
        "nothing in the fixture is refused: {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>()
    );
    let refusals = hir::suspend::transform(&mut lowered.program);
    assert!(refusals.is_empty(), "and nothing is refused by the split");
    lowered.program
}

fn func<'a>(program: &'a hir::Program, name: &str) -> Option<&'a hir::Func> {
    program.funcs.iter().find(|func| func.name == name)
}

/// The callees a resumption calls, and whether it queues itself without a
/// promise anywhere.
fn resumption(program: &hir::Program, export: &str) -> (Vec<String>, bool) {
    let resume = func(program, &format!("{export}__resume"))
        .unwrap_or_else(|| panic!("`{export}` suspends"));
    let mut called = Vec::new();
    let mut in_hand = false;
    for block in &resume.blocks {
        for value in &block.ops {
            match &resume.value(*value).kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } => called.push(name.clone()),
                OpKind::Suspend { promise: None, .. } => in_hand = true,
                _ => {}
            }
        }
    }
    (called, in_hand)
}

#[test]
fn a_callee_that_settles_inside_the_call_answers_its_payload() {
    let program = machine();
    for (callee, payload) in [
        ("settled", HirType::Float { bits: 64 }),
        ("flagged", HirType::Bool),
        ("noted", HirType::Void),
    ] {
        let variant = func(&program, &format!("{callee}@settled"))
            .unwrap_or_else(|| panic!("`{callee}` settles inside the call"));
        assert_eq!(variant.return_type, payload, "`{callee}`'s payload");
        assert!(variant.async_result.is_none());
        let placed: Vec<_> = variant
            .blocks
            .iter()
            .flat_map(|block| block.ops.iter())
            .filter(|value| {
                matches!(&variant.value(**value).kind, OpKind::Call { callee: Callee::External(name), .. }
                    if name.starts_with("nts_promise_"))
            })
            .collect();
        assert!(placed.is_empty(), "`{callee}@settled` makes no promise");
    }
    assert!(
        func(&program, "named@settled").is_some(),
        "a string is never a thenable"
    );
}

#[test]
fn a_callee_that_suspends_rejects_or_adopts_keeps_its_promise() {
    let program = machine();
    for callee in ["suspending", "throwing", "adopting"] {
        assert!(
            func(&program, &format!("{callee}@settled")).is_none(),
            "`{callee}` cannot settle inside the call"
        );
    }
}

#[test]
fn an_await_of_a_settled_call_queues_its_own_resumption() {
    let program = machine();
    for export in [
        "settledOrdering",
        "settledInATry",
        "otherPayloads",
        "summed",
    ] {
        let (called, in_hand) = resumption(&program, export);
        assert!(in_hand, "`{export}` awaits a value in hand");
        assert!(
            called.iter().any(|name| name.ends_with("@settled")),
            "`{export}` calls a settled variant: {called:?}"
        );
    }
    for export in [
        "suspendingOrdering",
        "throwingOrdering",
        "adoptingOrdering",
        "awaitedTwice",
    ] {
        let (called, in_hand) = resumption(&program, export);
        assert!(!in_hand, "`{export}` awaits a promise");
        assert!(
            !called.iter().any(|name| name.ends_with("@settled")),
            "`{export}` keeps the callee's promise: {called:?}"
        );
    }
}
