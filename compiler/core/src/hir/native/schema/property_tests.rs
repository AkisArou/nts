//! A member identity and its declared type survive the same guarded walk.

use super::*;
use nts_semantic_schema::{Accessor, TypeRecord};

#[test]
fn exact_keys_and_nullable_contracts_survive_nested_and_cyclic_intersections() {
    let keys = [
        PropertyKey::Name("value".to_owned()),
        PropertyKey::Private("#value".to_owned()),
        PropertyKey::Symbol(TypeId(4)),
        PropertyKey::Name("#value".to_owned()),
    ];
    let properties = keys
        .iter()
        .cloned()
        .map(|name| PropertyRecord {
            name,
            ty: TypeId(5),
            readonly: false,
            optional: false,
            declaration: None,
            kind: MemberKind::Accessor(Accessor::GetSet),
            own: true,
        })
        .collect();
    let kinds = [
        // A cycle before the real branch must not conceal that branch.
        TypeKind::Intersection(vec![TypeId(0), TypeId(1)]),
        TypeKind::Intersection(vec![TypeId(2), TypeId(3)]),
        TypeKind::Intersection(vec![TypeId(0)]),
        TypeKind::Object { properties },
        TypeKind::UniqueSymbol,
        TypeKind::Union(vec![TypeId(6), TypeId(7)]),
        TypeKind::Null,
        TypeKind::String,
    ];
    let snapshot = SemanticSnapshot {
        types: kinds
            .into_iter()
            .map(|kind| TypeRecord { kind, symbol: None })
            .collect(),
        ..SemanticSnapshot::default()
    };
    for key in &keys {
        let found = property_key(&snapshot, TypeId(0), key).expect("intersection member");
        assert_eq!(&found.name, key);
        assert_eq!(found.ty, TypeId(5), "retain the getter's nullable type");
    }
    assert_eq!(
        property(&snapshot, TypeId(0), "#value").map(|member| &member.name),
        Some(&keys[3]),
        "a native marker name cannot alias a private key"
    );
    assert!(property(&snapshot, TypeId(0), "missing").is_none());
    assert!(property_key(&snapshot, TypeId(0), &PropertyKey::Symbol(TypeId(6))).is_none());
}
