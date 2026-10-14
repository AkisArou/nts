//! Class identity keeps its public surface even when another type owns storage.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, reachable::Roots};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn shared_and_unique_layout_classes_keep_their_public_members() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP class export roots: tsgo is required");
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join(
        "../../tooling/conformance/blockers/an-exported-class-with-a-shared-layout/tsconfig.json",
    );
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    let mut program = hir::lower::lower(&snapshot).program;
    let shared = program
        .classes
        .iter()
        .find(|class| class.name == "Shared")
        .unwrap();
    assert!(program.layouts.iter().any(|layout| layout.name == "Earlier"
        && shared.types.iter().any(|ty| layout.types.contains(ty))));
    hir::reachable::prune(&mut program, Roots::EntrySurface);
    let names: Vec<_> = program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect();
    for control in ["Unique#constructor", "Unique#get"] {
        assert!(names.contains(&control), "control {control}: {names:?}");
    }
    for subject in [
        "Shared#constructor",
        "Shared#get",
        "Twin#constructor",
        "Twin#get",
    ] {
        assert!(names.contains(&subject), "subject {subject}: {names:?}");
    }
}

#[test]
fn same_display_names_resolve_to_their_own_semantic_declarations() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/class-export-identities/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    assert!(!snapshot.has_errors());
    let mut program = hir::lower::lower(&snapshot).program;
    let classes: Vec<_> = program.published_classes().collect();
    assert_eq!(classes.len(), 2);
    assert_ne!(classes[0].emitted, classes[1].emitted);
    assert_eq!(classes[0].identity.name, "Same");
    assert_eq!(classes[1].identity.name, "Same");
    assert_ne!(classes[0].identity.symbol, classes[1].identity.symbol);
    let members: Vec<_> = classes
        .iter()
        .flat_map(|class| {
            [
                format!("{}#constructor", class.emitted),
                format!("{}#get", class.emitted),
            ]
        })
        .collect();
    hir::reachable::prune(&mut program, Roots::EntrySurface);
    for name in members {
        assert!(
            program.funcs.iter().any(|func| func.name == name),
            "missing {name}"
        );
    }
}
