//! Execute cyclic phi copies and the full irreducible generator-resume graph.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::{I32, U32, block, function, origin, program, value};
use nts_core::hir::{BinOp, BlockId, Global, HirType, OpKind, Terminator, UnOp};

fn binary(
    func: &mut nts_core::hir::Func,
    op: BinOp,
    lhs: nts_core::hir::ValueId,
    rhs: nts_core::hir::ValueId,
    ty: HirType,
) -> nts_core::hir::ValueId {
    value(func, OpKind::Binary { op, lhs, rhs }, ty)
}

fn phi_swap() -> nts_core::hir::Func {
    let mut f = function("phiSwap", &[I32], I32);
    let n = value(&mut f, OpKind::Param(0), I32);
    let seven = value(&mut f, OpKind::ConstInt(7), I32);
    let eleven = value(&mut f, OpKind::ConstInt(11), I32);
    let zero = value(&mut f, OpKind::ConstInt(0), I32);
    let one = value(&mut f, OpKind::ConstInt(1), I32);
    let x = value(&mut f, OpKind::BlockParam(0), I32);
    let y = value(&mut f, OpKind::BlockParam(1), I32);
    let at = value(&mut f, OpKind::BlockParam(2), I32);
    let cond = binary(&mut f, BinOp::Lt, at, n, HirType::Bool);
    let next = binary(&mut f, BinOp::Add, at, one, I32);
    let hundred = value(&mut f, OpKind::ConstInt(100), I32);
    let product = binary(&mut f, BinOp::Mul, x, hundred, I32);
    let result = binary(&mut f, BinOp::Add, product, y, I32);
    f.blocks = vec![
        block(
            &[],
            &[n, seven, eleven, zero, one],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![seven, eleven, zero],
            },
        ),
        block(
            &[x, y, at],
            &[cond],
            Terminator::Branch {
                cond,
                then_target: BlockId(2),
                then_args: vec![],
                else_target: BlockId(3),
                else_args: vec![],
            },
        ),
        block(
            &[],
            &[next],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![y, x, next],
            },
        ),
        block(
            &[],
            &[hundred, product, result],
            Terminator::Return(Some(result)),
        ),
    ];
    f
}

fn triangle_graph() -> nts_core::hir::Func {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tooling/wasm/fixtures/triangle-resume-cfg.json"
    ))
    .unwrap();
    let graph: Vec<Vec<u32>> = serde_json::from_value(fixture["successors"].clone()).unwrap();
    let mut f = function("triangleGraph", &[U32], I32);
    let seed = value(&mut f, OpKind::Param(0), U32);
    let zero = value(&mut f, OpKind::ConstInt(0), I32);
    let reset = value(
        &mut f,
        OpKind::GlobalSet {
            global: 0,
            value: zero,
        },
        HirType::Void,
    );
    for (at, successors) in graph.iter().enumerate() {
        let at = u32::try_from(at).unwrap();
        let mut ops = if at == 0 {
            vec![seed, zero, reset]
        } else {
            Vec::new()
        };
        let old = value(&mut f, OpKind::GlobalGet(0), I32);
        let one = value(&mut f, OpKind::ConstInt(1), I32);
        let count = binary(&mut f, BinOp::Add, old, one, I32);
        let store = value(
            &mut f,
            OpKind::GlobalSet {
                global: 0,
                value: count,
            },
            HirType::Void,
        );
        let index = value(&mut f, OpKind::ConstInt(i128::from(at)), I32);
        ops.extend([old, one, count, store, index]);
        let terminator = match successors.as_slice() {
            [] => {
                let hundred = value(&mut f, OpKind::ConstInt(100), I32);
                let scaled = binary(&mut f, BinOp::Mul, count, hundred, I32);
                let result = binary(&mut f, BinOp::Add, scaled, index, I32);
                ops.extend([hundred, scaled, result]);
                Terminator::Return(Some(result))
            }
            [target] => Terminator::Jump {
                target: BlockId(*target),
                args: vec![],
            },
            [then_target, else_target] => {
                let shift = binary(&mut f, BinOp::Add, index, count, I32);
                let shift_bits = value(&mut f, OpKind::Convert(shift), U32);
                let bits = binary(&mut f, BinOp::UShr, seed, shift_bits, U32);
                let mask = value(&mut f, OpKind::ConstInt(1), U32);
                let bit = binary(&mut f, BinOp::BitAnd, bits, mask, U32);
                let cond = value(
                    &mut f,
                    OpKind::Unary {
                        op: UnOp::Truthy,
                        operand: bit,
                    },
                    HirType::Bool,
                );
                ops.extend([shift, shift_bits, bits, mask, bit, cond]);
                Terminator::Branch {
                    cond,
                    then_target: BlockId(*then_target),
                    then_args: vec![],
                    else_target: BlockId(*else_target),
                    else_args: vec![],
                }
            }
            _ => panic!("original HIR has only binary branches"),
        };
        f.blocks.push(block(&[], &ops, terminator));
    }
    f
}

#[test]
fn structured_phi_copies_and_irreducible_dispatch_execute_exactly() {
    let mut p = program(vec![phi_swap(), triangle_graph()]);
    p.globals.push(Global {
        name: "visits".to_owned(),
        ty: I32,
        written: None,
        constant: false,
        initial: 0.0,
        exported: false,
        deferred: false,
        origin: origin(),
    });
    let emitted = nts_codegen_wasm::emit(&p).expect("valid scalar control fixture");
    let fixture = common::repository().join("tooling/wasm/fixtures/triangle-resume-cfg.json");
    let result = common::run(
        "control",
        &emitted,
        "tooling/wasm/check-control.mjs",
        &[&fixture],
    );
    assert_eq!(result["visitedBlocks"], 16);
    assert!(result["cyclicPaths"].as_u64().unwrap() > 0);
    println!("{result}");
}
