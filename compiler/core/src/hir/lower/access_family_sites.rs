//! The source sites that consume interface fields, shared by licensing and
//! exception analysis. Bulk reads must expose user-getter effects too.

use super::{FuncBuilder, Hierarchy, MemberKind, NodeId, TypeId, interfaces, syntax};
use nts_semantic_schema::walk;
use std::collections::BTreeMap;

pub(super) fn collect(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
) -> BTreeMap<NodeId, Vec<(TypeId, super::PropertyKey)>> {
    let mut sites = BTreeMap::new();
    for index in 0..probe.snapshot.nodes.len() {
        let Ok(index) = u32::try_from(index) else {
            continue;
        };
        let at = NodeId(index);
        let mut reads: Vec<(TypeId, super::PropertyKey)> = reads(probe, at)
            .into_iter()
            .flat_map(
                |(face, member)| match hierarchy.template_instances.get(&face) {
                    Some(instances) => instances
                        .iter()
                        .map(|instance| (*instance, member.clone()))
                        .collect::<Vec<_>>(),
                    None => vec![(face, member)],
                },
            )
            .collect();
        reads.retain(|(face, member)| {
            hierarchy.is_field_face(*face)
                && !hierarchy
                    .declares
                    .get(&hierarchy.declared_face(*face))
                    .is_some_and(|methods| {
                        methods.contains(&super::MemberKey::method(member.clone()))
                    })
                && interfaces::property(probe.snapshot, *face, member)
                    .is_some_and(|property| property.kind != MemberKind::Method)
        });
        if !reads.is_empty() {
            sites.insert(at, reads);
        }
    }
    sites
}

fn reads(probe: &FuncBuilder<'_>, at: NodeId) -> Vec<(TypeId, super::PropertyKey)> {
    if let Some((receiver, member)) = probe.member_access_key(at) {
        return probe
            .snapshot
            .node_types
            .get(&receiver)
            .map(|face| vec![(*face, member)])
            .unwrap_or_default();
    }
    let (face, member) = match probe.kind_of(at) {
        Some(syntax::SPREAD_ASSIGNMENT) => {
            let Some(source) = probe.children(at).first().copied() else {
                return Vec::new();
            };
            (probe.snapshot.node_types.get(&source).copied(), None)
        }
        Some(syntax::BINDING_ELEMENT) => {
            let Some(pattern) = walk::parent(probe.snapshot, at)
                .filter(|parent| probe.kind_of(*parent) == Some(syntax::OBJECT_BINDING_PATTERN))
            else {
                return Vec::new();
            };
            let Some([rest, property, name, _]) = probe.child_slots::<4>(at) else {
                return Vec::new();
            };
            let face = probe
                .snapshot
                .node_types
                .get(&pattern)
                .copied()
                .or_else(|| {
                    let declaration = walk::parent(probe.snapshot, pattern)?;
                    let source = probe.child_slots::<4>(declaration)?[3]?;
                    probe.snapshot.node_types.get(&source).copied()
                });
            let member = if rest.is_some() {
                None
            } else {
                property.or(name).and_then(|name| probe.property_key(name))
            };
            (face, member)
        }
        Some(syntax::PROPERTY_ASSIGNMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
            let Some(pattern) = walk::parent(probe.snapshot, at)
                .filter(|parent| probe.kind_of(*parent) == Some(syntax::OBJECT_LITERAL_EXPRESSION))
            else {
                return Vec::new();
            };
            let member = probe
                .children(at)
                .first()
                .and_then(|name| probe.property_key(*name));
            (assignment_source(probe, pattern), member)
        }
        _ => return Vec::new(),
    };
    let Some(face) = face else { return Vec::new() };
    if let Some(member) = member {
        return vec![(face, member)];
    }
    let Some(record) = probe.snapshot.types.get(face.0 as usize) else {
        return Vec::new();
    };
    let super::TypeKind::Object { properties } = &record.kind else {
        return Vec::new();
    };
    properties
        .iter()
        .map(|property| (face, property.name.clone()))
        .collect()
}

/// Assignment patterns are expressions rather than binding elements. Resolve
/// their source, including nested named patterns, before recording effects.
fn assignment_source(probe: &FuncBuilder<'_>, mut pattern: NodeId) -> Option<TypeId> {
    // Each iteration follows an enclosing AST construct. The snapshot's
    // parent relation is a finite tree, independent of pattern nesting depth.
    let mut keys = Vec::new();
    let mut source = loop {
        let parent = walk::parent(probe.snapshot, pattern)?;
        match probe.kind_of(parent)? {
            syntax::BINARY_EXPRESSION => {
                let parts = probe.children(parent);
                let [left, operator, right] = parts.as_slice() else {
                    return None;
                };
                if *left != pattern || probe.kind_of(*operator) != Some(syntax::EQUALS_TOKEN) {
                    return None;
                }
                break *probe.snapshot.node_types.get(right)?;
            }
            syntax::PROPERTY_ASSIGNMENT => {
                let parts = probe.children(parent);
                let [name, target] = parts.as_slice() else {
                    return None;
                };
                if *target != pattern {
                    return None;
                }
                keys.push(probe.property_key(*name)?);
                pattern = walk::parent(probe.snapshot, parent)?;
            }
            _ => return None,
        }
    };
    for key in keys.into_iter().rev() {
        source = interfaces::property(probe.snapshot, source, &key)?.ty;
    }
    Some(source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::{
        DeclarationModifiers, MemberKind, NodeData, NodeKind, NodeRecord, Origin, PropertyRecord,
        SemanticSnapshot, TypeKind, TypeRecord,
    };

    fn node(
        snapshot: &mut SemanticSnapshot,
        kind: u16,
        parent: Option<NodeId>,
        text: Option<&str>,
    ) -> NodeId {
        let id = NodeId(u32::try_from(snapshot.nodes.len()).expect("small AST"));
        snapshot.nodes.push(NodeRecord {
            kind: NodeKind::Syntax(kind),
            parent,
            children: Vec::new(),
            symbol: None,
            flags: 0,
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 0),
            }),
            modifiers: DeclarationModifiers::default(),
            native: None,
            data: NodeData::Flags { small: 0 },
            text: text.map(Into::into),
        });
        if let Some(parent) = parent {
            snapshot.nodes[parent.0 as usize].children.push(id);
        }
        id
    }

    fn property(name: &str, ty: TypeId) -> PropertyRecord {
        PropertyRecord {
            name: name.into(),
            ty,
            readonly: true,
            optional: false,
            declaration: None,
            kind: MemberKind::Field,
            own: true,
        }
    }

    fn assignment(depth: u32) -> (SemanticSnapshot, NodeId, NodeId) {
        let mut snapshot = SemanticSnapshot::default();
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object {
                properties: vec![property("value", TypeId(0))],
            },
            symbol: None,
        });
        for n in 1..=depth {
            snapshot.types.push(TypeRecord {
                kind: TypeKind::Object {
                    properties: vec![property(&format!("level{n}"), TypeId(n - 1))],
                },
                symbol: None,
            });
        }
        let root = node(&mut snapshot, syntax::BINARY_EXPRESSION, None, None);
        let mut pattern = node(
            &mut snapshot,
            syntax::OBJECT_LITERAL_EXPRESSION,
            Some(root),
            None,
        );
        for n in (1..=depth).rev() {
            let member = node(
                &mut snapshot,
                syntax::PROPERTY_ASSIGNMENT,
                Some(pattern),
                None,
            );
            node(
                &mut snapshot,
                syntax::IDENTIFIER,
                Some(member),
                Some(&format!("level{n}")),
            );
            pattern = node(
                &mut snapshot,
                syntax::OBJECT_LITERAL_EXPRESSION,
                Some(member),
                None,
            );
        }
        let leaf = node(
            &mut snapshot,
            syntax::PROPERTY_ASSIGNMENT,
            Some(pattern),
            None,
        );
        node(&mut snapshot, syntax::IDENTIFIER, Some(leaf), Some("value"));
        node(
            &mut snapshot,
            syntax::IDENTIFIER,
            Some(leaf),
            Some("target"),
        );
        node(&mut snapshot, syntax::EQUALS_TOKEN, Some(root), None);
        let source = node(
            &mut snapshot,
            syntax::IDENTIFIER,
            Some(root),
            Some("source"),
        );
        snapshot.node_types.insert(source, TypeId(depth));
        (snapshot, pattern, leaf)
    }

    #[test]
    fn deep_assignment_patterns_keep_their_getter_effect_site() {
        for depth in [4, 80, 1024] {
            let (snapshot, pattern, leaf) = assignment(depth);
            let lowering = super::super::LoweringSnapshot::new(&snapshot);
            let probe = FuncBuilder::probe(&lowering);
            assert_eq!(
                assignment_source(&probe, pattern),
                Some(TypeId(0)),
                "depth {depth}"
            );
            assert_eq!(
                reads(&probe, leaf),
                vec![(TypeId(0), "value".into())],
                "depth {depth}"
            );
        }
    }

    #[test]
    fn an_object_literal_outside_an_assignment_has_no_assignment_effects() {
        let (mut snapshot, pattern, leaf) = assignment(80);
        snapshot.nodes[0].kind = NodeKind::Syntax(syntax::CALL_EXPRESSION);
        let lowering = super::super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&lowering);
        assert_eq!(assignment_source(&probe, pattern), None);
        assert_eq!(reads(&probe, leaf), Vec::new());
    }
}
