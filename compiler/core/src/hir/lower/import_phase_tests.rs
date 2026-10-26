//! Source imports must reach the module's lowering checks even without a body.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_diagnostics::{Digest, Location, SourceFile, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, ImportPhase, ModuleRecord, NodeData, NodeId, NodeKind, NodeRecord,
    Origin, SemanticSnapshot, syntax,
};

fn import(phase: u8) -> SemanticSnapshot {
    let node = |kind, parent, children, data| NodeRecord {
        kind: NodeKind::Syntax(kind),
        origin: Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 42),
        }),
        parent,
        children,
        symbol: None,
        flags: 0,
        modifiers: DeclarationModifiers::default(),
        native: None,
        data,
        text: None,
    };
    SemanticSnapshot {
        sources: vec![SourceFile {
            uri: "nts-workspace:///main.ts".to_owned(),
            digest: Digest([0; 16]),
            display_path: "main.ts".into(),
            rewritten_by: None,
            rewritten_map: Vec::new(),
        }],
        nodes: vec![
            node(
                syntax::SOURCE_FILE,
                None,
                vec![NodeId(1)],
                NodeData::Flags { small: 0 },
            ),
            node(
                syntax::IMPORT_DECLARATION,
                Some(NodeId(0)),
                vec![NodeId(2)],
                NodeData::Children {
                    present: 1,
                    small: 0,
                },
            ),
            node(
                syntax::IMPORT_CLAUSE,
                Some(NodeId(1)),
                Vec::new(),
                NodeData::Children {
                    present: 0,
                    small: phase,
                },
            ),
        ],
        modules: vec![ModuleRecord {
            file: SourceId(0),
            imports: Vec::new(),
            exports: Vec::new(),
            root: NodeId(0),
        }],
        ..SemanticSnapshot::default()
    }
}

#[test]
fn only_a_source_phase_import_needs_source_loading() {
    for (phase, expected) in [
        ImportPhase::Value,
        ImportPhase::Type,
        ImportPhase::Defer,
        ImportPhase::Source,
    ]
    .into_iter()
    .enumerate()
    {
        let semantic = import(u8::try_from(phase).unwrap());
        assert_eq!(
            ImportPhase::from_data(semantic.nodes[2].data),
            Some(expected)
        );
        let snapshot = super::LoweringSnapshot::new(&semantic);
        let mut probe = super::FuncBuilder::probe(&snapshot);
        let source = expected == ImportPhase::Source;
        assert_eq!(probe.is_source_import(NodeId(1)), source);

        let (eager, deferred, refusals) = super::module_statements(
            &snapshot,
            &[false],
            &super::initialization::Analysis::default(),
        );
        assert_eq!(deferred, []);
        assert_eq!(refusals, []);
        if source {
            assert_eq!(eager, Some((NodeId(0), vec![NodeId(1)])));
            let error = probe
                .lower_statement(NodeId(1))
                .expect_err("source loading is unsupported");
            assert_eq!(error.code, "NTS1001");
            assert!(error.message.contains("an `import source` declaration"));
            assert!(
                error
                    .message
                    .contains("a module's source rather than its bindings")
            );
        } else {
            assert!(
                eager.is_none(),
                "{expected:?} uses the existing module-linking path"
            );
        }
    }
}
