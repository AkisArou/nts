//! A `Date` is a millisecond offset from the epoch, and nothing else.
//!
//! The specification calls its contents a *time value* and defines every
//! accessor as arithmetic on it, so the object is a header and a double. That
//! is why `ManagedType::Date` carries nothing: unlike `Promise` and `Map` there
//! is not even a payload representation to decide.
//!
//! What it was worth: **55 refusal sites in `runtime/node`, all of them one
//! property** — `fs.Stats.atime`, and its three siblings, each `new Date(ms)`
//! over a number the platform supplies.
//!
//! Three of the tests here are about refusals, because three separate things
//! are refused for three separate reasons and each would be a different kind of
//! wrong if it were not.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind};
use nts_frontend_ts::SemanticSource;

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn externals(lowered: &hir::lower::Lowered) -> Vec<&str> {
    lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| func.values.iter())
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::External(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

/// A date has a representation of its own, and it is not an object layout.
///
/// The distinction matters: an object with a provided layout would have a field
/// nothing may read, which is the argument `ManagedType::Promise` already makes
/// and the reason this is a managed type rather than a class.
#[test]
fn a_date_is_its_own_representation() {
    let Some(lowered) = lowered("dates") else {
        return;
    };
    assert_eq!(lowered.diagnostics, [], "nothing in the fixture is refused");
    assert!(
        lowered
            .program
            .funcs
            .iter()
            .flat_map(|func| func.values.iter())
            .any(|op| matches!(op.ty, HirType::Managed(ManagedType::Date))),
        "`new Date(ms)` produces a value of date type"
    );
    // And a field holding one, which is what `fs.Stats` is.
    assert!(
        lowered
            .program
            .layouts
            .iter()
            .any(|layout| layout
                .fields
                .iter()
                .any(|field| matches!(field.ty, HirType::Managed(ManagedType::Date)))),
        "a class may hold a date in a field"
    );
}

/// `getTime` and `valueOf` are one operation under two names.
///
/// Not two helpers: the specification defines `valueOf` as returning the time
/// value and `getTime` as returning the time value, and emitting two runtime
/// entry points for one answer is two chances to make them disagree.
#[test]
fn get_time_and_value_of_are_one_operation() {
    let Some(lowered) = lowered("dates") else {
        return;
    };
    let calls = externals(&lowered);
    assert!(
        calls.contains(&"nts_date_new"),
        "construction goes through the runtime, in {calls:?}"
    );
    assert!(
        calls.contains(&"nts_date_value"),
        "and so does reading the time value, in {calls:?}"
    );
    assert!(
        !calls.iter().any(|name| name.contains("value_of")
            || name.contains("get_time")),
        "and there is exactly one entry point for it, in {calls:?}"
    );
}

/// Three refusals, three reasons, and none of them is "not implemented".
///
/// - `toISOString` throws a `RangeError` on an invalid date, which a runtime
///   helper here cannot do — and the differential scores node's throw as a case
///   *not reached*, so answering with a string would diverge where the oracle
///   is blind.
/// - The `getFullYear` family reads a **local** calendar, which needs a
///   timezone database and would make one program answer differently on two
///   machines.
/// - `Date.now()` and `new Date()` read a wall clock this runtime has no
///   capability for, and which no differential could check if it had one.
#[test]
fn what_is_refused_and_why() {
    let Some(lowered) = lowered("dates-unsupported") else {
        return;
    };
    let said: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|d| d.message.as_str())
        .collect();
    assert_eq!(
        said.len(),
        6,
        "every export of the fixture is refused, in {said:?}"
    );
    for (needle, why) in [
        ("toISOString", "the differential cannot see"),
        ("getFullYear", "local"),
        ("getHours", "timezone database"),
        ("getTimezoneOffset", "two machines"),
        ("Date.now", "no definition here"),
        ("new Date` with no argument", "no differential could check"),
    ] {
        let found = said
            .iter()
            .find(|message| message.contains(needle))
            .unwrap_or_else(|| panic!("`{needle}` is refused, in {said:?}"));
        assert!(
            found.contains(why),
            "and says why -- `{why}` is missing from `{found}`"
        );
    }
    assert!(
        lowered.program.funcs.is_empty(),
        "and nothing was emitted for any of them"
    );
}
