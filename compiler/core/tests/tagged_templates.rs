//! Keep the semantic subjects so a dropped tag cannot look like agreement.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn argument_semantics_retain_every_subject() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-template-object-keeps-its-identity/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot");
    let prepared = hir::prepare(&snapshot).expect("valid HIR");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in [
        "excess",
        "absentDefault",
        "absentOptional",
        "restValues",
        "emptyRest",
        "restIncludesTemplate",
        "defaultReadsEarlierParameters",
        "suppliedExpressionsBeforeDefaults",
        "ordinaryExpressionsBeforeDefaults",
        "defaultThenEmptyRest",
        "catchTag",
        "genericTag",
        "repeatIdentity",
        "differentSites",
        "copiedIdentity",
        "raisingCopyIdentity",
        "erasedIdentity",
        "heldInContainer",
        "cookedEscapes",
        "erasedRead",
        "erasedIsArray",
        "erasedType",
        "moduleIdentity",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|f| f.name == name && f.exported),
            "missing {name}"
        );
    }
}

#[test]
fn invalid_cooked_entries_and_writable_casts_remain_named_boundaries() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/tagged-template-boundaries/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot");
    let prepared = hir::prepare(&snapshot).expect("refused subjects leave valid HIR");
    let missing = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "missing")
        .expect("missing-index subject");
    assert!(
        missing.blocks.iter().flat_map(|b| &b.ops).any(|value| {
            matches!(
                missing.values[value.0 as usize].kind,
                hir::OpKind::ArrayGet { checked: true, .. }
            )
        }),
        "a folded comparison must retain the cooked-only bounds boundary"
    );
    for (name, reason) in [
        ("rawAccess", "`raw`"),
        ("invalidWhole", "undefined cooked entry"),
        ("invalidHead", "undefined cooked entry"),
        ("invalidMiddle", "undefined cooked entry"),
        ("invalidTail", "undefined cooked entry"),
    ] {
        assert!(
            !prepared
                .program
                .funcs
                .iter()
                .any(|f| f.exported && f.name == name),
            "accepted {name}"
        );
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|d| d.message.contains(reason)),
            "missing named boundary for {name}: {:?}",
            prepared.diagnostics
        );
    }
    // `strings as unknown as string[]` compiles: erasure keeps the template
    // object's identity, and reading it back as array storage is the `Unerase`
    // every backend guards with `nts_array_writable`, which refuses an
    // immutable template object at run time before the write lands.
    let mutable = prepared
        .program
        .funcs
        .iter()
        .find(|f| f.name == "mutable")
        .expect("writable-cast subject");
    assert!(
        mutable.blocks.iter().flat_map(|b| &b.ops).any(|value| matches!(
            (&mutable.values[value.0 as usize].kind, &mutable.values[value.0 as usize].ty),
            (hir::OpKind::Unerase { .. }, hir::HirType::Managed(hir::ManagedType::Array(_)))
        )),
        "the template is read back as array storage, which the backends check for writability"
    );
}
