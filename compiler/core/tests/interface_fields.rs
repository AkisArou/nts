//! Proven fields dispatch to their concrete storage; unproven fields retain
//! the Part 0 guard. A known class still uses a direct field access.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;

fn prepared() -> hir::Program {
    prepared_fixture("interface-fields")
}

fn prepared_fixture(fixture: &str) -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("tests/programs/{fixture}/tsconfig.json"))
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::prepare(&snapshot).expect("valid HIR").program
}

/// Whether the function `name` reads a family's field by its receiver's class
/// at run time: through the selector's table, or, where only a few classes
/// move the field (`hir::small_dispatch`), by testing for those and calling
/// the getter's default for every other class. A read whose layout is proved
/// reads the field where it is, and does neither.
fn reads_by_class(program: &hir::Program, name: &str) -> bool {
    let plan = &program.interface_access;
    let defaults: Vec<&str> = plan
        .families
        .iter()
        .filter_map(|family| plan.default_for(family.getter.slot))
        .collect();
    let function = program.funcs.iter().find(|func| func.name == name).unwrap();
    function.values.iter().any(|op| match &op.kind {
        OpKind::Call {
            callee: Callee::Virtual { slot, .. },
            ..
        } => plan.contains_selector(*slot) && op.ty != hir::HirType::Void,
        OpKind::Call {
            callee: Callee::Direct(callee),
            ..
        } => defaults.contains(&callee.as_str()),
        _ => false,
    })
}

#[test]
fn source_transfers_bound_suppliers_and_keep_unrelated_absence_out() {
    let program = prepared_fixture("accessor-source-flow");
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
        .find(|family| family.member == "budget".into())
        .expect("Computed flows to Face through calls and nested storage");
    assert!(budget.owners.iter().any(|owner| {
        program
            .layout(*owner)
            .is_some_and(|layout| layout.name == "Computed")
    }));
    assert!(
        !program
            .interface_access
            .families
            .iter()
            .filter(|family| family.member == "value".into())
            .flat_map(|family| &family.owners)
            .any(|owner| program
                .layout(*owner)
                .is_some_and(|layout| layout.name == "UnrelatedGetter")),
        "an unrelated exported getter cannot create a dependency for Value reads"
    );
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
        .find(|family| family.member == "marker".into())
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
    let program = prepared_fixture("accessor-source-flow");
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
        .filter(|layout| {
            layout
                .fields
                .iter()
                .any(|field| field.name == "value".into())
        })
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
    let program = prepared_fixture("accessor-stored-result");
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
    let program = prepared_fixture("accessor-private-template");
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
    let program = prepared_fixture("accessor-narrowed-read");
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
    assert!(
        program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
            .any(|(name, reason)| {
                name == "assertedRead" && reason.contains("an erased value where a concrete")
            })
    );
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
    let program = prepared_fixture("accessor-known-storage");
    assert!(
        program
            .interface_access
            .families
            .iter()
            .any(|family| family.member == "entries".into()),
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
fn equivalent_optional_records_keep_one_geometry_in_their_own_layouts() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/accessor-preserved-layout/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let lowered = hir::lower::lower_with(&snapshot, &[], &rustc_hash::FxHashMap::default());
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
    assert!(
        !std::ptr::eq(optional, explicit),
        "optional membership differs, so each record keeps its own layout"
    );
}

#[test]
fn a_stored_family_constructs_its_accessor_bodies() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-fields/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let lowered = hir::lower::lower_with(&snapshot, &[], &rustc_hash::FxHashMap::default());
    let program = &lowered.program;
    assert!(!program.interface_access.families.is_empty());
    assert!(
        program.interface_access.families.iter().any(|family| {
            program
                .funcs
                .iter()
                .any(|func| func.name == family.getter.declared)
        }),
        "a family's reads dispatch, so its accessor bodies exist before pruning"
    );
}

#[test]
fn optional_storage_reads_dispatch_through_their_family() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/accessor-schema-supplier/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let program = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::HostGc,
            ..hir::Options::default()
        },
    )
    .unwrap()
    .program;
    for name in ["readLabel", "resultLabel", "textOf"] {
        assert!(reads_by_class(&program, name), "{name}");
    }
}

#[test]
fn stored_field_dispatch_is_independent_of_the_memory_provider() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-fields/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    for provider in [hir::Provider::NoGc, hir::Provider::HostGc] {
        let program = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        )
        .unwrap()
        .program;
        assert!(program.interface_access.materialized);
        let read = program
            .funcs
            .iter()
            .find(|func| func.name == "nameOf")
            .unwrap();
        let dispatches = read.values.iter().any(|op| {
            matches!(op.kind, OpKind::Call { callee: Callee::Virtual { slot, .. }, .. }
                if program.interface_access.contains_selector(slot))
        });
        assert!(dispatches, "{provider:?}");
    }
}

#[test]
fn non_prefix_field_views_keep_their_license_and_cannot_become_plain_casts() {
    let program = prepared_fixture("interface-field-view");
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
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/interface-field-view-lifetime/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .unwrap();
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::ReferenceCounting,
            ..hir::Options::default()
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
    let program = prepared_fixture("accessor-default-record");
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
                && layout.fields[0].name == "item".into()
                && layout.fields[1].name == "remove".into()
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
        let program = prepared_fixture(fixture);
        let mut rows = Vec::new();
        for fields in [["item", "remove"], ["hostname", "port"]] {
            let records: Vec<_> = program
                .layouts
                .iter()
                .filter(|layout| {
                    layout
                        .fields
                        .iter()
                        .map(|field| {
                            field
                                .name
                                .public_name()
                                .expect("this fixture uses public fields")
                        })
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
    let program = prepared_fixture("accessor-default-sharing");
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
    let program = prepared_fixture("accessor-refusal-chain");
    for caller in [
        "readFace",
        "caughtFace",
        "unknownReceiver",
        "caughtReceiver",
    ] {
        assert!(
            program
                .uncompiled
                .iter()
                .map(|entry| (&entry.name, &entry.reason))
                .any(|(name, reason)| {
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
    let program = prepared_fixture("accessor-refusal-chain");
    for caller in [
        "readDirect",
        "caughtDirect",
        "directUnknown",
        "directCaught",
    ] {
        assert!(
            program
                .uncompiled
                .iter()
                .map(|entry| (&entry.name, &entry.reason))
                .any(|(name, reason)| {
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
    let program = prepared_fixture("accessor-layout-proof");
    assert!(!reads_by_class(&program, "guarded"));
    assert!(reads_by_class(&program, "unguarded"));
}

#[test]
fn field_dispatch_does_not_turn_prototype_getters_into_own_properties() {
    let program = prepared_fixture("accessor-spread-boundary");
    assert!(
        program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
            .any(|(_, reason)| {
                reason.contains("own properties, order or storage are not uniform")
            })
    );
    assert!(!program.funcs.iter().any(|func| func.name == "spreadFace"));
    assert!(
        program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
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
    let program = prepared();
    for (function, member, writes) in [
        ("levelOf", "level", false),
        ("setLevel", "level", true),
        ("nameOf", "name", false),
    ] {
        assert_eq!(
            tested(&program, function),
            [] as [std::vec::Vec<std::string::String>; 0]
        );
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
            .position(|field| field.name == member.into())
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
    let program = prepared();
    assert_eq!(tested(&program, "unreadyName"), [["Unready"]]);
}

#[test]
fn an_access_through_the_class_is_not_tested() {
    let program = prepared();
    assert_eq!(
        tested(&program, "levelOfGreen"),
        [] as [std::vec::Vec<std::string::String>; 0]
    );
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
    let program = prepared();
    let getter = program
        .interface_access
        .families
        .iter()
        .find(|family| family.member == "level".into())
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
    let mut program = prepared_fixture("accessor-families");
    let family = program
        .interface_access
        .families
        .iter()
        .find(|family| family.member == "value".into() && !family.raising.is_empty())
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

/// The selector's default is the face's own positional read, and a class laid
/// out as a prefix of the face is read at that position whether through the
/// default or through a row of its own.
///
/// Rows are owed to the owners that keep the field elsewhere. A row for every
/// structural owner instead gave each object of a program a full table per
/// optional-only face it fit, and the `cluster` addon grew by 71%.
#[test]
fn a_prefix_class_is_read_at_the_faces_own_position() {
    let program = prepared_fixture("accessor-default-row");
    let family = program
        .interface_access
        .families
        .iter()
        .find(|family| {
            family.member == "a".into()
                && program
                    .layout(family.face)
                    .is_some_and(|layout| layout.name == "F3")
        })
        .expect("`F3.a` dispatches: `T3` keeps `a` elsewhere");
    let slot = family.getter.slot;
    let default = program
        .interface_access
        .default_for(slot)
        .expect("the selector has a default");
    let body = program
        .funcs
        .iter()
        .find(|func| func.name == default)
        .expect("the default is compiled");
    let face = program.layout(family.face).unwrap();
    let at = face.index_of("a").unwrap();
    assert!(
        body.values
            .iter()
            .any(|op| matches!(op.kind, OpKind::FieldGet { field, .. } if field == at)),
        "the default reads the face's own position"
    );
    // By class, not by layout name: `S3`'s fields are exactly `F3`'s, and a
    // class that reaches a face of its own shape shares the face's layout.
    //
    // `S3` and `D3` reach `F3` through `this`, which the supplier bound
    // follows, so they carry the rows a class pushed onto the registry from
    // outside carries -- the same rows, read where the face reads. A row on an
    // owner that keeps the field at the face's own position is redundant with
    // the default; dropping it is a size question for the faces family, and
    // until then this asserts that such a row is at least the face's read.
    for name in ["S3", "D3"] {
        let class = program
            .classes
            .iter()
            .find(|class| class.name == name)
            .unwrap_or_else(|| panic!("{name} is a class of the program"));
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.types.iter().any(|ty| class.types.contains(ty)))
            .unwrap_or_else(|| panic!("{name} is laid out"));
        let Some(Some(row)) = layout.methods.get(slot as usize) else {
            continue;
        };
        let body = program
            .funcs
            .iter()
            .find(|func| &func.name == row)
            .unwrap_or_else(|| panic!("{name}'s row `{row}` is compiled"));
        assert!(
            body.values
                .iter()
                .any(|op| matches!(op.kind, OpKind::FieldGet { field, .. } if field == at)),
            "{name}'s row reads the face's own position"
        );
    }
}

#[test]
fn a_family_read_narrowed_by_a_test_over_stored_fields_is_the_narrowed_type() {
    let program = prepared_fixture("accessor-narrowed-family");
    let refused = |name: &str| {
        program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
            .any(|(refused, reason)| {
                refused == name && reason.contains("an erased value where a concrete")
            })
    };
    let name_of = program
        .funcs
        .iter()
        .find(|func| func.name == "nameOf")
        .expect("a read narrowed by `typeof` over stored fields compiles");
    assert!(name_of.values.iter().any(|op| {
        matches!(op.kind, OpKind::Unerase { .. })
            && op.ty == hir::HirType::Managed(hir::ManagedType::String)
    }));
    // The controls: the same read asserted rather than tested, and the same
    // test over a family with a getter, both keep the family's erased value.
    assert!(refused("assertedName"), "{:?}", program.uncompiled);
    assert!(refused("labelOf"), "{:?}", program.uncompiled);
}
