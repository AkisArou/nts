//! The key kind a keyed table call names (`hir::tables`), on
//! `tests/outcomes/a-typed-table-seen-with-wider-keys`: typed tables passed to
//! functions that see them as `Map<unknown, unknown>` and `Set<unknown>`.
//!
//! The kind is a promise about the key -- the C runtime hashes with it, as a
//! constant, wherever it equals the table's own -- so it must survive every
//! pass that runs after lowering. Inlining is the one that could break it: it
//! replaces a `Map<unknown, unknown>` parameter with the typed table passed to
//! it, while the key still comes from the wide body.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, OpKind, ValueId};
use nts_frontend_ts::SemanticSource;

fn prepared(name: &str) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/outcomes")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/outcomes/{name} is checked in"));
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let options = hir::Options {
        provider: hir::Provider::ReferenceCounting,
        roots: hir::reachable::Roots::EveryExport,
        ..hir::Options::default()
    };
    Some(hir::prepare_unverified(&snapshot, &options).program)
}

/// The constant a value is, if it is one.
fn constant(func: &hir::Func, value: ValueId) -> Option<i128> {
    match func.values[value.0 as usize].kind {
        OpKind::ConstInt(kind) => Some(kind),
        _ => None,
    }
}

/// The type a key had before it was erased for the call, if the call erased
/// it: what the kind promises about.
fn key_type(func: &hir::Func, key: ValueId) -> Option<&HirType> {
    match func.values[key.0 as usize].kind {
        OpKind::Erase { value, .. } => Some(&func.values[value.0 as usize].ty),
        _ => None,
    }
}

/// Every live keyed call: its function, helper, key's own type and kind.
fn keyed_calls(program: &hir::Program) -> Vec<(String, String, Option<HirType>, u32)> {
    let mut calls = Vec::new();
    for func in &program.funcs {
        for block in &func.blocks {
            for &op in &block.ops {
                let OpKind::Call {
                    callee: Callee::External(name),
                    args,
                    ..
                } = &func.values[op.0 as usize].kind
                else {
                    continue;
                };
                let Some(at) = hir::tables::kind_at(name) else {
                    continue;
                };
                let kind = constant(func, args[at]).unwrap_or_else(|| {
                    panic!("{name} in {} names its kind by a constant", func.name)
                });
                let key = args[if name == "nts_map_entry_get" || name == "nts_map_entry_set" {
                    2
                } else {
                    1
                }];
                calls.push((
                    func.name.clone(),
                    name.clone(),
                    key_type(func, key).cloned(),
                    u32::try_from(kind).unwrap(),
                ));
            }
        }
    }
    calls
}

#[test]
fn a_narrow_kind_is_named_only_for_a_key_of_its_sort() {
    let Some(program) = prepared("a-typed-table-seen-with-wider-keys") else {
        return;
    };
    let calls = keyed_calls(&program);
    assert_ne!(
        calls,
        [] as [(
            std::string::String,
            std::string::String,
            std::option::Option<nts_core::HirType>,
            u32
        ); 0]
    );
    for (func, name, key, kind) in &calls {
        if *kind == hir::tables::ERASED {
            continue;
        }
        let key = key.as_ref().unwrap_or_else(|| {
            panic!("{name} in {func} promises kind {kind} of a key it did not erase")
        });
        assert_eq!(
            hir::tables::key_kind(key),
            *kind,
            "{name} in {func} promises kind {kind} of a {key:?} key"
        );
    }
}

#[test]
fn the_wide_view_promises_nothing_and_the_typed_one_its_kind() {
    let Some(program) = prepared("a-typed-table-seen-with-wider-keys") else {
        return;
    };
    let calls = keyed_calls(&program);
    // `writesWide` sets a number, a string and -0 through the wide view; the
    // typed half sets "a" into the same table through its own type.
    let number_keys_erased = calls.iter().any(|(_, name, key, kind)| {
        name == "nts_map_set"
            && matches!(key, Some(HirType::Float { .. }))
            && *kind == hir::tables::ERASED
    });
    let string_keys_typed = calls.iter().any(|(_, name, key, kind)| {
        name == "nts_map_set"
            && key == &Some(HirType::Managed(hir::ManagedType::String))
            && *kind == hir::tables::STRING
    });
    assert!(number_keys_erased, "{calls:#?}");
    assert!(string_keys_typed, "{calls:#?}");
}
