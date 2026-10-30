//! Complete binding-then membership over the finite semantic type graph.
//!
//! Only absence, one certain signature, or ambiguity is consumed. Saturating
//! cardinality at two avoids expanding shared unions/intersections into an
//! exponential list, while retaining multiplicity and union uncertainty.

use super::{NodeId, SemanticSnapshot, Thenables, TypeId, TypeKind};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Found {
    None,
    One(NodeId, bool),
    Many,
}

impl Found {
    fn join(self, other: Self) -> Self {
        match (self, other) {
            (Self::None, answer) | (answer, Self::None) => answer,
            _ => Self::Many,
        }
    }

    fn uncertain(self) -> Self {
        match self {
            Self::One(signature, _) => Self::One(signature, false),
            answer => answer,
        }
    }
}

pub(super) fn collect(
    snapshot: &SemanticSnapshot,
    thenables: &Thenables,
    ty: TypeId,
) -> Result<Found, &'static str> {
    let mut pending = vec![(ty, false)];
    let mut active = FxHashSet::default();
    let mut complete = FxHashMap::default();
    while let Some((at, leaving)) = pending.pop() {
        if complete.contains_key(&at) {
            continue;
        }
        let kind = &snapshot
            .types
            .get(at.0 as usize)
            .ok_or("an incomplete type graph while discovering a binding's thenable")?
            .kind;
        match kind {
            TypeKind::Union(members) | TypeKind::Intersection(members) => {
                if leaving {
                    let mut answer = Found::None;
                    for member in members {
                        let member = complete.get(member).copied().ok_or(
                            "an unfinished type graph while discovering a binding's thenable",
                        )?;
                        answer = answer.join(member);
                    }
                    if matches!(kind, TypeKind::Union(_)) {
                        answer = answer.uncertain();
                    }
                    active.remove(&at);
                    complete.insert(at, answer);
                } else {
                    if !active.insert(at) {
                        return Err("a cyclic type graph while discovering a binding's thenable");
                    }
                    pending.push((at, true));
                    pending.extend(members.iter().rev().map(|member| (*member, false)));
                }
            }
            TypeKind::Object { properties } => {
                let signature = properties
                    .iter()
                    .find(|property| property.name.is_name("then"))
                    .and_then(|property| property.declaration)
                    .filter(|signature| thenables.signatures.contains_key(signature));
                complete.insert(
                    at,
                    signature.map_or(Found::None, |signature| Found::One(signature, true)),
                );
            }
            _ => {
                complete.insert(at, Found::None);
            }
        }
    }
    complete
        .get(&ty)
        .copied()
        .ok_or("an unfinished type graph while discovering a binding's thenable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_semantic_schema::{MemberKind, PropertyRecord, TypeRecord};

    fn graph(depth: u32, union: bool) -> (SemanticSnapshot, Thenables, TypeId) {
        let mut snapshot = SemanticSnapshot::default();
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object {
                properties: vec![PropertyRecord {
                    name: "then".into(),
                    ty: TypeId(0),
                    readonly: true,
                    optional: false,
                    declaration: Some(NodeId(0)),
                    kind: MemberKind::Method,
                    own: true,
                }],
            },
            symbol: None,
        });
        let mut ty = TypeId(0);
        for n in 1..=depth {
            snapshot.types.push(TypeRecord {
                kind: if union {
                    TypeKind::Union(vec![ty])
                } else {
                    TypeKind::Intersection(vec![ty])
                },
                symbol: None,
            });
            ty = TypeId(n);
        }
        let mut thenables = Thenables::default();
        thenables
            .signatures
            .insert(NodeId(0), super::super::Thenable::Job(7));
        (snapshot, thenables, ty)
    }

    #[test]
    fn the_resolve_site_uses_the_complete_type_graph() {
        use nts_diagnostics::{Location, SourceId, Span};
        use nts_semantic_schema::{
            DeclarationModifiers, NodeData, NodeKind, NodeRecord, Origin, syntax,
        };
        for depth in [4, 80] {
            for union in [false, true] {
                let (mut snapshot, thenables, ty) = graph(depth, union);
                snapshot.nodes.push(NodeRecord {
                    kind: NodeKind::Syntax(syntax::IDENTIFIER),
                    parent: None,
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
                    text: None,
                });
                snapshot.node_types.insert(NodeId(0), ty);
                let lowering = super::super::LoweringSnapshot::new(&snapshot);
                let mut builder = super::super::FuncBuilder::probe(&lowering);
                builder.thenables = std::rc::Rc::new(thenables);
                let answer = builder.binding_thenable(NodeId(0));
                if union {
                    let diagnostic = answer
                        .expect_err("an uncertain binding thenable cannot choose a static job");
                    assert!(
                        diagnostic
                            .message
                            .contains("may or may not be a binding's thenable")
                    );
                } else {
                    assert_eq!(
                        answer.expect("complete certain membership"),
                        Some(7),
                        "depth {depth}"
                    );
                }
            }
        }
    }

    #[test]
    fn deeply_nested_binding_thenables_remain_present_and_certain() {
        for depth in [4, 80, 1024] {
            let (snapshot, thenables, ty) = graph(depth, false);
            assert_eq!(
                collect(&snapshot, &thenables, ty),
                Ok(Found::One(NodeId(0), true))
            );
            let (snapshot, thenables, ty) = graph(depth, true);
            assert_eq!(
                collect(&snapshot, &thenables, ty),
                Ok(Found::One(NodeId(0), false))
            );
        }
    }

    #[test]
    fn shared_type_edges_retain_multiplicity_without_expanding_paths() {
        let (mut snapshot, thenables, ty) = graph(80, false);
        for n in 1..=80 {
            snapshot.types[n].kind =
                TypeKind::Intersection(vec![
                    TypeId(u32::try_from(n - 1).expect("small type graph"));
                    2
                ]);
        }
        assert_eq!(collect(&snapshot, &thenables, ty), Ok(Found::Many));
    }

    #[test]
    fn a_type_cycle_or_missing_record_never_becomes_absence() {
        let (mut snapshot, thenables, ty) = graph(80, false);
        snapshot.types[0].kind = TypeKind::Intersection(vec![ty]);
        assert_eq!(
            collect(&snapshot, &thenables, ty),
            Err("a cyclic type graph while discovering a binding's thenable")
        );
        snapshot.types[0].kind = TypeKind::Union(vec![TypeId(9999)]);
        assert_eq!(
            collect(&snapshot, &thenables, ty),
            Err("an incomplete type graph while discovering a binding's thenable")
        );
    }

    #[test]
    fn an_empty_branch_is_absent_and_cannot_restore_union_certainty() {
        let (mut snapshot, thenables, ty) = graph(4, false);
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Number,
            symbol: None,
        });
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Union(vec![ty, TypeId(5)]),
            symbol: None,
        });
        assert_eq!(
            collect(&snapshot, &thenables, TypeId(6)),
            Ok(Found::One(NodeId(0), false))
        );
        assert_eq!(collect(&snapshot, &thenables, TypeId(5)), Ok(Found::None));
    }
}
