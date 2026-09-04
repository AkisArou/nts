//! `Map#forEach` and `Set#forEach`, as the walk they are.
//!
//! The same loop `for...of` builds over a table, with the callback's body
//! inlined where the head's bindings would go. What the tests are about is that
//! it *is* that loop — no allocation, no indirect call — and that the two
//! parameters are in the order `forEach` hands them rather than the order the
//! table stores them.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
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

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/map-and-set"))
}

fn externals(func: &hir::Func) -> Vec<&str> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::External(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

/// The walk is the table cursor, not a call into the runtime to iterate.
///
/// `nts_map_next` steps it and `nts_map_key_at` / `nts_map_value_at` read it —
/// the same three the `for...of` over a table uses. A `forEach` implemented as
/// a runtime helper taking a function pointer would agree with node on every
/// case and cost a call per entry.
#[test]
fn a_table_for_each_is_the_cursor_walk() {
    let Some(lowered) = lowered("map-and-set") else {
        return;
    };
    let calls = externals(func(&lowered, "mapForEach"));
    assert!(
        calls.contains(&"nts_map_next"),
        "the cursor asks for the next live entry: {calls:?}",
    );
    assert!(
        calls.contains(&"nts_map_key_at") && calls.contains(&"nts_map_value_at"),
        "and reads a key and a value: {calls:?}",
    );
    assert!(
        !calls.iter().any(|name| name.contains("for_each")),
        "no runtime helper does the iterating: {calls:?}",
    );
}

/// A `Set`'s callback reads the key twice.
///
/// Node passes the element as both arguments — `v === k` for every entry — so
/// the second read is `nts_map_key_at` again rather than a value read a `Set`
/// has nothing to answer with.
#[test]
fn a_set_reads_its_key_for_both_parameters() {
    let Some(lowered) = lowered("map-and-set") else {
        return;
    };
    let calls = externals(func(&lowered, "setForEachSeesTheElementTwice"));
    assert!(
        !calls.contains(&"nts_map_value_at"),
        "a `Set` has no values to read: {calls:?}",
    );
    assert_eq!(
        calls.iter().filter(|name| **name == "nts_map_key_at").count(),
        2,
        "it reads the key twice, once per parameter: {calls:?}",
    );
}

/// The walk allocates nothing.
///
/// No pair is materialised for `(value, key)` — the table holds keys and values
/// in separate arrays and the callback binds two names, so building one to take
/// apart immediately would be an allocation for nothing. That is what
/// `Walk::Entries` says about `for...of` and it has to stay true here.
#[test]
fn the_walk_allocates_nothing() {
    let Some(lowered) = lowered("map-and-set") else {
        return;
    };
    let allocations = |name: &str| {
        func(&lowered, name)
            .values
            .iter()
            .filter(|op| {
                matches!(
                    op.kind,
                    OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. }
                )
            })
            .count()
    };
    // Against `empty`, which builds a table and walks nothing, so the
    // difference is the walk. Written as `0` first, which failed: these
    // functions build the map they walk, and building it is an allocation.
    let baseline = allocations("empty");
    for name in ["mapForEach", "afterADelete", "returnsEarly"] {
        assert_eq!(
            allocations(name),
            baseline,
            "`{name}` walks a table and the walk allocates nothing beyond building it",
        );
    }
}

/// The table parameter is still refused, and by count.
#[test]
fn the_table_parameter_is_refused() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    let reasons: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert!(
        reasons.iter().any(|reason| {
            reason.contains("callback taking 3 parameters") && reason.contains("the value and the key")
        }),
        "the refusal names what a table callback may take: {reasons:?}",
    );
}

/// The single parameter is bound to the **value**, not the key.
///
/// `forEach` hands `(value, key)` and the table stores `[key, value]`, so the
/// binding is a swap and swapping it back is invisible to every other test
/// here: `mapForEach` computes `value * key`, and one multiply reading both
/// looks the same either way. Only the differential caught the mutation.
///
/// `mapForEachValueOnly` is the shape that can tell. It binds one name and adds
/// it, so exactly one of the two reads feeds the addition — and which one it is
/// *is* the parameter order.
#[test]
fn the_first_parameter_is_the_value() {
    let Some(lowered) = lowered("map-and-set") else {
        return;
    };
    let function = func(&lowered, "mapForEachValueOnly");

    let read = |helper: &str| -> Vec<u32> {
        function
            .values
            .iter()
            .enumerate()
            .filter(|(_, op)| {
                matches!(
                    &op.kind,
                    OpKind::Call { callee: Callee::External(name), .. } if name == helper
                )
            })
            .map(|(at, _)| u32::try_from(at).unwrap_or(u32::MAX))
            .collect()
    };
    let values = read("nts_map_value_at");
    let keys = read("nts_map_key_at");
    assert!(!values.is_empty() && !keys.is_empty(), "both are read");

    // The addition the body performs, and which read reaches it. A read is
    // unerased before use where the element type is concrete, so the operand
    // may be the `Unerase` of the call rather than the call.
    let source_of = |value: u32| -> u32 {
        match function.values[value as usize].kind {
            OpKind::Unerase { value: inner } => inner.0,
            _ => value,
        }
    };
    let mut checked = 0;
    for op in &function.values {
        let OpKind::Binary {
            op: hir::BinOp::Add,
            lhs,
            rhs,
        } = &op.kind
        else {
            continue;
        };
        let operands = [source_of(lhs.0), source_of(rhs.0)];
        if !operands.iter().any(|at| values.contains(at) || keys.contains(at)) {
            continue;
        }
        checked += 1;
        assert!(
            operands.iter().any(|at| values.contains(at)),
            "the bound name is the value read",
        );
        assert!(
            !operands.iter().any(|at| keys.contains(at)),
            "and not the key read",
        );
    }
    assert!(checked > 0, "the body adds the bound name");
}
