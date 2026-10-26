//! Declared arity, duplicate dispatch roots and receiver-bound views.
use nts_semantic_schema::{MemberKind, PropertyKey, SymbolFlags, SymbolRecord, TypeRecord};

use super::*;

fn snapshot() -> SemanticSnapshot {
    let mut snapshot = SemanticSnapshot::default();
    snapshot.symbols.push(SymbolRecord {
        name: PropertyKey::Name("Iterator".into()),
        builtin: None,
        flags: SymbolFlags::INTERFACE,
        declarations: Vec::new(),
        ty: None,
        aliased: None,
        library: Some(nts_semantic_schema::Library::Es),
    });
    snapshot.types = vec![
        TypeKind::Number,
        TypeKind::String,
        TypeKind::Any,
        TypeKind::TypeParameter {
            name: "this".into(),
            is_this: true,
            constraint: None,
        },
    ]
    .into_iter()
    .map(|kind| TypeRecord { kind, symbol: None })
    .collect();
    snapshot
}

fn reference(snapshot: &mut SemanticSnapshot, args: &[u32], count: Option<u32>) -> TypeId {
    let id = TypeId(u32::try_from(snapshot.types.len()).unwrap_or(u32::MAX));
    snapshot.types.push(TypeRecord {
        kind: TypeKind::Object {
            properties: vec![PropertyRecord {
                name: PropertyKey::Name("next".into()),
                ty: TypeId(2),
                readonly: false,
                optional: false,
                declaration: None,
                kind: MemberKind::Method,
                own: false,
            }],
        },
        symbol: Some(nts_semantic_schema::SymbolId(0)),
    });
    snapshot
        .type_arguments
        .insert(id, args.iter().copied().map(TypeId).collect());
    if let Some(count) = count {
        snapshot.reference_parameter_counts.insert(id, count);
    }
    id
}

#[test]
fn declared_this_in_the_prefix_and_all_duplicate_roots_survive() {
    let mut snapshot = snapshot();
    // The last DECLARED argument is `this`. The extra heritage binding is
    // another occurrence of the same type; only the explicit count separates it.
    let bound = reference(&mut snapshot, &[0, 2, 3, 3], Some(3));
    let first = reference(&mut snapshot, &[0, 2, 3], Some(3));
    let duplicate = reference(&mut snapshot, &[0, 2, 3], Some(3));
    let different = reference(&mut snapshot, &[0, 2, 1], Some(3));
    let unknown = reference(&mut snapshot, &[0, 2, 3], None);
    let short = reference(&mut snapshot, &[0, 2], Some(3));
    let long = reference(&mut snapshot, &[0, 2, 3, 3, 3], Some(3));
    let mut hierarchy = Hierarchy::default();
    let carried = collect_carried_protocols(&snapshot, &mut hierarchy);
    for id in [first, duplicate, bound] {
        assert_eq!(carried.resolve(&snapshot, id), [first, duplicate]);
    }
    assert_eq!(carried.resolve(&snapshot, different), [different]);
    for id in [unknown, short, long] {
        assert_eq!(carried.resolve(&snapshot, id), []);
        assert!(!hierarchy.faces.contains(&id));
    }
    assert!(
        !hierarchy.faces.contains(&bound),
        "bound views are not extra canonical roots"
    );
    snapshot.reference_parameter_counts.insert(unknown, 2);
    let conflicted = collect_carried_protocols(&snapshot, &mut Hierarchy::default());
    assert_eq!(
        conflicted.resolve(&snapshot, first),
        [],
        "contradictory declaration facts fail closed"
    );
}

#[test]
fn known_zero_is_distinct_from_missing_arity_and_missing_arguments() {
    let mut snapshot = snapshot();
    let declared = reference(&mut snapshot, &[], Some(0));
    let bound = reference(&mut snapshot, &[3], Some(0));
    let unknown = reference(&mut snapshot, &[], None);
    let missing_arguments = reference(&mut snapshot, &[], Some(0));
    snapshot.type_arguments.remove(&missing_arguments);
    let carried = collect_carried_protocols(&snapshot, &mut Hierarchy::default());
    assert_eq!(carried.resolve(&snapshot, declared), [declared]);
    assert_eq!(carried.resolve(&snapshot, bound), [declared]);
    assert_eq!(carried.resolve(&snapshot, unknown), []);
    assert_eq!(carried.resolve(&snapshot, missing_arguments), []);
}
