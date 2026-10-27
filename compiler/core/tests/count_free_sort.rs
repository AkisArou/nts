//! The scratch stores must really be uint32 permutations: answer agreement
//! alone also passes with the old O(N log N) managed stores.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
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
                2,
                "{name} must keep two four-byte index buffers"
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
            // Only final write-back stores a managed value at the sort call.
            // The original string-array literal has its own initialization
            // stores, at a different source location.
            let managed_stores = func
                .values
                .iter()
                .filter(|op| {
                    &op.origin.location == sort_origin
                        && matches!(&op.kind, OpKind::ArraySet { value, .. }
                    if matches!(func.values[value.0 as usize].ty, HirType::Managed(_)))
                })
                .count();
            assert_eq!(managed_stores, 1, "{name}: no managed merge store");
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
