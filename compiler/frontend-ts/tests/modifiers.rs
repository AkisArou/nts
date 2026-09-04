//! Declaration modifiers and class heritage, derived from the AST.
//!
//! These cost no round trips — a modifier is a child keyword and a heritage
//! clause is a child node. They are extracted anyway because every backend needs
//! them and each would otherwise re-derive the traversal slightly differently.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::tsgo::types::syntax;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::{
    DeclarationModifiers as M, HeritageKind, NodeKind, SemanticSnapshot, VariableKind,
};

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/classes/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/classes fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

/// Modifiers on the declaration that names `name`.
fn modifiers_of(snapshot: &SemanticSnapshot, name: &str) -> M {
    snapshot
        .nodes
        .iter()
        .find(|node| {
            !node.modifiers.is_empty()
                && node
                    .children
                    .iter()
                    .any(|c| snapshot.nodes[c.0 as usize].text.as_deref() == Some(name))
        })
        .unwrap_or_else(|| panic!("no declaration named {name:?} carries modifiers"))
        .modifiers
}

#[test]
fn modifiers_land_on_the_declaration_not_the_modifier_list() {
    let Some(snapshot) = snapshot() else { return };
    // The bug this guards: modifiers are grandchildren, sitting inside a NodeList.
    // A one-level scan attributes every modifier to the list, leaving every
    // declaration bare — and a list is not a declaration, so it must not claim
    // them either.
    assert!(
        snapshot
            .nodes
            .iter()
            .all(|node| node.kind != NodeKind::List || node.modifiers.is_empty()),
        "a NodeList claimed modifiers belonging to its contents",
    );
    assert!(!modifiers_of(&snapshot, "Shape").is_empty());
}

#[test]
fn class_and_member_modifiers_are_recovered() {
    let Some(snapshot) = snapshot() else { return };

    let shape = modifiers_of(&snapshot, "Shape");
    assert!(shape.contains(M::EXPORT) && shape.contains(M::ABSTRACT));

    // JVM access flags come straight off these: ACC_STATIC, ACC_FINAL,
    // ACC_ABSTRACT, ACC_PRIVATE.
    assert!(modifiers_of(&snapshot, "id").contains(M::READONLY));
    assert!(modifiers_of(&snapshot, "name").contains(M::PROTECTED));
    assert!(modifiers_of(&snapshot, "instances").contains(M::STATIC));
    assert!(modifiers_of(&snapshot, "radius").contains(M::PRIVATE));

    // `async` decides whether a function lowers to a state machine at all.
    let load = modifiers_of(&snapshot, "load");
    assert!(load.contains(M::STATIC) && load.contains(M::ASYNC));
}

#[test]
fn ambient_and_default_declarations_are_marked() {
    let Some(snapshot) = snapshot() else { return };
    // `declare` means no body is emitted; `default` changes the export name.
    assert!(modifiers_of(&snapshot, "ambient").contains(M::DECLARE));
    assert!(modifiers_of(&snapshot, "Widget").contains(M::DEFAULT));
}

#[test]
fn extends_and_implements_are_distinguishable() {
    let Some(snapshot) = snapshot() else { return };
    let clauses: Vec<HeritageKind> = snapshot
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Syntax(syntax::HERITAGE_CLAUSE))
        .map(|node| HeritageKind::from_data(node.data))
        .collect();

    // `class Circle extends Shape implements Drawable` — nothing in the node kind
    // separates these, only the data bits. Confusing them makes an interface look
    // like a base class, which on the JVM is `super_class` versus `interfaces`.
    assert!(clauses.contains(&HeritageKind::Extends), "{clauses:?}");
    assert!(clauses.contains(&HeritageKind::Implements), "{clauses:?}");
}

#[test]
fn variable_declarations_report_let_against_const() {
    let Some(snapshot) = snapshot() else { return };
    let kinds: Vec<VariableKind> = snapshot
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Syntax(syntax::VARIABLE_DECLARATION_LIST))
        .map(|node| VariableKind::from_flags(node.flags))
        .collect();

    // `const` is what lets a backend treat a binding as immutable without proving
    // it. The bits are on NodeFlags, not on the node data the encoder docs suggest.
    assert!(kinds.contains(&VariableKind::Let), "{kinds:?}");
    assert!(kinds.contains(&VariableKind::Const), "{kinds:?}");
}
