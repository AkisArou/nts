//! Scratch stores and powersort metadata must really be uint32 indices. Answer
//! agreement alone also passes with the old O(N log N) managed stores.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind};
use nts_frontend_ts::Frontend;

fn index_arrays(func: &hir::Func) -> usize {
    func.values
        .iter()
        .filter(|op| {
            matches!(op.kind, OpKind::ArrayNew { .. })
                && op.ty
                    == HirType::Managed(ManagedType::Array(Box::new(HirType::Int {
                        bits: 32,
                        signed: false,
                    })))
        })
        .count()
}

#[test]
fn managed_sorts_merge_uint32_indices_but_numeric_sorts_keep_values() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/count-free-sort/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("prepared HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for program in [&lowered.program, &prepared.program] {
        for name in [
            "stableObjects",
            "emptiedSource",
            "retainArgument",
            "throwing",
            "copied",
            "stableStrings",
        ] {
            let func = program.funcs.iter().find(|f| f.name == name).expect(name);
            assert_eq!(
                index_arrays(func),
                3,
                "{name} must keep an order, smaller-run scratch and node-power stack"
            );
            let sort_origin = &func
                .values
                .iter()
                .find(|op| {
                    matches!(op.kind, OpKind::ArrayNew { .. })
                        && op.ty
                            == HirType::Managed(ManagedType::Array(Box::new(HirType::Int {
                                bits: 32,
                                signed: false,
                            })))
                })
                .expect("the sort's scratch allocation")
                .origin
                .location;
            // Even final write-back goes through its permutation contract.
            // String-array literal initialization has a different origin.
            let managed_stores = func
                .values
                .iter()
                .filter(|op| {
                    &op.origin.location == sort_origin
                        && matches!(&op.kind, OpKind::ArraySet { value, .. }
                    if matches!(func.values[value.0 as usize].ty, HirType::Managed(_)))
                })
                .count();
            assert_eq!(managed_stores, 0, "{name}: no managed permutation store");
            for op in &func.values {
                if &op.origin.location != sort_origin {
                    continue;
                }
                if let OpKind::ArrayGet { index, .. } | OpKind::ArraySet { index, .. } = op.kind {
                    assert!(
                        matches!(func.values[index.0 as usize].ty, HirType::Int { bits, .. } if bits <= 32),
                        "{name}: array addressing uses the u32 domain, not wide power coordinates: {:?}",
                        func.values[index.0 as usize].ty
                    );
                }
            }
            for op in &func.values {
                if &op.origin.location != sort_origin {
                    continue;
                }
                if let OpKind::ArrayGet { index, .. } | OpKind::ArraySet { index, .. } = op.kind {
                    assert!(
                        matches!(func.values[index.0 as usize].ty, HirType::Int { bits, .. } if bits <= 32),
                        "{name}: memory cursors stay within the u32 index contract"
                    );
                }
            }
            assert_eq!(
                func.values
                    .iter()
                    .filter(|op| matches!(
                        &op.kind, OpKind::Call { callee: Callee::External(name), .. }
                            if name == "nts_array_sort_writeback_ref"
                    ))
                    .count(),
                1,
                "{name}: one completed permutation commit"
            );
            if name == "copied" {
                assert_eq!(
                    func.values
                        .iter()
                        .filter(|op| matches!(
                            &op.kind, OpKind::Call { callee: Callee::External(name), .. }
                                if name == "nts_array_slice_ref"
                        ))
                        .count(),
                    1,
                    "toSorted's single private owner is already its snapshot"
                );
            }
        }
        let numeric = program
            .funcs
            .iter()
            .find(|f| f.name == "numericControl")
            .expect("control");
        assert_eq!(
            index_arrays(numeric),
            0,
            "numeric sort has no managed traffic to remove"
        );
    }
}
