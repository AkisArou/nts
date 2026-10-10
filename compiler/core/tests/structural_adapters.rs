//! Check the prepared program which every backend actually receives.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared(relative: &str) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .expect("fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(
        !snapshot.has_errors(),
        "the checker accepts these method relations"
    );
    Some(hir::prepare(&snapshot).expect("valid prepared HIR").program)
}

#[test]
fn the_interface_declares_its_own_signature_and_the_table_adapts_to_it() {
    let Some(program) = prepared("../../examples/a-method-adapted-to-a-structural-interface")
    else {
        return;
    };
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
    let Some(program) = prepared("../../examples/a-method-adapted-to-a-structural-interface")
    else {
        return;
    };
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
    let Some(program) = prepared("../../examples/a-method-adapted-to-a-structural-interface")
    else {
        return;
    };
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
    let Some(program) = prepared("tests/programs/structural-incompatible") else {
        return;
    };
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
    let Some(program) = prepared("tests/programs/structural-absence") else {
        return;
    };
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
