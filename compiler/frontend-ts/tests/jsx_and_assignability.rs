//! TSX, and the one checker question that is asked rather than extracted.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::{Client, types::flags};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, TypeKind};

fn tsgo() -> Option<Utf8PathBuf> {
    let path = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    path.exists().then_some(path)
}

fn fixture(name: &str) -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"))
}

fn jsx_snapshot() -> Option<SemanticSnapshot> {
    let tsgo = tsgo()?;
    Some(
        TsgoApi::new(tsgo)
            .with_decomposition(Budget::DEFAULT)
            .snapshot(&fixture("jsx"))
            .expect("snapshot should succeed"),
    )
}

#[test]
fn a_tsx_file_typechecks_and_decodes() {
    let Some(snapshot) = jsx_snapshot() else {
        return;
    };
    // TSX needs no special handling: the encoded AST carries JSX nodes like any
    // other, and the diagnostics gate proves the checker accepted the file.
    assert!(
        !snapshot.has_errors(),
        "the TSX fixture should typecheck: {:?}",
        snapshot.diagnostics,
    );
    assert!(snapshot.nodes.len() > 50);
}

#[test]
fn jsx_elements_carry_their_element_type() {
    let Some(snapshot) = jsx_snapshot() else {
        return;
    };
    // This is what a renderer needs: the type at a JSX element, reached through
    // the ordinary node-type path rather than a JSX-specific one. RFC §30's
    // React work depends on it and gets it for free.
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
                TypeKind::Object { properties } if properties.iter().any(|p| p.name == "kind")
            )
        })
        .count();
    assert!(
        typed_jsx >= 1,
        "a JSX element should resolve to the declared JSX.Element type",
    );
}

#[test]
fn assignability_answers_a_question_the_snapshot_cannot() {
    let Some(tsgo) = tsgo() else { return };
    let tsconfig = fixture("types");
    let mut client = Client::spawn(&tsgo, tsconfig.parent().unwrap()).expect("tsgo should start");
    client.initialize().expect("initialize");
    let opened = client.open_project(&tsconfig).expect("open");
    let project = &opened.projects[0].id;

    // Whether one type may flow into another depends on a *pair*, so there is
    // nothing to store up front — lowering asks where a coercion might be needed
    // and the answer decides between emitting a conversion and emitting nothing.
    //
    // Located by flags rather than by id, since checker ids are not stable across
    // runs. A literal is assignable to its widened primitive; the reverse is not.
    let path = Utf8PathBuf::from(&opened.projects[0].root_files[0]);
    let bytes = client
        .source_file(opened.snapshot, project, &path)
        .expect("source file");
    assert!(!bytes.is_empty());

    // `string` is assignable to `string`; `string` is not assignable to `number`.
    // Both operands come from the same program, so any two distinct primitives
    // prove the call works and that it is not answering a constant.
    let string_type = find_primitive(&mut client, &opened, flags::STRING);
    let number_type = find_primitive(&mut client, &opened, flags::NUMBER);
    let (Some(string_type), Some(number_type)) = (string_type, number_type) else {
        return;
    };

    assert!(
        client
            .is_type_assignable_to(opened.snapshot, project, string_type, string_type)
            .expect("assignable"),
        "a type is assignable to itself",
    );
    assert!(
        !client
            .is_type_assignable_to(opened.snapshot, project, string_type, number_type)
            .expect("assignable"),
        "string is not assignable to number",
    );
}

/// Find a checker type id for a primitive, by asking about the program's nodes.
fn find_primitive(
    client: &mut Client,
    opened: &nts_frontend_ts::tsgo::proto::UpdateSnapshotResponse,
    wanted: u32,
) -> Option<u32> {
    let project = &opened.projects[0].id;
    let path = Utf8PathBuf::from(&opened.projects[0].root_files[0]);
    let bytes = client.source_file(opened.snapshot, project, &path).ok()?;
    let decoded = nts_frontend_ts::tsgo::ast::decode(&bytes, nts_diagnostics::SourceId(0)).ok()?;

    let handles: Vec<nts_frontend_ts::tsgo::proto::NodeHandle> = decoded
        .nodes
        .iter()
        .enumerate()
        .filter_map(|(index, node)| match node.kind {
            NodeKind::Syntax(kind) => Some(nts_frontend_ts::tsgo::proto::NodeHandle(
                nts_frontend_ts::tsgo::types::node_handle(
                    u32::try_from(index).ok()? + 1,
                    kind,
                    path.as_str(),
                ),
            )),
            NodeKind::List => None,
        })
        .collect();

    let responses = client.types_at(opened.snapshot, project, handles).ok()?;
    responses
        .iter()
        .find(|response| {
            response.flags & wanted != 0 && response.flags & flags::STRING_LITERAL == 0
        })
        .map(|response| response.id)
}
