//! The native field inventory cannot add a silently dropped semantic child.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;

use nts_semantic_schema::children;

include!("native_roles.rs");

type Row = (&'static str, &'static str, Option<&'static str>);

macro_rules! detail {
    () => {
        None
    };
    ($text:literal) => {
        Some($text)
    };
}

macro_rules! child_metadata {
    ($($name:ident => $projection:ident $(($detail:literal))?,)*) => {
        const CHILDREN: &[Row] = &[$((stringify!($name), stringify!($projection), detail!($($detail)?))),*];
    };
}
macro_rules! list_metadata {
    ($($name:ident => $projection:ident $(($detail:literal))?,)*) => {
        const LISTS: &[Row] = &[$((stringify!($name), stringify!($projection), detail!($($detail)?))),*];
    };
}

native_child_roles!(child_metadata);
native_list_roles!(list_metadata);

fn camel_case(field: &str) -> String {
    let mut uppercase = false;
    field
        .chars()
        .filter_map(|ch| {
            if ch == '_' {
                uppercase = true;
                None
            } else if std::mem::take(&mut uppercase) {
                Some(ch.to_ascii_uppercase())
            } else {
                Some(ch)
            }
        })
        .collect()
}

fn kind_names(owner: &str) -> Vec<&str> {
    match owner {
        "BindingPattern" => vec!["ObjectBindingPattern", "ArrayBindingPattern"],
        "CaseOrDefaultClause" => vec!["CaseClause", "DefaultClause"],
        "ForInOrOfStatement" => vec!["ForInStatement", "ForOfStatement"],
        "TypeAssertion" => vec!["TypeAssertionExpression"],
        _ => vec![
            owner,
            owner.strip_suffix("Node").unwrap_or(owner),
            owner.strip_suffix("Declaration").unwrap_or(owner),
        ],
    }
}

#[test]
fn every_native_field_has_a_slot_or_an_explicit_non_slot_reason() {
    let inventory: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../frontend-tsrs/api/roles.json"
    )))
    .unwrap();
    let mut remaining = BTreeMap::new();
    for (kind, rows) in [("child", CHILDREN), ("list", LISTS)] {
        for &(role, projection, detail) in rows {
            assert!(
                remaining
                    .insert((kind.to_owned(), role.to_owned()), (projection, detail))
                    .is_none(),
                "duplicate {kind} role {role}"
            );
        }
    }
    let mut expected = 0;
    for node in inventory["nodes"].as_array().unwrap() {
        let owner = node["owner"].as_str().unwrap();
        for field in node["fields"].as_array().unwrap() {
            expected += 1;
            let variant = field["variant"].as_str().unwrap();
            let kind = field["role"].as_str().unwrap();
            let (projection, detail) = remaining
                .remove(&(kind.to_owned(), variant.to_owned()))
                .unwrap_or_else(|| panic!("native role {variant} needs an explicit projection"));
            match projection {
                "Slot" => {
                    let property = detail.expect("slot name");
                    assert_eq!(
                        property,
                        camel_case(field["field"].as_str().unwrap()),
                        "{variant}"
                    );
                    let names = kind_names(owner);
                    assert!(
                        super::KINDS
                            .iter()
                            .any(|(name, semantic)| names.contains(name)
                                && children::properties(*semantic).contains(&property)),
                        "{owner}.{property} needs a semantic slot"
                    );
                }
                "ListContents" => {
                    assert_eq!(variant, "SyntaxListChildren");
                    assert_eq!(owner, "SyntaxList");
                    assert_eq!(kind, "list");
                }
                "NotSlot" => assert!(
                    !detail.expect("non-slot reason").is_empty(),
                    "{variant} needs a reason"
                ),
                other => panic!("unknown projection {other} for {variant}"),
            }
        }
    }
    assert!(
        expected >= 421,
        "the pinned field inventory must be complete"
    );
    assert_eq!(remaining, BTreeMap::new(), "stale role projections");
}

#[test]
fn checker_annotations_do_not_shift_a_method_body_slot() {
    assert_eq!(
        children::properties(nts_semantic_schema::syntax::METHOD_DECLARATION)
            .iter()
            .position(|field| *field == "body"),
        Some(7)
    );
    assert_eq!(
        CHILDREN
            .iter()
            .find(|row| row.0 == "MethodDeclarationFullSignature")
            .unwrap()
            .1,
        "NotSlot"
    );
    assert_eq!(
        CHILDREN
            .iter()
            .find(|row| row.0 == "MethodDeclarationBody")
            .unwrap()
            .2,
        Some("body")
    );
}

#[test]
fn typed_native_roles_project_without_a_numeric_role_encoding() {
    use crate::native_ast::roles::{self as implementation, Projection};
    use nts_frontend_tsrs::{ChildRole, ListRole};
    assert_eq!(
        implementation::child(ChildRole::MethodDeclarationBody),
        Projection::Slot("body")
    );
    assert!(matches!(
        implementation::child(ChildRole::MethodDeclarationFullSignature),
        Projection::NotSlot(_)
    ));
    assert_eq!(
        implementation::list(ListRole::SourceFileStatements),
        Projection::Slot("statements")
    );
    assert_eq!(
        implementation::list(ListRole::SyntaxListChildren),
        Projection::ListContents
    );
}
