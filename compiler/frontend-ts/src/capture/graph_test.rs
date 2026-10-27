//! Native service limits also cover deferred provided-container arguments.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::num::NonZeroU16;

use camino::Utf8Path;
use nts_frontend_tsrs::{ProjectSpec, SessionOptions};

use super::*;

fn with_capture(count: u16, check: impl FnOnce(&mut Capture<'_, '_>) + Send) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let config =
        root.join("compiler/frontend-ts/tests/programs/abi-payload-query-budget/tsconfig.json");
    let mut options = SessionOptions::new(root);
    options.checker_count = NonZeroU16::new(count);
    native::run(options, |session| {
        let checked = session.open(ProjectSpec::new(config)).unwrap();
        let paths: Vec<_> = checked
            .projects()
            .flat_map(native::Project::files)
            .filter(|file| !file.is_default_library() && !file.is_external_library())
            .map(|file| file.path().to_owned())
            .collect();
        let checked = checked.start_diagnostics(native::DiagnosticScope::Files(&paths));
        let project = checked.projects().next().unwrap();
        let project_root = project
            .config_path()
            .parent()
            .unwrap()
            .canonicalize_utf8()
            .unwrap();
        let mut capture = Capture::syntax(
            &project_root,
            project
                .files()
                .filter(|file| paths.contains(&file.path().to_owned())),
            project.semantics(),
        )
        .unwrap();
        check(&mut capture);
        assert_eq!(checked.finish().diagnostics(), []);
    });
}

fn named_type<'p>(capture: &Capture<'p, '_>, name: &str) -> Type<'p> {
    capture
        .native_nodes
        .iter()
        .flatten()
        .copied()
        .find(|node| node.name_text() == Some(name))
        .unwrap()
        .ty()
}

fn declared_return<'p>(capture: &Capture<'p, '_>, name: &str) -> Type<'p> {
    named_type(capture, name).signatures(native::SignatureKind::Call)[0].return_type()
}

fn assert_query_limit(trace: &[TypeQuery], allowance: usize) -> usize {
    let mut services = 0;
    let mut current = None;
    let mut exhausted = false;
    for &event in trace {
        match event {
            TypeQuery::Service(id) => {
                assert!(!exhausted, "native service after exhaustion: {trace:?}");
                services += 1;
                assert!(services <= allowance, "uncharged native service: {trace:?}");
                current = Some(id);
            }
            TypeQuery::Arguments(id) | TypeQuery::Expansion(id) => {
                assert!(!exhausted, "native query after exhaustion: {trace:?}");
                assert_eq!(
                    current,
                    Some(id),
                    "native query outside its charged service"
                );
            }
            TypeQuery::Exhausted => exhausted = true,
            TypeQuery::Owned(_) => {}
        }
    }
    services
}

#[test]
fn provided_generic_arguments_stop_at_the_native_service_allowance() {
    for count in [1, 4] {
        for allowance in [8, 128] {
            with_capture(count, |capture| {
                let returned = declared_return(capture, "demanded");
                let id = capture.intern_type(returned).unwrap();
                capture
                    .expand_types_with_allowance(vec![id], allowance)
                    .unwrap();
                let services = assert_query_limit(&capture.type_query_trace, allowance);
                let exhausted = allowance == 8;
                assert_eq!(capture.type_budget_exhausted, exhausted);
                let warnings: Vec<_> = capture
                    .snapshot
                    .diagnostics
                    .iter()
                    .filter(|diagnostic| diagnostic.code == "NTS0003")
                    .collect();
                assert_eq!(warnings.len(), usize::from(exhausted));
                if exhausted {
                    assert_eq!(services, allowance);
                    assert_eq!(capture.type_query_trace.last(), Some(&TypeQuery::Exhausted));
                    assert!(warnings[0].message.contains("budget of 8 types"));
                } else {
                    assert!(services > 24, "the entire finite chain was queried");
                    assert!(services < allowance);
                }
            });
        }
    }
}

#[test]
fn an_unused_generic_return_does_not_start_the_provided_argument_chain() {
    for count in [1, 4] {
        with_capture(count, |capture| {
            let callable = named_type(capture, "unused");
            let id = capture.intern_type(callable).unwrap();
            capture.expand_types_with_allowance(vec![id], 8).unwrap();
            assert!(!capture.type_budget_exhausted);
            assert!(assert_query_limit(&capture.type_query_trace, 8) < 8);
            let TypeKind::Function(signature) = capture.snapshot.types[id.0 as usize].kind else {
                panic!("generic callable contract");
            };
            let signature = &capture.snapshot.signatures[signature.0 as usize];
            assert_eq!(signature.type_parameters.len(), 2);
            assert!(matches!(
                capture.snapshot.types[signature.return_type.0 as usize].kind,
                TypeKind::Structured
            ));
            assert!(
                !capture
                    .snapshot
                    .type_arguments
                    .contains_key(&signature.return_type)
            );
        });
    }
}

#[test]
fn late_storage_demand_replays_owned_shapes_without_native_queries() {
    for count in [1, 4] {
        with_capture(count, |capture| {
            let payload = declared_return(capture, "ownedPayload");
            let payload_id = capture.intern_type(payload).unwrap();
            capture
                .expand_types_with_allowance(vec![payload_id], 128)
                .unwrap();
            assert!(!capture.type_budget_exhausted);
            let TypeKind::Object { properties } =
                &capture.snapshot.types[payload_id.0 as usize].kind
            else {
                panic!("owned payload object");
            };
            let array_id = properties
                .iter()
                .find(|property| property.name.public_name() == Some("entries"))
                .unwrap()
                .ty;
            let TypeKind::Array(union_id) = capture.snapshot.types[array_id.0 as usize].kind else {
                panic!("owned payload array");
            };
            assert!(matches!(
                capture.snapshot.types[union_id.0 as usize].kind,
                TypeKind::Union(_)
            ));
            let promise = declared_return(capture, "latePayload");
            let promise_id = capture.intern_type(promise).unwrap();
            capture.type_query_trace.clear();
            capture
                .expand_types_with_allowance(vec![promise_id], 1)
                .unwrap();
            assert!(!capture.type_budget_exhausted);
            assert_eq!(assert_query_limit(&capture.type_query_trace, 1), 1);
            for id in [payload_id, array_id, union_id] {
                assert!(capture.type_query_trace.contains(&TypeQuery::Owned(id)));
                assert!(!capture.type_query_trace.contains(&TypeQuery::Service(id)));
            }
            assert_eq!(capture.snapshot.type_arguments[&promise_id], [payload_id]);
        });
    }
}

use nts_semantic_schema::{
    DeclarationModifiers, NativeAttributes, NodeData, NodeId, NodeRecord, Origin, SemanticSnapshot,
};

fn demand_node(kind: NodeKind, children: Vec<NodeId>, native: bool) -> NodeRecord {
    NodeRecord {
        kind,
        origin: Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 0),
        }),
        parent: None,
        children,
        symbol: None,
        flags: 0,
        modifiers: DeclarationModifiers::default(),
        native: native.then(|| {
            Box::new(NativeAttributes {
                symbol: Some("arbitrary_native_symbol".into()),
                ..NativeAttributes::default()
            })
        }),
        data: NodeData::Children {
            present: 0,
            small: 0,
        },
        text: None,
    }
}

fn parameter_demand_fixture() -> SemanticSnapshot {
    let mut snapshot = SemanticSnapshot {
        nodes: vec![
            demand_node(
                NodeKind::Syntax(syntax::METHOD_SIGNATURE),
                vec![NodeId(1)],
                true,
            ),
            demand_node(NodeKind::List, vec![NodeId(2), NodeId(3)], false),
            demand_node(NodeKind::Syntax(syntax::PARAMETER), vec![], false),
            demand_node(NodeKind::Syntax(syntax::PARAMETER), vec![], false),
            demand_node(
                NodeKind::Syntax(syntax::METHOD_DECLARATION),
                vec![NodeId(5)],
                true,
            ),
            demand_node(NodeKind::Syntax(syntax::PARAMETER), vec![], false),
            demand_node(
                NodeKind::Syntax(syntax::METHOD_SIGNATURE),
                vec![NodeId(7)],
                false,
            ),
            demand_node(NodeKind::Syntax(syntax::PARAMETER), vec![], false),
            demand_node(
                NodeKind::Syntax(syntax::METHOD_SIGNATURE),
                vec![NodeId(9)],
                true,
            ),
            demand_node(NodeKind::Syntax(syntax::PARAMETER), vec![], false),
            demand_node(
                NodeKind::Syntax(syntax::FUNCTION_DECLARATION),
                vec![NodeId(11)],
                true,
            ),
            demand_node(NodeKind::Syntax(syntax::PARAMETER), vec![], false),
        ],
        ..SemanticSnapshot::default()
    };
    snapshot.node_types.extend([
        (NodeId(0), TypeId(20)),
        (NodeId(2), TypeId(40)),
        (NodeId(3), TypeId(41)),
        (NodeId(4), TypeId(20)),
        (NodeId(5), TypeId(40)),
        (NodeId(6), TypeId(20)),
        (NodeId(7), TypeId(50)),
        (NodeId(8), TypeId(30)),
        (NodeId(9), TypeId(60)),
        (NodeId(10), TypeId(20)),
        (NodeId(11), TypeId(70)),
    ]);
    snapshot
}

#[test]
fn native_parameter_edges_keep_their_callable_domain_and_source_order() {
    let snapshot = parameter_demand_fixture();
    let demands = native_parameter_demands(&snapshot).unwrap();
    assert_eq!(demands.len(), 2, "{demands:?}");
    assert_eq!(
        demands.get(&TypeId(20)),
        Some(&vec![TypeId(40), TypeId(41)])
    );
    assert_eq!(demands.get(&TypeId(30)), Some(&vec![TypeId(60)]));
    // Index construction is not a seed operation: the other callable's
    // parameter remains associated only with that callable; untagged methods
    // and independently rooted free functions add no edge here.
    assert!(!demands[&TypeId(20)].contains(&TypeId(60)));
    assert!(!demands.values().flatten().any(|id| matches!(id.0, 50 | 70)));
}
