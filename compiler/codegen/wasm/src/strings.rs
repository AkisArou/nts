//! JS strings stay extern references. Range adapters use Wasm instructions.

use crate::{
    body::Body,
    error::Failure,
    helpers::Helper as ScalarHelper,
    module::Symbols,
    numeric,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{BlockType, Function, Instruction as I, RefType, ValType};

pub(crate) const STRING: Physical = Physical::Reference(RefType::EXTERNREF);
const NONNULL_STRING: Physical = Physical::Reference(RefType {
    nullable: false,
    ..RefType::EXTERNREF
});
const I32: Physical = Physical::Scalar(Slot::I32);
const F64: Physical = Physical::Scalar(Slot::F64);
const UINT: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

pub(crate) fn is_string(ty: &HirType) -> bool {
    *ty == HirType::Managed(ManagedType::String)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    Length,
    Unit,
    Equal,
    Compare,
    Concat,
    SubstringBuiltin,
    FromCharCodeBuiltin,
    CharCodeAt,
    CharAt,
    Substring,
    Slice,
    FromCharCode,
}

impl Helper {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Length => "length",
            Self::Unit => "charCodeAt",
            Self::Equal => "equals",
            Self::Compare => "compare",
            Self::Concat => "concat",
            Self::SubstringBuiltin => "substring",
            Self::FromCharCodeBuiltin => "fromCharCode",
            Self::CharCodeAt => "string.charCodeAt",
            Self::CharAt => "string.charAt",
            Self::Substring => "string.substring",
            Self::Slice => "string.slice",
            Self::FromCharCode => "string.fromCharCode",
        }
    }
    pub(crate) const fn builtin(self) -> bool {
        match self {
            Self::Length
            | Self::Unit
            | Self::Equal
            | Self::Compare
            | Self::Concat
            | Self::SubstringBuiltin
            | Self::FromCharCodeBuiltin => true,
            Self::CharCodeAt
            | Self::CharAt
            | Self::Substring
            | Self::Slice
            | Self::FromCharCode => false,
        }
    }
    pub(crate) fn signature(self) -> (Vec<Physical>, Physical) {
        match self {
            Self::Length => (vec![STRING], I32),
            Self::Unit => (vec![STRING, I32], I32),
            Self::Equal | Self::Compare => (vec![STRING, STRING], I32),
            Self::Concat => (vec![STRING, STRING], NONNULL_STRING),
            Self::SubstringBuiltin => (vec![STRING, I32, I32], NONNULL_STRING),
            Self::FromCharCodeBuiltin => (vec![I32], NONNULL_STRING),
            Self::CharCodeAt => (vec![STRING, F64], F64),
            Self::CharAt => (vec![STRING, F64], STRING),
            Self::Substring | Self::Slice => (vec![STRING, F64, F64], STRING),
            Self::FromCharCode => (vec![F64], STRING),
        }
    }
    pub(crate) const fn dependencies(self) -> &'static [Self] {
        match self {
            Self::CharCodeAt => &[Self::Length, Self::Unit],
            Self::CharAt | Self::Substring | Self::Slice => &[Self::Length, Self::SubstringBuiltin],
            Self::FromCharCode => &[Self::FromCharCodeBuiltin],
            Self::Length
            | Self::Unit
            | Self::Equal
            | Self::Compare
            | Self::Concat
            | Self::SubstringBuiltin
            | Self::FromCharCodeBuiltin => &[],
        }
    }
    pub(crate) fn body(self, symbols: &Symbols<'_>) -> Result<Option<Function>, Failure> {
        match self {
            Self::Length
            | Self::Unit
            | Self::Equal
            | Self::Compare
            | Self::Concat
            | Self::SubstringBuiltin
            | Self::FromCharCodeBuiltin => Ok(None),
            Self::CharCodeAt | Self::CharAt => indexed(self, symbols).map(Some),
            Self::Substring | Self::Slice => substring(self, symbols).map(Some),
            Self::FromCharCode => {
                let to_int = symbols.helpers.get(&ScalarHelper::ToInt32).ok_or_else(|| {
                    Failure::Invariant("unplanned fromCharCode numeric dependency".into())
                })?;
                let mut f = Function::new([]);
                instructions(
                    &mut f,
                    &[
                        I::LocalGet(0),
                        I::Call(*to_int),
                        I::Call(callee(symbols, Self::FromCharCodeBuiltin)?),
                        I::End,
                    ],
                );
                Ok(Some(f))
            }
        }
    }
}

/// Only explicitly mapped names become string helpers; all others reach the
/// external-call named decline in Body. Native `_into` storage is not a string.
pub(crate) fn external(name: &str) -> Option<Helper> {
    match name {
        "nts_concat" | "nts_concat_fn" | "nts_str_append" => Some(Helper::Concat),
        "nts_string_eq" => Some(Helper::Equal),
        "nts_str_char_code_at"
        | "nts_str_char_code_at_fn"
        | "nts_str_char_code_at_int"
        | "nts_str_char_code_at_int_fn" => Some(Helper::CharCodeAt),
        "nts_str_char_at" => Some(Helper::CharAt),
        "nts_str_substring" => Some(Helper::Substring),
        "nts_str_slice" => Some(Helper::Slice),
        "nts_string_from_char_code" => Some(Helper::FromCharCode),
        _ => None,
    }
}

pub(crate) fn binary_helper(op: BinOp) -> Result<Helper, Failure> {
    match op {
        BinOp::Eq | BinOp::Ne => Ok(Helper::Equal),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Ok(Helper::Compare),
        BinOp::Concat => Ok(Helper::Concat),
        BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::BitAnd
        | BinOp::BitOr
        | BinOp::BitXor
        | BinOp::Shl
        | BinOp::Shr
        | BinOp::UShr
        | BinOp::Min
        | BinOp::Max => Err(format!("string binary {op:?}").into()),
    }
}

pub(crate) fn call(b: &mut Body<'_>, helper: Helper) -> Result<(), Failure> {
    b.ins(&I::Call(callee(b.symbols, helper)?));
    Ok(())
}

pub(crate) fn constant(b: &mut Body<'_>, text: &str) -> Result<(), Failure> {
    let global = b
        .symbols
        .literals
        .get(text)
        .copied()
        .ok_or_else(|| Failure::Invariant("unplanned string literal".into()))?;
    b.ins(&I::GlobalGet(global));
    Ok(())
}

pub(crate) fn truthy(b: &mut Body<'_>, op: UnOp, value: ValueId) -> Result<(), Failure> {
    if !matches!(op, UnOp::Truthy | UnOp::Not) {
        return Err(format!("string unary {op:?}").into());
    }
    b.load(value)?;
    b.ins(&I::RefIsNull);
    b.ins(&I::If(BlockType::Result(ValType::I32)));
    b.ins(&I::I32Const(0));
    b.ins(&I::Else);
    b.load(value)?;
    call(b, Helper::Length)?;
    b.ins(&I::I32Eqz);
    b.ins(&I::I32Eqz);
    b.ins(&I::End);
    if op == UnOp::Not {
        b.ins(&I::I32Eqz);
    }
    Ok(())
}
pub(crate) fn callee(symbols: &Symbols<'_>, helper: Helper) -> Result<u32, Failure> {
    symbols
        .strings
        .get(&helper)
        .copied()
        .ok_or_else(|| Failure::Invariant(format!("unplanned string helper {helper:?}")))
}

pub(crate) fn length(b: &mut Body<'_>, result: ValueId, value: ValueId) -> Result<(), Failure> {
    crate::contract::nonnull(b, value)?;
    b.load(value)?;
    call(b, Helper::Length)?;
    numeric::convert(b, &UINT, &b.ty(result).clone())
}

pub(crate) fn unit(
    b: &mut Body<'_>,
    result: ValueId,
    string: ValueId,
    index: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    let helper = if checked {
        // Range checks happen in the adapter, after the receiver contract.
        Helper::CharCodeAt
    } else {
        Helper::Unit
    };
    crate::contract::nonnull(b, string)?;
    if !checked {
        unit_index_contract(b, string, index)?;
    }
    let index_type = if checked { HirType::NUMBER } else { UINT };
    b.load(string)?;
    b.load(index)?;
    numeric::convert(b, &b.ty(index).clone(), &index_type)?;
    call(b, helper)?;
    numeric::convert(b, &index_type, &b.ty(result).clone())
}

fn unit_index_contract(b: &mut Body<'_>, string: ValueId, index: ValueId) -> Result<(), Failure> {
    let ty = b.ty(index).clone();
    b.load(index)?;
    numeric::convert(b, &ty, &HirType::NUMBER)?;
    b.load(index)?;
    numeric::convert(b, &ty, &HirType::NUMBER)?;
    b.ins(&I::F64Trunc);
    b.ins(&I::F64Eq);
    b.load(index)?;
    numeric::convert(b, &ty, &HirType::NUMBER)?;
    b.ins(&I::F64Const(0.0.into()));
    b.ins(&I::F64Ge);
    b.ins(&I::I32And);
    b.load(index)?;
    numeric::convert(b, &ty, &HirType::NUMBER)?;
    b.load(string)?;
    call(b, Helper::Length)?;
    b.ins(&I::F64ConvertI32U);
    b.ins(&I::F64Lt);
    b.ins(&I::I32And);
    crate::contract::require(b)
}

pub(crate) fn binary(
    b: &mut Body<'_>,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if !is_string(b.ty(lhs)) || !is_string(b.ty(rhs)) {
        return Err("string binary operands have differing logical types".into());
    }
    let helper = binary_helper(op)?;
    if !matches!(op, BinOp::Eq | BinOp::Ne) {
        crate::contract::nonnull(b, lhs)?;
        crate::contract::nonnull(b, rhs)?;
    }
    b.load(lhs)?;
    b.load(rhs)?;
    call(b, helper)?;
    match op {
        BinOp::Eq | BinOp::Concat => {}
        BinOp::Ne => b.ins(&I::I32Eqz),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            b.ins(&I::I32Const(0));
            b.ins(&match op {
                BinOp::Lt => I::I32LtS,
                BinOp::Le => I::I32LeS,
                BinOp::Gt => I::I32GtS,
                BinOp::Ge => I::I32GeS,
                _ => return Err(Failure::Invariant("unplanned string comparison".into())),
            });
        }
        BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::BitAnd
        | BinOp::BitOr
        | BinOp::BitXor
        | BinOp::Shl
        | BinOp::Shr
        | BinOp::UShr
        | BinOp::Min
        | BinOp::Max => return Err(format!("string binary {op:?}").into()),
    }
    Ok(())
}

pub(crate) fn runtime(
    b: &mut Body<'_>,
    result: ValueId,
    helper: Helper,
    args: &[ValueId],
) -> Result<(), Failure> {
    let (params, output) = helper.signature();
    if args.len() != params.len() {
        return Err(format!("string helper {helper:?} arity mismatch").into());
    }
    for (&arg, expected) in args.iter().zip(params) {
        if expected == STRING && helper != Helper::Equal {
            crate::contract::nonnull(b, arg)?;
        }
        b.load(arg)?;
        match expected {
            STRING => {
                if !is_string(b.ty(arg)) {
                    return Err(format!("string helper {helper:?} expects a string").into());
                }
            }
            F64 => numeric::convert(b, &b.ty(arg).clone(), &HirType::NUMBER)?,
            _ => {
                return Err(Failure::Invariant(format!(
                    "unplanned runtime string parameter {expected:?}"
                )));
            }
        }
    }
    call(b, helper)?;
    match output {
        F64 => numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())?,
        I32 if helper == Helper::Equal && b.ty(result) == &HirType::Bool => {}
        Physical::Reference(_) if is_string(b.ty(result)) => {}
        _ => {
            return Err(format!("string helper {helper:?} result {:?}", b.ty(result)).into());
        }
    }
    Ok(())
}

fn instructions(f: &mut Function, code: &[I<'_>]) {
    for i in code {
        f.instruction(i);
    }
}

/// `ToIntegerOrInfinity` before testing bounds. NaN becomes zero, fractions
/// truncate, and infinities/huge indices stay outside the range until checked.
fn indexed(helper: Helper, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let char_at = helper == Helper::CharAt;
    let mut f = Function::new_with_locals_types([ValType::F64]);
    instructions(
        &mut f,
        &[
            I::LocalGet(1),
            I::LocalGet(1),
            I::F64Eq,
            I::If(BlockType::Result(ValType::F64)),
            I::LocalGet(1),
            I::F64Trunc,
            I::Else,
            I::F64Const(0.0.into()),
            I::End,
            I::LocalSet(2),
            I::LocalGet(2),
            I::F64Const(0.0.into()),
            I::F64Ge,
            I::LocalGet(2),
            I::LocalGet(0),
            I::Call(callee(symbols, Helper::Length)?),
            I::F64ConvertI32U,
            I::F64Lt,
            I::I32And,
            I::If(BlockType::Result(if char_at {
                ValType::EXTERNREF
            } else {
                ValType::F64
            })),
            I::LocalGet(0),
            I::LocalGet(2),
            I::I32TruncSatF64U,
        ],
    );
    if char_at {
        instructions(
            &mut f,
            &[
                I::LocalGet(2),
                I::I32TruncSatF64U,
                I::I32Const(1),
                I::I32Add,
                I::Call(callee(symbols, Helper::SubstringBuiltin)?),
                I::Else,
                I::GlobalGet(
                    *symbols.literals.get("").ok_or_else(|| {
                        Failure::Invariant("unplanned charAt empty string".into())
                    })?,
                ),
            ],
        );
    } else {
        instructions(
            &mut f,
            &[
                I::Call(callee(symbols, Helper::Unit)?),
                I::F64ConvertI32U,
                I::Else,
                I::F64Const(f64::NAN.into()),
            ],
        );
    }
    instructions(&mut f, &[I::End, I::End]);
    Ok(f)
}

fn substring(helper: Helper, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let slice = helper == Helper::Slice;
    let mut f =
        Function::new_with_locals_types([ValType::I32, ValType::I32, ValType::I32, ValType::F64]);
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::Call(callee(symbols, Helper::Length)?),
            I::LocalSet(3),
        ],
    );
    for (param, local) in [(1, 4), (2, 5)] {
        crate::indexing::clamp(&mut f, param, local, slice, 3, 6);
    }
    if !slice {
        instructions(
            &mut f,
            &[
                I::LocalGet(4),
                I::LocalGet(5),
                I::I32GtU,
                I::If(BlockType::Empty),
                I::LocalGet(4),
                I::LocalGet(5),
                I::LocalSet(4),
                I::LocalSet(5),
                I::End,
            ],
        );
    }
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::LocalGet(4),
            I::LocalGet(5),
            I::Call(callee(symbols, Helper::SubstringBuiltin)?),
            I::End,
        ],
    );
    Ok(f)
}
