//! JSX elements have types; their tag names carry symbol identities.
//!

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, TypeKind};

fn fixture(name: &str) -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/programs/{name} is checked in"))
}

fn jsx_snapshot() -> SemanticSnapshot {
    Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&fixture("jsx"))
        .expect("snapshot should succeed")
}

#[test]
fn a_tsx_file_typechecks_and_is_captured() {
    let snapshot = jsx_snapshot();
    // Capturing the syntax must not turn an intrinsic tag into a free variable.
    assert!(
        !snapshot.has_errors(),
        "the TSX fixture should typecheck: {:?}",
        snapshot.diagnostics,
    );
    assert!(snapshot.nodes.len() > 50);
}

#[test]
fn intrinsic_and_component_tag_names_keep_symbols_without_expression_types() {
    use nts_semantic_schema::syntax;

    let snapshot = jsx_snapshot();
    let tags: Vec<_> = snapshot
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Syntax(syntax::JSX_SELF_CLOSING_ELEMENT))
        .map(|element| element.children[0])
        .collect();
    assert_eq!(tags.len(), 2);
    for tag in tags {
        let node = &snapshot.nodes[tag.0 as usize];
        assert!(
            node.symbol.is_some(),
            "{} has its resolved symbol",
            node.text.as_ref().and_then(|text| text.as_utf8()).unwrap()
        );
        assert!(!snapshot.node_types.contains_key(&tag));
    }
}

#[test]
fn jsx_elements_carry_their_element_type() {
    let snapshot = jsx_snapshot();
    // This is what a renderer needs: the type at a JSX element, reached through
    // the ordinary node-type path rather than a JSX-specific one.
    let typed_jsx = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| matches!(node.kind, NodeKind::Syntax(kind) if kind > 280))
        .filter_map(|(index, _)| {
            snapshot
                .node_types
                .get(&NodeId(u32::try_from(index).unwrap()))
        })
        .filter(|id| {
            matches!(
                &snapshot.types[id.0 as usize].kind,
                TypeKind::Object { properties } if properties.iter().any(|p| p.name == "kind".into())
            )
        })
        .count();
    assert!(
        typed_jsx >= 1,
        "a JSX element should resolve to the declared JSX.Element type",
    );
}
