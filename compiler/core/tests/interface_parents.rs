//! Declared interface ancestry survives independently of storage and dispatch.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, Program};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::TypeId;

fn prepared() -> Option<Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-parents/tsconfig.json")
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

fn parents(program: &Program, ty: TypeId) -> &[TypeId] {
    program
        .interface_identities
        .iter()
        .find_map(|identity| identity.parents.get(&ty))
        .expect("a known interface instantiation has an ancestry answer")
}

#[test]
fn roots_and_both_arms_of_a_diamond_are_explicit() {
    let Some(program) = prepared() else { return };
    let root = returns(&program, "root");
    let left = returns(&program, "left");
    let right = returns(&program, "right");
    let diamond = returns(&program, "diamond");
    assert!(parents(&program, root).is_empty());
    assert_eq!(parents(&program, left), [root]);
    assert_eq!(parents(&program, right), [root]);
    assert_eq!(parents(&program, diamond), [left, right]);
    // The single-parent relation remains deliberately narrower.
    assert!(!program.record_parents.contains_key(&diamond));
}

#[test]
fn generic_parents_keep_their_instantiation() {
    let Some(program) = prepared() else { return };
    let numeric = returns(&program, "numericParent");
    let textual = returns(&program, "textualParent");
    assert_ne!(numeric, textual);
    assert_eq!(
        parents(&program, returns(&program, "numericChild")),
        [numeric]
    );
    assert_eq!(
        parents(&program, returns(&program, "textualChild")),
        [textual]
    );
}

#[test]
fn shared_layouts_and_concrete_parents_do_not_erase_declared_edges() {
    let Some(program) = prepared() else { return };
    let root = returns(&program, "root");
    let same = returns(&program, "same");
    assert_ne!(root, same);
    assert!(std::ptr::eq(
        program.layout(root).unwrap(),
        program.layout(same).unwrap()
    ));
    assert_eq!(parents(&program, same), [root]);
    let concrete = returns(&program, "concrete");
    assert_eq!(
        parents(&program, returns(&program, "concreteChild")),
        [concrete]
    );
    assert!(
        program
            .interface_identities
            .iter()
            .all(|identity| !identity.parents.contains_key(&concrete))
    );
}
