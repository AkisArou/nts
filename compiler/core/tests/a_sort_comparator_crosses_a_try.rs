//! Which **entry** a `sort` comparator is called at, which is the fact the answers
//! rest on and the one that can expire without an answer changing.
//!
//! `lower_sort_with` used to build the comparator's call itself, with the comparator's
//! *written* arguments, while `closure_callee` had already chosen the callee. Where the
//! receiver's static type **is** the closure class and the call is not a raising one,
//! that choice is a `Callee::Direct` naming the written `Closure{n}#call`, and written
//! arguments are right; a raising call goes through the uniform slot, where they are
//! not. So an unguarded sort was correct and a guarded one called through an entry of
//! the wrong ABI: **a sort did not order** -- 5 where node answers 1, with the JVM
//! refusing the copy outright (NTS4001).
//!
//! So the differential is not enough on its own: it compares answers, and the unguarded
//! arm gave the right one for a reason the guarded arm did not share. What is asserted
//! here is *which callee each one gets*.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

const EXAMPLE: &str = "a-throwing-sort-comparator-inside-a-try";

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(EXAMPLE)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{EXAMPLE} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// How a function's closure calls are made, in order: a slot it dispatches at, or the
/// name it calls directly.
#[derive(Debug, PartialEq, Eq)]
enum Reached {
    Slot(u32),
    Name(String),
}

fn closure_calls_in(lowered: &hir::lower::Lowered, name: &str) -> Vec<Reached> {
    lowered
        .program
        .funcs
        .iter()
        .filter(|func| func.name == name)
        .flat_map(|func| &func.values)
        .filter_map(|op| match &op.kind {
            hir::OpKind::Call {
                callee: hir::Callee::Closure { slot },
                ..
            } => Some(Reached::Slot(*slot)),
            hir::OpKind::Call {
                callee: hir::Callee::Direct(called),
                ..
            } if called.starts_with("Closure") => Some(Reached::Name(called.clone())),
            _ => None,
        })
        .collect()
}

/// A guarded sort dispatches at the **raising** uniform entry; an unguarded one calls
/// the written `Closure{n}#call` by name.
///
/// Both directions, because an assertion that only says "the guarded one is raising"
/// passes on a compiler that sends *every* comparator through a slot -- which would be
/// correct and slower, and would quietly undo the direct call `closure_callee` gives a
/// known class. That direct call is lowering's own, not a later pass's: nothing
/// rewrites these sites afterwards, which the JVM lane confirmed by reading the
/// prepared HIR.
#[test]
fn a_guarded_comparator_dispatches_at_the_raising_entry() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP: tsgo is not built");
        return;
    };
    let raising = lowered
        .program
        .raising_call_slot
        .expect("this program has closures, so it has the raising entry");
    let ordinary = lowered
        .program
        .erased_call_slot
        .expect("and the ordinary uniform entry the raising one is built beside");
    assert_ne!(raising, ordinary, "two slots, or there is nothing to assert");

    // `throughAMethod` holds no sort of its own: the sort is in `Jar#smallest`, so the
    // guarded dispatch is in that method's **raising copy** and the ordinary one in the
    // method itself. Naming both is what says the copy is where the raising slot is
    // chosen, rather than the choice leaking into every copy of the body.
    for guarded in [
        "directlyAroundTheSort",
        "withAQuietComparator",
        "Jar#smallest@raises",
    ] {
        assert_eq!(
            closure_calls_in(&lowered, guarded),
            vec![Reached::Slot(raising)],
            "{guarded} should dispatch its comparator once, at the raising entry"
        );
    }
    for unguarded in ["outsideATry", "Jar#smallest"] {
        let calls = closure_calls_in(&lowered, unguarded);
        assert!(
            matches!(calls.as_slice(), [Reached::Name(_)]),
            "{unguarded} should call the written entry by name, not through a slot: {calls:?}"
        );
    }
}
