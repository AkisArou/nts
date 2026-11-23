//! A table key read and then written shares one lookup (`hir::entries`).
//!
//! `tests/programs/a-table-key-updated-in-place` compares every shape with
//! node, which the plain calls answer as well, so which shapes pair is asserted
//! here: the update idioms do, one read feeds a write on either arm, and a call
//! between, another key or another table does not. A program prepared for a
//! host's heap keeps the plain calls unless its backend's tables answer an
//! entry (`PreparationOptions::table_entries`), resolved from the backend.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, Memory, OpKind, Options};
use nts_frontend_ts::Frontend;

const PROGRAM: &str = "a-table-key-updated-in-place";

fn prepared(provider: Memory) -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(PROGRAM)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{PROGRAM} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = Options {
        provider,
        ..Options::new(
            if provider == Memory::HostGc {
                hir::backend::Backend::Jvm
            } else {
                hir::backend::Backend::C
            },
            nts_core::hir::EntryUnwind::Terminal,
        )
    };
    hir::prepare_with(&snapshot, &options)
        .expect("prepared HIR verifies")
        .program
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
    let program = prepared(Memory::NoGc);
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
    let program = prepared(Memory::NoGc);
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

/// JVM preparation keeps plain table calls. Exercise the sharing pass directly
/// as the control, without inventing a preparation capability no backend owns.
#[test]
fn a_host_heap_shares_only_where_its_backend_says_so() {
    let plain = prepared(Memory::HostGc);
    let mut shared = plain.clone();
    hir::entries::share(&mut shared, true);
    let native = prepared(Memory::NoGc);
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
