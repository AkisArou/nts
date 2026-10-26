//! A captured reachable contract must not retain an unrequested type slot.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeSet;

use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{PropertyKey, SemanticSnapshot, SignatureId, TypeId, TypeKind};

fn signature_types(snapshot: &SemanticSnapshot, id: SignatureId, work: &mut Vec<TypeId>) {
    let signature = &snapshot.signatures[id.0 as usize];
    work.extend(signature.parameters.iter().map(|parameter| parameter.ty));
    work.push(signature.return_type);
    work.extend(signature.type_parameters.iter().copied());
    work.extend(signature.this_type);
    work.extend(
        signature
            .type_predicate
            .as_ref()
            .and_then(|predicate| predicate.narrowed_to),
    );
}

fn unrequested(snapshot: &SemanticSnapshot) -> Vec<TypeId> {
    let reached = nts_semantic_schema::reachability::for_frontend(snapshot);
    let mut work = reached.seeds();
    let mut seen = BTreeSet::new();
    let mut missing = Vec::new();
    while let Some(id) = work.pop() {
        if !seen.insert(id) {
            continue;
        }
        let record = &snapshot.types[id.0 as usize];
        match &record.kind {
            TypeKind::Unsupported { rendered } => {
                if rendered == "a native type whose graph has not been requested" {
                    missing.push(id);
                }
            }
            TypeKind::Object { properties } => {
                for property in properties {
                    work.push(property.ty);
                    if let PropertyKey::Symbol(key) = property.name {
                        work.push(key);
                    }
                }
            }
            TypeKind::Array(element) => work.push(*element),
            TypeKind::Tuple(parts) | TypeKind::Union(parts) | TypeKind::Intersection(parts) => {
                work.extend(parts.iter().copied());
            }
            TypeKind::Function(signature) => signature_types(snapshot, *signature, &mut work),
            TypeKind::TypeParameter { constraint, .. } => work.extend(*constraint),
            TypeKind::Conditional {
                check,
                extends,
                true_type,
                false_type,
            } => {
                work.extend([*check, *extends]);
                work.extend(*true_type);
                work.extend(*false_type);
            }
            TypeKind::IndexedAccess { object, index } => work.extend([*object, *index]),
            TypeKind::TemplateLiteral { types, .. } => work.extend(types.iter().copied()),
            TypeKind::Any
            | TypeKind::Evolving
            | TypeKind::Unknown
            | TypeKind::Never
            | TypeKind::Void
            | TypeKind::Undefined
            | TypeKind::Null
            | TypeKind::Boolean
            | TypeKind::Number
            | TypeKind::BigInt
            | TypeKind::String
            | TypeKind::Symbol
            | TypeKind::UniqueSymbol
            | TypeKind::NonPrimitive
            | TypeKind::Literal(_)
            | TypeKind::Structured => {}
        }
        work.extend(snapshot.base_types.get(&id).into_iter().flatten().copied());
        work.extend(
            snapshot
                .type_arguments
                .get(&id)
                .into_iter()
                .flatten()
                .copied(),
        );
        for index in snapshot.index_signatures.get(&id).into_iter().flatten() {
            work.extend([index.key, index.value]);
        }
        work.extend(snapshot.bound_types.get(&id).copied());
    }
    missing.sort();
    missing
}

fn root() -> &'static Utf8Path {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
}

fn capture(name: &str) -> SemanticSnapshot {
    Frontend::new(root())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(
            &root()
                .join("tests/programs")
                .join(name)
                .join("tsconfig.json"),
        )
        .unwrap()
}

#[test]
fn instantiated_callbacks_rest_and_composites_have_complete_reachable_contracts() {
    for name in [
        "a-closure-default-captures-its-parameter",
        "a-bound-function",
        "array-from-a-set-a-mapper-adds-to",
        "a-generic-pinned-only-through-a-callback",
        "a-fixed-arity-rest-is-positional",
        "a-generic-call-materializes-its-callers-composite-types",
        "a-generic-owner-returns-a-carried-iteration-contract",
    ] {
        let snapshot = capture(name);
        assert!(
            unrequested(&snapshot).is_empty(),
            "{name}: {:?}",
            unrequested(&snapshot)
        );
    }
}

#[test]
fn repeated_concrete_references_do_not_consume_a_deferred_generic_form() {
    let snapshot = capture("a-closure-default-captures-its-parameter");
    let forms: Vec<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter(|(index, record)| {
            record
                .symbol
                .is_some_and(|symbol| snapshot.symbols[symbol.0 as usize].name.is_name("Box"))
                && snapshot
                    .type_arguments
                    .get(&TypeId(
                        u32::try_from(*index).expect("snapshot arena fits u32"),
                    ))
                    .is_some_and(|arguments| {
                        !arguments.is_empty()
                            && arguments.iter().all(|argument| {
                                matches!(
                                    snapshot.types[argument.0 as usize].kind,
                                    TypeKind::TypeParameter { .. }
                                )
                            })
                    })
        })
        .collect();
    assert_eq!(
        forms.len(),
        2,
        "both the class and the generic default's form are reached"
    );
    for (_, record) in forms {
        assert!(
            matches!(&record.kind, TypeKind::Object { properties } if properties.iter().any(|property| property.name.is_name("value"))),
            "a reached Box<T> form must carry its value member: {:?}",
            record.kind
        );
    }
}

#[test]
#[ignore = "whole-program corpus capture audit; run explicitly for a frontend switch"]
fn no_program_keeps_an_unrequested_reachable_type() {
    let mut names: Vec<_> = std::fs::read_dir(root().join("tests/programs"))
        .unwrap()
        .map(Result::unwrap)
        .filter(|entry| entry.path().join("tsconfig.json").is_file())
        .map(|entry| entry.file_name().into_string().unwrap())
        .collect();
    names.sort();
    let mut problems = Vec::new();
    for name in names {
        let snapshot = capture(&name);
        let missing = unrequested(&snapshot);
        if !missing.is_empty() {
            let records: Vec<_> = missing
                .iter()
                .map(|id| {
                    let record = &snapshot.types[id.0 as usize];
                    let symbol = record
                        .symbol
                        .map(|symbol| &snapshot.symbols[symbol.0 as usize]);
                    let returns: Vec<_> = snapshot
                        .signatures
                        .iter()
                        .enumerate()
                        .filter(|(_, signature)| signature.return_type == *id)
                        .collect();
                    let arguments: Vec<_> = snapshot
                        .type_arguments
                        .iter()
                        .filter(|(_, arguments)| arguments.contains(id))
                        .collect();
                    (id, record, symbol, returns, arguments)
                })
                .collect();
            problems.push(format!("{name}: {records:#?}"));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
