//! A collection through an erased view preserves the table's actual tags.

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
use nts_frontend_ts::Frontend;

fn snapshot() -> nts_semantic_schema::SemanticSnapshot {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/array-from-widened-map-values/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture the widened and directly erased allocation pair");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    snapshot
}

#[test]
fn a_wide_alias_retains_its_source_view_without_changing_the_allocation() {
    let snapshot = snapshot();
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:#?}", lowered.diagnostics);
    for name in [
        "throughMapped",
        "throughEntries",
        "throughValuesLoop",
        "throughForEach",
    ] {
        let function = lowered
            .program
            .funcs
            .iter()
            .find(|function| function.name == name)
            .expect("the source export");
        assert!(function.values.iter().any(|operation| {
            let OpKind::Convert(value) = operation.kind else { return false; };
            matches!((&function.value(value).ty, &operation.ty),
                (HirType::Managed(ManagedType::Map(_, from)), HirType::Managed(ManagedType::Map(_, to)))
                    if **from == HirType::NUMBER && **to == HirType::Erased)
        }), "{name} must retain the requested view as a source edge");
    }
    let prepared = hir::prepare(&snapshot).expect("prepare the lossless carrier views");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:#?}",
        prepared.diagnostics
    );
}
