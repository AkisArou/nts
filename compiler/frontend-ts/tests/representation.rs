//! The type facts that decide how a value is represented.
//!
//! Each of these changes emitted code rather than merely describing the source:
//! readonly becomes `ACC_FINAL`/`const`, optional changes layout, an index
//! signature rules out a flat struct, and a tuple's fixed arity is what lets it
//! be laid out flat where an array needs a pointer and a length.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};
use nts_semantic_schema::{PropertyRecord, SemanticSnapshot, TypeKind};

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/readonly/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/readonly fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .with_decomposition(Budget::DEFAULT)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

fn object_with<'a>(snapshot: &'a SemanticSnapshot, names: &[&str]) -> &'a [PropertyRecord] {
    snapshot
        .types
        .iter()
        .find_map(|record| match &record.kind {
            TypeKind::Object { properties }
                if properties
                    .iter()
                    .map(|p| p.name.as_str())
                    .eq(names.iter().copied()) =>
            {
                Some(properties.as_slice())
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("no object type with exactly {names:?}"))
}

#[test]
fn readonly_by_keyword_is_recorded() {
    let Some(snapshot) = snapshot() else { return };
    let config = object_with(&snapshot, &["host", "port", "timeout"]);
    let get = |name: &str| config.iter().find(|p| p.name == name).unwrap();

    assert!(get("host").readonly, "`readonly host: string`");
    assert!(!get("port").readonly, "`port: number` is writable");
}

#[test]
fn readonly_by_mapped_type_is_recorded() {
    let Some(snapshot) = snapshot() else { return };
    // `Readonly<{ a: number; b: string }>` writes no `readonly` keyword on any
    // declaration. The modifier alone misses it entirely; only the checker knows.
    let frozen = snapshot
        .types
        .iter()
        .find_map(|record| match &record.kind {
            TypeKind::Object { properties }
                if properties.len() == 2
                    && properties.iter().all(|p| p.readonly)
                    && properties.iter().any(|p| p.name == "a") =>
            {
                Some(properties)
            }
            _ => None,
        })
        .expect("`Readonly<{a,b}>` should have both properties readonly");
    assert_eq!(frozen.len(), 2);
}

#[test]
fn optional_properties_are_distinguished() {
    let Some(snapshot) = snapshot() else { return };
    let config = object_with(&snapshot, &["host", "port", "timeout"]);
    let get = |name: &str| config.iter().find(|p| p.name == name).unwrap();

    // An optional property needs a presence bit or an undefined slot, so it
    // cannot share a representation with a required one.
    assert!(get("timeout").optional, "`timeout?: number`");
    assert!(!get("port").optional);
}

#[test]
fn index_signatures_are_recorded_with_their_readonly_ness() {
    let Some(snapshot) = snapshot() else { return };
    // The fixture has `Bag` and `ReadonlyBag`. A type with an index signature
    // cannot be a flat struct: its keys are not known at compile time.
    assert_eq!(snapshot.index_signatures.len(), 2);

    let readonly_flags: Vec<bool> = snapshot
        .index_signatures
        .values()
        .flatten()
        .map(|sig| sig.readonly)
        .collect();
    assert!(readonly_flags.contains(&true), "ReadonlyBag");
    assert!(readonly_flags.contains(&false), "Bag");
}

#[test]
fn a_tuple_keeps_its_element_types_and_arity() {
    let Some(snapshot) = snapshot() else { return };
    // A tuple is an object type *and* array-like, so it has to be separated
    // before either path. Treated as an array it loses its arity, which is the
    // property that lets it be laid out flat.
    let tuples: Vec<&Vec<nts_semantic_schema::TypeId>> = snapshot
        .types
        .iter()
        .filter_map(|record| match &record.kind {
            TypeKind::Tuple(elements) => Some(elements),
            _ => None,
        })
        .collect();
    assert!(!tuples.is_empty(), "`[number, string]` should decompose");
    assert!(tuples.iter().all(|t| t.len() == 2), "both are pairs");

    let first = &snapshot.types[tuples[0][0].0 as usize].kind;
    assert_eq!(first, &TypeKind::Number);
}

#[test]
fn optional_and_rest_parameters_are_distinguished() {
    let Some(snapshot) = snapshot() else { return };
    // `optionals(a: number, b?: string, ...rest: number[])`. Neither
    // `SymbolFlagsOptional` nor `CheckFlagsOptionalParameter` is set on the
    // symbols the parameter endpoint returns — the `?` is a QuestionToken child
    // in the AST, and rest-ness is only on the signature.
    let signature = snapshot
        .signatures
        .iter()
        .find(|sig| sig.parameters.len() == 3)
        .expect("the three-parameter function is present");

    assert!(!signature.parameters[0].optional, "`a` is required");
    assert!(signature.parameters[1].optional, "`b?` is optional");
    assert!(
        signature.parameters[2].rest,
        "`...rest` is a rest parameter"
    );
    assert!(!signature.parameters[0].rest);
}
