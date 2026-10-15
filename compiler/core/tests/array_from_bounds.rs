//! The output index of a callback-free table collection is bounded by its
//! allocation. The table cursor can skip holes and is a different value.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared() -> Option<hir::Prepared> {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP: no tsgo; set NTS_TSGO to run the array-from bounds guards");
        return None;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/array-from-set-bounds/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    Some(hir::prepare(&snapshot).expect("prepared HIR verifies"))
}

/// Only stores into an array allocated at a table's live count. In the mapped
/// control this is the intermediate collection, not the mapper's output.
fn collection_stores(program: &hir::Program, name: &str) -> String {
    let function = program
        .funcs
        .iter()
        .find(|function| function.name == name)
        .unwrap_or_else(|| panic!("{name} is compiled"));
    let mut records = Vec::new();
    for value in function.blocks.iter().flat_map(|block| &block.ops) {
        let OpKind::ArraySet {
            array,
            index,
            checked,
            ..
        } = function.value(*value).kind
        else {
            continue;
        };
        let OpKind::ArrayNew { length, .. } = function.value(array).kind else {
            continue;
        };
        let OpKind::Length(source) = function.value(length).kind else {
            continue;
        };
        if !matches!(
            function.value(source).ty,
            HirType::Managed(ManagedType::Set(_) | ManagedType::Map(..))
        ) {
            continue;
        }
        records.push(format!(
            "index: {:?}, checked: {checked}",
            function.value(index).ty
        ));
    }
    records.join("\n")
}

#[test]
fn callback_free_table_collections_use_an_integer_unchecked_write() {
    let Some(prepared) = prepared() else { return };
    for name in ["fromSet", "fromMapValues", "fromMapEntries"] {
        assert_eq!(
            collection_stores(&prepared.program, name),
            "index: Int { bits: 32, signed: true }, checked: false",
            "{name}: a live-entry count bounds the output position, including holes"
        );
    }
}

#[test]
fn supplying_a_mapper_keeps_the_collection_write_checked() {
    let Some(prepared) = prepared() else { return };
    assert_eq!(
        collection_stores(&prepared.program, "fromMappedSet"),
        "index: Float { bits: 64 }, checked: true",
        "a mapped collection must not acquire the callback-free bound"
    );
}
