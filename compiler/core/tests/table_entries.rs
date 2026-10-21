//! A table key read and then written shares one lookup (`hir::entries`).
//!
//! `tests/programs/a-table-key-updated-in-place` compares every shape with
//! node, which the plain calls answer as well, so which shapes pair is asserted
//! here: the update idioms do, one read feeds a write on either arm, and a call
//! between, another key or another table does not. A program prepared for a
//! host's heap keeps the plain calls unless its backend's tables answer an
//! entry (`Options::table_entries`): the JVM's do not, Wasm's do.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind, Options, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

const PROGRAM: &str = "a-table-key-updated-in-place";

fn prepared(provider: Provider) -> Option<hir::Program> {
    prepared_with(provider, None)
}

fn prepared_with(provider: Provider, table_entries: Option<bool>) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(PROGRAM)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{PROGRAM} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = Options {
        provider,
        table_entries,
        ..Options::default()
    };
    Some(
        hir::prepare_with(&snapshot, &options)
            .expect("prepared HIR verifies")
            .program,
    )
}

/// How many calls to `helper` the function `name` makes.
fn calls(program: &hir::Program, name: &str, helper: &str) -> usize {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from tests/programs/{PROGRAM}"));
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|op| {
            matches!(
                &func.values[op.0 as usize].kind,
                OpKind::Call { callee: Callee::External(called), .. } if called == helper
            )
        })
        .count()
}

#[test]
fn a_read_then_a_write_of_one_key_shares_the_lookup() {
    let Some(program) = prepared(Provider::NoGc) else {
        return;
    };
    // (function, entries, writes through one)
    for (name, entries, sets) in [
        ("recordCounts", 1, 1),
        ("mapCounts", 1, 1),
        // Two updates, each its own pair: the first write stands between the
        // first read and the second write.
        ("negativeZeroKey", 2, 2),
        // One read, a write on each arm.
        ("eitherArm", 1, 2),
        ("deleteBetweenUpdates", 1, 1),
    ] {
        assert_eq!(
            calls(&program, name, hir::entries::ENTRY),
            entries,
            "entries in `{name}`"
        );
        assert_eq!(
            calls(&program, name, hir::entries::ENTRY_GET),
            entries,
            "reads through an entry in `{name}`"
        );
        assert_eq!(
            calls(&program, name, hir::entries::ENTRY_SET),
            sets,
            "writes through an entry in `{name}`"
        );
    }
}

#[test]
fn a_write_that_might_not_be_the_read_keeps_its_own_lookup() {
    let Some(program) = prepared(Provider::NoGc) else {
        return;
    };
    for name in ["callBetween", "anotherKey", "anotherTable"] {
        assert_eq!(
            calls(&program, name, hir::entries::ENTRY),
            0,
            "`{name}` paired a read with a write it cannot prove is the same table and key"
        );
        assert!(
            calls(&program, name, "nts_map_set") > 0,
            "`{name}` still writes"
        );
    }
}

/// A host's heap answers no entry unless its backend says its tables do: the
/// JVM keeps the plain calls, and every optimization it makes of them, with
/// the flag unset -- the default does not inherit native's answer -- and Wasm,
/// which sets it, shares exactly the lookups native preparation shares.
#[test]
fn a_host_heap_shares_only_where_its_backend_says_so() {
    let Some(plain) = prepared(Provider::HostGc) else {
        return;
    };
    let Some(shared) = prepared_with(Provider::HostGc, Some(true)) else {
        return;
    };
    let Some(native) = prepared(Provider::NoGc) else {
        return;
    };
    for name in ["recordCounts", "mapCounts", "eitherArm"] {
        assert_eq!(calls(&plain, name, hir::entries::ENTRY), 0, "`{name}`");
        assert!(calls(&plain, name, "nts_map_set") > 0, "`{name}`");
    }
    for name in [
        "recordCounts",
        "mapCounts",
        "negativeZeroKey",
        "eitherArm",
        "deleteBetweenUpdates",
    ] {
        for helper in [
            hir::entries::ENTRY,
            hir::entries::ENTRY_GET,
            hir::entries::ENTRY_SET,
        ] {
            assert_eq!(
                calls(&shared, name, helper),
                calls(&native, name, helper),
                "`{helper}` in `{name}`"
            );
        }
    }
}
