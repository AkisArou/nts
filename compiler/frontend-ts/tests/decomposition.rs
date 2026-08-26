//! Decomposition of structured types, against a real tsgo.
//!
//! Skips without `NTS_TSGO`; see `tsgo_transport.rs` for how to build the pinned
//! binary.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};
use nts_semantic_schema::{LiteralValue, SemanticSnapshot, TypeKind};

fn decomposed_types() -> Option<SemanticSnapshot> {
    let tsgo = std::env::var("NTS_TSGO").ok()?;
    let tsgo = Utf8PathBuf::from(tsgo);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/types/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/types fixture is checked in");
    let mut source = TsgoApi::new(tsgo).with_decomposition(Budget::DEFAULT);
    Some(source.snapshot(&tsconfig).expect("snapshot should succeed"))
}

/// Find the one object type carrying exactly `names` as its properties.
fn object_with<'a>(snapshot: &'a SemanticSnapshot, names: &[&str]) -> &'a TypeKind {
    snapshot
        .types
        .iter()
        .map(|record| &record.kind)
        .find(|kind| match kind {
            TypeKind::Object { properties } => {
                properties.len() == names.len()
                    && properties
                        .iter()
                        .map(|(n, _)| n.as_str())
                        .eq(names.iter().copied())
            }
            _ => false,
        })
        .unwrap_or_else(|| panic!("no object type with properties {names:?}"))
}

#[test]
fn an_interface_decomposes_into_its_properties() {
    let Some(snapshot) = decomposed_types() else {
        return;
    };
    let TypeKind::Object { properties } = object_with(&snapshot, &["x", "y", "label"]) else {
        unreachable!("object_with only returns objects")
    };

    let kind_of = |name: &str| {
        let (_, id) = properties.iter().find(|(n, _)| n == name).unwrap();
        &snapshot.types[id.0 as usize].kind
    };
    assert_eq!(kind_of("x"), &TypeKind::Number);
    assert_eq!(kind_of("y"), &TypeKind::Number);
    assert_eq!(kind_of("label"), &TypeKind::String);

    // `x` and `y` are both `number`; one record must serve both, or the arena
    // grows with property count rather than with distinct types.
    let x = properties.iter().find(|(n, _)| n == "x").unwrap().1;
    let y = properties.iter().find(|(n, _)| n == "y").unwrap().1;
    assert_eq!(x, y, "identical property types share a record");
}

#[test]
fn a_string_literal_union_decomposes_into_its_members() {
    let Some(snapshot) = decomposed_types() else {
        return;
    };
    let members = snapshot
        .types
        .iter()
        .find_map(|record| match &record.kind {
            TypeKind::Union(members) if members.len() == 3 => Some(members),
            _ => None,
        })
        .expect("`\"idle\" | \"busy\" | \"done\"` should decompose");

    let mut literals: Vec<String> = members
        .iter()
        .map(|id| match &snapshot.types[id.0 as usize].kind {
            TypeKind::Literal(LiteralValue::String(s)) => s.clone(),
            other => panic!("union member was {other:?}, not a string literal"),
        })
        .collect();
    // The checker does not preserve source order, so compare as a set.
    literals.sort();
    assert_eq!(literals, ["busy", "done", "idle"]);
}

#[test]
fn an_array_decomposes_to_its_element_type_not_its_prototype() {
    let Some(snapshot) = decomposed_types() else {
        return;
    };
    let element = snapshot
        .types
        .iter()
        .find_map(|record| match &record.kind {
            TypeKind::Array(element) => Some(*element),
            _ => None,
        })
        .expect("`string[]` should decompose to an array");
    assert_eq!(snapshot.types[element.0 as usize].kind, TypeKind::String);

    // The regression this guards: an array is an object type, so decomposing it
    // as one yields `length`, `push`, `map` and the rest of the prototype.
    assert!(
        !snapshot.types.iter().any(|record| matches!(
            &record.kind,
            TypeKind::Object { properties } if properties.iter().any(|(n, _)| n == "push")
        )),
        "an array was decomposed as an ordinary object",
    );
}

#[test]
fn a_mixed_union_keeps_both_primitives() {
    let Some(snapshot) = decomposed_types() else {
        return;
    };
    let found = snapshot.types.iter().any(|record| match &record.kind {
        TypeKind::Union(members) if members.len() == 2 => {
            let mut kinds: Vec<&TypeKind> = members
                .iter()
                .map(|id| &snapshot.types[id.0 as usize].kind)
                .collect();
            kinds.sort_by_key(|k| format!("{k:?}"));
            kinds == [&TypeKind::Number, &TypeKind::String]
        }
        _ => false,
    });
    assert!(found, "`number | string` should decompose to both members");
}

#[test]
fn nothing_structured_is_left_where_the_fixture_has_a_shape() {
    let Some(snapshot) = decomposed_types() else {
        return;
    };
    // Objects, unions and arrays are all modelled now. Anything still Structured
    // in this fixture would mean a shape silently skipped rather than resolved.
    let leftover: Vec<u32> = snapshot
        .types
        .iter()
        .filter_map(|record| match record.kind {
            TypeKind::Structured { flags } => Some(flags),
            _ => None,
        })
        .collect();
    assert!(
        leftover.is_empty(),
        "structured types left undecomposed with flags {leftover:?}",
    );
}

fn decomposed_signatures() -> Option<SemanticSnapshot> {
    let tsgo = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/signatures/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/signatures fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .with_decomposition(Budget::DEFAULT)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

/// Find the signature whose parameter names are exactly `names`.
fn signature_with<'a>(
    snapshot: &'a SemanticSnapshot,
    names: &[&str],
) -> &'a nts_semantic_schema::SignatureRecord {
    snapshot
        .signatures
        .iter()
        .find(|sig| {
            sig.parameters
                .iter()
                .map(|p| p.name.as_str())
                .eq(names.iter().copied())
        })
        .unwrap_or_else(|| panic!("no signature with parameters {names:?}"))
}

#[test]
fn an_annotated_function_resolves_its_whole_signature() {
    let Some(snapshot) = decomposed_signatures() else {
        return;
    };
    let sig = signature_with(&snapshot, &["a", "b"]);
    let kind = |id: nts_semantic_schema::TypeId| &snapshot.types[id.0 as usize].kind;

    assert_eq!(kind(sig.parameters[0].ty), &TypeKind::Number);
    assert_eq!(kind(sig.parameters[1].ty), &TypeKind::String);
    assert_eq!(kind(sig.return_type), &TypeKind::Boolean);
}

#[test]
fn an_inferred_return_type_is_recovered() {
    let Some(snapshot) = decomposed_signatures() else {
        return;
    };
    // The case that justifies calling the API at all. `export function
    // inferred(a: number) { return a * 2; }` writes its return type nowhere, so
    // there is no AST node carrying it — walking children cannot find it, and
    // deriving it from the return statement would mean reimplementing inference.
    let sig = signature_with(&snapshot, &["a"]);
    assert_eq!(
        &snapshot.types[sig.return_type.0 as usize].kind,
        &TypeKind::Number,
    );
}

#[test]
fn a_rest_parameter_is_flagged_only_on_the_last_position() {
    let Some(snapshot) = decomposed_signatures() else {
        return;
    };
    let sig = signature_with(&snapshot, &["first", "others"]);
    assert!(!sig.parameters[0].rest, "`first` is not a rest parameter");
    assert!(sig.parameters[1].rest, "`others` is a rest parameter");

    // A rest parameter's type is the array, not the element.
    assert!(matches!(
        snapshot.types[sig.parameters[1].ty.0 as usize].kind,
        TypeKind::Array(_)
    ));
}

#[test]
fn a_function_type_points_at_its_signature() {
    let Some(snapshot) = decomposed_signatures() else {
        return;
    };
    let functions: Vec<_> = snapshot
        .types
        .iter()
        .filter_map(|record| match record.kind {
            TypeKind::Function(id) => Some(id),
            _ => None,
        })
        .collect();
    assert_eq!(functions.len(), 3, "three declared functions, three types");
    for id in functions {
        assert!(
            (id.0 as usize) < snapshot.signatures.len(),
            "function type points past the signature arena",
        );
    }
}

#[test]
fn a_function_is_not_decomposed_as_an_object() {
    let Some(snapshot) = decomposed_signatures() else {
        return;
    };
    // A function type *is* an object type. Reaching properties first would record
    // `call`, `apply`, `bind` and lose the signature entirely.
    assert!(
        !snapshot.types.iter().any(|record| matches!(
            &record.kind,
            TypeKind::Object { properties } if properties.iter().any(|(n, _)| n == "apply")
        )),
        "a function was decomposed as an ordinary object",
    );
}
