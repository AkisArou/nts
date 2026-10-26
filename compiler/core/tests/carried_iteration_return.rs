//! A copied class method needs the carried protocol's declared return shape.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{PropertyKey, SemanticSnapshot, TypeId, TypeKind};

#[test]
fn a_generic_owner_keeps_its_carried_return_contract_and_prepared_abi() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-generic-owner-returns-a-carried-iteration-contract/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in carried return fixture");
    let snapshot = Frontend::new(config.parent().unwrap())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture the carried return contract");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    assert!(snapshot.diagnostics.iter().all(|d| d.code != "NTS0003"));
    let mut declared_returns = 0;
    for (index, record) in snapshot.types.iter().enumerate() {
        let Some(symbol) = record.symbol else {
            continue;
        };
        if !snapshot.symbols[symbol.0 as usize].name.is_name("Source") {
            continue;
        }
        let Some(arguments) = snapshot
            .type_arguments
            .get(&TypeId(u32::try_from(index).unwrap()))
        else {
            continue;
        };
        let [parameter] = arguments.as_slice() else {
            continue;
        };
        if !matches!(
            snapshot.types[parameter.0 as usize].kind,
            TypeKind::TypeParameter { .. }
        ) {
            continue;
        }
        let TypeKind::Object { properties } = &record.kind else {
            continue;
        };
        let member = properties
            .iter()
            .find(|p| p.name.is_name("values"))
            .unwrap();
        let TypeKind::Function(signature) = snapshot.types[member.ty.0 as usize].kind else {
            panic!("the declared values method must be callable");
        };
        let signature = &snapshot.signatures[signature.0 as usize];
        assert!(
            signature.type_parameters.is_empty(),
            "{:?}",
            signature.type_parameters
        );
        let returned = signature.return_type;
        let TypeKind::Object { properties } = &snapshot.types[returned.0 as usize].kind else {
            panic!("the carried return of Source<T>.values must have its contract");
        };
        assert!(properties.iter().any(|p| p.name.is_name("next")));
        assert_eq!(snapshot.type_arguments[&returned][0], *parameter);
        declared_returns += 1;
    }
    assert!(declared_returns > 0, "the generic declaration was measured");
    assert_generic_return_demands(&snapshot);

    let materialized = hir::instantiate::materialise(&snapshot);
    let snapshot = materialized.as_ref().unwrap_or(&snapshot);
    assert_lowered_return_abi(snapshot);
    let prepared = hir::prepare(snapshot).expect("the carried return has a valid prepared ABI");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in ["subject", "control"] {
        assert!(prepared.program.funcs.iter().any(|f| f.name == name));
    }
}

fn assert_generic_return_demands(snapshot: &SemanticSnapshot) {
    for name in ["unusedRecursive", "unusedLibrary"] {
        let returned = snapshot
            .types
            .iter()
            .find_map(|record| {
                let symbol = &snapshot.symbols[record.symbol?.0 as usize];
                if !symbol.name.is_name(name) {
                    return None;
                }
                let TypeKind::Function(signature) = record.kind else {
                    return None;
                };
                let signature = &snapshot.signatures[signature.0 as usize];
                assert_eq!(signature.type_parameters.len(), 1);
                Some(signature.return_type)
            })
            .expect("the unused generic declaration is captured");
        if name == "unusedLibrary" {
            assert_eq!(
                snapshot.types[returned.0 as usize].kind,
                TypeKind::Structured,
                "an unused library return stays shallow"
            );
        } else {
            // The written Flatten<T> alias/annotation is independently rooted
            // by module syntax, on both pre-storage and repaired capture. It
            // cannot isolate demand from the unused signature. The native
            // graph worker's unused-callable test covers that negative seam.
            let reached = nts_semantic_schema::reachability::for_frontend(snapshot);
            let witnesses: Vec<_> = snapshot
                .node_types
                .iter()
                .filter(|(node, ty)| **ty == returned && reached.nodes.contains(node))
                .map(|(node, _)| (node, &snapshot.nodes[node.0 as usize]))
                .collect();
            assert!(
                !witnesses.is_empty(),
                "an exact syntax demand must explain {returned:?}"
            );
            eprintln!("{name} independent syntax demand: {witnesses:?}");
            assert!(matches!(
                snapshot.types[returned.0 as usize].kind,
                TypeKind::Conditional { .. }
            ));
        }
    }
}

fn assert_lowered_return_abi(snapshot: &SemanticSnapshot) {
    // Preparation inlines these allocation-returning methods, then prunes
    // their private bodies. Inspect the actual call ABI before that rewrite.
    let lowered = hir::lower::lower(snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    let values: Vec<_> = lowered
        .program
        .funcs
        .iter()
        .filter(|f| {
            !f.abstract_declaration && f.name.starts_with("Source<") && f.name.ends_with("#values")
        })
        .collect();
    assert!(
        !values.is_empty(),
        "the subject's copied method must be lowered"
    );
    for function in values {
        assert_eq!(function.params.len(), 1, "only the receiver is passed");
        let HirType::Managed(ManagedType::Object(returned)) = function.return_type else {
            panic!("the carried result uses an object ABI");
        };
        let symbol = snapshot.types[returned.0 as usize].symbol.unwrap();
        assert_eq!(
            snapshot.symbols[symbol.0 as usize].name,
            PropertyKey::Name("AsyncIterableIterator".into())
        );
        let subject = lowered
            .program
            .funcs
            .iter()
            .find(|f| f.name == "subject")
            .unwrap();
        let call = subject
            .values
            .iter()
            .find(|op| {
                matches!(&op.kind, hir::OpKind::Call { callee: hir::Callee::Direct(name), args, .. }
                if name == &function.name && args.len() == function.params.len())
            })
            .expect("the subject calls the actual one-receiver ABI");
        let HirType::Managed(ManagedType::Object(call_returned)) = call.ty else {
            panic!("the call also returns an object reference");
        };
        assert_eq!(
            snapshot.types[call_returned.0 as usize].symbol,
            Some(symbol)
        );
        assert_eq!(
            snapshot.types[snapshot.type_arguments[&call_returned][0].0 as usize].kind,
            TypeKind::Number,
            "the call contract instantiates the owner's T while the declared ABI stays an object pointer"
        );
    }
}
