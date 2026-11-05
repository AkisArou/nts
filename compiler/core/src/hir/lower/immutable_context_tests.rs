#![allow(clippy::expect_used)]

use super::*;

fn captured() -> nts_semantic_schema::SemanticSnapshot {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-var-holding-a-closure/tsconfig.json");
    let config = camino::Utf8Path::from_path(&root).expect("fixture path");
    let snapshot = nts_frontend_ts::Frontend::new(
        camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    )
    .snapshot(config)
    .expect("actual native capture");
    assert!(!snapshot.has_errors(), "context guard must typecheck");
    snapshot
}

#[test]
fn every_body_builder_borrows_the_one_program_context() {
    let semantic = captured();
    let snapshot = LoweringSnapshot::new(&semantic);
    let foreign = crate::hir::runtime::ForeignTable::default();
    let readers = initialization::PrivateReaders::new(&FuncBuilder::probe(&snapshot));
    let closures = collect_closures(&snapshot, &readers);
    let (hierarchy, naming) = hierarchy_and_naming(&snapshot, &foreign, &closures, &readers);
    let module = collect_module_scope(&snapshot, &foreign, &closures, &hierarchy, &naming);
    let shared = Shared::whole_program(&snapshot, module, hierarchy, &closures, naming);
    let module: &ModuleScope = &shared.module;
    let hierarchy: &Hierarchy = &shared.hierarchy;
    // The work contract is independent of how many entries need a builder:
    // each one sees the same immutable owners, never another deep copy.
    for entries in [1, 16, 64] {
        for _ in 0..entries {
            let builder = shared.builder(&snapshot, &foreign, Copy::default());
            assert!(
                std::ptr::eq::<ModuleScope>(builder.module, module),
                "a body builder copied the program module context"
            );
            assert!(
                std::ptr::eq::<Hierarchy>(builder.hierarchy, hierarchy),
                "a body builder copied the program hierarchy"
            );
            assert!(std::ptr::eq(
                builder.qualified,
                std::ptr::from_ref(&shared.naming.qualified)
            ));
            assert!(std::ptr::eq(
                builder.generators,
                std::ptr::from_ref(&shared.naming.generators)
            ));
            assert!(std::ptr::eq(
                builder.throwing,
                std::ptr::from_ref(&shared.naming.throwing)
            ));
            assert!(std::ptr::eq(
                builder.raising,
                std::ptr::from_ref(&shared.naming.raising)
            ));
            assert!(std::ptr::eq(
                builder.withheld,
                std::ptr::from_ref(&shared.naming.withheld)
            ));
            assert!(std::ptr::eq(
                builder.presence_keys,
                std::ptr::from_ref(&shared.naming.presence_keys)
            ));
            assert!(std::ptr::eq(
                builder.written_order,
                std::ptr::from_ref(&shared.naming.written_order)
            ));
            assert!(std::ptr::eq(
                builder.class_tokens,
                std::ptr::from_ref(&shared.naming.class_tokens)
            ));
            assert_eq!(
                builder.calls.generic.map(std::ptr::from_ref),
                Some(std::ptr::from_ref(&shared.generics.at_call))
            );
            assert_eq!(
                builder.calls.structural.map(std::ptr::from_ref),
                Some(std::ptr::from_ref(&shared.structural))
            );
        }
    }
}

#[test]
fn body_local_values_stay_independent_between_context_users() {
    let semantic = captured();
    let snapshot = LoweringSnapshot::new(&semantic);
    let foreign = crate::hir::runtime::ForeignTable::default();
    let readers = initialization::PrivateReaders::new(&FuncBuilder::probe(&snapshot));
    let closures = collect_closures(&snapshot, &readers);
    let (hierarchy, naming) = hierarchy_and_naming(&snapshot, &foreign, &closures, &readers);
    let module = collect_module_scope(&snapshot, &foreign, &closures, &hierarchy, &naming);
    let shared = Shared::whole_program(&snapshot, module, hierarchy, &closures, naming);
    let mut first = shared.builder(&snapshot, &foreign, Copy::default());
    let second = shared.builder(&snapshot, &foreign, Copy::default());
    first.suffix.push_str("local-copy");
    first.bindings.insert(123, ValueId(0));
    assert_eq!(second.suffix, "");
    assert!(!second.bindings.contains_key(&123));
}
