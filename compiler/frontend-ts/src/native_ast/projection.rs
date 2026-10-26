//! One projection from native field roles onto nts's stable semantic slots.

use nts_frontend_tsrs::{Edge, Node};
use nts_semantic_schema::{SnapshotError, children, syntax};

use super::roles::{self, Projection};

pub(super) struct Projected<'p> {
    pub present: u8,
    pub edges: Vec<Edge<'p>>,
    pub contents: Option<Vec<Node<'p>>>,
}

pub(super) fn children(node: Node<'_>, kind: u16) -> Result<Projected<'_>, SnapshotError> {
    let mut projected = Vec::new();
    let mut contents = None;
    for edge in node.edges() {
        let projection = match edge {
            Edge::Node { role, .. } => roles::child(role),
            Edge::List { role, .. } => roles::list(role),
        };
        match projection {
            Projection::Slot(property) => {
                let slot = children::properties(kind)
                    .iter()
                    .position(|name| *name == property)
                    .ok_or_else(|| {
                        SnapshotError::Project(format!(
                            "native field {property} has no semantic slot on {} in {}",
                            syntax::name_of(kind).unwrap_or("unknown syntax"),
                            node.source_file().path()
                        ))
                    })?;
                projected.push((slot, edge));
            }
            Projection::ListContents => {
                let Edge::List { list, .. } = edge else {
                    return Err(SnapshotError::Project(
                        "native list contents is not a list".into(),
                    ));
                };
                contents = Some(list.iter().collect());
            }
            Projection::NotSlot(_) => {}
        }
    }
    projected.sort_unstable_by_key(|(slot, _)| *slot);
    let mut present = 0_u8;
    for (slot, _) in &projected {
        let bit = u32::try_from(*slot)
            .ok()
            .and_then(|slot| 1_u8.checked_shl(slot))
            .ok_or_else(|| {
                SnapshotError::Project("semantic child slot exceeds the presence mask".into())
            })?;
        if present & bit != 0 {
            return Err(SnapshotError::Project(
                "native fields share a semantic child slot".into(),
            ));
        }
        present |= bit;
    }
    Ok(Projected {
        present,
        edges: projected.into_iter().map(|(_, edge)| edge).collect(),
        contents,
    })
}
