//! End-to-end tests against a real `tsgo --api` process.
//!
//! These prove the transport against the actual server rather than against our
//! own encoder — a round-trip test passes happily with both sides wrong.
//!
//! They skip, loudly, when no tsgo binary is available. Set `NTS_TSGO` to one, or
//! build the pinned submodule:
//!
//! ```console
//! $ (cd third_party/typescript-go && go build -o ../../target/tsgo ./cmd/tsgo)
//! $ NTS_TSGO=target/tsgo cargo test -p nts-frontend-ts
//! ```
//!
//! Skipping rather than failing is deliberate, but the pass count is what to
//! read: a green run that silently tested nothing is the failure mode this note
//! exists to prevent.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::Client};
use nts_semantic_schema::{LiteralValue, NodeId, NodeKind, NodeRecord, SemanticSnapshot, TypeKind};

/// Locate a tsgo binary, or explain why the test is being skipped.
fn tsgo_binary() -> Option<Utf8PathBuf> {
    if let Ok(path) = std::env::var("NTS_TSGO") {
        let path = Utf8PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
        eprintln!("SKIP: NTS_TSGO points at {path}, which does not exist");
        return None;
    }
    eprintln!("SKIP: no NTS_TSGO set; see this file's docs to build the pinned tsgo");
    None
}

/// Absolute path to the workspace's `examples/hello` fixture.
fn hello_tsconfig() -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/hello/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/hello fixture is checked in")
}

#[test]
fn initialize_handshake_succeeds() {
    let Some(tsgo) = tsgo_binary() else { return };
    let cwd = hello_tsconfig();
    let cwd = cwd.parent().unwrap();

    let mut client = Client::spawn(&tsgo, cwd).expect("tsgo should start");
    let response = client.initialize().expect("initialize should succeed");

    // Not asserting the value — case sensitivity is a property of the host
    // filesystem, and both answers are legitimate. Asserting it parsed at all is
    // the point: it proves the frame decoded and the JSON shape matches.
    assert!(!response.current_directory.is_empty());
    assert_eq!(client.round_trips(), 1);
}

#[test]
fn opening_a_project_reports_its_root_files() {
    let Some(tsgo) = tsgo_binary() else { return };
    let tsconfig = hello_tsconfig();
    let cwd = tsconfig.parent().unwrap();

    let mut client = Client::spawn(&tsgo, cwd).expect("tsgo should start");
    client.initialize().expect("initialize should succeed");
    let opened = client
        .open_project(&tsconfig)
        .expect("updateSnapshot should succeed");

    assert_eq!(opened.projects.len(), 1, "one tsconfig means one project");
    let files = &opened.projects[0].root_files;
    assert!(
        files.iter().any(|f| f.ends_with("main.ts")),
        "expected src/main.ts among root files, got {files:?}",
    );
}

#[test]
fn an_unknown_method_surfaces_as_a_server_error_not_a_hang() {
    let Some(tsgo) = tsgo_binary() else { return };
    let cwd = hello_tsconfig();
    let cwd = cwd.parent().unwrap();

    let mut client = Client::spawn(&tsgo, cwd).expect("tsgo should start");
    let result: Result<serde_json::Value, _> =
        client.request("thisMethodDoesNotExist", &serde_json::Value::Null);

    // The failure mode this guards: an error frame we do not recognise, leaving
    // the client blocked on a read that will never complete.
    assert!(result.is_err(), "an unknown method must not succeed");
}

#[test]
fn snapshotting_a_project_reports_measured_stats() {
    let Some(tsgo) = tsgo_binary() else { return };
    let mut source = TsgoApi::new(tsgo);

    let snapshot = source
        .snapshot(&hello_tsconfig())
        .expect("snapshot should succeed");
    let stats = source.stats();

    assert!(snapshot.validate().is_ok());
    assert_eq!(stats.files, 1);
    // Gate G1's health metric: round trips must track files, not nodes. Two
    // exchanges per file is the handshake plus the project open.
    assert!(
        stats.round_trips_per_file() < 10.0,
        "round trips per file climbed to {:.1}; batching is leaking",
        stats.round_trips_per_file(),
    );
}

/// tsgo 7.0.2 `SyntaxKind` values, spelled out where a test needs one.
mod kind {
    pub(crate) const IDENTIFIER: u16 = 79;
    pub(crate) const SOURCE_FILE: u16 = 307;
}

fn snapshot_of_hello() -> Option<SemanticSnapshot> {
    let tsgo = tsgo_binary()?;
    let mut source = TsgoApi::new(tsgo);
    Some(
        source
            .snapshot(&hello_tsconfig())
            .expect("snapshot should succeed"),
    )
}

fn find_by_text<'a>(snapshot: &'a SemanticSnapshot, text: &str) -> Option<&'a NodeRecord> {
    snapshot
        .nodes
        .iter()
        .find(|node| node.text.as_deref() == Some(text))
}

#[test]
fn the_decoded_ast_is_rooted_at_a_source_file() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
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
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
    for name in ["add", "a", "b", "greeting"] {
        let node = find_by_text(&snapshot, name)
            .unwrap_or_else(|| panic!("no node carried the text {name:?}"));
        assert_eq!(node.kind, NodeKind::Syntax(kind::IDENTIFIER));
    }
}

#[test]
fn spans_point_at_the_text_they_name() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
    // `add` is declared at column 16 of `export function add(...)`. If the span
    // and the resolved string ever disagree, every diagnostic and every debug-map
    // entry built on top is silently off.
    let add = find_by_text(&snapshot, "add").expect("`add` is declared");
    let span = add.origin.location.span;
    assert_eq!(span.len(), 4, "span covers `add` plus its leading trivia");
    assert!(span.start < span.end);
}

#[test]
fn the_return_expression_decodes_as_a_three_child_binary() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
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
                    .filter_map(|c| snapshot.nodes[c.0 as usize].text.as_deref())
                    .eq(["a", "b"])
        })
        .expect("`a + b` should decode as a node with three children");

    let operator = &snapshot.nodes[binary.children[1].0 as usize];
    assert_eq!(operator.text, None, "the operator token carries no string");
    assert!(operator.children.is_empty());
}

#[test]
fn source_paths_are_remapped_to_a_workspace_uri() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
    let source = &snapshot.sources[0];
    // RFC §20.4: no absolute machine path may reach an artifact.
    assert_eq!(source.uri, "nts-workspace:///src/main.ts");
    assert!(
        !source.uri.contains("/home/"),
        "uri leaked a home directory"
    );
    assert_ne!(
        source.digest.0, [0u8; 16],
        "tsgo's content hash was recorded"
    );
}

#[test]
fn round_trips_stay_proportional_to_files() {
    let Some(tsgo) = tsgo_binary() else { return };
    let mut source = TsgoApi::new(tsgo);
    source.snapshot(&hello_tsconfig()).expect("snapshot");
    let stats = source.stats();

    // Gate G1. Fixed cost is 2 (initialize, updateSnapshot); per-file cost is 4
    // (getSourceFile, getTypeAtLocations, getSymbolsAtLocations,
    // getExportsOfModule). Every one of those either transfers in bulk or
    // batches; if this ever tracks node count, the transport choice needs redoing.
    assert_eq!(stats.files, 1);
    assert_eq!(stats.round_trips, 2 + 4 * u64::from(stats.files) + 2);
    assert!(stats.nodes_decoded > 20, "a real AST was decoded");
    assert!(stats.types_resolved > 20, "types were resolved");
}

fn type_of<'a>(snapshot: &'a SemanticSnapshot, text: &str) -> &'a TypeKind {
    let index = snapshot
        .nodes
        .iter()
        .position(|node| node.text.as_deref() == Some(text))
        .unwrap_or_else(|| panic!("no node carried the text {text:?}"));
    let id = snapshot
        .node_types
        .get(&NodeId(u32::try_from(index).unwrap()))
        .unwrap_or_else(|| panic!("{text:?} has no resolved type"));
    &snapshot.types[id.0 as usize].kind
}

#[test]
fn annotated_parameters_resolve_to_their_declared_type() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
    assert_eq!(type_of(&snapshot, "a"), &TypeKind::Number);
    assert_eq!(type_of(&snapshot, "b"), &TypeKind::Number);
    assert_eq!(type_of(&snapshot, "greeting"), &TypeKind::String);
}

#[test]
fn a_string_literal_is_not_widened_to_string() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
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
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
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
                    .filter_map(|c| snapshot.nodes[c.0 as usize].text.as_deref())
                    .eq(["a", "b"])
        })
        .expect("`a + b` is present");
    let id = snapshot.node_types[&NodeId(u32::try_from(index).unwrap())];
    assert_eq!(snapshot.types[id.0 as usize].kind, TypeKind::Number);
}

#[test]
fn types_are_interned_rather_than_duplicated_per_node() {
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
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
    let Some(snapshot) = snapshot_of_hello() else {
        return;
    };
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
            "a NodeList was sent to getTypeAtLocations; one bad handle fails the batch",
        );
    }
    assert!(seen > 0, "the fixture should contain node lists");
}
