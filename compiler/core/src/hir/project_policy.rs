//! The project-wide compile policy, shared by CLI entry and raw lowering.

use nts_diagnostics::{Diagnostic, Location, SourceId, Span};
use nts_semantic_schema::{NodeKind, SemanticSnapshot, StrictOptionSource, syntax as S};

/// NTS1006: a required effective project compiler setting is disabled.
pub const PROJECT_SETTINGS_REFUSAL: &str = "NTS1006";

/// Refuse disabled effective strict options, independently of which constructs
/// the program happens to contain. This does not change checker diagnostics.
#[must_use]
pub fn strict_rejections(snapshot: &SemanticSnapshot) -> Vec<Diagnostic> {
    let semantics = &snapshot.semantics;
    let disabled: Vec<_> = [
        ("noImplicitAny", semantics.no_implicit_any),
        ("strictNullChecks", semantics.strict_null_checks),
        ("strictFunctionTypes", semantics.strict_function_types),
        ("strictBindCallApply", semantics.strict_bind_call_apply),
        (
            "strictPropertyInitialization",
            semantics.strict_property_initialization,
        ),
        (
            "strictBuiltinIteratorReturn",
            semantics.strict_builtin_iterator_return,
        ),
        ("noImplicitThis", semantics.no_implicit_this),
        (
            "useUnknownInCatchVariables",
            semantics.use_unknown_in_catch_variables,
        ),
        ("alwaysStrict", semantics.always_strict),
    ]
    .into_iter()
    .filter(|(_, enabled)| !enabled)
    .map(|(name, _)| name)
    .collect();
    if disabled.is_empty() {
        return Vec::new();
    }
    let source_of = |name: &str| {
        semantics
            .disabled_strict_sources
            .iter()
            .find(|source| source.name == name)
    };
    let location = disabled
        .iter()
        .filter_map(|name| source_of(name))
        .find_map(|source| setting_location(snapshot, source))
        .unwrap_or(Location {
            file: SourceId(0),
            span: Span::new(0, 0),
        });
    let descriptions: Vec<_> = disabled
        .into_iter()
        .map(|name| {
            source_of(name).map_or_else(
                || format!("{name}: false (configuration provenance unavailable)"),
                |source| {
                    format!(
                        "{name}: false ({} sets {}: false)",
                        source.configuration, source.setting
                    )
                },
            )
        })
        .collect();
    // A compile policy, not a checker diagnostic: frontend-only audits
    // retain the native checker's original diagnostics and populations.
    vec![Diagnostic::error(
        PROJECT_SETTINGS_REFUSAL,
        format!(
            "compiling a project requires every strict option in effect: {}",
            descriptions.join("; ")
        ),
        location,
    )]
}

fn setting_location(snapshot: &SemanticSnapshot, source: &StrictOptionSource) -> Option<Location> {
    let index = snapshot
        .sources
        .iter()
        .position(|file| file.uri == source.configuration)?;
    let file = SourceId(u32::try_from(index).ok()?);
    let at = |id: nts_semantic_schema::NodeId| snapshot.nodes.get(id.0 as usize);
    let mut keys = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter_map(|(index, node)| {
            if node.origin.location.file != file
                || node.text.as_ref().and_then(|text| text.as_utf8())
                    != Some(source.setting.as_str())
            {
                return None;
            }
            let assignment = at(node.parent?)?;
            if assignment.kind != NodeKind::Syntax(S::PROPERTY_ASSIGNMENT)
                || assignment.children.first()?.0 as usize != index
            {
                return None;
            }
            let mut object = at(assignment.parent?)?;
            if object.kind == NodeKind::List {
                object = at(object.parent?)?;
            }
            if object.kind != NodeKind::Syntax(S::OBJECT_LITERAL_EXPRESSION) {
                return None;
            }
            let options = at(object.parent?)?;
            let name = at(*options.children.first()?)?;
            (options.kind == NodeKind::Syntax(S::PROPERTY_ASSIGNMENT)
                && name.text.as_ref().and_then(|text| text.as_utf8()) == Some("compilerOptions"))
            .then_some(node.origin.location)
        });
    let first = keys.next();
    // Do not guess between duplicate keys or unavailable captured positions.
    Some(
        if keys.next().is_none() { first } else { None }.unwrap_or(Location {
            file,
            span: Span::new(0, 0),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_disabled_strict_member_refuses_before_any_construct_is_lowered() {
        type Disable = fn(&mut nts_semantic_schema::ProjectSemantics);
        let settings: [(&str, Disable); 9] = [
            ("noImplicitAny", |o| o.no_implicit_any = false),
            ("strictNullChecks", |o| o.strict_null_checks = false),
            ("strictFunctionTypes", |o| o.strict_function_types = false),
            ("strictBindCallApply", |o| o.strict_bind_call_apply = false),
            ("strictPropertyInitialization", |o| {
                o.strict_property_initialization = false;
            }),
            ("strictBuiltinIteratorReturn", |o| {
                o.strict_builtin_iterator_return = false;
            }),
            ("noImplicitThis", |o| o.no_implicit_this = false),
            ("useUnknownInCatchVariables", |o| {
                o.use_unknown_in_catch_variables = false;
            }),
            ("alwaysStrict", |o| o.always_strict = false),
        ];
        for (name, disable) in settings {
            let mut snapshot = SemanticSnapshot::default();
            disable(&mut snapshot.semantics);
            snapshot.semantics.disabled_strict_sources.push(
                nts_semantic_schema::StrictOptionSource {
                    name: name.to_owned(),
                    configuration: "nts-workspace:///../base.json".to_owned(),
                    setting: "strict".to_owned(),
                },
            );
            let rejected = strict_rejections(&snapshot);
            assert_eq!(rejected.len(), 1, "{name}: {rejected:?}");
            assert_eq!(rejected[0].code, PROJECT_SETTINGS_REFUSAL);
            assert!(rejected[0].message.contains(name), "{rejected:?}");
            assert!(
                rejected[0]
                    .message
                    .contains("../base.json sets strict: false"),
                "{rejected:?}"
            );
        }
    }

    #[test]
    fn the_bundle_switch_is_not_required_when_its_members_are_all_enabled() {
        let mut snapshot = SemanticSnapshot::default();
        snapshot.semantics.strict = false;
        assert_eq!(strict_rejections(&snapshot), []);
    }

    #[test]
    fn exhausted_provenance_never_waives_an_effective_disabled_option() {
        let mut snapshot = SemanticSnapshot::default();
        snapshot.semantics.no_implicit_any = false;
        let rejected = strict_rejections(&snapshot);
        assert_eq!(rejected.len(), 1);
        assert!(
            rejected[0]
                .message
                .contains("noImplicitAny: false (configuration provenance unavailable)")
        );
        snapshot.semantics.no_implicit_any = true;
        snapshot.semantics.always_strict = false;
        let rejected = strict_rejections(&snapshot);
        assert_eq!(rejected[0].code, PROJECT_SETTINGS_REFUSAL);
        assert!(
            rejected[0]
                .message
                .contains("alwaysStrict: false (configuration provenance unavailable)")
        );
    }

    #[test]
    fn a_captured_configuration_points_at_its_setting() {
        use nts_semantic_schema::{NodeData, NodeId, NodeRecord, Origin};
        let mut snapshot = SemanticSnapshot::default();
        snapshot.semantics.no_implicit_any = false;
        snapshot
            .semantics
            .disabled_strict_sources
            .push(StrictOptionSource {
                name: "noImplicitAny".into(),
                configuration: "nts-workspace:///base.json".into(),
                setting: "noImplicitAny".into(),
            });
        snapshot.sources = ["main.ts", "base.json"]
            .into_iter()
            .map(|name| nts_diagnostics::SourceFile {
                uri: format!("nts-workspace:///{name}"),
                digest: nts_diagnostics::Digest([0; 16]),
                display_path: name.into(),
                rewritten_by: None,
                rewritten_map: Vec::new(),
            })
            .collect();
        let node = |kind, text: Option<&str>, parent, children, span| NodeRecord {
            kind,
            text: text.map(Into::into),
            parent,
            children,
            origin: Origin::source(Location {
                file: SourceId(1),
                span,
            }),
            symbol: None,
            flags: 0,
            modifiers: nts_semantic_schema::DeclarationModifiers::default(),
            native: None,
            data: NodeData::Flags { small: 0 },
        };
        snapshot.nodes = vec![
            node(
                NodeKind::Syntax(S::STRING_LITERAL),
                Some("compilerOptions"),
                Some(NodeId(1)),
                vec![],
                Span::new(1, 18),
            ),
            node(
                NodeKind::Syntax(S::PROPERTY_ASSIGNMENT),
                None,
                None,
                vec![NodeId(0), NodeId(2)],
                Span::new(1, 60),
            ),
            node(
                NodeKind::Syntax(S::OBJECT_LITERAL_EXPRESSION),
                None,
                Some(NodeId(1)),
                vec![NodeId(3)],
                Span::new(20, 60),
            ),
            node(
                NodeKind::Syntax(S::PROPERTY_ASSIGNMENT),
                None,
                Some(NodeId(2)),
                vec![NodeId(4)],
                Span::new(25, 55),
            ),
            node(
                NodeKind::Syntax(S::STRING_LITERAL),
                Some("noImplicitAny"),
                Some(NodeId(3)),
                vec![],
                Span::new(25, 40),
            ),
        ];
        let rejected = strict_rejections(&snapshot);
        assert_eq!(
            rejected[0].primary,
            Location {
                file: SourceId(1),
                span: Span::new(25, 40)
            }
        );
        snapshot.sources[1].uri = "nts-workspace:///unrelated.json".into();
        let rejected = strict_rejections(&snapshot);
        assert_eq!(rejected[0].primary.file, SourceId(0));
        assert!(
            rejected[0].message.contains("base.json"),
            "missing source retains its provenance in the message"
        );
    }
}
