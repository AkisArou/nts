//! The edge-value contract; executable Invoke ownership is checked separately.

use super::{EdgeKind, OutcomeEdge, OutcomeValue};
use crate::hir::{
    Absent, Block, BlockId, Callee, Func, HirType, ManagedType, Op, OpKind, Terminator, ValueId,
    verify,
};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::Origin;

fn function() -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    });
    let string = HirType::Managed(ManagedType::String);
    let number = HirType::Float { bits: 64 };
    let values = [
        (OpKind::ConstString("live owner".into()), string.clone()),
        (
            OpKind::Call {
                callee: Callee::Direct("cooperating".into()),
                args: vec![ValueId(0)],
                frame: None,
            },
            number.clone(),
        ),
        (OpKind::BlockParam(0), number),
        (OpKind::BlockParam(1), string.clone()),
        (OpKind::BlockParam(0), HirType::Erased),
        (OpKind::BlockParam(1), string.clone()),
        (OpKind::BlockParam(2), string),
    ]
    .into_iter()
    .map(|(kind, ty)| Op {
        kind,
        ty,
        origin: origin.clone(),
    })
    .collect();
    Func {
        name: "edge-value-contract".into(),
        params: Vec::new(),
        return_type: HirType::Void,
        written_return: None,
        written_return_elements: Vec::new(),
        validation: None,
        result_absent: Absent::Impossible,
        values,
        blocks: vec![
            Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1)],
                terminator: Terminator::Unreachable,
            },
            Block {
                params: vec![ValueId(2), ValueId(3)],
                ops: Vec::new(),
                terminator: Terminator::Return(None),
            },
            Block {
                params: vec![ValueId(4), ValueId(5), ValueId(6)],
                ops: Vec::new(),
                terminator: Terminator::Return(None),
            },
        ],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
    }
}

fn normal() -> OutcomeEdge {
    OutcomeEdge {
        target: BlockId(1),
        args: vec![OutcomeValue::Result, OutcomeValue::Existing(ValueId(0))],
    }
}

fn raised() -> OutcomeEdge {
    OutcomeEdge {
        target: BlockId(2),
        args: vec![
            OutcomeValue::Thrown,
            OutcomeValue::Detail,
            OutcomeValue::Existing(ValueId(0)),
        ],
    }
}

fn check(function: &Func, kind: EdgeKind, edge: &OutcomeEdge) -> Vec<verify::Invalid> {
    let mut problems = Vec::new();
    let valid =
        verify::check_outcome_edge(function, BlockId(0), ValueId(1), kind, edge, &mut problems);
    assert_eq!(valid, problems.is_empty());
    problems
}

#[test]
fn outcome_values_arrive_only_on_their_own_edge() {
    let function = function();
    assert_eq!(check(&function, EdgeKind::Normal, &normal()), Vec::new());
    assert_eq!(check(&function, EdgeKind::Raised, &raised()), Vec::new());
}

#[test]
fn a_normal_result_is_not_available_on_a_raise_edge() {
    let mut edge = raised();
    edge.args[0] = OutcomeValue::Result;
    assert!(matches!(
        check(&function(), EdgeKind::Raised, &edge).as_slice(),
        [verify::Invalid::OutcomeValue { at: 0, .. }]
    ));
}

#[test]
fn thrown_and_detail_values_are_not_available_on_the_normal_edge() {
    for value in [OutcomeValue::Thrown, OutcomeValue::Detail] {
        let mut edge = normal();
        edge.args[0] = value;
        assert!(matches!(
            check(&function(), EdgeKind::Normal, &edge).as_slice(),
            [verify::Invalid::OutcomeValue { at: 0, .. }]
        ));
    }
}

#[test]
fn the_invoked_operation_is_not_an_existing_ssa_result() {
    for (kind, mut edge) in [(EdgeKind::Normal, normal()), (EdgeKind::Raised, raised())] {
        edge.args[0] = OutcomeValue::Existing(ValueId(1));
        assert!(matches!(
            check(&function(), kind, &edge).as_slice(),
            [verify::Invalid::OutcomeValue { at: 0, .. }]
        ));
    }
}

#[test]
fn short_and_long_outcome_edges_keep_the_shared_count_diagnostic() {
    let function = function();
    for (count, found) in [(1, 1), (3, 3)] {
        let mut edge = normal();
        edge.args.resize(count, OutcomeValue::Existing(ValueId(0)));
        assert!(matches!(
            check(&function, EdgeKind::Normal, &edge).as_slice(),
            [verify::Invalid::ArgumentCount {
                from: BlockId(0), edge: "normal", target: BlockId(1),
                expected: 2, found: actual, ..
            }] if *actual == found
        ));
    }
}

#[test]
fn outcome_edges_check_actual_argument_and_parameter_ids() {
    let mut edge = normal();
    edge.args[1] = OutcomeValue::Existing(ValueId(99));
    assert!(matches!(
        check(&function(), EdgeKind::Normal, &edge).as_slice(),
        [verify::Invalid::EdgeValue {
            value: ValueId(99),
            which: "argument",
            ..
        }]
    ));
    let mut function = function();
    function.blocks[1].params[0] = ValueId(99);
    assert!(matches!(
        check(&function, EdgeKind::Normal, &normal()).as_slice(),
        [verify::Invalid::EdgeValue {
            value: ValueId(99),
            which: "parameter",
            ..
        }]
    ));
}

#[test]
fn missing_operations_and_targets_are_named_failures() {
    let function = function();
    let mut problems = Vec::new();
    assert!(!verify::check_outcome_edge(
        &function,
        BlockId(0),
        ValueId(99),
        EdgeKind::Normal,
        &normal(),
        &mut problems,
    ));
    assert!(matches!(
        problems.as_slice(),
        [verify::Invalid::ValueDomain {
            value: ValueId(99),
            role: "outcome operation",
            ..
        }]
    ));
    let mut edge = normal();
    edge.target = BlockId(99);
    assert!(matches!(
        check(&function, EdgeKind::Normal, &edge).as_slice(),
        [verify::Invalid::DanglingSuccessor {
            target: BlockId(99),
            ..
        }]
    ));
}

#[test]
fn a_void_or_never_operation_has_no_normal_result() {
    for ty in [HirType::Void, HirType::Never] {
        let mut function = function();
        function.values[1].ty = ty;
        assert!(matches!(
            check(&function, EdgeKind::Normal, &normal()).as_slice(),
            [verify::Invalid::OutcomeValue { at: 0, .. }]
        ));
    }
}

#[test]
fn outcome_token_types_use_the_ordinary_compatibility_authority() {
    for (kind, edge, parameter) in [
        (EdgeKind::Normal, normal(), 2),
        (EdgeKind::Raised, raised(), 4),
        (EdgeKind::Raised, raised(), 5),
    ] {
        let mut function = function();
        function.values[parameter].ty = HirType::Bool;
        assert!(matches!(
            check(&function, kind, &edge).as_slice(),
            [verify::Invalid::EdgeType {
                expected: HirType::Bool,
                ..
            }]
        ));
    }
}
