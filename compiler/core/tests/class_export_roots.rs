//! Class identity keeps its public surface even when another type owns storage.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, reachable::Roots};
use nts_frontend_ts::Frontend;

#[test]
fn shared_and_unique_layout_classes_keep_their_public_members() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/refusals/an-exported-class-with-a-shared-layout/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
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
    let solo = program
        .classes
        .iter()
        .find(|class| class.name == "Solo")
        .unwrap();
    let layout = program
        .layouts
        .iter()
        .find(|layout| solo.types.iter().any(|ty| layout.types.contains(ty)))
        .unwrap();
    assert_eq!(layout.name, "EarlierNumber");
    assert!(
        !layout
            .types
            .iter()
            .any(|ty| program.plain_records.contains(ty))
    );
    assert_eq!(program.distinct_identities(layout).len(), 1);
    assert_eq!(program.distinct_identities(layout)[0].name, "Solo");
    assert!(!program.uses_layout_identity(layout));
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
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/class-export-identities/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
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

#[test]
fn a_live_layout_test_keeps_the_shape_but_a_dead_test_does_not() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/refusals/an-exported-class-with-a-shared-layout/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let mut program = hir::lower::lower(&snapshot).program;
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.name == "EarlierNumber")
        .unwrap()
        .clone();
    assert!(!program.uses_layout_identity(&layout));
    let reader = program
        .funcs
        .iter_mut()
        .find(|func| func.name == "readEarlierNumber")
        .unwrap();
    let hir::HirType::Managed(hir::ManagedType::Object(ty)) = reader.params[0].ty else {
        panic!("the reader takes an interface");
    };
    let test = hir::ValueId(u32::try_from(reader.values.len()).unwrap());
    reader.values.push(hir::Op {
        kind: hir::OpKind::InstanceOf {
            value: hir::ValueId(0),
            classes: vec![ty],
            by_layout: true,
        },
        ty: hir::HirType::Bool,
        origin: reader.origin.clone(),
    });
    reader.blocks[0].ops.push(test);
    assert!(program.uses_layout_identity(&layout));
    program
        .funcs
        .iter_mut()
        .find(|func| func.name == "readEarlierNumber")
        .unwrap()
        .blocks[0]
        .ops
        .pop();
    assert!(!program.uses_layout_identity(&layout));
}
