//! A checked read stands for its out-of-range path until bounds prove it.
//!
//! Out of range, a checked read stops the program rather than answering
//! `undefined`, so its value facts are the element's and the read itself
//! survives a fold that drops its consumer (`hir::may_stop`). A read the
//! program discards is not evaluated at all, as in JavaScript.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, OpKind, ValueId};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn checked_reads_survive_and_unused_reads_remain_removable() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/checked-read-facts/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let prepared = hir::prepare(&snapshot).expect("prepared HIR");
    assert!(
        prepared.program.uncompiled.is_empty(),
        "{:?}",
        prepared.program.uncompiled
    );
    let facts_by_function = hir::interprocedural::analyze_program(
        &prepared.program,
        hir::reachable::Roots::EveryExport,
    );
    for name in [
        "unboundedByte",
        "boundedArray",
        "ordinaryArray",
        "unusedRead",
        "allZero",
    ] {
        let (index, body) = prepared
            .program
            .funcs
            .iter()
            .enumerate()
            .find(|(_, f)| f.name == name)
            .expect(name);
        let analysis = &facts_by_function[index];
        let reads: Vec<ValueId> = body
            .blocks
            .iter()
            .flat_map(|b| &b.ops)
            .copied()
            .filter(|id| matches!(body.values[id.0 as usize].kind, OpKind::ArrayGet { .. }))
            .collect();
        if name == "unusedRead" {
            assert!(
                reads.is_empty(),
                "an unobserved ordinary read stays removable"
            );
            continue;
        }
        assert_eq!(
            reads.len(),
            1,
            "{name}: the value-producing read survives folding"
        );
        let id = reads[0];
        let expected_checked = name != "boundedArray";
        assert!(
            matches!(body.values[id.0 as usize].kind,
            OpKind::ArrayGet { checked, .. } if checked == expected_checked),
            "{name}: {body:#?}"
        );
        // An element, whenever the read returns: a byte is never NaN, which
        // is what keeps `total + xs[k]` in integers. (A `number[]` element can
        // be NaN in its own right, so the two arrays are not asked.)
        if matches!(name, "unboundedByte" | "allZero") {
            assert!(
                !analysis.get(id).maybe_nan,
                "{name}: a checked read's value is an element"
            );
        }
    }
}
