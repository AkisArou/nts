//! Semantic declarations and instantiations survive physical layout sharing.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, Program};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::TypeId;

fn prepared() -> Option<Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-identities/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    Some(
        hir::prepare_with(&snapshot, &hir::Options::default())
            .expect("valid prepared HIR")
            .program,
    )
}

fn returns(program: &Program, name: &str) -> TypeId {
    let func = program.funcs.iter().find(|func| func.name == name).unwrap();
    let HirType::Managed(ManagedType::Object(ty)) = func.return_type else {
        panic!("{name} returns an object");
    };
    ty
}

#[test]
fn empty_interfaces_share_storage_and_keep_distinct_declarations() {
    let Some(program) = prepared() else { return };
    let left = returns(&program, "left");
    let right = returns(&program, "right");
    assert_ne!(left, right);
    assert!(std::ptr::eq(
        program.layout(left).unwrap(),
        program.layout(right).unwrap(),
    ));
    let identity = |name| {
        program
            .interface_identities
            .iter()
            .find(|identity| identity.name == name)
            .unwrap()
    };
    assert!(identity("Left").types.contains(&left));
    assert!(identity("Right").types.contains(&right));
    assert_ne!(identity("Left").symbol, identity("Right").symbol);
    assert_eq!(program.interface_type_name(left), Some("Left"));
    assert_eq!(program.interface_type_name(right), Some("Right"));
    let token = returns(&program, "token");
    assert!(
        program
            .classes
            .iter()
            .any(|class| class.types.contains(&token))
    );
    assert!(
        program
            .interface_identities
            .iter()
            .all(|identity| { identity.name != "Token" && !identity.types.contains(&token) })
    );
    let provided = returns(&program, "provided");
    assert!(
        program
            .interface_identities
            .iter()
            .all(|identity| { identity.name != "Error" && !identity.types.contains(&provided) })
    );
}

#[test]
fn generic_instantiations_keep_their_storage_under_one_declaration() {
    let Some(program) = prepared() else { return };
    let numeric = returns(&program, "numeric");
    let textual = returns(&program, "textual");
    assert_ne!(numeric, textual);
    assert!(!std::ptr::eq(
        program.layout(numeric).unwrap(),
        program.layout(textual).unwrap(),
    ));
    let holders: Vec<_> = program
        .interface_identities
        .iter()
        .filter(|identity| identity.name == "Holder")
        .collect();
    assert_eq!(holders.len(), 1);
    assert!(holders[0].types.contains(&numeric));
    assert!(holders[0].types.contains(&textual));
    assert_eq!(
        program.interface_type_name(numeric),
        Some(format!("Holder<{}>", numeric.0).as_str())
    );
    assert_eq!(
        program.interface_type_name(textual),
        Some(format!("Holder<{}>", textual.0).as_str())
    );
}

#[test]
fn equal_storage_does_not_merge_nullable_and_optional_contracts() {
    let Some(program) = prepared() else { return };
    let nullable = returns(&program, "nullable");
    let optional = returns(&program, "optional");
    assert_ne!(nullable, optional);
    assert!(std::ptr::eq(
        program.layout(nullable).unwrap(),
        program.layout(optional).unwrap(),
    ));
    let holder = program
        .interface_identities
        .iter()
        .find(|identity| identity.name == "Holder")
        .unwrap();
    assert!(holder.types.contains(&nullable));
    assert!(holder.types.contains(&optional));
}
