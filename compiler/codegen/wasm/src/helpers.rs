//! Exact scalar algorithms absent from wasm's numeric instruction set.

use crate::{
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey},
    types::{Physical, Slot},
};
use wasm_encoder::{BlockType, Instruction as I, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Helper {
    ToInt32,
    Round,
    Remainder,
}

impl Helper {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::ToInt32 => "toInt32",
            Self::Round => "round",
            Self::Remainder => "remainder",
        }
    }
    pub(crate) fn signature(self) -> (Vec<Slot>, Slot) {
        match self {
            Self::ToInt32 => (vec![Slot::F64], Slot::I32),
            Self::Round => (vec![Slot::F64], Slot::F64),
            Self::Remainder => (vec![Slot::F64, Slot::F64], Slot::F64),
        }
    }
    pub(crate) const fn imported(self) -> bool {
        matches!(self, Self::Remainder)
    }
}

/// The function implementing `helper`: Node's exact `%` for a floating
/// remainder, a module-local body otherwise.
pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let (params, result) = helper.signature();
    let params = params.into_iter().map(Physical::Scalar).collect();
    let result = Some(Physical::Scalar(result));
    let key = FuncKey::Numeric(helper);
    if helper.imported() {
        return Ok(m.import(key, "nts:host/v1", helper.name(), params, result, false));
    }
    m.helper(
        key,
        format!("nts.{}", helper.name()),
        params,
        result,
        |_| {
            Ok(match helper {
                Helper::ToInt32 => to_int32(),
                Helper::Round => round(),
                Helper::Remainder => {
                    return Err(Failure::Invariant("remainder is a host import".into()));
                }
            })
        },
    )
}

/// Truncate the significand, reduce modulo 2^32 and apply the sign. Exponents
/// at least 84 have no low 32 integer bits; nonfinite numbers and fractions below one
/// yield zero. No out-of-range float-to-int trap or saturation is involved.
fn to_int32() -> Function {
    let mut f = Function::with_groups([(1, ValType::I32), (2, ValType::I64)]);
    let instructions = [
        I::LocalGet(0),
        I::I64ReinterpretF64,
        I::LocalTee(3),
        I::I64Const(52),
        I::I64ShrU,
        I::I32WrapI64,
        I::I32Const(2047),
        I::I32And,
        I::I32Const(1023),
        I::I32Sub,
        I::LocalSet(1),
        I::LocalGet(1),
        I::I32Const(0),
        I::I32LtS,
        I::LocalGet(1),
        I::I32Const(84),
        I::I32GeS,
        I::I32Or,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
        I::LocalGet(3),
        I::I64Const((1_i64 << 52) - 1),
        I::I64And,
        I::I64Const(1_i64 << 52),
        I::I64Or,
        I::LocalSet(2),
        I::LocalGet(1),
        I::I32Const(52),
        I::I32LeS,
        I::If(BlockType::Result(ValType::I64)),
        I::LocalGet(2),
        I::I32Const(52),
        I::LocalGet(1),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64ShrU,
        I::Else,
        I::LocalGet(2),
        I::LocalGet(1),
        I::I32Const(52),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64Shl,
        I::End,
        I::LocalSet(2),
        I::LocalGet(3),
        I::I64Const(0),
        I::I64LtS,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(0),
        I::LocalGet(2),
        I::I32WrapI64,
        I::I32Sub,
        I::Else,
        I::LocalGet(2),
        I::I32WrapI64,
        I::End,
        I::End,
    ];
    for i in instructions {
        f.instruction(&i);
    }
    f
}

/// Floor plus a fractional comparison avoids x+0.5 rounding across a boundary.
/// Large integral/nonfinite values are identities. Zero keeps the input sign.
fn round() -> Function {
    let mut f = Function::with_groups([(1, ValType::F64)]);
    let instructions = [
        I::LocalGet(0),
        I::F64Abs,
        I::F64Const(4_503_599_627_370_496.0.into()),
        I::F64Ge,
        I::LocalGet(0),
        I::LocalGet(0),
        I::F64Ne,
        I::I32Or,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::Return,
        I::End,
        I::LocalGet(0),
        I::F64Floor,
        I::LocalSet(1),
        I::LocalGet(0),
        I::LocalGet(1),
        I::F64Sub,
        I::F64Const(0.5.into()),
        I::F64Ge,
        I::If(BlockType::Empty),
        I::LocalGet(1),
        I::F64Const(1.0.into()),
        I::F64Add,
        I::LocalSet(1),
        I::End,
        I::LocalGet(1),
        I::F64Const(0.0.into()),
        I::F64Eq,
        I::If(BlockType::Result(ValType::F64)),
        I::F64Const(0.0.into()),
        I::LocalGet(0),
        I::F64Copysign,
        I::Else,
        I::LocalGet(1),
        I::End,
        I::End,
    ];
    for i in instructions {
        f.instruction(&i);
    }
    f
}
