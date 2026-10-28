//! Public fixture guards for the memory-safety analysis decisions, including
//! the dangling pointer which ordinary native execution can survive by luck.
#![allow(clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind};

fn prepared(name: &str) -> hir::Prepared {
    let path = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(name)
        .join("tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&path)
        .expect("fixture captures");
    let prepared = hir::prepare_unverified(
        &snapshot,
        &hir::Options {
            provider: hir::Memory::ReferenceCounting,
            roots: hir::reachable::Roots::EveryExport,
            ..hir::Options::default()
        },
    );
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    prepared
}

#[test]
fn borrowed_container_elements_do_not_enter_a_count_free_clone() {
    let prepared = prepared("a-region-container-never-consumes-a-borrowed-reference");
    let calls: Vec<_> = prepared
        .regions
        .calls
        .iter()
        .filter(|call| call.callee == "build" || call.callee == "controlBuild")
        .collect();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|call| call.verdict.is_err()), "{calls:?}");
}

#[test]
fn the_long_and_short_chain_owners_both_allocate_on_the_heap() {
    let prepared = prepared("an-escape-fact-crosses-a-long-call-chain");
    for name in ["owner", "controlOwner"] {
        let owner = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .expect("live owner");
        let placements: Vec<_> = owner
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .filter_map(|id| match owner.values[id.0 as usize].kind {
                OpKind::ObjectNew { frame } => Some(frame),
                _ => None,
            })
            .collect();
        assert_eq!(placements, [false], "{name} must outlive its frame");
    }
}
