#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::{self, Block, Func, HirType, Op, OpKind, Param, Program, Terminator, ValueId};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::Origin;

pub(crate) const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};
pub(crate) const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
pub(crate) const F64: HirType = HirType::Float { bits: 64 };

pub(crate) fn origin() -> Origin {
    Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    })
}

pub(crate) fn function(name: &str, params: &[HirType], result: HirType) -> Func {
    Func {
        name: name.to_owned(),
        params: params
            .iter()
            .enumerate()
            .map(|(at, ty)| Param {
                name: format!("p{at}"),
                ty: ty.clone(),
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
                written: None,
            })
            .collect(),
        return_type: result,
        written_return: None,
        written_return_elements: Vec::new(),
        values: Vec::new(),
        blocks: Vec::new(),
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
    }
}

pub(crate) fn value(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap());
    func.values.push(Op {
        kind,
        ty,
        origin: origin(),
    });
    id
}

pub(crate) fn block(params: &[ValueId], ops: &[ValueId], terminator: Terminator) -> Block {
    Block {
        params: params.to_vec(),
        ops: ops.to_vec(),
        terminator,
    }
}

pub(crate) fn program(funcs: Vec<Func>) -> Program {
    Program {
        provider: nts_core::hir::Provider::HostGc,
        public_api: funcs
            .iter()
            .map(|f| (f.name.clone(), f.name.clone()))
            .collect(),
        funcs,
        ..Program::default()
    }
}
