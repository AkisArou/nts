//! Owned syntax and semantic facts captured through the native frontend.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{LiteralValue, NodeId, NodeKind, NodeRecord, SemanticSnapshot, TypeKind};

/// Absolute path to the workspace's `tests/programs/hello` fixture.
fn hello_tsconfig() -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/hello/tsconfig.json")
        .canonicalize_utf8()
        .expect("tests/programs/hello fixture is checked in")
}

/// nts semantic syntax tags stay stable across frontend updates.
mod kind {
    pub(crate) const IDENTIFIER: u16 = 79;
    pub(crate) const SOURCE_FILE: u16 = 307;
}

fn snapshot_of_hello() -> SemanticSnapshot {
    let mut source =
        Frontend::new(env!("CARGO_MANIFEST_DIR")).with_checkers(std::num::NonZeroU16::MIN);
    source
        .snapshot(&hello_tsconfig())
        .expect("snapshot should succeed")
}

fn find_by_text<'a>(snapshot: &'a SemanticSnapshot, text: &str) -> Option<&'a NodeRecord> {
    snapshot
        .nodes
        .iter()
        .find(|node| node.text.as_ref().and_then(|text| text.as_utf8()) == Some(text))
}

#[test]
fn the_captured_ast_is_rooted_at_a_source_file() {
    let snapshot = snapshot_of_hello();
    let root = &snapshot.nodes[0];
    assert_eq!(root.kind, NodeKind::Syntax(kind::SOURCE_FILE));
    assert_eq!(root.parent, None, "the root has no parent");
    assert!(
        snapshot.nodes.iter().skip(1).all(|n| n.parent.is_some()),
        "every node but the root is parented",
    );
}

#[test]
fn identifiers_carry_their_resolved_text() {
    let snapshot = snapshot_of_hello();
    for name in ["add", "a", "b", "greeting"] {
        let node = find_by_text(&snapshot, name)
            .unwrap_or_else(|| panic!("no node carried the text {name:?}"));
        assert_eq!(node.kind, NodeKind::Syntax(kind::IDENTIFIER));
    }
}

#[test]
fn spans_point_at_the_text_they_name() {
    let snapshot = snapshot_of_hello();
    // `add` is declared at column 16 of `export function add(...)`. If the span
    // and the resolved string ever disagree, every diagnostic and every debug-map
    // entry built on top is silently off.
    //
    // **Exactly the identifier, and this assertion is the point of the test.** It
    // used to read `4` with the message "span covers `add` plus its leading
    // trivia" -- the leading space -- because a node's `pos` is its *full start*,
    // the position after the previous token. Every diagnostic inherited that: a
    // declaration with a comment or a blank line above it reported at the end of
    // whatever came before, on the *previous line* when the trivia held a newline.
    // 1,585 of `runtime/node/stream`'s locations landed on whitespace or past the
    // end of a line; 61 do now.
    //
    // So the number changed because the thing it measures was wrong, and the test's
    // own name -- spans point at the text they name -- is what it now asserts.
    let add = find_by_text(&snapshot, "add").expect("`add` is declared");
    let span = add.origin.location.span;
    assert_eq!(
        span.len(),
        3,
        "the span is `add` and not the space before it"
    );
    assert!(span.start < span.end);
}

#[test]
fn the_return_expression_captures_as_a_three_child_binary() {
    let snapshot = snapshot_of_hello();
    // `return a + b` — the operands are the second and third `a`/`b` identifiers,
    // so locate the binary by shape rather than by index.
    let binary = snapshot
        .nodes
        .iter()
        .find(|node| {
            node.children.len() == 3
                && node
                    .children
                    .iter()
                    .filter_map(|c| {
                        snapshot.nodes[c.0 as usize]
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                    })
                    .eq(["a", "b"])
        })
        .expect("`a + b` should capture as a node with three children");

    let operator = &snapshot.nodes[binary.children[1].0 as usize];
    assert_eq!(operator.text, None, "the operator token carries no string");
    assert_eq!(operator.children, [] as [nts_semantic_schema::NodeId; 0]);
}

#[test]
fn source_paths_are_remapped_to_a_workspace_uri() {
    let snapshot = snapshot_of_hello();
    let source = &snapshot.sources[0];
    // No absolute machine path may reach an artifact.
    assert_eq!(source.uri, "nts-workspace:///src/main.ts");
    assert!(
        !source.uri.contains("/home/"),
        "uri leaked a home directory"
    );
    assert_ne!(
        source.digest.0, [0u8; 16],
        "the native source content hash was recorded"
    );
}

fn type_of<'a>(snapshot: &'a SemanticSnapshot, text: &str) -> &'a TypeKind {
    let index = snapshot
        .nodes
        .iter()
        .position(|node| node.text.as_ref().and_then(|text| text.as_utf8()) == Some(text))
        .unwrap_or_else(|| panic!("no node carried the text {text:?}"));
    let id = snapshot
        .node_types
        .get(&NodeId(u32::try_from(index).unwrap()))
        .unwrap_or_else(|| panic!("{text:?} has no resolved type"));
    &snapshot.types[id.0 as usize].kind
}

#[test]
fn annotated_parameters_resolve_to_their_declared_type() {
    let snapshot = snapshot_of_hello();
    assert_eq!(type_of(&snapshot, "a"), &TypeKind::Number);
    assert_eq!(type_of(&snapshot, "b"), &TypeKind::Number);
    assert_eq!(type_of(&snapshot, "greeting"), &TypeKind::String);
}

#[test]
fn a_string_literal_is_not_widened_to_string() {
    let snapshot = snapshot_of_hello();
    // The checker reports `"hello from nts"` with both StringLiteral and String
    // set. Classifying on the wider bit first would turn every constant in the
    // program into an opaque `string` and silently cost every literal
    // specialization the compiler could have made.
    let literal = snapshot
        .types
        .iter()
        .find(|record| matches!(record.kind, TypeKind::Literal(_)))
        .expect("the string literal keeps a literal type");
    assert_eq!(
        literal.kind,
        TypeKind::Literal(LiteralValue::String("hello from nts".into()))
    );
}

#[test]
fn the_addition_resolves_to_number() {
    let snapshot = snapshot_of_hello();
    // `a + b` — found by shape, as in the AST test.
    let (index, _) = snapshot
        .nodes
        .iter()
        .enumerate()
        .find(|(_, node)| {
            node.children.len() == 3
                && node
                    .children
                    .iter()
                    .filter_map(|c| {
                        snapshot.nodes[c.0 as usize]
                            .text
                            .as_ref()
                            .and_then(|text| text.as_utf8())
                    })
                    .eq(["a", "b"])
        })
        .expect("`a + b` is present");
    let id = snapshot.node_types[&NodeId(u32::try_from(index).unwrap())];
    assert_eq!(snapshot.types[id.0 as usize].kind, TypeKind::Number);
}

#[test]
fn types_are_interned_rather_than_duplicated_per_node() {
    let snapshot = snapshot_of_hello();
    // Many nodes are `number`; one record should serve them all. Without
    // interning the arena would grow with the program instead of with its types.
    assert!(
        snapshot.types.len() < snapshot.node_types.len() / 2,
        "{} type records for {} typed nodes suggests interning is not working",
        snapshot.types.len(),
        snapshot.node_types.len(),
    );
}

#[test]
fn node_lists_are_left_untyped_rather_than_failing_the_batch() {
    let snapshot = snapshot_of_hello();
    let lists = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.kind == NodeKind::List);
    let mut seen = 0;
    for (index, _) in lists {
        seen += 1;
        assert!(
            !snapshot
                .node_types
                .contains_key(&NodeId(u32::try_from(index).unwrap())),
            "an arena list has no checker type",
        );
    }
    assert!(seen > 0, "the fixture should contain node lists");
}
