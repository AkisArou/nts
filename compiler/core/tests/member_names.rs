//! Where a member's name comes from, and where the line is drawn.
//!
//! Runs the frontend, so it skips only when `tsgo` is not built.
//!
//! A name is resolved in two places that have to agree: the function a member
//! is *emitted* as, and the table a call site *finds* it through. An earlier
//! attempt fixed one and not the other, which produced a method the emitter
//! named and no call site could reach — it compiled, and returned garbage. So
//! these check both ends: that the function exists under the expected name, and
//! that a call from outside the class lands on it.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, OpKind, lower::Lowered};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lower_at(relative: &str) -> Option<Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    Some(hir::lower::lower(&snapshot))
}

fn named<'a>(lowered: &'a Lowered, name: &str) -> Option<&'a hir::Func> {
    lowered.program.funcs.iter().find(|f| f.name == name)
}

fn calls(func: &hir::Func) -> Vec<&str> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

fn messages(lowered: &Lowered) -> Vec<&str> {
    lowered
        .diagnostics
        .iter()
        .map(|d| d.message.as_str())
        .collect()
}

/// `plain`, `"quoted"` and `["bracketed"]` are three spellings of one thing.
#[test]
fn every_literal_spelling_names_the_same_kind_of_member() {
    let Some(lowered) = lower_at("tests/programs/computed-names") else {
        return;
    };
    for member in ["plain", "quoted", "bracketed", "get getter", "set size"] {
        assert!(
            named(&lowered, &format!("Holder#{member}")).is_some(),
            "no function for `{member}`; lowered {:?}",
            lowered
                .program
                .funcs
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
        );
    }
}

/// A name the program computes stays refused.
///
/// The whole reason a literal is safe is that it is not this: `[kTag]` and
/// `["kTag"]` are different members, and resolving the first by the identifier's
/// text would put them in one slot.
#[test]
fn a_name_the_program_computes_is_still_refused() {
    let Some(lowered) = lower_at("tests/programs/computed-names") else {
        return;
    };
    assert!(named(&lowered, "Holder#kTag").is_none(), "`[kTag]` is not a name");
    assert!(
        messages(&lowered)
            .iter()
            .any(|m| m.contains("a member whose name the program computes")),
        "expected the computed-name refusal, got {:?}",
        messages(&lowered),
    );
}

/// A setter produces nothing, whatever its name.
///
/// It was reading its own name as a return annotation: `set ["size"](n: number)`
/// came out returning `f64`, so the body fell off the end of a function that
/// owed a value and the emitter rendered that as `__builtin_unreachable()` —
/// a store, then a licence for the C compiler to compute anything at all in the
/// caller. The caller's answer was wrong by a constant and nothing crashed.
#[test]
fn a_setter_returns_nothing() {
    let Some(lowered) = lower_at("tests/programs/computed-names") else {
        return;
    };
    let setter = named(&lowered, "Holder#set size").expect("the setter lowers");
    assert_eq!(setter.return_type, HirType::Void);
}

/// `o.x` and `o["x"]` reach one member, and `o[0]()` is a call and not an index.
#[test]
fn brackets_at_the_use_site_reach_the_same_member() {
    let Some(lowered) = lower_at("../../examples/computed-members") else {
        return;
    };
    assert!(
        lowered.diagnostics.is_empty(),
        "examples/computed-members should lower clean: {:?}",
        messages(&lowered),
    );
    let accessors = named(&lowered, "accessors").expect("`accessors` lowers");
    assert!(
        calls(accessors).contains(&"Registry#0"),
        "`registry[0]()` should call the member named `0`, found {:?}",
        calls(accessors),
    );
}
