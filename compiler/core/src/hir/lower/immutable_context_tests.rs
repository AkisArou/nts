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
    let module = collect_module_scope(
        &snapshot,
        &foreign,
        &closures,
        &hierarchy,
        &naming.initialization,
    );
    let shared = Shared::whole_program(&snapshot, &module, &hierarchy, &closures, naming);
    let module: &ModuleScope = &shared.module;
    let hierarchy: &Hierarchy = &shared.hierarchy;
    // The work contract is independent of how many entries need a builder:
    // each one sees the same immutable owners, never another deep copy.
    for entries in [1, 16, 64] {
        for _ in 0..entries {
            let builder = shared.builder(&snapshot, &foreign, Copy::default());
            assert!(
                std::ptr::eq::<ModuleScope>(&raw const builder.module, module),
                "a body builder copied the program module context"
            );
            assert!(
                std::ptr::eq::<Hierarchy>(&raw const builder.hierarchy, hierarchy),
                "a body builder copied the program hierarchy"
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
    let module = collect_module_scope(
        &snapshot,
        &foreign,
        &closures,
        &hierarchy,
        &naming.initialization,
    );
    let shared = Shared::whole_program(&snapshot, &module, &hierarchy, &closures, naming);
    let mut first = shared.builder(&snapshot, &foreign, Copy::default());
    let second = shared.builder(&snapshot, &foreign, Copy::default());
    first.suffix.push_str("local-copy");
    first.bindings.insert(123, ValueId(0));
    assert_eq!(second.suffix, "");
    assert!(!second.bindings.contains_key(&123));
}
