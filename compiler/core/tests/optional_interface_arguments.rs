//! An optional library method retains its declared call ABI even when the
//! concrete implementation ignores its optional argument.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{PropertyKey, TypeKind};

#[test]
fn an_optional_interface_method_uses_the_declared_dispatch_contract() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/an-optional-interface-call-uses-its-dispatch-contract/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in iterator fixture");
    let snapshot = Frontend::new(config.parent().unwrap())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture the iterator call");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let returns = snapshot
        .types
        .iter()
        .filter_map(|record| {
            let symbol = snapshot.symbols.get(record.symbol?.0 as usize)?;
            if symbol.name != PropertyKey::Name("Iterator".into()) {
                return None;
            }
            let TypeKind::Object { properties } = &record.kind else {
                return None;
            };
            properties
                .iter()
                .find(|property| property.name == PropertyKey::Name("return".into()))
        })
        .collect::<Vec<_>>();
    assert!(
        returns.iter().any(|member| member.optional),
        "the snapshot must preserve the library's optional return method"
    );
    let lowered = hir::lower::lower(&snapshot);
    let body = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == "Cursor#return")
        .expect("concrete no-argument return method before inlining");
    assert_eq!(body.params.len(), 1);
    let prepared = hir::prepare(&snapshot).unwrap_or_else(|error| {
        let path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
            .join("optional-interface-arguments.snapshot.txt");
        std::fs::write(&path, format!("{snapshot:#?}")).unwrap();
        panic!(
            "invalid iterator dispatch: {error:?}; snapshot: {}",
            path.display()
        );
    });
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let program = &prepared.program;
    let declaration = program
        .funcs
        .iter()
        .find(|func| {
            func.abstract_declaration
                && func.name.starts_with("Iterator<")
                && func.name.ends_with("#return")
        })
        .expect("declared Iterator return contract");
    assert_eq!(
        declaration.params.len(),
        2,
        "the interface takes its receiver and optional value"
    );
    let cursor = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Cursor")
        .expect("concrete iterator layout");
    let slot = lowered
        .program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .find_map(|op| match &op.kind {
            hir::OpKind::Call {
                callee: hir::Callee::Virtual { slot, declared },
                ..
            } if declared == &declaration.name => Some(*slot as usize),
            _ => None,
        })
        .expect("the interface call's actual virtual slot");
    let entry = cursor
        .methods
        .get(slot)
        .and_then(Option::as_deref)
        .expect("the concrete receiver fills that slot");
    let adapter = program
        .funcs
        .iter()
        .find(|func| func.name == entry)
        .expect("the prepared dispatch adapter is retained");
    assert_eq!(
        adapter.params.len(),
        declaration.params.len(),
        "{entry} must accept the interface's full argument list"
    );
}

#[test]
fn an_exact_receiver_without_the_optional_member_keeps_its_named_refusal() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/an-absent-optional-interface-method/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in missing-member neighbor");
    let snapshot = Frontend::new(config.parent().unwrap())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture the missing-member neighbor");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("the refused neighbor has valid HIR");
    assert!(
        prepared
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS1001"
                && diagnostic
                    .message
                    .contains("a method `finish` with no declaration in the hierarchy")),
        "the known refusal must remain explicit: {:?}",
        prepared.diagnostics
    );
}
