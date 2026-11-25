//! A table write borrows the key it is handed (#902). The runtime's write
//! stores only into its table (`runtime::WRITES_ONLY_ITS_TABLE`), so a key read
//! out of a slot needs no count across it; a key whose slot is overwritten
//! before the write still takes one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BlockId, Callee, Func, OpKind, Terminator, ValueId};
use nts_frontend_ts::Frontend;

/// The position of the key among a table write's arguments.
fn key_position(name: &str) -> Option<usize> {
    match name {
        "nts_map_set" | "nts_set_add" | "nts_map_delete" => Some(1),
        "nts_map_entry_set" => Some(2),
        _ => None,
    }
}

/// The keys `func` hands a table write.
fn written_keys(func: &Func) -> Vec<ValueId> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } => key_position(name).and_then(|at| args.get(at).copied()),
            _ => None,
        })
        .collect()
}

/// How many retains `func` takes of a key it hands a table write.
fn retained_keys(func: &Func) -> usize {
    let keys = written_keys(func);
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(
            |id| matches!(func.value(**id).kind, OpKind::Retain(value) if keys.contains(&value)),
        )
        .count()
}

/// How many calls of `helper` `func` makes.
fn calls(func: &Func, helper: &str) -> usize {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|id| {
            matches!(&func.value(**id).kind,
                OpKind::Call { callee: Callee::External(name), .. } if name == helper)
        })
        .count()
}

fn prepared(config: &str) -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(config)
        .canonicalize_utf8()
        .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            ..hir::Options::new(hir::backend::Backend::C, hir::EntryUnwind::Terminal)
        },
    )
    .unwrap();
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    prepared
}

fn find<'p>(prepared: &'p hir::Prepared, name: &str) -> &'p Func {
    prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("{name} must remain a compiled function"))
}

#[test]
fn a_table_write_borrows_a_key_whose_slot_nothing_overwrites() {
    let prepared = prepared("../../tests/programs/a-table-write-borrows-its-key/tsconfig.json");
    // The update idiom, fused into one lookup, and the plain writes beside it.
    let updates = find(&prepared, "updates");
    assert_eq!(
        calls(updates, "nts_map_entry_set"),
        1,
        "the update shares its lookup"
    );
    // Each of these took one retain and one release of its key per write
    // before a table write was known to write only its table.
    for name in [
        "updates",
        "countAll",
        "aSetGivesUpTheHolder",
        "theKeyIsInTheHolderTheWriteFrees",
    ] {
        let func = find(&prepared, name);
        assert_eq!(retained_keys(func), 0, "{name} borrows every key it writes");
    }
    // The controls: the key's slot is overwritten between its read and the
    // write -- by a store, by a call, and by a call that writes the same table
    // through a wider alias -- or it is read out of a global array a store may
    // replace, so the key takes a count of its own. And a key
    // the loop makes, which the frame owns rather than borrows: its erasure is
    // carried across the update's join with a count of its own, a different
    // shape from a borrowed key.
    for (name, retains) in [
        ("sourceOverwritten", 1),
        ("sourceOverwrittenByACall", 1),
        ("fromUnsettled", 1),
        // Both retains come from the `widen` call, which may overwrite the
        // key's slot; this arm is not a counterfactual for the `unknown` alias.
        ("widenedAliases", 2),
        ("entriesOf", 1),
    ] {
        assert_eq!(
            retained_keys(find(&prepared, name)),
            retains,
            "{name} must keep the key's retain"
        );
    }
}

/// Whether every path from `block` to a return releases the holder.
fn every_return_releases(
    func: &Func,
    block: BlockId,
    releases: &dyn Fn(&[ValueId]) -> bool,
    seen: &mut Vec<BlockId>,
) -> bool {
    if seen.contains(&block) {
        return true;
    }
    seen.push(block);
    let body = &func.blocks[block.0 as usize];
    if releases(&body.ops) {
        return true;
    }
    if matches!(body.terminator, Terminator::Return(_)) {
        return false;
    }
    body.terminator
        .successors()
        .into_iter()
        .all(|next| every_return_releases(func, next, releases, seen))
}

/// Whether the holder read out of a table (`unerase(nts_map_get(..))`) is
/// given up after `helper`, never before it: nothing releases it in the
/// write's block ahead of the write, and every path from the write to a
/// return releases it, in the write's block after the write or in a block
/// that path reaches.
fn holder_outlives(func: &Func, helper: &str) -> bool {
    let holder = |value: ValueId| {
        matches!(func.value(value).kind, OpKind::Unerase { value: read, .. }
            if matches!(&func.value(read).kind,
                OpKind::Call { callee: Callee::External(name), .. } if name == "nts_map_get"))
    };
    let releases = |ops: &[ValueId]| {
        ops.iter()
            .any(|id| matches!(func.value(*id).kind, OpKind::Release(value) if holder(value)))
    };
    let writes: Vec<(usize, usize)> = func
        .blocks
        .iter()
        .enumerate()
        .flat_map(|(block, body)| {
            body.ops.iter().enumerate().filter_map(move |(at, id)| {
                matches!(&func.value(*id).kind,
                    OpKind::Call { callee: Callee::External(name), .. } if name == helper)
                .then_some((block, at))
            })
        })
        .collect();
    !writes.is_empty()
        && writes.iter().all(|&(block, at)| {
            let body = &func.blocks[block];
            if releases(&body.ops[..at]) {
                return false;
            }
            if releases(&body.ops[at + 1..]) {
                return true;
            }
            if matches!(body.terminator, Terminator::Return(_)) {
                return false;
            }
            let mut seen = Vec::new();
            body.terminator
                .successors()
                .into_iter()
                .all(|next| every_return_releases(func, next, &releases, &mut seen))
        })
}

/// A write that gives up a holder whose element is still read: the holder the
/// frame read out of the table keeps its own count until that element's last
/// read, so the element's borrow stands on it rather than on the table.
#[test]
fn a_write_that_frees_a_holder_leaves_the_frames_count_of_it_until_its_element_is_read() {
    let prepared = prepared("../../tests/programs/a-table-write-borrows-its-key/tsconfig.json");
    for (name, helper) in [
        ("aDeleteFreesTheHolder", "nts_map_delete"),
        ("aClearFreesTheHolder", "nts_map_clear"),
        ("theKeyIsInTheHolderTheWriteFrees", "nts_map_set"),
    ] {
        assert!(
            holder_outlives(find(&prepared, name), helper),
            "{name}'s holder must be given up after `{helper}`, not before"
        );
    }
}

/// Where the program counts a foreign handle, a release inside a table write
/// can run foreign code, so the update's key keeps its retain and release.
#[test]
fn a_table_write_in_a_program_counting_a_foreign_handle_keeps_the_keys_count() {
    let prepared = prepared(
        "tests/programs/a-table-write-in-a-program-counting-a-foreign-handle/tsconfig.json",
    );
    let updates = find(&prepared, "updates");
    assert_eq!(
        calls(updates, "nts_map_entry_set"),
        1,
        "the update shares its lookup"
    );
    assert_eq!(
        retained_keys(updates),
        1,
        "a foreign release may overwrite the key's slot"
    );
}
