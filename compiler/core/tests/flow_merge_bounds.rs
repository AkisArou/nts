//! A path-local range must not survive an unrefined predecessor at a merge.
#![allow(clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BlockId, OpKind};
use nts_frontend_ts::Frontend;

#[test]
fn a_merge_keeps_the_whole_index_range_and_the_array_check() {
    let config =
        Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/flow_merge_bounds/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot of the original source and its swapped-arm control");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    for name in ["subjectAccess", "controlAccess"] {
        let function = lowered
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .expect(name);
        let facts = hir::flow::analyze(function);
        let mut reads = 0;
        for (block, record) in function.blocks.iter().enumerate() {
            for id in &record.ops {
                if let OpKind::ArrayGet { index, .. } = function.value(*id).kind {
                    reads += 1;
                    assert_eq!(
                        facts.get_at(BlockId(u32::try_from(block).expect("block id")), index),
                        facts.get(index),
                        "{name}: the merge must include the unrefined arrival"
                    );
                    assert!(
                        facts.get(index).hi > 3.0,
                        "the input index is not bounded by the array"
                    );
                }
            }
        }
        assert_eq!(reads, 1, "{name}: retain the source array access");
    }
    for provider in [
        hir::Memory::NoGc,
        hir::Memory::ReferenceCounting,
        hir::Memory::HostGc,
    ] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        )
        .expect("valid prepared graph");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        for name in ["subjectAccess", "controlAccess"] {
            let function = prepared
                .program
                .funcs
                .iter()
                .find(|f| f.name == name)
                .expect(name);
            let reads: Vec<_> = function
                .blocks
                .iter()
                .flat_map(|b| &b.ops)
                .filter_map(|id| match function.value(*id).kind {
                    OpKind::ArrayGet { checked, .. } => Some(checked),
                    _ => None,
                })
                .collect();
            assert_eq!(
                reads,
                [true],
                "{name}: an out-of-range arrival must keep its check"
            );
        }
    }
}
