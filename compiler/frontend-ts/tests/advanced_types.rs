//! Type-level features that change emitted code: predicates, accessors,
//! construct signatures, generics, conditionals and template literals.
//!
//! Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};
use nts_semantic_schema::{Accessor, MemberKind, SemanticSnapshot, TypeKind};

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/advanced/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/advanced fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .with_decomposition(Budget::DEFAULT)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

#[test]
fn a_type_guard_records_what_it_narrows() {
    let Some(snapshot) = snapshot() else { return };
    // `pet is Fish`. Inside the true branch the concrete type is known, so a
    // dispatch on `pet` can become a direct call.
    let guard = snapshot
        .signatures
        .iter()
        .filter_map(|sig| sig.type_predicate.as_ref())
        .find(|p| !p.asserts)
        .expect("`pet is Fish` should record a predicate");

    assert_eq!(guard.parameter_name, "pet");
    assert_eq!(guard.parameter_index, Some(0));
    let narrowed = guard.narrowed_to.expect("narrows to a type");
    assert!(matches!(
        &snapshot.types[narrowed.0 as usize].kind,
        TypeKind::Object { properties } if properties.iter().any(|p| p.name == "swim")
    ));
}

#[test]
fn an_asserts_predicate_is_distinguished_from_a_guard() {
    let Some(snapshot) = snapshot() else { return };
    // `asserts pet is Fish` narrows for the rest of the enclosing scope rather
    // than only inside a branch, and returns void. Treating it as an ordinary
    // guard would narrow the wrong region.
    assert!(
        snapshot
            .signatures
            .iter()
            .filter_map(|sig| sig.type_predicate.as_ref())
            .any(|p| p.asserts),
        "the asserts predicate should be recorded",
    );
}

#[test]
fn accessors_are_distinguished_from_fields() {
    let Some(snapshot) = snapshot() else { return };
    // `get value()` / `set value()` look like a property and are a call. Emitting
    // a field load reads whatever sits at that offset.
    let box_type = snapshot
        .types
        .iter()
        .find_map(|record| match &record.kind {
            TypeKind::Object { properties }
                if properties.iter().any(|p| p.name == "value")
                    && properties.iter().any(|p| p.name == "plain") =>
            {
                Some(properties)
            }
            _ => None,
        })
        .expect("the Box instance type");

    let get = |name: &str| box_type.iter().find(|p| p.name == name).unwrap();
    assert_eq!(get("value").kind, MemberKind::Accessor(Accessor::GetSet));
    assert_eq!(
        get("plain").kind,
        MemberKind::Field,
        "a plain field is not an accessor"
    );
}

#[test]
fn construct_signatures_are_resolved() {
    let Some(snapshot) = snapshot() else { return };
    // `new (id: number) => Widget` has no call signature. Asking only for call
    // signatures decomposes it as an ordinary object, losing the arity and
    // parameter types a `new` expression needs.
    let constructors: Vec<_> = snapshot
        .signatures
        .iter()
        .filter(|sig| sig.is_construct)
        .collect();
    assert!(!constructors.is_empty(), "a construct signature is present");
    assert!(
        constructors.iter().any(|sig| sig.parameters.len() == 1),
        "`new (id: number)` takes one parameter",
    );
}

#[test]
fn generic_signatures_keep_their_type_parameters() {
    let Some(snapshot) = snapshot() else { return };
    // Monomorphization needs to know what to specialize over.
    assert!(
        snapshot
            .signatures
            .iter()
            .any(|sig| sig.type_parameters.len() == 1),
        "`identity<T>` declares one type parameter",
    );
}

#[test]
fn a_constrained_type_parameter_records_its_constraint() {
    let Some(snapshot) = snapshot() else { return };
    // `<T extends Fish>` bounds what T can be, which is what lets a backend emit
    // a specialization rather than a boxed generic.
    let constrained = snapshot
        .types
        .iter()
        .filter(|record| {
            matches!(&record.kind, TypeKind::TypeParameter { constraint, .. } if constraint.is_some())
        })
        .count();
    assert!(
        constrained >= 1,
        "`T extends Fish` should carry a constraint"
    );
}

#[test]
fn a_conditional_type_keeps_its_branches() {
    let Some(snapshot) = snapshot() else { return };
    let conditional = snapshot
        .types
        .iter()
        .find(|record| matches!(record.kind, TypeKind::Conditional { .. }))
        .expect("`T extends (infer U)[] ? U : never` should decompose");
    let TypeKind::Conditional { check, extends, .. } = conditional.kind else {
        unreachable!()
    };
    assert!((check.0 as usize) < snapshot.types.len());
    assert!((extends.0 as usize) < snapshot.types.len());
}

#[test]
fn a_template_literal_keeps_its_literal_segments() {
    let Some(snapshot) = snapshot() else { return };
    // The segments arrive on the type response and no endpoint answers them
    // again, so they are captured when the type is first classified rather than
    // when it is decomposed.
    let texts = snapshot
        .types
        .iter()
        .find_map(|record| match &record.kind {
            TypeKind::TemplateLiteral { texts, .. } => Some(texts),
            _ => None,
        })
        .expect("`hello ${string}` should decompose");
    assert_eq!(texts, &["hello ", ""]);
}
