use super::*;
use crate::hir::{Block, HirType, Layout, ManagedType, Op, Param};
use nts_semantic_schema::TypeId;

fn push(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap());
    func.values.push(Op {
        kind,
        ty,
        origin: func.origin.clone(),
    });
    func.blocks[0].ops.push(id);
    id
}

fn call(func: &mut Func, object: ValueId) -> ValueId {
    let text = push(
        func,
        OpKind::ConstString("payload".into()),
        HirType::Managed(ManagedType::String),
    );
    push(
        func,
        OpKind::Call {
            callee: Callee::Direct("fill".into()),
            args: vec![object, text],
            frame: None,
        },
        HirType::Void,
    )
}

fn program(fields: usize) -> Program {
    let object = HirType::Managed(ManagedType::Object(TypeId(1)));
    let string = HirType::Managed(ManagedType::String);
    let mut callee = super::super::tests::fixture();
    callee.name = "fill".into();
    callee.return_type = HirType::Void;
    callee.values.clear();
    callee.params.truncate(1);
    let mut text_parameter = callee.params[0].clone();
    text_parameter.name = "text".into();
    text_parameter.ty = string.clone();
    callee.params.push(text_parameter);
    callee.blocks = vec![Block {
        params: vec![],
        ops: vec![],
        terminator: Terminator::Return(None),
    }];
    let base = push(&mut callee, OpKind::Param(0), object.clone());
    let text = push(&mut callee, OpKind::Param(1), string.clone());
    for field in 0..fields {
        push(
            &mut callee,
            OpKind::FieldSet {
                object: base,
                field: u32::try_from(field).unwrap(),
                value: text,
            },
            HirType::Void,
        );
    }
    let mut caller = callee.clone();
    caller.name = "work".into();
    caller.exported = true;
    caller.values.clear();
    caller.params.clear();
    caller.blocks[0].ops.clear();
    let made = push(
        &mut caller,
        OpKind::ObjectNew { frame: true },
        object.clone(),
    );
    call(&mut caller, made);
    call(&mut caller, made);
    Program {
        funcs: vec![callee, caller],
        layouts: vec![Layout {
            types: vec![TypeId(1)],
            name: "Holder".into(),
            interfaces: vec![],
            fields: (0..fields)
                .map(|field| hir::Field {
                    name: format!("field{field}").into(),
                    ty: string.clone(),
                    readonly: false,
                    declared_by: None,
                    written: None,
                })
                .collect(),
            methods: vec![],
            base: None,
        }],
        ..Program::default()
    }
}

fn rewrite(program: &mut Program) -> Versioning {
    let before = hir::own::summarize(program, &program.layouts);
    materialize(program, &before)
}

fn loads(func: &Func) -> usize {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|&&id| matches!(func.value(id).kind, OpKind::FieldGet { .. }))
        .count()
}

#[test]
fn only_vouched_calls_reach_the_private_entry_and_remove_its_old_slot_loads() {
    let mut program = program(2);
    let report = rewrite(&mut program);
    assert_eq!(report.versions.len(), 1);
    assert_eq!(report.versions[0].removed, 2);
    assert!(report.duplicated_ops <= report.original_ops);
    let name = &report.versions[0].entry;
    let contracts = hir::own::summarize(&program, &program.layouts);
    assert_eq!(contracts.slot_contracts().1.parameters[name].len(), 2);
    assert!(contracts.slot_contracts().1.parameters["fill"].is_empty());
    hir::rc::insert_summarized(&mut program, &contracts).unwrap();
    assert_eq!(
        loads(&program.funcs[0]),
        2,
        "occupied calls retain both old-value releases"
    );
    assert_eq!(
        loads(&program.funcs[2]),
        0,
        "disabling versioning must fail this assertion"
    );
}

#[test]
fn first_arrival_is_separate_from_the_occupied_backedge() {
    let mut program = program(2);
    let caller = &mut program.funcs[1];
    caller.values.clear();
    caller.blocks[0].ops.clear();
    let object = caller.values.first().map_or_else(
        || HirType::Managed(ManagedType::Object(TypeId(1))),
        |op| op.ty.clone(),
    );
    let condition = push(caller, OpKind::Param(0), HirType::Bool);
    caller.params = vec![Param {
        name: "again".into(),
        ty: HirType::Bool,
        origin: caller.origin.clone(),
        shape: hir::ParamShape::Ordinary,
        known: hir::facts::Facts::TOP,
        written: None,
    }];
    let busy = push(caller, OpKind::ObjectNew { frame: true }, object);
    let text = push(
        caller,
        OpKind::ConstString("payload".into()),
        HirType::Managed(ManagedType::String),
    );
    caller.blocks[0].terminator = Terminator::Jump {
        target: BlockId(1),
        args: vec![],
    };
    let fill = ValueId(u32::try_from(caller.values.len()).unwrap());
    caller.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct("fill".into()),
            args: vec![busy, text],
            frame: None,
        },
        ty: HirType::Void,
        origin: caller.origin.clone(),
    });
    caller.blocks.push(Block {
        params: vec![],
        ops: vec![fill],
        terminator: Terminator::Branch {
            cond: condition,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        },
    });
    caller.blocks.push(Block {
        params: vec![],
        ops: vec![],
        terminator: Terminator::Return(None),
    });
    let report = rewrite(&mut program);
    assert_eq!(
        report.versions.len(),
        2,
        "one callee entry and one first-arrival region"
    );
    assert!(report.versions.iter().all(|version| version.removed == 2));
    let contracts = hir::own::summarize(&program, &program.layouts);
    assert_eq!(
        contracts.slot_contracts().1.parameters[&report.versions[0].entry].len(),
        2
    );
    assert!(contracts.slot_contracts().1.parameters["fill"].is_empty());
    hir::verify::verify(&program).expect("both first-arrival and backedge preserve SSA");
}

#[test]
fn unknown_call_and_reentrant_callee_do_not_manufacture_a_profitable_shape() {
    assert!(!hir::runtime::stores_nothing("unknown_effect"));
    for in_callee in [false, true] {
        let mut program = program(2);
        let func = &mut program.funcs[usize::from(!in_callee)];
        let call = ValueId(u32::try_from(func.values.len()).unwrap());
        func.values.push(Op {
            kind: OpKind::Call {
                callee: Callee::External("unknown_effect".into()),
                args: vec![ValueId(0)],
                frame: None,
            },
            ty: HirType::Void,
            origin: func.origin.clone(),
        });
        func.blocks[0].ops.insert(1, call);
        assert!(rewrite(&mut program).versions.is_empty());
    }
}

#[test]
fn a_string_helper_before_the_store_leaves_two_useful_release_elisions() {
    let mut program = program(2);
    let callee = &mut program.funcs[0];
    let number = push(callee, OpKind::ConstFloat(3.0), HirType::Float { bits: 64 });
    let helper = push(
        callee,
        OpKind::Call {
            callee: Callee::External("nts_str_append_number".into()),
            args: vec![ValueId(1), number],
            frame: None,
        },
        HirType::Managed(ManagedType::String),
    );
    callee.blocks[0].ops = vec![
        ValueId(0),
        ValueId(1),
        number,
        helper,
        ValueId(2),
        ValueId(3),
    ];
    for id in [ValueId(2), ValueId(3)] {
        if let OpKind::FieldSet { value, .. } = &mut callee.values[id.0 as usize].kind {
            *value = helper;
        }
    }
    let report = rewrite(&mut program);
    assert_eq!(
        report.versions.len(),
        1,
        "the effect-connection counterfactual makes this zero"
    );
    assert_eq!(report.versions[0].removed, 2);
}

#[test]
fn initializing_a_local_object_does_not_erase_the_private_entrys_gain() {
    let mut program = program(2);
    let callee = &mut program.funcs[0];
    let local = push(
        callee,
        OpKind::ObjectNew { frame: false },
        HirType::Managed(ManagedType::Object(TypeId(1))),
    );
    let mut before = vec![ValueId(0), ValueId(1), local];
    for field in 0..2 {
        let store = push(
            callee,
            OpKind::FieldSet {
                object: local,
                field,
                value: ValueId(1),
            },
            HirType::Void,
        );
        before.push(store);
    }
    before.extend([ValueId(2), ValueId(3)]);
    callee.blocks[0].ops = before;
    let report = rewrite(&mut program);
    assert_eq!(report.versions.len(), 1);
    assert_eq!(report.versions[0].removed, 2);
}

#[test]
fn exported_callees_remain_generic() {
    let mut program = program(2);
    program.funcs[0].exported = true;
    assert!(rewrite(&mut program).versions.is_empty());
}

#[test]
fn recursive_calls_in_a_version_keep_the_generic_entry() {
    let mut program = program(2);
    call(&mut program.funcs[0], ValueId(0));
    let report = rewrite(&mut program);
    assert_eq!(report.versions.len(), 1);
    assert!(
        matches!(&program.funcs[2].values.last().unwrap().kind, OpKind::Call { callee: Callee::Direct(name), .. } if name == "fill")
    );
}

#[test]
fn three_runs_make_identical_versions_and_bodies() {
    let source = program(2);
    let runs: Vec<_> = (0..3)
        .map(|_| {
            let mut program = source.clone();
            let report = rewrite(&mut program);
            (report, format!("{:?}", program.funcs))
        })
        .collect();
    assert!(runs.windows(2).all(|pair| pair[0] == pair[1]));
}

fn with_shapes(fields: usize, masks: &[u32]) -> Program {
    let mut program = program(fields);
    let caller = &mut program.funcs[1];
    caller.values.clear();
    caller.blocks[0].ops.clear();
    let text = push(
        caller,
        OpKind::ConstString("old".into()),
        HirType::Managed(ManagedType::String),
    );
    for mask in masks {
        let base = push(
            caller,
            OpKind::ObjectNew { frame: true },
            HirType::Managed(ManagedType::Object(TypeId(1))),
        );
        for field in 0..fields {
            if mask & (1 << field) == 0 {
                push(
                    caller,
                    OpKind::FieldSet {
                        object: base,
                        field: u32::try_from(field).unwrap(),
                        value: text,
                    },
                    HirType::Void,
                );
            }
        }
        call(caller, base);
        call(caller, base);
    }
    program
}

#[test]
fn partial_shapes_stop_at_four_entries_and_leave_other_calls_generic() {
    let mut program = with_shapes(4, &[1, 2, 4, 8, 3, 5]);
    let report = rewrite(&mut program);
    assert_eq!(report.versions.len(), VARIANTS);
    assert_eq!(report.capped, ["fill"]);
    assert!(report.versions.iter().all(|version| version.removed > 0));
    assert!(report.duplicated_ops <= report.original_ops);
    let contracts = hir::own::summarize(&program, &program.layouts);
    for version in &report.versions {
        assert!(!contracts.slot_contracts().1.parameters[&version.entry].is_empty());
    }
    assert!(contracts.slot_contracts().1.parameters["fill"].is_empty());
}

#[test]
fn growth_budget_keeps_a_large_second_shape_generic() {
    let mut program = with_shapes(2, &[1, 2]);
    for _ in 0..1_000 {
        push(
            &mut program.funcs[0],
            OpKind::ConstBool(false),
            HirType::Bool,
        );
    }
    let report = rewrite(&mut program);
    assert_eq!(report.versions.len(), 1);
    assert_eq!(report.exhausted, ["slot version HIR growth"]);
    assert!(report.duplicated_ops <= report.original_ops);
    let generic = program.funcs[1].blocks.iter().flat_map(|block| &block.ops).filter(|&&id| {
        matches!(&program.funcs[1].value(id).kind, OpKind::Call { callee: Callee::Direct(name), .. } if name == "fill")
    }).count();
    assert_eq!(
        generic, 3,
        "two occupied calls and the unversioned partial shape"
    );
}

#[test]
fn actual_overwrite_entries_and_first_arrival_calls_keep_memory_source_lineage() {
    use camino::Utf8Path;
    use nts_frontend_ts::Frontend;
    for name in ["field-overwrite-in-loop", "field-overwrite-in-loop-control"] {
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/memory")
            .join(name)
            .join("tsconfig.json")
            .canonicalize_utf8()
            .expect("the overwrite fixtures are checked in");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("the overwrite fixture captures");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let roots = ["work".to_owned(), "module#init".to_owned()];
        let options = hir::Options {
            provider: hir::Memory::ReferenceCounting,
            roots: hir::reachable::Roots::Entry(&roots),
            ..hir::Options::new(hir::backend::Backend::C, hir::EntryUnwind::Terminal)
        };
        let prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
            .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
        let report = prepared
            .memory
            .as_ref()
            .expect("memory observation was requested");
        assert!(report.failure.is_none(), "{name}: {:?}", report.failure);
        assert!(report.comparison_failure.is_none());
        assert!(
            report
                .sites
                .iter()
                .all(|site| site.legacy_unknown.is_none()),
            "{name}: {}",
            report.render()
        );
        let entries: FxHashSet<_> = prepared
            .slot_versions
            .lineage
            .iter()
            .filter(|lineage| lineage.source == "fill")
            .map(|lineage| lineage.function.as_str())
            .collect();
        assert!(!entries.is_empty());
        for context in ["work:entry/fill:%12", "work:entry/work#whole:%66/fill:%12"] {
            // The control's whole call has a different source ValueId. Find
            // that context by its source suffix rather than guessing its ID.
            let mut found = false;
            for site in report.sites.iter().filter(|site| {
                site.id.function == "fill"
                    && site.context.ends_with("/fill:%12")
                    && site.context.contains("work#whole") == context.contains("work#whole")
            }) {
                found = true;
                assert!(
                    site.legacy_variants
                        .iter()
                        .any(|variant| entries.contains(variant.function.as_str()))
                );
                assert!(
                    site.legacy_variants
                        .iter()
                        .all(|variant| variant.home != "call-region")
                );
            }
            assert!(
                found,
                "{name}: the source %12 context must remain inventoried"
            );
        }
        assert!(
            report
                .sites
                .iter()
                .filter(|site| site.id.function == "fill" && !site.context.ends_with("/fill:%12"))
                .any(|site| site
                    .legacy_variants
                    .iter()
                    .any(|variant| entries.contains(variant.function.as_str()))),
            "the copied first-arrival call must join the original loop call's source context"
        );
    }
}
