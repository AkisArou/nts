//! Logical signedness must survive wasm's shared physical integer slots.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::{F64, I32, U32, block, function, program, value};
use nts_core::hir::{BinOp, HirType, OpKind, Terminator, UnOp};

fn conversion(name: &str, from: &HirType, to: &HirType) -> nts_core::hir::Func {
    let mut f = function(name, std::slice::from_ref(from), to.clone());
    let arg = value(&mut f, OpKind::Param(0), from.clone());
    let result = value(&mut f, OpKind::Convert(arg), to.clone());
    f.blocks
        .push(block(&[], &[arg, result], Terminator::Return(Some(result))));
    f
}

fn unary(name: &str, from: &HirType, to: &HirType, op: UnOp) -> nts_core::hir::Func {
    let mut f = function(name, std::slice::from_ref(from), to.clone());
    let arg = value(&mut f, OpKind::Param(0), from.clone());
    let result = value(&mut f, OpKind::Unary { op, operand: arg }, to.clone());
    f.blocks
        .push(block(&[], &[arg, result], Terminator::Return(Some(result))));
    f
}

fn binary(name: &str, ty: &HirType, op: BinOp, result: HirType) -> nts_core::hir::Func {
    let mut f = function(name, &[ty.clone(), ty.clone()], result.clone());
    let lhs = value(&mut f, OpKind::Param(0), ty.clone());
    let rhs = value(&mut f, OpKind::Param(1), ty.clone());
    let out = value(&mut f, OpKind::Binary { op, lhs, rhs }, result);
    f.blocks
        .push(block(&[], &[lhs, rhs, out], Terminator::Return(Some(out))));
    f
}

#[test]
fn unsigned_widening_min_max_abs_and_proven_float_storage_execute_exactly() {
    let i64 = HirType::Int {
        bits: 64,
        signed: true,
    };
    let u64 = HirType::Int {
        bits: 64,
        signed: false,
    };
    let mut funcs = vec![
        conversion("u32Float", &U32, &F64),
        conversion("u32Wide", &U32, &i64),
        conversion("i32Float", &I32, &F64),
        conversion("i64Float", &i64, &F64),
        unary("absI32", &I32, &U32, UnOp::Abs),
        unary("negI32", &I32, &F64, UnOp::Neg),
        binary("minU32", &U32, BinOp::Min, U32),
        binary("maxU32", &U32, BinOp::Max, U32),
        binary("ltU32", &U32, BinOp::Lt, HirType::Bool),
        binary("gtU32", &U32, BinOp::Gt, HirType::Bool),
        binary("minU64", &u64, BinOp::Min, u64.clone()),
        binary("maxI64", &i64, BinOp::Max, i64.clone()),
    ];
    // These raw HIR cases state the same proofs prepared integral operations
    // consume. Signed division is exact (divisor -1, positive dividend);
    // signed remainder is nonzero (-5 or -4, divisor 3), so no -0 is lost.
    for (name, ty, maximum) in [
        ("I32", I32, 2_147_483_647.0),
        ("U32", U32, 4_294_967_295.0),
        ("I64", i64.clone(), 9_007_199_254_740_991.0),
        ("U64", u64.clone(), 9_007_199_254_740_991.0),
    ] {
        let signed = matches!(ty, HirType::Int { signed: true, .. });
        let mut div = binary(&format!("div{name}"), &ty, BinOp::Div, ty.clone());
        div.params[0].known = nts_core::hir::facts::Facts::new(1.0, maximum, true, false, false);
        let divisor = if signed { -1.0 } else { 1.0 };
        div.params[1].known = nts_core::hir::facts::Facts::constant(divisor);
        funcs.push(div);
        let mut rem = binary(&format!("rem{name}"), &ty, BinOp::Rem, ty.clone());
        rem.params[0].known = nts_core::hir::facts::Facts::new(
            if signed { -5.0 } else { 0.0 },
            if signed { -4.0 } else { maximum },
            true,
            false,
            false,
        );
        rem.params[1].known = nts_core::hir::facts::Facts::constant(3.0);
        funcs.push(rem);
    }
    for bits in [8, 16, 32] {
        for signed in [true, false] {
            let ty = HirType::Int { bits, signed };
            let mut f = conversion(
                &format!("floatTo{}{}", if signed { "i" } else { "u" }, bits),
                &F64,
                &ty,
            );
            let limit = 2_f64.powi(i32::from(bits) - i32::from(signed));
            f.params[0].known = nts_core::hir::facts::Facts::new(
                if signed { -limit } else { 0.0 },
                limit - 1.0,
                true,
                false,
                false,
            );
            funcs.push(f);
        }
    }
    let mut floor = unary("floorInt", &F64, &I32, UnOp::Floor);
    floor.params[0].known = nts_core::hir::facts::Facts::new(0.0, 100.0, false, false, false);
    funcs.push(floor);
    let emitted = nts_codegen_wasm::emit(&program(funcs)).expect("proven scalar fixture");
    println!(
        "{}",
        common::run("numeric", &emitted, "tooling/wasm/check-numeric.mjs", &[])
    );
}
