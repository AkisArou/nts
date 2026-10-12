//! Proven fields dispatch to their concrete storage; unproven fields retain
//! the Part 0 guard. A known class still uses a direct field access.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared() -> Option<hir::Program> {
    prepared_fixture("interface-fields")
}

fn prepared_fixture(fixture: &str) -> Option<hir::Program> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("tests/programs/{fixture}/tsconfig.json"))
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::prepare(&snapshot).expect("valid HIR").program)
}

#[test]
fn source_transfers_bound_suppliers_and_keep_unrelated_absence_out() {
    let Some(program) = prepared_fixture("accessor-source-flow") else {
        return;
    };
    for name in [
        "readFace",
        "observe",
        "readValues",
        "observeValues",
        "nestedGetter",
        "erasedMarker",
        "readValue",
        "observeValue",
        "publishedHolder",
        "copyDetails",
    ] {
        assert!(
            program.funcs.iter().any(|func| func.name == name),
            "{name} must remain compiled: {:?}",
            program.uncompiled
        );
    }
    let budget = program
        .interface_access
        .families
        .iter()
        .find(|family| family.member == "budget")
        .expect("Computed flows to Face through calls and nested storage");
    assert!(budget.owners.iter().any(|owner| {
        program
            .layout(*owner)
            .is_some_and(|layout| layout.name == "Computed")
    }));
    // Every structural owner has a row, the unrelated getter's too: nothing
    // proves it never reaches `Value`. But its row is a named stop, never a
    // call into its getter, so the getter's own refusal cannot reach `Value`'s
    // readers -- `readValue` above is still compiled.
    for family in program
        .interface_access
        .families
        .iter()
        .filter(|family| family.member == "value")
    {
        let Some(layout) = program
            .layouts
            .iter()
            .find(|layout| layout.name == "UnrelatedGetter")
        else {
            continue;
        };
        let row = layout
            .methods
            .get(family.getter.slot as usize)
            .and_then(Option::as_deref)
            .and_then(|name| program.funcs.iter().find(|func| func.name == name));
        let row = row.expect("the unrelated getter has a row of its own");
        assert!(
            !row.values.iter().any(|op| matches!(
                &op.kind,
                OpKind::Call { callee: Callee::Direct(name), .. } if name.contains("UnrelatedGetter")
            )),
            "an unrelated exported getter cannot create a dependency for Value reads"
        );
        assert!(
            row.values.iter().any(|op| matches!(
                &op.kind,
                OpKind::Call { callee: Callee::External(name), .. } if name == "nts_refused"
            )),
            "its row stops by name"
        );
    }
    let read = program
        .funcs
        .iter()
        .find(|func| func.name == "readValues")
        .unwrap();
    assert!(
        !read
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::Unerase { .. })),
        "an unrelated optional array cannot change Values' typed payload"
    );
    let optional = program
        .interface_access
        .families
        .iter()
        .find(|family| family.member == "marker")
        .expect("erased object suppliers retain absence through an assertion");
    for name in ["Missing", "Marked"] {
        assert!(
            optional.owners.iter().any(|owner| program
                .layout(*owner)
                .is_some_and(|layout| layout.name == name)),
            "erasure must preserve {name}"
        );
    }
}

#[test]
fn explicit_function_receivers_keep_their_proven_storage() {
    let Some(program) = prepared_fixture("accessor-source-flow") else {
        return;
    };
    let reader = program
        .funcs
        .iter()
        .find(|func| func.name == "readReceiver@this")
        .unwrap();
    let accepted: Vec<_> = reader
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::InstanceOf { classes, .. } => Some(classes.as_slice()),
            _ => None,
        })
        .flatten()
        .filter_map(|ty| program.layout(*ty))
        .collect();
    let caller = program
        .funcs
        .iter()
        .find(|func| func.name == "explicitReceivers")
        .unwrap();
    let allocations: Vec<_> = caller
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. }))
        .filter_map(|op| match op.ty {
            hir::HirType::Managed(hir::ManagedType::Object(ty)) => program.layout(ty),
            _ => None,
        })
        .filter(|layout| layout.fields.iter().any(|field| field.name == "value"))
        .collect();
    assert_eq!(
        allocations.len(),
        4,
        "all call, apply, bind and concrete receivers are exercised"
    );
    for layout in allocations {
        assert!(
            accepted
                .iter()
                .any(|accepted| std::ptr::eq(*accepted, layout)),
            "the receiver guard must accept the source allocation's proven storage: {}",
            layout.name
        );
    }
}

#[test]
fn stored_record_results_keep_the_existing_positional_path() {
    let Some(program) = prepared_fixture("accessor-stored-result") else {
        return;
    };
    for name in ["observeDirect", "read"] {
        assert!(
            program.funcs.iter().any(|func| func.name == name),
            "a stored record result cannot lose its existing positional path: {name}: {:?}",
            program.uncompiled
        );
    }
}

#[test]
fn native_rows_do_not_break_a_private_generic_template_prefix() {
    let Some(program) = prepared_fixture("accessor-private-template") else {
        return;
    };
    assert!(!program.interface_access.families.is_empty());
    assert!(
        program
            .funcs
            .iter()
            .any(|func| func.name == "observeNumber"),
        "a source template with the same private declaration and storage must keep compiling: {:?}",
        program.uncompiled
    );
}

#[test]
fn accessor_reads_keep_checked_narrowing_and_actual_getter_absence() {
    let Some(program) = prepared_fixture("accessor-narrowed-read") else {
        return;
    };
    let flag = program
        .funcs
        .iter()
        .find(|func| func.name == "flag")
        .expect("the predicate's checked field read must remain compiled");
    assert!(
        flag.values
            .iter()
            .any(|op| { matches!(op.kind, OpKind::Unerase { .. }) && op.ty == hir::HirType::Bool })
    );
    assert!(program.uncompiled.iter().any(|(name, reason)| {
        name == "assertedRead" && reason.contains("an erased value where a concrete")
    }));
    let nullable = program
        .funcs
        .iter()
        .find(|func| func.name == "observeNullable")
        .expect("the getter's actual null can still return through unknown");
    assert!(
        !nullable
            .values
            .iter()
            .any(|op| { matches!(op.kind, OpKind::Unerase { .. }) && op.ty == hir::HirType::Bool })
    );
    for name in ["Query#read", "observeQuery"] {
        assert!(
            program.funcs.iter().any(|func| func.name == name),
            "checked narrowing of a concrete stored field must remain compiled: {name}: {:?}",
            program.uncompiled
        );
    }
}

#[test]
fn an_exact_source_allocation_keeps_its_typed_array_storage() {
    let Some(program) = prepared_fixture("accessor-known-storage") else {
        return;
    };
    assert!(
        program
            .interface_access
            .families
            .iter()
            .any(|family| family.member == "entries"),
        "the control must have a licensed field family"
    );
    let append = program
        .funcs
        .iter()
        .find(|func| func.name == "appendLocal")
        .expect("a typed local read must not be lost to the family's erased ABI");
    assert!(append.values.iter().any(
        |op| matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                if name == "nts_array_push_ref")
    ));
    assert!(!append.values.iter().any(|op| {
        matches!(op.kind, OpKind::Call { callee: Callee::Virtual { slot, .. }, .. }
            if program.interface_access.contains_selector(slot))
    }));
}

#[test]
fn preserving_fields_keeps_equivalent_optional_record_layouts_merged() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/accessor-preserved-layout/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    for access in [
        hir::InterfaceAccess::Materialize,
        hir::InterfaceAccess::PreserveFieldAccess,
    ] {
        let lowered = hir::lower::lower_with_access(
            &snapshot,
            &[],
            &rustc_hash::FxHashMap::default(),
            access,
        );
        let program = &lowered.program;
        assert!(program.interface_access.families.len() >= 2);
        let layout = |name| {
            let function = program.funcs.iter().find(|func| func.name == name).unwrap();
            let hir::HirType::Managed(hir::ManagedType::Object(ty)) = function.params[0].ty else {
                panic!("record parameter");
            };
            program.layout(ty).unwrap()
        };
        let optional = layout("readOptional");
        let explicit = layout("readExplicit");
        assert_eq!(
            optional
                .fields
                .iter()
                .map(|field| (&field.name, &field.ty))
                .collect::<Vec<_>>(),
            explicit
                .fields
                .iter()
                .map(|field| (&field.name, &field.ty))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            std::ptr::eq(optional, explicit),
            access == hir::InterfaceAccess::PreserveFieldAccess,
            "optional membership differs, but preserving storage has the same geometry"
        );
    }
}

#[test]
fn preserving_stored_fields_does_not_construct_unused_native_bodies() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-fields/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    for access in [
        hir::InterfaceAccess::Materialize,
        hir::InterfaceAccess::PreserveFieldAccess,
    ] {
        let lowered = hir::lower::lower_with_access(
            &snapshot,
            &[],
            &rustc_hash::FxHashMap::default(),
            access,
        );
        let program = &lowered.program;
        assert!(!program.interface_access.families.is_empty());
        let has_body = program
            .funcs
            .iter()
            .any(|func| func.name.contains("nts$get$") || func.name.contains("nts$set$"));
        assert_eq!(
            has_body,
            access == hir::InterfaceAccess::Materialize,
            "unused helper bodies must not demand layouts before pruning"
        );
    }
}

#[test]
fn preserving_optional_storage_keeps_source_field_reads() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/accessor-schema-supplier/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    for access in [
        hir::InterfaceAccess::Materialize,
        hir::InterfaceAccess::PreserveFieldAccess,
    ] {
        let program = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider: hir::Provider::HostGc,
                ..hir::Options::new(access)
            },
        )
        .unwrap()
        .program;
        if access == hir::InterfaceAccess::PreserveFieldAccess {
            assert!(
                program.funcs.iter().all(|func| {
                    !func.name.contains("nts$get$") && !func.name.contains("nts$set$")
                }),
                "a preserved field must not revive a native-only accessor helper"
            );
        }
        for name in ["readLabel", "resultLabel", "textOf"] {
            let read = program.funcs.iter().find(|f| f.name == name).unwrap();
            let dispatches = read.values.iter().any(|op| {
                matches!(op.kind, OpKind::Call { callee: Callee::Virtual { slot, .. }, .. }
                    if program.interface_access.contains_selector(slot))
            });
            assert_eq!(
                dispatches,
                access == hir::InterfaceAccess::Materialize,
                "{name}"
            );
            if access == hir::InterfaceAccess::PreserveFieldAccess {
                assert!(
                    read.values
                        .iter()
                        .any(|op| matches!(op.kind, OpKind::FieldGet { .. }))
                );
            }
        }
    }
}

#[test]
fn stored_field_capability_is_independent_of_the_memory_provider() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-fields/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    for provider in [hir::Provider::NoGc, hir::Provider::HostGc] {
        for interface_access in [
            hir::InterfaceAccess::Materialize,
            hir::InterfaceAccess::PreserveFieldAccess,
        ] {
            let mut program = hir::prepare_with(
                &snapshot,
                &hir::Options {
                    provider,
                    ..hir::Options::new(interface_access)
                },
            )
            .unwrap()
            .program;
            let read = program
                .funcs
                .iter()
                .find(|func| func.name == "nameOf")
                .unwrap();
            let dispatches = read.values.iter().any(|op| {
                matches!(op.kind, OpKind::Call { callee: Callee::Virtual { slot, .. }, .. }
                    if program.interface_access.contains_selector(slot))
            });
            assert_eq!(
                dispatches,
                interface_access == hir::InterfaceAccess::Materialize
            );
            if interface_access == hir::InterfaceAccess::PreserveFieldAccess {
                assert!(
                    read.values
                        .iter()
                        .any(|op| matches!(op.kind, OpKind::FieldGet { .. }))
                );
                assert!(
                    read.values.iter().any(|op| {
                        matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                        if name == "nts_refused")
                    }),
                    "the preserved positional read must retain its layout guard"
                );
            }
            program.interface_access.mode = Some(match interface_access {
                hir::InterfaceAccess::Materialize => hir::InterfaceAccess::PreserveFieldAccess,
                hir::InterfaceAccess::PreserveFieldAccess => hir::InterfaceAccess::Materialize,
            });
            assert!(
                hir::verify::verify(&program).is_err(),
                "the verifier must reject a changed preparation contract"
            );
        }
    }
}

#[test]
fn non_prefix_field_views_keep_their_license_and_cannot_become_plain_casts() {
    let Some(program) = prepared_fixture("interface-field-view") else {
        return;
    };
    let reordered = program
        .funcs
        .iter()
        .find(|f| f.name == "reordered")
        .unwrap();
    let (at, view) = reordered
        .values
        .iter()
        .enumerate()
        .find(|(_, op)| matches!(op.kind, OpKind::FieldView { .. }))
        .expect("a non-prefix source transfer");
    let OpKind::FieldView {
        value,
        source,
        face,
    } = view.kind
    else {
        unreachable!()
    };
    assert!(
        program
            .interface_access
            .native_views
            .contains(&(source, face))
    );
    assert!(
        !program
            .funcs
            .iter()
            .find(|f| f.name == "ordered")
            .unwrap()
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::FieldView { .. }))
    );
    let mut unlicensed = program.clone();
    unlicensed.interface_access.native_views.clear();
    assert!(
        hir::verify::verify(&unlicensed).is_err(),
        "a view needs its source license"
    );
    let mut cast = program.clone();
    cast.funcs
        .iter_mut()
        .find(|f| f.name == "reordered")
        .unwrap()
        .values[at]
        .kind = OpKind::Convert(value);
    assert!(
        hir::verify::verify(&cast).is_err(),
        "a Convert cannot replace a view"
    );
    let mut unused = program;
    unused.interface_access.native_views.insert((face, face));
    assert!(
        hir::verify::verify(&unused).is_err(),
        "each license must name a source transfer"
    );
}

#[test]
fn a_field_view_outlives_its_replaced_owner_under_reference_counting() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-field-view-lifetime/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&tsconfig).unwrap();
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::ReferenceCounting,
            ..hir::Options::new(hir::InterfaceAccess::Materialize)
        },
    )
    .expect("the view's alias and ownership remain valid after RC insertion");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let function = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name == "returnView")
        .expect("the escaping view's producer remains");
    assert!(
        function
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::FieldView { .. })),
        "the ownership witness must exercise a licensed non-prefix view"
    );
    assert!(
        function.values.iter().any(|op| {
            let hir::HirType::Managed(hir::ManagedType::Object(ty)) = op.ty else {
                return false;
            };
            prepared
                .program
                .layout(ty)
                .is_some_and(|layout| layout.name == "Reordered")
                && matches!(op.kind, OpKind::ObjectNew { frame: false })
        }),
        "an object returned only through its view must escape its allocating frame"
    );
}

#[test]
fn unrelated_optional_defaults_preserve_a_records_literal_storage_identity() {
    let Some(program) = prepared_fixture("accessor-default-record") else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    let maker = program
        .funcs
        .iter()
        .find(|f| f.name == "maybeAddress")
        .unwrap();
    let hir::HirType::Managed(hir::ManagedType::Object(face)) = maker.return_type else {
        panic!("optional Address has pointer storage");
    };
    let allocation = maker
        .values
        .iter()
        .find(|op| matches!(op.kind, OpKind::ObjectNew { .. }))
        .unwrap();
    let hir::HirType::Managed(hir::ManagedType::Object(owner)) = allocation.ty else {
        panic!("Address literal has object storage");
    };
    assert!(
        std::ptr::eq(
            program.layout(face).unwrap(),
            program.layout(owner).unwrap()
        ),
        "an unrelated missing optional getter must not separate equal records"
    );
    let records: Vec<_> = program
        .layouts
        .iter()
        .filter(|layout| {
            layout.fields.len() == 2
                && layout.fields[0].name == "item"
                && layout.fields[1].name == "remove"
        })
        .collect();
    assert_eq!(
        records.len(),
        1,
        "instantiated callback return records share their literal storage"
    );
}

#[test]
fn anonymous_schema_reservations_do_not_depend_on_declaration_order() {
    let mut shapes = Vec::new();
    for fixture in ["accessor-schema-order", "accessor-schema-order-reversed"] {
        let Some(program) = prepared_fixture(fixture) else {
            return;
        };
        let mut rows = Vec::new();
        for fields in [["item", "remove"], ["hostname", "port"]] {
            let records: Vec<_> = program
                .layouts
                .iter()
                .filter(|layout| {
                    layout
                        .fields
                        .iter()
                        .map(|field| field.name.as_str())
                        .eq(fields)
                })
                .collect();
            assert_eq!(
                records.len(),
                1,
                "{fixture}: anonymous schema must alias its face"
            );
            rows.push(
                records[0]
                    .methods
                    .iter()
                    .filter(|entry| entry.is_some())
                    .count(),
            );
        }
        shapes.push(rows);
    }
    assert_eq!(
        shapes[0], shapes[1],
        "both declaration orders reserve the same rows"
    );
}

#[test]
fn default_getter_roles_survive_prepare_and_only_default_targets_share() {
    let Some(program) = prepared_fixture("accessor-default-sharing") else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    let defaults = &program.interface_access.default_bodies;
    assert!(
        defaults.len() >= 2,
        "both missing-field owners survive prepare"
    );
    let emitted: std::collections::BTreeSet<_> =
        program.native_funcs().map(|f| f.name.as_str()).collect();
    let mut shared = 0;
    for layout in &program.layouts {
        let row = program.native_methods(layout).expect("native row");
        for (slot, logical) in layout.methods.iter().enumerate() {
            let Some(column) = program.native_column(u32::try_from(slot).unwrap()) else {
                continue;
            };
            let target = row.get(column as usize).copied().flatten();
            if logical.as_deref() != target {
                let logical = logical.as_ref().expect("null cannot acquire a body");
                let target = target.expect("a live default cannot disappear");
                assert_eq!(defaults.get(logical), defaults.get(target));
                assert!(defaults.contains_key(logical));
                assert!(emitted.contains(target));
                assert!(!emitted.contains(logical.as_str()));
                shared += 1;
            }
        }
    }
    assert!(
        shared > 0,
        "prepared defaults actually share a native target"
    );
}

#[test]
fn a_transitively_refused_getter_refuses_interface_readers() {
    let Some(program) = prepared_fixture("accessor-refusal-chain") else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    for caller in [
        "readFace",
        "caughtFace",
        "unknownReceiver",
        "caughtReceiver",
    ] {
        assert!(
            program.uncompiled.iter().any(|(name, reason)| {
                name == caller && reason.starts_with("it calls `") && reason.contains("`eval`")
            }),
            "{caller} must inherit the concrete getter refusal: {:?}",
            program.uncompiled
        );
        assert!(!program.funcs.iter().any(|func| func.name == caller));
    }
    assert!(
        program
            .funcs
            .iter()
            .any(|func| func.name == "provenReceiver")
    );
}

#[test]
fn an_initially_refused_getter_uses_the_same_dependency_cascade() {
    let Some(program) = prepared_fixture("accessor-refusal-chain") else {
        return;
    };
    for caller in [
        "readDirect",
        "caughtDirect",
        "directUnknown",
        "directCaught",
    ] {
        assert!(
            program.uncompiled.iter().any(|(name, reason)| {
                name == caller && reason.starts_with("it calls `") && reason.contains("`eval`")
            }),
            "{caller} must inherit the initial getter refusal: {:?}",
            program.uncompiled
        );
        assert!(!program.funcs.iter().any(|func| func.name == caller));
    }
    assert!(program.funcs.iter().any(|func| func.name == "directProven"));
    assert!(
        !program
            .funcs
            .iter()
            .filter(|func| func.name.contains("nts$get$"))
            .flat_map(|func| &func.values)
            .any(|op| {
                matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                if name == "nts_refused")
            }),
        "an absent getter body must not acquire an emitted refusal stub"
    );
}

#[test]
fn a_class_test_can_prove_the_stored_receivers_exact_layout() {
    let Some(program) = prepared_fixture("accessor-layout-proof") else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    let dispatches = |name: &str| {
        let function = program.funcs.iter().find(|func| func.name == name).unwrap();
        function.values.iter().any(|op| {
            matches!(&op.kind,
            OpKind::Call { callee: Callee::Virtual { slot, .. }, .. }
                if program.interface_access.contains_selector(*slot)
                    && op.ty != hir::HirType::Void)
        })
    };
    assert!(!dispatches("guarded"));
    assert!(dispatches("unguarded"));
}

#[test]
fn field_dispatch_does_not_turn_prototype_getters_into_own_properties() {
    let Some(program) = prepared_fixture("accessor-spread-boundary") else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    assert!(program.uncompiled.iter().any(|(_, reason)| {
        reason.contains("own properties, order or storage are not uniform")
    }));
    assert!(!program.funcs.iter().any(|func| func.name == "spreadFace"));
    assert!(
        program
            .uncompiled
            .iter()
            .any(|(_, reason)| { reason.contains("an `Object` static through an interface") })
    );
    assert!(
        program
            .funcs
            .iter()
            .any(|func| func.name == "provenOwnShape"),
        "the uniform control was refused: {:?}",
        program.uncompiled
    );
}

/// The classes each class test in `func` names, by layout name and sorted.
fn tested(program: &hir::Program, func: &str) -> Vec<Vec<String>> {
    let func = program
        .funcs
        .iter()
        .find(|candidate| candidate.name == func)
        .unwrap_or_else(|| panic!("`{func}` is kept"));
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::InstanceOf { classes, .. } => Some(classes),
            _ => None,
        })
        .map(|classes| {
            let mut names: Vec<String> = classes
                .iter()
                .filter_map(|class| {
                    program
                        .layouts
                        .iter()
                        .find(|layout| layout.types.contains(class))
                })
                .map(|layout| layout.name.clone())
                .collect();
            names.sort();
            names.dedup();
            names
        })
        .collect()
}

#[test]
fn proven_interface_fields_dispatch_to_each_class_storage() {
    let Some(program) = prepared() else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    for (function, member, writes) in [
        ("levelOf", "level", false),
        ("setLevel", "level", true),
        ("nameOf", "name", false),
    ] {
        assert!(tested(&program, function).is_empty());
        assert_storage_rows(&program, function, member, writes);
    }
}

fn assert_storage_rows(program: &hir::Program, function: &str, member: &str, writes: bool) {
    let caller = program
        .funcs
        .iter()
        .find(|func| func.name == function)
        .unwrap();
    let slot = caller
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                ..
            } => Some(*slot),
            _ => None,
        })
        .expect("an interface access dispatches");
    for name in ["Red", "Green", "Lime", "Teal"] {
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.name == name)
            .unwrap();
        let target = layout.methods[slot as usize]
            .as_ref()
            .expect("complete coverage");
        let body = program
            .funcs
            .iter()
            .find(|func| &func.name == target)
            .unwrap();
        let field = layout
            .fields
            .iter()
            .position(|field| field.name == member)
            .unwrap();
        assert!(
            body.values.iter().any(|op| match &op.kind {
                OpKind::FieldGet { field: actual, .. } if !writes => *actual as usize == field,
                OpKind::FieldSet { field: actual, .. } if writes => *actual as usize == field,
                _ => false,
            }),
            "{name}'s row must access its own `{member}`"
        );
    }
}

#[test]
fn an_unproven_field_keeps_the_class_guard() {
    let Some(program) = prepared() else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    assert_eq!(tested(&program, "unreadyName"), [["Unready"]]);
}

#[test]
fn an_access_through_the_class_is_not_tested() {
    let Some(program) = prepared() else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    assert!(tested(&program, "levelOfGreen").is_empty());
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == "levelOfGreen")
        .unwrap();
    assert!(
        func.values
            .iter()
            .any(|op| matches!(op.kind, OpKind::FieldGet { .. }))
    );
    assert!(!func.values.iter().any(|op| matches!(
        op.kind,
        OpKind::Call {
            callee: Callee::Virtual { .. },
            ..
        }
    )));
}

#[test]
fn accessor_coverage_and_storage_permissions_are_verified() {
    let Some(program) = prepared() else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    let getter = program
        .interface_access
        .families
        .iter()
        .find(|family| family.member == "level")
        .unwrap()
        .getter
        .clone();
    let mut missing = program.clone();
    missing
        .layouts
        .iter_mut()
        .find(|layout| layout.name == "Green")
        .unwrap()
        .methods[getter.slot as usize] = None;
    assert!(
        hir::verify::verify(&missing)
            .unwrap_err()
            .iter()
            .any(|error| {
                matches!(error, hir::verify::Invalid::InvalidInterfaceAccess { reason }
            if reason.contains("Green") && reason.contains("level"))
            })
    );

    let mut wrong_abi = program.clone();
    let row = wrong_abi
        .layouts
        .iter()
        .find(|layout| layout.name == "Green")
        .unwrap()
        .methods[getter.slot as usize]
        .as_ref()
        .unwrap()
        .clone();
    wrong_abi
        .funcs
        .iter_mut()
        .find(|func| func.name == row)
        .unwrap()
        .return_type = hir::HirType::Bool;
    assert!(
        hir::verify::verify(&wrong_abi)
            .unwrap_err()
            .iter()
            .any(|error| {
                matches!(error, hir::verify::Invalid::InvalidInterfaceAccess { reason }
            if reason.contains("declared accessor ABI"))
            })
    );

    let mut stale = program;
    let owner = *stale
        .interface_access
        .storage_bodies
        .values()
        .next()
        .unwrap();
    stale
        .interface_access
        .storage_bodies
        .insert("removed-helper".to_owned(), owner);
    assert!(
        hir::verify::verify(&stale)
            .unwrap_err()
            .iter()
            .any(|error| {
                matches!(error, hir::verify::Invalid::InvalidInterfaceAccess { reason }
            if reason.contains("removed-helper"))
            })
    );
}

#[test]
fn raising_accessor_rows_require_complete_coverage() {
    let Some(mut program) = prepared_fixture("accessor-families") else {
        eprintln!("SKIP interface_fields: tsgo is not built");
        return;
    };
    let family = program
        .interface_access
        .families
        .iter()
        .find(|family| family.member == "value" && !family.raising.is_empty())
        .unwrap();
    let slot = family.raising[0].slot as usize;
    let owners = family.owners.clone();
    let layout = program
        .layouts
        .iter_mut()
        .find(|layout| layout.types.iter().any(|owner| owners.contains(owner)))
        .unwrap();
    assert!(layout.methods[slot].is_some());
    layout.methods[slot] = None;
    assert!(
        hir::verify::verify(&program)
            .unwrap_err()
            .iter()
            .any(|error| {
                matches!(error, hir::verify::Invalid::InvalidInterfaceAccess { reason }
                if reason.contains("value") && reason.contains("declared accessor ABI"))
            })
    );
}
