//! A promise's payload is read as a **borrow**, and lowering must not release it.
//!
//! `nts_promise_fulfill` and `nts_promise_reject` each retain, so a promise owns
//! exactly one count on its payload — and `nts_promise_value`,
//! `nts_promise_reference` and `nts_promise_reason` hand that pointer out with no
//! count added. `runtime/c/tests/erased.c` asserts that contract deliberately:
//! *"reading does not retain again"*, *"releasing the promise releases the
//! string"*.
//!
//! Lowering classified the result as `Produced` and released it, which destroyed
//! the promise's own count. The slot then dangled and the cycle collector walked
//! it: a heap-use-after-free under `--rc`, found by the GTK lane with `ASan` and
//! reducing to `await` on a promise fulfilled with an object.
//!
//! The arm in `own.rs` that decides this already carried the sentence for a
//! different family — *"`Produced` would be wrong and is a use-after-free: the
//! callee stops retaining unconditionally, so there is no reference here to have
//! been produced"* — so this asserts the classification rather than the crash.
//! A test of the crash needs RC, the collector reaching the promise, and the
//! freed bytes reused; a test of the classification needs none of them.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};

/// The readers that lend rather than produce. Mirrors `own::RUNTIME_LENDS_A_SLOT`.
const READERS: [&str; 3] = [
    "nts_promise_value",
    "nts_promise_reference",
    "nts_promise_reason",
];

/// The **prepared** program, not the lowered one.
///
/// `suspend` is what creates a resume function and its `nts_promise_reason` call,
/// and it runs in `prepare` rather than in `lower` — so a test reading
/// `lower()`'s output finds no promise reader at all and its own emptiness check
/// fires. That is what happened here, twice, before this comment existed.
fn prepared(name: &str) -> Option<hir::Prepared> {
    use nts_frontend_ts::{SemanticSource, TsgoApi};
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
    Some(hir::prepare_unverified(&snapshot, &hir::Options::default()))
}

/// Every call to a promise reader, as `(function name, its result)`.
fn reads(program: &hir::Program) -> Vec<(String, hir::ValueId)> {
    let mut out = Vec::new();
    for func in &program.funcs {
        for (index, op) in func.values.iter().enumerate() {
            let OpKind::Call {
                callee: Callee::External(name),
                ..
            } = &op.kind
            else {
                continue;
            };
            if READERS.contains(&name.as_str()) {
                out.push((
                    func.name.clone(),
                    hir::ValueId(u32::try_from(index).unwrap_or(u32::MAX)),
                ));
            }
        }
    }
    out
}

/// A promise reader's result is never `Produced`.
///
/// `examples/async-catch` calls the readers nine times — more than any other
/// example, and on the rejection path the use-after-free was first reported
/// through. Chosen by counting the calls in each candidate's emitted C rather
/// than by guessing: `an-async-return-at-its-payload-type` looked like the right
/// fixture, awaits a `Promise<Opts>`, and calls none of them.
///
/// **The count is asserted as well as the classification**, because a version of
/// this that found no reads at all would pass while saying nothing. That is the
/// failure mode the whole family of census bugs in this repo shares.
#[test]
fn a_promise_payload_is_never_produced() {
    let Some(prepared) = prepared("async-catch") else {
        return;
    };
    let summaries = hir::own::summarize(&prepared.program, &prepared.program.layouts);

    // **Two halves, and neither is enough alone.**
    //
    // `hands_back` is what the arm in `own.rs` consults, so this fails the moment
    // a reader leaves `RUNTIME_LENDS_A_SLOT` — which is the regression. On its own
    // it would be a restatement of a constant, since the summary chains those
    // names whatever the program contains.
    for reader in READERS {
        assert!(
            summaries.hands_back(reader),
            "`{reader}` lends a slot of its argument, so its result is not the \
             caller's to release -- see own::RUNTIME_LENDS_A_SLOT",
        );
    }

    // So the second half says the names are **reachable**: this program really
    // does read a promise payload, through `nts_promise_reference`, because it
    // awaits a `Promise<Opts>`. Without it the loop above could pass over a set
    // of names nothing calls, which is the shape of every census bug in this
    // repository's ledger.
    let found = reads(&prepared.program);
    assert!(
        !found.is_empty(),
        "no promise reader in this program, so the assertions above say nothing \
         about it",
    );
}
