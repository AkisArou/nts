use super::*;
use crate::hir::{Absent, Block, Callee, HirType, Op, Param, Terminator};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{Origin, TypeId};

fn fixture() -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    });
    let object = HirType::Managed(hir::ManagedType::Object(TypeId(1)));
    let mut func = Func {
        name: "slots".to_owned(),
        params: Vec::new(),
        return_type: object.clone(),
        written_return: None,
        validation: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Impossible,
        values: Vec::new(),
        blocks: Vec::new(),
        origin: origin.clone(),
        exported: false,
        raises: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: FxHashMap::default(),
    };
    for (kind, ty) in [
        (OpKind::Param(0), object.clone()),
        (OpKind::Param(1), object.clone()),
        (OpKind::ConstNull, object.clone()),
        (
            OpKind::FieldSet {
                object: ValueId(0),
                field: 0,
                value: ValueId(2),
            },
            HirType::Void,
        ),
        (
            OpKind::FieldSet {
                object: ValueId(1),
                field: 0,
                value: ValueId(1),
            },
            HirType::Void,
        ),
        (OpKind::BlockParam(0), object.clone()),
        (OpKind::ConstBool(true), HirType::Bool),
        (
            OpKind::Call {
                callee: Callee::External("unknown".to_owned()),
                args: Vec::new(),
                frame: None,
            },
            HirType::Void,
        ),
    ] {
        func.values.push(Op {
            kind,
            ty,
            origin: origin.clone(),
        });
    }
    func.params = vec![
        Param {
            name: "a".into(),
            ty: object.clone(),
            origin: origin.clone(),
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        },
        Param {
            name: "b".into(),
            ty: object,
            origin,
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        },
    ];
    func
}

fn observe(state: &mut Fresh, func: &Func, id: u32) {
    let id = ValueId(id);
    state.observe(
        func,
        id,
        &func.value(id).kind,
        &FxHashSet::default(),
        &Returned::default(),
    );
}

#[test]
fn explicit_null_is_killed_by_a_write_through_an_unknown_alias() {
    let func = fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    assert!(state.known_zero(ValueId(0), Slot::Field(0)));
    observe(&mut state, &func, 4);
    assert!(!state.known_zero(ValueId(0), Slot::Field(0)));
}

#[test]
fn an_open_call_without_arguments_can_still_mutate_an_aliased_field() {
    let func = fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    observe(&mut state, &func, 7);
    assert!(!state.known_zero(ValueId(0), Slot::Field(0)));
}

#[test]
fn fields_and_array_elements_have_separate_slot_keys() {
    let mut state = Fresh::default();
    state.zero.insert(ValueId(0), Slot::Field(0));
    assert!(state.known_zero(ValueId(0), Slot::Field(0)));
    assert!(!state.known_zero(ValueId(0), Slot::Element(0)));
}

#[test]
fn a_phi_rebinds_the_fact_and_drops_the_previous_iterations_value() {
    let func = fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    let carried = state.across(&[ValueId(5)], &[ValueId(0)]);
    assert!(carried.known_zero(ValueId(5), Slot::Field(0)));
    let rebound = carried.across(&[ValueId(5)], &[ValueId(1)]);
    assert!(!rebound.known_zero(ValueId(5), Slot::Field(0)));
}

#[test]
fn every_predecessor_must_establish_the_null_before_a_join() {
    let func = fixture();
    let mut cleared = Fresh::default();
    observe(&mut cleared, &func, 3);
    let unknown = Fresh::default();
    assert!(
        !cleared
            .both(&unknown)
            .known_zero(ValueId(0), Slot::Field(0))
    );
    assert!(
        cleared
            .both(&cleared)
            .known_zero(ValueId(0), Slot::Field(0))
    );
}

#[test]
fn block_storage_order_does_not_make_a_conditional_store_dominate_a_return() {
    let mut func = fixture();
    // Block 2 clears a; block 1 can be reached with or without that clear.
    // The physical block scan used by the old return summary saw the clear.
    func.blocks = vec![
        Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(6)],
            terminator: Terminator::Branch {
                cond: ValueId(6),
                then_target: hir::BlockId(2),
                then_args: Vec::new(),
                else_target: hir::BlockId(1),
                else_args: vec![ValueId(0)],
            },
        },
        Block {
            params: vec![ValueId(5)],
            ops: vec![ValueId(5)],
            terminator: Terminator::Return(Some(ValueId(5))),
        },
        Block {
            params: Vec::new(),
            ops: vec![ValueId(3)],
            terminator: Terminator::Jump {
                target: hir::BlockId(1),
                args: vec![ValueId(0)],
            },
        },
    ];
    let analysis = freshness(
        &func,
        &[],
        &FxHashSet::default(),
        &FxHashSet::default(),
        &Returned::default(),
    );
    assert!(!analysis.entering[1].known_zero(ValueId(5), Slot::Field(0)));
    // One difference: both paths run the clear before joining.
    if let Terminator::Branch {
        else_target,
        else_args,
        ..
    } = &mut func.blocks[0].terminator
    {
        *else_target = hir::BlockId(2);
        else_args.clear();
    }
    let analysis = freshness(
        &func,
        &[],
        &FxHashSet::default(),
        &FxHashSet::default(),
        &Returned::default(),
    );
    assert!(analysis.entering[1].known_zero(ValueId(5), Slot::Field(0)));
}
