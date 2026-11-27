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
    push(
        func,
        OpKind::Call {
            callee: Callee::Direct("fill".into()),
            args: vec![object],
            frame: None,
        },
        HirType::Void,
    )
}

fn program(fields: usize) -> Program {
    let object = HirType::Managed(ManagedType::Object(TypeId(1)));
    let string = HirType::Managed(ManagedType::String);
    let mut callee = super::super::super::tests::fixture();
    callee.name = "fill".into();
    callee.return_type = HirType::Void;
    callee.values.clear();
    callee.params.truncate(1);
    callee.blocks = vec![Block {
        params: vec![],
        ops: vec![],
        terminator: Terminator::Return(None),
    }];
    let base = push(&mut callee, OpKind::Param(0), object.clone());
    let text = push(
        &mut callee,
        OpKind::ConstString("value".into()),
        string.clone(),
    );
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
    caller.blocks[0].terminator = Terminator::Jump {
        target: BlockId(1),
        args: vec![],
    };
    let fill = ValueId(u32::try_from(caller.values.len()).unwrap());
    caller.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct("fill".into()),
            args: vec![busy],
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
    for in_callee in [false, true] {
        let mut program = program(2);
        let func = &mut program.funcs[usize::from(!in_callee)];
        let call = ValueId(u32::try_from(func.values.len()).unwrap());
        func.values.push(Op {
            kind: OpKind::Call {
                callee: Callee::External("unknown_effect".into()),
                args: vec![],
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
