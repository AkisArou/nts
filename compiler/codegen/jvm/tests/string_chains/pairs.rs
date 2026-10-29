//! Typed split-optionals, independent of the source producer's erased union.
use nts_core::hir::{
    self, Block, BlockId, Callee, Func, HirType, ManagedType, Op, OpKind, Param, Program,
    Terminator, ValueId,
};
use nts_semantic_schema::Origin;

fn origin() -> Origin {
    Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}
fn op(kind: OpKind, ty: HirType) -> Op {
    Op {
        kind,
        ty,
        origin: origin(),
    }
}
fn block(ops: &[u32], terminator: Terminator) -> Block {
    Block {
        params: vec![],
        ops: ops.iter().map(|&v| ValueId(v)).collect(),
        terminator,
    }
}
fn function(
    name: &str,
    types: Vec<HirType>,
    values: Vec<Op>,
    blocks: Vec<Block>,
    exported: bool,
) -> Func {
    Func {
        name: name.into(),
        params: types
            .into_iter()
            .enumerate()
            .map(|(index, ty)| Param {
                name: format!("p{index}"),
                ty,
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
                written: None,
            })
            .collect(),
        return_type: HirType::Managed(ManagedType::String),
        values,
        blocks,
        origin: origin(),
        exported,
        written_return: None,
        validation: None,
        written_return_elements: vec![],
        result_absent: hir::Absent::Impossible,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: vec![],
        exact: hir::ExactArithmetic::default(),
    }
}

pub(super) fn program() -> Program {
    let string = HirType::Managed(ManagedType::String);
    let pair = HirType::PossiblyUndefined(Box::new(HirType::NUMBER));
    let writer = function(
        "pairWriter",
        vec![string.clone(), pair.clone()],
        vec![
            op(OpKind::Param(0), string.clone()),
            op(OpKind::Param(1), pair.clone()),
            op(OpKind::OptionalDefined(ValueId(1)), HirType::Bool),
            op(OpKind::OptionalPayload(ValueId(1)), HirType::NUMBER),
            op(
                OpKind::Call {
                    callee: Callee::External("nts_number_to_string".into()),
                    args: vec![ValueId(3)],
                    frame: None,
                },
                string.clone(),
            ),
            op(
                OpKind::Binary {
                    op: hir::BinOp::Concat,
                    lhs: ValueId(0),
                    rhs: ValueId(4),
                },
                string.clone(),
            ),
            op(OpKind::ConstString("no".into()), string.clone()),
            op(
                OpKind::Binary {
                    op: hir::BinOp::Concat,
                    lhs: ValueId(0),
                    rhs: ValueId(6),
                },
                string.clone(),
            ),
        ],
        vec![
            block(
                &[0, 1, 2],
                Terminator::Branch {
                    cond: ValueId(2),
                    then_target: BlockId(1),
                    then_args: vec![],
                    else_target: BlockId(2),
                    else_args: vec![],
                },
            ),
            block(&[3, 4, 5], Terminator::Return(Some(ValueId(5)))),
            block(&[6, 7], Terminator::Return(Some(ValueId(7)))),
        ],
        false,
    );
    let caller = function(
        "optionalPair",
        vec![HirType::NUMBER, HirType::Bool],
        vec![
            op(OpKind::Param(0), HirType::NUMBER),
            op(OpKind::Param(1), HirType::Bool),
            op(OpKind::ConstString("prefix:".into()), string.clone()),
            op(
                OpKind::Optional {
                    defined: ValueId(1),
                    payload: ValueId(0),
                },
                pair,
            ),
            op(
                OpKind::Call {
                    callee: Callee::Direct("pairWriter".into()),
                    args: vec![ValueId(2), ValueId(3)],
                    frame: None,
                },
                string,
            ),
        ],
        vec![block(
            &[0, 1, 2, 3, 4],
            Terminator::Return(Some(ValueId(4))),
        )],
        true,
    );
    Program {
        funcs: vec![writer, caller],
        ..Program::default()
    }
}

/// A declined full-width optional return also needs its caller scratch array.
pub(super) fn scratch_return() -> Func {
    let pair = HirType::PossiblyUndefined(Box::new(HirType::NUMBER));
    let mut func = function(
        "optionalReturn",
        vec![pair.clone()],
        vec![
            op(OpKind::Param(0), pair.clone()),
            op(
                OpKind::NativeSizeOf(hir::native::Pointee::Scalar(hir::native::Scalar::Int)),
                HirType::NUMBER,
            ),
        ],
        vec![block(&[0, 1], Terminator::Return(Some(ValueId(0))))],
        true,
    );
    func.return_type = pair;
    func
}
