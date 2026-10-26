//! Check the prepared program which every backend actually receives.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, OpKind};
use nts_frontend_ts::Frontend;

fn prepared(relative: &str) -> hir::Program {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .expect("fixture is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(
        !snapshot.has_errors(),
        "the checker accepts these method relations"
    );
    hir::prepare(&snapshot).expect("valid prepared HIR").program
}

#[test]
fn class_and_interface_return_bridges_share_the_conversion_plan() {
    let program = prepared("../../tests/programs/a-method-adapted-to-a-structural-interface");
    let child = program
        .layouts
        .iter()
        .find(|layout| layout.name == "ChildReader")
        .unwrap();
    let entries: Vec<_> = child
        .methods
        .iter()
        .flatten()
        .filter(|name| name.starts_with("ChildReader#read@"))
        .collect();
    assert_eq!(
        entries.len(),
        2,
        "both roots dispatch to the shared adapter"
    );
    assert_eq!(entries[0], entries[1]);
    assert_eq!(
        program
            .funcs
            .iter()
            .filter(|func| func.name.starts_with("ChildReader#read@"))
            .count(),
        1
    );
    assert!(
        program
            .identity_projections
            .iter()
            .any(|(adapter, target)| adapter.starts_with("ChildMaker#make@")
                && target == "ChildMaker#make")
    );
    let inlined = program
        .funcs
        .iter()
        .find(|func| func.name.starts_with("ChildMaker#make@"))
        .unwrap();
    assert!(
        inlined
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ObjectNew { .. })),
        "allocation merging consumed the wrapper, while its proof survived"
    );
    for (adapter, target) in &program.identity_projections {
        let adapter = program
            .funcs
            .iter()
            .find(|func| &func.name == adapter)
            .expect("live adapter");
        let target = program
            .funcs
            .iter()
            .find(|func| &func.name == target)
            .expect("live target");
        assert!(adapter.params.len() >= target.params.len());
    }
    assert!(!program.identity_projections.contains_key(entries[0]));
}

#[test]
fn a_shared_projection_keeps_only_guarantees_from_both_faces() {
    let program = prepared("../../tests/programs/a-method-adapted-to-a-structural-interface");
    let reader = program
        .layouts
        .iter()
        .find(|layout| layout.name == "ValueReader")
        .unwrap();
    let entries: Vec<_> = reader
        .methods
        .iter()
        .flatten()
        .filter(|name| name.starts_with("ValueReader#readValue@"))
        .collect();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0], entries[1]);
    let adapter = program
        .funcs
        .iter()
        .find(|func| &func.name == entries[0])
        .unwrap();
    assert_eq!(adapter.params[1].ty, HirType::NUMBER);
    assert!(adapter.params[1].known.contains(0.5));
    assert!(adapter.params[1].known.contains(1_000_000.0));
    assert!(adapter.params[1].known.contains(f64::NAN));
}

#[test]
fn a_covariant_return_does_not_hide_the_class_parameters_erasure_mismatch() {
    let program = prepared("tests/programs/structural-bridge-absence");
    assert!(
        program
            .uncompiled
            .iter()
            .any(|(name, why)| name == "throughParent"
                && why.contains("passes parameter 1 as a string")
                && why.contains("declares an erased value"))
    );
}

#[test]
fn an_interface_declaration_can_be_served_by_a_body_in_a_nonimplementing_base() {
    let program = prepared("../../tests/programs/a-method-adapted-to-a-structural-interface");
    assert!(
        program
            .funcs
            .iter()
            .any(|func| func.name == "TaggedSink#take" && func.abstract_declaration),
        "refusals {:?}; tagged layouts {:?}",
        program.uncompiled,
        program
            .layouts
            .iter()
            .filter(|layout| layout.name.contains("Tagged")
                || layout.name == "Base"
                || layout.name == "OtherBase")
            .collect::<Vec<_>>()
    );
    assert!(
        program
            .funcs
            .iter()
            .any(|func| func.name == "inheritedFace")
    );
    assert!(
        !program
            .uncompiled
            .iter()
            .any(|(name, _)| name == "TaggedSink#take")
    );
}

#[test]
fn the_interface_declares_its_own_signature_and_the_table_adapts_to_it() {
    let program = prepared("../../tests/programs/a-method-adapted-to-a-structural-interface");
    let sink = program
        .funcs
        .iter()
        .find(|func| func.name == "Sink#take")
        .unwrap();
    assert!(sink.abstract_declaration);
    assert_eq!(sink.params.len(), 2);
    assert_eq!(sink.params[1].ty, HirType::NUMBER);
    assert_eq!(sink.return_type, HirType::NUMBER);
    let raising = program
        .funcs
        .iter()
        .find(|func| func.name == "Raising#invoke@raises")
        .unwrap();
    assert_eq!(raising.params[1].ty, HirType::NUMBER);
    for class in ["Wide", "Drops", "Inherited", "Overridden"] {
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.name == class)
            .unwrap();
        let entry = layout
            .methods
            .iter()
            .flatten()
            .find(|name| name.contains("@Sink"))
            .unwrap();
        let adapter = program
            .funcs
            .iter()
            .find(|func| &func.name == entry)
            .unwrap();
        assert_eq!(adapter.params.len(), sink.params.len());
        assert_eq!(adapter.params[1].ty, sink.params[1].ty);
        assert_eq!(adapter.return_type, sink.return_type);
    }
    let wakeable = program
        .funcs
        .iter()
        .find(|func| func.name == "Wakeable#then")
        .unwrap();
    assert_eq!(
        wakeable.params.len(),
        3,
        "the first implementer takes no arguments"
    );
    assert_eq!(
        wakeable.return_type,
        HirType::Erased,
        "the first implementer returns void"
    );
    assert!(
        program
            .funcs
            .iter()
            .filter(|func| func.name.contains("@Wakeable"))
            .any(|func| func
                .values
                .iter()
                .any(|op| matches!(op.kind, OpKind::ConstUndefined)))
    );
}

#[test]
fn equivalent_callable_faces_share_the_adapter() {
    let program = prepared("../../tests/programs/a-method-adapted-to-a-structural-interface");
    let listener = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Listener")
        .unwrap();
    let mut adapters: Vec<_> = listener
        .methods
        .iter()
        .flatten()
        .filter(|name| name.contains("#then@") && !name.contains("@raises"))
        .collect();
    assert_eq!(adapters.len(), 2, "both interface slots are filled");
    adapters.dedup();
    assert_eq!(
        adapters.len(),
        1,
        "one JVM member and descriptor must reach one adapter"
    );
}

#[test]
fn specialization_narrows_the_body_and_preserves_the_table_signature() {
    let program = prepared("../../tests/programs/a-method-adapted-to-a-structural-interface");
    let body = program
        .funcs
        .iter()
        .find(|func| func.name == "SpecializedCounter#tally")
        .unwrap();
    let integer = HirType::Int {
        bits: 32,
        signed: true,
    };
    assert_eq!(
        body.params[1].ty, integer,
        "number input specializes to i32"
    );
    let adapter = program
        .funcs
        .iter()
        .find(|func| func.name == "SpecializedCounter#tally@Counter")
        .unwrap();
    assert_eq!(adapter.params[1].ty, HirType::NUMBER);
    assert_eq!(adapter.return_type, HirType::Erased);
    assert!(adapter.values.iter().any(|op| matches!(
        &op.kind,
        OpKind::Call { callee: hir::Callee::Direct(name), .. } if name == &body.name
    )));
}

#[test]
fn a_narrowed_input_a_defaulted_optional_and_an_interface_cast_block_inference() {
    let program = prepared("tests/programs/structural-incompatible");
    for class in ["Exact", "Literal", "Defaulted", "WantsInterface"] {
        let layout = program
            .layouts
            .iter()
            .find(|layout| {
                program.classes.iter().any(|identity| {
                    identity.name == class
                        && identity.types.iter().any(|ty| layout.types.contains(ty))
                })
            })
            .unwrap();
        assert!(
            layout.interfaces.is_empty(),
            "{class} must not acquire an unsafe edge"
        );
    }
    for name in ["Numeric#accept", "Optional#finish", "Handler#handle"] {
        assert!(
            program
                .uncompiled
                .iter()
                .any(|(refused, _)| refused == name),
            "{name} stays a named refusal"
        );
    }
}

#[test]
fn equal_machine_signatures_keep_distinct_absence_conversions() {
    let program = prepared("tests/programs/structural-absence");
    let adapters: Vec<_> = program
        .funcs
        .iter()
        .filter(|func| func.name.starts_with("EchoInput#feed@"))
        .collect();
    assert_eq!(adapters.len(), 2);
    for absent in [hir::Absent::Null, hir::Absent::Undefined] {
        assert!(
            adapters
                .iter()
                .any(|func| func.values.iter().any(|op| matches!(
                    op.kind, OpKind::Erase { absent: actual, .. } if actual == absent
                )))
        );
    }
}

#[test]
fn a_named_literal_fills_the_row_and_allows_class_edges() {
    let program = prepared("tests/programs/structural-literal-gap");
    assert!(
        !program
            .uncompiled
            .iter()
            .any(|(name, _)| name == "Sink#take")
    );
    let exact = program
        .classes
        .iter()
        .find(|class| class.name == "Exact")
        .unwrap();
    assert!(
        program
            .layouts
            .iter()
            .filter(|layout| layout.types.iter().any(|ty| exact.types.contains(ty)))
            .any(|layout| !layout.interfaces.is_empty())
    );
    let slot = program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .find_map(|op| {
            if let OpKind::Call {
                callee: hir::Callee::Virtual { slot, declared },
                ..
            } = &op.kind
                && declared == "Sink#take"
            {
                Some(*slot as usize)
            } else {
                None
            }
        })
        .expect("the mixed array dispatches through Sink");
    assert!(
        program.layouts.iter().any(
            |layout| layout.types.iter().any(|ty| exact.types.contains(ty))
                && layout.methods.get(slot).is_some_and(Option::is_some)
        ),
        "Exact supplies the method actually called through Sink"
    );
    let literal = program
        .funcs
        .iter()
        .find(|func| func.name == "Thenable#take")
        .expect("the literal's own method body");
    let HirType::Managed(hir::ManagedType::Object(owner)) = literal.params[0].ty else {
        panic!("the literal method has an object receiver");
    };
    assert!(
        program
            .layout(owner)
            .unwrap()
            .methods
            .get(slot)
            .is_some_and(Option::is_some),
        "the literal supplies the same Sink slot as Exact"
    );
}
