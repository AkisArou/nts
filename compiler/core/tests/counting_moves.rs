//! Where reference counting hands a reference on, or borrows one, instead of
//! copying it, read off `tests/memory` cases as the counting operations each
//! function keeps.
//!
//! The memory step measures the same programs at run time, but it is a wide
//! step and runs only in the full run, so a regression there surfaces days
//! after the landing that caused it. These are the same facts, static, in the
//! core gate.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::Frontend;

fn counted(case: &str) -> hir::Prepared {
    counted_at("memory", case)
}

/// [`counted`] for a case in another corpus under `tests/`.
fn counted_at(corpus: &str, case: &str) -> hir::Prepared {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests")
        .join(corpus)
        .join(case)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/{corpus}/{case} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            ..hir::Options::default()
        },
    )
    .expect("prepared HIR should verify")
}

/// The retains and releases left in the function named `name`, none if it is
/// gone.
fn counting_in(prepared: &hir::Prepared, name: &str) -> usize {
    prepared
        .program
        .funcs
        .iter()
        .filter(|func| func.name == name)
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| block.ops.iter())
                .map(|value| &func.values[value.0 as usize].kind)
        })
        .filter(|kind| matches!(kind, OpKind::Retain(_) | OpKind::Release(_)))
        .count()
}

/// A block parameter is forwarded only for an object scalarize then takes
/// apart. `chain`'s `Link` escapes through `tail.next = made`, and forwarded
/// anyway, it was used across the loop's join where its parameter used to
/// carry it, with a retain before the join and a release after it every
/// iteration: 33 counting operations at run time became 97.
#[test]
fn a_forwarding_that_takes_nothing_apart_is_not_made() {
    let prepared = counted("borrowed-call");
    assert_eq!(counting_in(&prepared, "chain"), 0);
}

/// An erasure of a reference that dies at it takes the reference: each
/// element stored into a tuple of unlike references, an array of erased
/// values, paid a retain of the erased value and a release of the original,
/// 40 operations at run time for an ideal of 20.
#[test]
fn an_erasure_of_a_dying_reference_is_a_move() {
    let prepared = counted("tuple-cycle");
    assert_eq!(counting_in(&prepared, "Node#constructor"), 0);
    // What is left is the store over `pair`, giving back the tuple it held,
    // and `n` erased into the new one while `link`'s caller still holds it.
    assert_eq!(counting_in(&prepared, "link"), 2);
}

/// The retains of a field loaded from the function's own receiver, `this`:
/// what a borrow out of a parameter's field saves.
fn retained_receiver_fields(prepared: &hir::Prepared, name: &str) -> usize {
    prepared
        .program
        .funcs
        .iter()
        .filter(|func| func.name == name)
        .map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| block.ops.iter())
                .filter(|value| {
                    let OpKind::Retain(retained) = func.values[value.0 as usize].kind else {
                        return false;
                    };
                    let OpKind::FieldGet { object, .. } = func.values[retained.0 as usize].kind
                    else {
                        return false;
                    };
                    matches!(func.values[object.0 as usize].kind, OpKind::Param(0))
                })
                .count()
        })
        .sum()
}

/// A field read behind a non-null assertion borrows, as `awfy-queens` reads
/// its boards. The null side's message helper runs no program code and writes
/// no field, and operations no block holds never run, so neither ends the
/// borrow: each read paid a retain and a release before (266 counting
/// operations at run time in `tests/memory/a-field-behind-an-assertion`, 2 now).
#[test]
fn a_field_behind_an_assertion_is_borrowed() {
    let prepared = counted("a-field-behind-an-assertion");
    assert_eq!(retained_receiver_fields(&prepared, "Board#free"), 0);
    assert_eq!(retained_receiver_fields(&prepared, "Board#check"), 0);
}

/// `new Array(3).fill(null)` is one object under two names: `fill` hands back
/// its receiver, so the filled array takes the new one's reference instead of
/// a retain of its own beside a release (2 counting operations in
/// `Piles#constructor` on main).
#[test]
fn a_handed_back_receiver_is_a_move() {
    let prepared = counted("pile-shuffle");
    assert_eq!(counting_in(&prepared, "Piles#constructor"), 0);
}

/// A borrow lasts until its last read, not until the end of everything its
/// block can reach. Each function reads a chain out of a slot and only then
/// overwrites the slot, and the overwrite, reachable round a loop or after
/// the reads, made every read in the chain copy and release. What is left is
/// the overwrite's own retain and release, and, on each throwing path, the
/// release of the parameter the throw abandons. Counts on main before the
/// change: 16, 2, 5 and 6.
#[test]
fn a_borrow_ends_at_its_last_read() {
    let prepared = counted("a-borrow-ends-at-its-last-read");
    // `old.next!.value + old.next!.back!.value`, then `ring[slot] = fresh`.
    // The 7 left: the overwrite giving back what the slot held (1), and on
    // each of the three throwing paths the error it built (3) and the
    // `fresh` it was handed (3). The 9 removed were the copies and releases
    // of the four reads, and the copy of `old` given back on the first
    // throwing path.
    assert_eq!(counting_in(&prepared, "replaceAfterBranches"), 7);
    // The store pairs with the load of `old.next`, which takes the slot's
    // reference rather than borrowing it: a take is a load fewer than a
    // borrow followed by a store that has to read the slot again.
    assert_eq!(counting_in(&prepared, "relinkAfterEarlyExit"), 2);
    assert_eq!(counting_in(&prepared, "replaceInLoop"), 3);
    // `at`, carried by the loop's parameter, is read before the store.
    assert_eq!(counting_in(&prepared, "carriedPastNoStore"), 2);
}

/// Each `after` function beside its control, the same function with the
/// overwrite moved in front of the last read. The control keeps its counts:
/// what is read after its slot lets go of it holds a reference of its own,
/// or takes the slot's. Run against node under reference counting, the same
/// fixture shows each `before` function's reads still find their objects.
#[test]
fn a_store_before_the_last_read_still_ends_the_borrow() {
    let prepared = counted_at("programs", "a-borrow-read-around-the-store-that-ends-it");
    for (after, before, kept, copied) in [
        ("afterBranches", "beforeBranches", 8, 17),
        ("afterCall", "beforeCall", 3, 6),
        ("afterEarlyExit#whole", "beforeEarlyExit#whole", 5, 11),
        ("afterLoop#whole", "beforeLoop#whole", 6, 12),
        ("afterCarried#whole", "beforeCarried#whole", 4, 10),
        ("afterThrow", "beforeThrow", 5, 10),
    ] {
        assert_eq!(counting_in(&prepared, after), kept, "{after}");
        assert_eq!(counting_in(&prepared, before), copied, "{before}");
    }
}
