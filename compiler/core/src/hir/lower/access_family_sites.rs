//! The source sites that consume interface fields, shared by licensing and
//! exception analysis. Bulk reads must expose user-getter effects too.

use super::{FuncBuilder, Hierarchy, MemberKind, NodeId, TypeId, interfaces, syntax};
use nts_semantic_schema::walk;
use std::collections::BTreeMap;

pub(super) fn collect(
    probe: &FuncBuilder<'_>,
    hierarchy: &Hierarchy,
) -> BTreeMap<NodeId, Vec<(TypeId, String)>> {
    let mut sites = BTreeMap::new();
    for index in 0..probe.snapshot.nodes.len() {
        let Ok(index) = u32::try_from(index) else {
            continue;
        };
        let at = NodeId(index);
        let mut reads = reads(probe, at);
        reads.retain(|(face, member)| {
            hierarchy.faces.contains(face)
                && !hierarchy
                    .declares
                    .get(face)
                    .is_some_and(|methods| methods.contains(member))
                && interfaces::property(probe.snapshot, *face, member)
                    .is_some_and(|property| property.kind != MemberKind::Method)
        });
        if !reads.is_empty() {
            sites.insert(at, reads);
        }
    }
    sites
}

fn reads(probe: &FuncBuilder<'_>, at: NodeId) -> Vec<(TypeId, String)> {
    if let Some((receiver, member)) = probe.member_access(at) {
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
                property.or(name).and_then(|name| probe.literal_name(name))
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
                .and_then(|name| probe.literal_name(*name));
            (assignment_source(probe, pattern, 0), member)
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
fn assignment_source(probe: &FuncBuilder<'_>, pattern: NodeId, depth: u32) -> Option<TypeId> {
    if depth >= 32 {
        return None;
    }
    let parent = walk::parent(probe.snapshot, pattern)?;
    match probe.kind_of(parent)? {
        syntax::BINARY_EXPRESSION => {
            let parts = probe.children(parent);
            let [left, operator, right] = parts.as_slice() else {
                return None;
            };
            (*left == pattern && probe.kind_of(*operator) == Some(syntax::EQUALS_TOKEN))
                .then(|| probe.snapshot.node_types.get(right).copied())?
        }
        syntax::PROPERTY_ASSIGNMENT => {
            let parts = probe.children(parent);
            let [name, target] = parts.as_slice() else {
                return None;
            };
            if *target != pattern {
                return None;
            }
            let outer = walk::parent(probe.snapshot, parent)?;
            let source = assignment_source(probe, outer, depth + 1)?;
            let name = probe.literal_name(*name)?;
            Some(interfaces::property(probe.snapshot, source, &name)?.ty)
        }
        _ => None,
    }
}
