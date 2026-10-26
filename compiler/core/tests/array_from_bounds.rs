//! A callback-free table collection is sized at the table's live count and
//! filled by one call; a mapped one grows, because its callback can change
//! that count. (The fill replaced a walk whose output position had to stay
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
use nts_frontend_ts::Frontend;

fn prepared() -> hir::Prepared {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/array-from-set-bounds/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("prepared HIR verifies");
    assert!(
        prepared.diagnostics.is_empty(),
        "every fixture export must compile: {:#?}",
        prepared.diagnostics
    );
    prepared
}

/// Only stores into an array allocated at a table's live count. A mapped
/// collection must grow instead, because its callback can change that count.
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

/// The fills of arrays allocated at a table's live count, as `helper(array)`,
/// and whether anything else in the function still walks a table by cursor.
fn collection_fills(program: &hir::Program, name: &str) -> (Vec<String>, bool) {
    let function = program
        .funcs
        .iter()
        .find(|function| function.name == name)
        .unwrap_or_else(|| panic!("{name} is compiled"));
    let mut fills = Vec::new();
    let mut walks = false;
    for value in function.blocks.iter().flat_map(|block| &block.ops) {
        let OpKind::Call {
            callee: hir::Callee::External(helper),
            args,
            ..
        } = &function.value(*value).kind
        else {
            continue;
        };
        if helper == "nts_map_next" {
            walks = true;
        }
        let [table, out] = args.as_slice() else {
            continue;
        };
        let OpKind::ArrayNew { length, .. } = function.value(*out).kind else {
            continue;
        };
        if matches!(function.value(length).kind, OpKind::Length(source) if source == *table) {
            fills.push(helper.clone());
        }
    }
    (fills, walks)
}

/// A callback-free collection of a table is sized at its live count and
/// filled by one call: no store per element, so no output position for a
/// hole to put out of step, and no cursor at all.
#[test]
fn callback_free_table_collections_are_one_fill_at_the_live_count() {
    let prepared = prepared();
    for (name, helper) in [
        ("fromSet", "nts_map_keys_into"),
        ("fromEmptySet", "nts_map_keys_into"),
        ("fromMapValues", "nts_map_values_into"),
    ] {
        assert_eq!(
            collection_fills(&prepared.program, name),
            (vec![helper.to_owned()], false),
            "{name}: one fill of an array sized at the live count, and no walk"
        );
        assert_eq!(
            collection_stores(&prepared.program, name),
            "",
            "{name}: the fill stores every element; nothing stores one by one"
        );
    }
}

#[test]
fn supplying_a_mapper_keeps_a_growing_write_checked() {
    let prepared = prepared();
    assert_eq!(
        collection_stores(&prepared.program, "fromMappedSet"),
        "",
        "a mapped collection must not allocate at the source's initial live count"
    );
    let function = prepared
        .program
        .funcs
        .iter()
        .find(|function| function.name == "fromMappedSet")
        .expect("the mapped control compiles");
    let appends: Vec<bool> = function
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|value| match function.value(*value).kind {
            OpKind::ArraySet {
                array,
                index,
                checked,
                ..
            } if matches!(function.value(index).kind, OpKind::Length(source) if source == array) => {
                Some(checked)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        appends,
        [true],
        "the mapped result appends with a checked write"
    );
}
