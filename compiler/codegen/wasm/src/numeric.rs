//! Number semantics over HIR's proven storage kinds.

use crate::{
    body::Body,
    error::Failure,
    helpers::Helper,
    ir,
    types::{self, Slot},
};
use nts_core::hir::{BinOp, HirType, UnOp, ValueId};
use wasm_encoder::Instruction as I;

/// A runtime number conversion or test answered at its call site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Conversion {
    /// `ToInt32`'s bits, then this integer's width: `nts_to_uint8` and its
    /// siblings, which a typed-array store calls. C's are `nts_to_uint32` and
    /// a truncation, and `ToUint32`'s bits are `ToInt32`'s.
    Narrow { bits: u8, signed: bool },
    /// `nts_to_index`: zero for NaN and everything below one, else truncated.
    Index,
    /// `Number.isFinite`: neither NaN nor an infinity.
    IsFinite,
    /// `Number.isInteger`: finite, and its own truncation (-0 included).
    IsInteger,
    /// `Number.isSafeInteger`: an integer whose magnitude is at most 2^53 - 1.
    IsSafeInteger,
}

pub(crate) fn external(name: &str) -> Option<Conversion> {
    let narrow = |bits, signed| Conversion::Narrow { bits, signed };
    Some(match name {
        "nts_to_int8" | "nts_to_int8_fn" => narrow(8, true),
        "nts_to_uint8" | "nts_to_uint8_fn" => narrow(8, false),
        "nts_to_int16" | "nts_to_int16_fn" => narrow(16, true),
        "nts_to_uint16" | "nts_to_uint16_fn" => narrow(16, false),
        "nts_to_int32" | "nts_to_int32_fn" => narrow(32, true),
        "nts_to_uint32" | "nts_to_uint32_fn" => narrow(32, false),
        "nts_to_index" => Conversion::Index,
        "nts_is_finite" => Conversion::IsFinite,
        "nts_is_integer" => Conversion::IsInteger,
        "nts_is_safe_integer" => Conversion::IsSafeInteger,
        _ => return None,
    })
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    conversion: Conversion,
    args: &[ValueId],
) -> Result<(), Failure> {
    let &[value] = args else {
        return Err(format!("{conversion:?} arity mismatch").into());
    };
    let to = b.ty(result).clone();
    match conversion {
        Conversion::Narrow { bits, signed } => {
            let narrow = HirType::Int { bits, signed };
            to_i32(b, exact_integer(b, value))?;
            convert(
                b,
                &HirType::Int {
                    bits: 32,
                    signed: true,
                },
                &narrow,
            )?;
            convert(b, &narrow, &to)
        }
        Conversion::Index => {
            push_as(b, value, &HirType::NUMBER)?;
            b.instructions(&[I::F64Trunc, I::F64Const(0.0.into())]);
            push_as(b, value, &HirType::NUMBER)?;
            b.instructions(&[I::F64Const(1.0.into()), I::F64Ge, I::Select]);
            convert(b, &HirType::NUMBER, &to)
        }
        Conversion::IsFinite | Conversion::IsInteger | Conversion::IsSafeInteger => {
            // `x - x` is 0 for every finite x, and NaN for NaN and both
            // infinities.
            push_as(b, value, &HirType::NUMBER)?;
            push_as(b, value, &HirType::NUMBER)?;
            b.instructions(&[I::F64Sub, I::F64Const(0.0.into()), I::F64Eq]);
            if conversion != Conversion::IsFinite {
                push_as(b, value, &HirType::NUMBER)?;
                b.instruction(&I::F64Trunc);
                push_as(b, value, &HirType::NUMBER)?;
                b.instructions(&[I::F64Eq, I::I32And]);
            }
            if conversion == Conversion::IsSafeInteger {
                push_as(b, value, &HirType::NUMBER)?;
                b.instructions(&[
                    I::F64Abs,
                    I::F64Const(9_007_199_254_740_991.0.into()),
                    I::F64Le,
                    I::I32And,
                ]);
            }
            convert(b, &HirType::Bool, &to)
        }
    }
}

/// The integer a `number` was converted from, when the conversion was exact:
/// `ToInt32` of it is the integer's own low bits, with no float to truncate. A
/// loop counter stored into a typed array arrives this way.
fn exact_integer(b: &Body<'_, '_>, value: ValueId) -> ValueId {
    match b.func.value(value).kind {
        nts_core::hir::OpKind::Convert(from)
            if matches!(
                b.ty(from),
                HirType::Int {
                    bits: 8 | 16 | 32,
                    ..
                }
            ) =>
        {
            from
        }
        _ => value,
    }
}

pub(crate) fn constant_int(b: &mut Body<'_, '_>, value: i128, ty: &HirType) -> Result<(), Failure> {
    // Unsigned slots share wasm's signed bit-pattern encoding. Check the
    // logical range first, then encode the identical low bits.
    let HirType::Int { bits, signed } = ty else {
        return Err(format!("integer literal of type {ty:?}").into());
    };
    let limit = 1_i128 << (u32::from(*bits) - u32::from(*signed));
    let minimum = if *signed { -limit } else { 0 };
    if value < minimum || value >= limit {
        return Err(format!("integer literal {value} outside {ty:?}").into());
    }
    match types::value_slot(ty)? {
        Slot::I32 => {
            let raw =
                u32::try_from(value.rem_euclid(1_i128 << 32)).map_err(|_| "integer encoding")?;
            b.instruction(&I::I32Const(i32::from_ne_bytes(raw.to_ne_bytes())));
        }
        Slot::I64 => {
            let raw =
                u64::try_from(value.rem_euclid(1_i128 << 64)).map_err(|_| "integer encoding")?;
            b.instruction(&I::I64Const(i64::from_ne_bytes(raw.to_ne_bytes())));
        }
        Slot::F32 | Slot::F64 => {
            return Err(format!("integer literal in a noninteger slot {ty:?}").into());
        }
        Slot::V128 => {
            return Err(Failure::Invariant("a bigint routed to number code".into()));
        }
    }
    Ok(())
}

pub(crate) fn constant_float(
    b: &mut Body<'_, '_>,
    value: f64,
    ty: &HirType,
) -> Result<(), Failure> {
    match types::value_slot(ty)? {
        Slot::F64 => b.instruction(&I::F64Const(value.into())),
        Slot::F32 => {
            #[allow(
                clippy::cast_possible_truncation,
                reason = "HIR explicitly selected f32 storage"
            )]
            b.instruction(&I::F32Const((value as f32).into()));
        }
        Slot::I32 | Slot::I64 => {
            return Err(format!("floating literal in an integer slot {ty:?}").into());
        }
        Slot::V128 => {
            return Err(Failure::Invariant("a bigint routed to number code".into()));
        }
    }
    Ok(())
}

fn unsigned(ty: &HirType) -> bool {
    matches!(ty, HirType::Int { signed: false, .. })
}

pub(crate) fn convert(b: &mut Body<'_, '_>, from: &HirType, to: &HirType) -> Result<(), Failure> {
    convert_in(&mut b.code, from, to)
}

/// [`convert`] into any code: a module helper's as well as a body's.
pub(crate) fn convert_in(code: &mut ir::Code, from: &HirType, to: &HirType) -> Result<(), Failure> {
    let source = types::value_slot(from)?;
    let target = types::value_slot(to)?;
    if matches!(to, HirType::Bool) {
        truth_on_stack(code, source);
        return Ok(());
    }
    let op = match (source, target) {
        (Slot::I32, Slot::I32)
        | (Slot::I64, Slot::I64)
        | (Slot::F32, Slot::F32)
        | (Slot::F64, Slot::F64)
        | (Slot::V128, Slot::V128) => None,
        (Slot::V128, _) | (_, Slot::V128) => {
            return Err(Failure::Invariant("a bigint routed to number code".into()));
        }
        (Slot::I32, Slot::I64) => Some(if unsigned(from) {
            I::I64ExtendI32U
        } else {
            I::I64ExtendI32S
        }),
        (Slot::I64, Slot::I32) => Some(I::I32WrapI64),
        (Slot::I32, Slot::F32) => Some(if unsigned(from) {
            I::F32ConvertI32U
        } else {
            I::F32ConvertI32S
        }),
        (Slot::I32, Slot::F64) => Some(if unsigned(from) {
            I::F64ConvertI32U
        } else {
            I::F64ConvertI32S
        }),
        (Slot::I64, Slot::F32) => Some(if unsigned(from) {
            I::F32ConvertI64U
        } else {
            I::F32ConvertI64S
        }),
        (Slot::I64, Slot::F64) => Some(if unsigned(from) {
            I::F64ConvertI64U
        } else {
            I::F64ConvertI64S
        }),
        (Slot::F32, Slot::F64) => Some(I::F64PromoteF32),
        (Slot::F64, Slot::F32) => Some(I::F32DemoteF64),
        (Slot::F32, Slot::I32) => Some(if unsigned(to) {
            I::I32TruncSatF32U
        } else {
            I::I32TruncSatF32S
        }),
        (Slot::F64, Slot::I32) => Some(if unsigned(to) {
            I::I32TruncSatF64U
        } else {
            I::I32TruncSatF64S
        }),
        (Slot::F32, Slot::I64) => Some(if unsigned(to) {
            I::I64TruncSatF32U
        } else {
            I::I64TruncSatF32S
        }),
        (Slot::F64, Slot::I64) => Some(if unsigned(to) {
            I::I64TruncSatF64U
        } else {
            I::I64TruncSatF64S
        }),
    };
    if let Some(op) = op {
        code.instruction(&op);
    }
    normalize(code, to)
}

/// A narrow integer kept in an i32 in its canonical form: sign-extended, or
/// masked to its width.
fn normalize(code: &mut ir::Code, to: &HirType) -> Result<(), Failure> {
    match to {
        HirType::Int {
            bits: 8,
            signed: true,
        } => code.instruction(&I::I32Extend8S),
        HirType::Int {
            bits: 16,
            signed: true,
        } => code.instruction(&I::I32Extend16S),
        HirType::Int {
            bits: 8,
            signed: false,
        } => {
            code.instruction(&I::I32Const(255));
            code.instruction(&I::I32And);
        }
        HirType::Int {
            bits: 16,
            signed: false,
        } => {
            code.instruction(&I::I32Const(65535));
            code.instruction(&I::I32And);
        }
        HirType::Bool
        | HirType::Int { bits: 32 | 64, .. }
        | HirType::Float { bits: 32 | 64 }
        | HirType::BigInt => {}
        HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::Void
        | HirType::Never
        | HirType::NativePointer(_)
        | HirType::Erased
        | HirType::Managed(_) => {
            return Err(format!("conversion normalization to {to:?}").into());
        }
    }
    Ok(())
}

fn push_as(b: &mut Body<'_, '_>, value: ValueId, ty: &HirType) -> Result<(), Failure> {
    b.load(value)?;
    let from = b.ty(value).clone();
    convert(b, &from, ty)
}

fn truth_on_stack(code: &mut ir::Code, slot: Slot) {
    // abs(x)>0 is false for both zeroes AND NaN; x!=0 would be true for NaN.
    match slot {
        Slot::I32 => {
            code.instruction(&I::I32Eqz);
            code.instruction(&I::I32Eqz);
        }
        Slot::I64 => {
            code.instruction(&I::I64Eqz);
            code.instruction(&I::I32Eqz);
        }
        Slot::F32 => {
            code.instruction(&I::F32Abs);
            code.instruction(&I::F32Const(0.0_f32.into()));
            code.instruction(&I::F32Gt);
        }
        Slot::F64 => {
            code.instruction(&I::F64Abs);
            code.instruction(&I::F64Const(0.0.into()));
            code.instruction(&I::F64Gt);
        }
        // A bigint is false only at zero.
        Slot::V128 => code.instruction(&I::V128AnyTrue),
    }
}

pub(crate) fn unary(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: UnOp,
    operand: ValueId,
) -> Result<(), Failure> {
    let out = b.ty(result).clone();
    let slot = types::value_slot(&out)?;
    match op {
        UnOp::Truthy | UnOp::Not => {
            b.load(operand)?;
            let slot = types::value_slot(b.ty(operand))?;
            truth_on_stack(&mut b.code, slot);
            if op == UnOp::Not {
                b.instruction(&I::I32Eqz);
            }
        }
        UnOp::ToInt32 | UnOp::ToUint32 => {
            to_i32(b, operand)?;
            let from = HirType::Int {
                bits: 32,
                signed: op == UnOp::ToInt32,
            };
            convert(b, &from, &out)?;
        }
        UnOp::Neg => match slot {
            Slot::I32 => {
                b.instruction(&I::I32Const(0));
                push_as(b, operand, &out)?;
                b.instruction(&I::I32Sub);
            }
            Slot::I64 => {
                b.instruction(&I::I64Const(0));
                push_as(b, operand, &out)?;
                b.instruction(&I::I64Sub);
            }
            Slot::F32 => {
                push_as(b, operand, &out)?;
                b.instruction(&I::F32Neg);
            }
            Slot::F64 => {
                push_as(b, operand, &out)?;
                b.instruction(&I::F64Neg);
            }
            Slot::V128 => {
                return Err(Failure::Invariant("a bigint routed to number code".into()));
            }
        },
        UnOp::Abs => absolute(b, operand, &out)?,
        UnOp::Round => {
            push_as(b, operand, &HirType::Float { bits: 64 })?;
            b.helper(Helper::Round)?;
            convert(b, &HirType::Float { bits: 64 }, &out)?;
        }
        UnOp::Floor => float_unary(b, operand, &out, &I::F64Floor)?,
        UnOp::Ceil => float_unary(b, operand, &out, &I::F64Ceil)?,
        UnOp::Trunc => float_unary(b, operand, &out, &I::F64Trunc)?,
        UnOp::Sqrt => float_unary(b, operand, &out, &I::F64Sqrt)?,
    }
    Ok(())
}

fn float_unary(
    b: &mut Body<'_, '_>,
    operand: ValueId,
    out: &HirType,
    opcode: &I<'static>,
) -> Result<(), Failure> {
    push_as(b, operand, &HirType::Float { bits: 64 })?;
    b.instruction(opcode);
    convert(b, &HirType::Float { bits: 64 }, out)
}

fn absolute(b: &mut Body<'_, '_>, operand: ValueId, out: &HirType) -> Result<(), Failure> {
    let slot = types::value_slot(out)?;
    if matches!(slot, Slot::F32 | Slot::F64) {
        push_as(b, operand, out)?;
        b.instruction(&if slot == Slot::F32 {
            I::F32Abs
        } else {
            I::F64Abs
        });
        return Ok(());
    }
    if unsigned(b.ty(operand)) || matches!(b.ty(operand), HirType::Bool) {
        return push_as(b, operand, out);
    }
    push_as(b, operand, out)?;
    b.instruction(&if slot == Slot::I32 {
        I::I32Const(0)
    } else {
        I::I64Const(0)
    });
    push_as(b, operand, out)?;
    b.instruction(&if slot == Slot::I32 {
        I::I32Sub
    } else {
        I::I64Sub
    });
    push_as(b, operand, out)?;
    b.instruction(&if slot == Slot::I32 {
        I::I32Const(0)
    } else {
        I::I64Const(0)
    });
    b.instruction(&if slot == Slot::I32 {
        I::I32GeS
    } else {
        I::I64GeS
    });
    b.instruction(&I::Select);
    Ok(())
}

fn to_i32(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    match types::value_slot(b.ty(value))? {
        Slot::I32 => {}
        Slot::I64 => b.instruction(&I::I32WrapI64),
        Slot::F32 => {
            b.instruction(&I::F64PromoteF32);
            b.helper(Helper::ToInt32)?;
        }
        Slot::F64 => b.helper(Helper::ToInt32)?,
        Slot::V128 => {
            return Err(Failure::Invariant("a bigint routed to number code".into()));
        }
    }
    Ok(())
}

pub(crate) fn binary(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    match op {
        BinOp::BitAnd => bitwise(b, result, &I::I32And, true, lhs, rhs),
        BinOp::BitOr => bitwise(b, result, &I::I32Or, true, lhs, rhs),
        BinOp::BitXor => bitwise(b, result, &I::I32Xor, true, lhs, rhs),
        BinOp::Shl => bitwise(b, result, &I::I32Shl, true, lhs, rhs),
        BinOp::Shr => bitwise(b, result, &I::I32ShrS, true, lhs, rhs),
        BinOp::UShr => bitwise(b, result, &I::I32ShrU, false, lhs, rhs),
        BinOp::Lt => comparison(b, Comparison::Lt, lhs, rhs),
        BinOp::Le => comparison(b, Comparison::Le, lhs, rhs),
        BinOp::Gt => comparison(b, Comparison::Gt, lhs, rhs),
        BinOp::Ge => comparison(b, Comparison::Ge, lhs, rhs),
        BinOp::Eq => comparison(b, Comparison::Eq, lhs, rhs),
        BinOp::Ne => comparison(b, Comparison::Ne, lhs, rhs),
        BinOp::Concat => Err(("string concatenation is outside M1a".to_owned()).into()),
        BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::Min
        | BinOp::Max => arithmetic(b, result, op, lhs, rhs),
    }
}

fn bitwise(
    b: &mut Body<'_, '_>,
    result: ValueId,
    opcode: &I<'static>,
    signed: bool,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    to_i32(b, lhs)?;
    to_i32(b, rhs)?;
    b.instruction(opcode);
    let out = b.ty(result).clone();
    convert(b, &HirType::Int { bits: 32, signed }, &out)
}

#[derive(Debug, Clone, Copy)]
enum Comparison {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

fn comparison(
    b: &mut Body<'_, '_>,
    op: Comparison,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if matches!(b.ty(lhs), HirType::Bool) != matches!(b.ty(rhs), HirType::Bool) {
        return Err(format!("comparison {op:?} between boolean and number").into());
    }
    let slot = types::value_slot(b.ty(lhs))?;
    if slot != types::value_slot(b.ty(rhs))? || unsigned(b.ty(lhs)) != unsigned(b.ty(rhs)) {
        return Err(format!("comparison {op:?} with differing scalar representations").into());
    }
    let signed = !unsigned(b.ty(lhs));
    b.load(lhs)?;
    b.load(rhs)?;
    b.instruction(&compare_opcode(slot, op, signed)?);
    Ok(())
}

fn compare_opcode(slot: Slot, op: Comparison, signed: bool) -> Result<I<'static>, Failure> {
    Ok(match (slot, op) {
        (Slot::I32, Comparison::Eq) => I::I32Eq,
        (Slot::I32, Comparison::Ne) => I::I32Ne,
        (Slot::I32, Comparison::Lt) => {
            if signed {
                I::I32LtS
            } else {
                I::I32LtU
            }
        }
        (Slot::I32, Comparison::Le) => {
            if signed {
                I::I32LeS
            } else {
                I::I32LeU
            }
        }
        (Slot::I32, Comparison::Gt) => {
            if signed {
                I::I32GtS
            } else {
                I::I32GtU
            }
        }
        (Slot::I32, Comparison::Ge) => {
            if signed {
                I::I32GeS
            } else {
                I::I32GeU
            }
        }
        (Slot::I64, Comparison::Eq) => I::I64Eq,
        (Slot::I64, Comparison::Ne) => I::I64Ne,
        (Slot::I64, Comparison::Lt) => {
            if signed {
                I::I64LtS
            } else {
                I::I64LtU
            }
        }
        (Slot::I64, Comparison::Le) => {
            if signed {
                I::I64LeS
            } else {
                I::I64LeU
            }
        }
        (Slot::I64, Comparison::Gt) => {
            if signed {
                I::I64GtS
            } else {
                I::I64GtU
            }
        }
        (Slot::I64, Comparison::Ge) => {
            if signed {
                I::I64GeS
            } else {
                I::I64GeU
            }
        }
        (Slot::F32, Comparison::Eq) => I::F32Eq,
        (Slot::F32, Comparison::Ne) => I::F32Ne,
        (Slot::F32, Comparison::Lt) => I::F32Lt,
        (Slot::F32, Comparison::Le) => I::F32Le,
        (Slot::F32, Comparison::Gt) => I::F32Gt,
        (Slot::F32, Comparison::Ge) => I::F32Ge,
        (Slot::F64, Comparison::Eq) => I::F64Eq,
        (Slot::F64, Comparison::Ne) => I::F64Ne,
        (Slot::F64, Comparison::Lt) => I::F64Lt,
        (Slot::F64, Comparison::Le) => I::F64Le,
        (Slot::F64, Comparison::Gt) => I::F64Gt,
        (Slot::F64, Comparison::Ge) => I::F64Ge,
        (Slot::V128, _) => {
            return Err(Failure::Invariant("a bigint routed to number code".into()));
        }
    })
}

fn arithmetic(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    let ty = b.ty(result).clone();
    let slot = types::value_slot(&ty)?;
    if slot != types::value_slot(b.ty(lhs))? || slot != types::value_slot(b.ty(rhs))? {
        return Err(
            format!("{op:?} with operands differing from result representation {ty:?}").into(),
        );
    }
    if op == BinOp::Rem && matches!(slot, Slot::F32 | Slot::F64) {
        push_as(b, lhs, &HirType::Float { bits: 64 })?;
        push_as(b, rhs, &HirType::Float { bits: 64 })?;
        b.helper(Helper::Remainder)?;
        return convert(b, &HirType::Float { bits: 64 }, &ty);
    }
    if matches!(op, BinOp::Min | BinOp::Max) && matches!(slot, Slot::I32 | Slot::I64) {
        if unsigned(b.ty(lhs)) != unsigned(b.ty(rhs)) {
            return Err(("integer min/max with mixed signedness".to_owned()).into());
        }
        b.load(lhs)?;
        b.load(rhs)?;
        b.load(lhs)?;
        b.load(rhs)?;
        b.instruction(&compare_opcode(
            slot,
            if op == BinOp::Min {
                Comparison::Le
            } else {
                Comparison::Ge
            },
            !unsigned(b.ty(lhs)),
        )?);
        b.instruction(&I::Select);
        return Ok(());
    }
    // Prepared integral operations consume core's representation proofs:
    // finite whole results, representable width, and unobservable negative
    // zero. C emits / and %, LLVM emits signed/unsigned div/rem with no
    // additional guards. A zero divisor or overflowing signed quotient cannot
    // satisfy that contract; ordinary JS division remains floating point.
    let instruction = arithmetic_opcode(slot, op, !unsigned(&ty))?;
    b.load(lhs)?;
    b.load(rhs)?;
    b.instruction(&instruction);
    Ok(())
}

fn arithmetic_opcode(slot: Slot, op: BinOp, signed: bool) -> Result<I<'static>, Failure> {
    Ok(match (slot, op) {
        (Slot::I32, BinOp::Add) => I::I32Add,
        (Slot::I32, BinOp::Sub) => I::I32Sub,
        (Slot::I32, BinOp::Mul) => I::I32Mul,
        (Slot::I64, BinOp::Add) => I::I64Add,
        (Slot::I64, BinOp::Sub) => I::I64Sub,
        (Slot::I64, BinOp::Mul) => I::I64Mul,
        (Slot::I32, BinOp::Div) => {
            if signed {
                I::I32DivS
            } else {
                I::I32DivU
            }
        }
        (Slot::I64, BinOp::Div) => {
            if signed {
                I::I64DivS
            } else {
                I::I64DivU
            }
        }
        (Slot::I32, BinOp::Rem) => {
            if signed {
                I::I32RemS
            } else {
                I::I32RemU
            }
        }
        (Slot::I64, BinOp::Rem) => {
            if signed {
                I::I64RemS
            } else {
                I::I64RemU
            }
        }
        (Slot::F32, BinOp::Add) => I::F32Add,
        (Slot::F32, BinOp::Sub) => I::F32Sub,
        (Slot::F32, BinOp::Mul) => I::F32Mul,
        (Slot::F32, BinOp::Div) => I::F32Div,
        (Slot::F32, BinOp::Min) => I::F32Min,
        (Slot::F32, BinOp::Max) => I::F32Max,
        (Slot::F64, BinOp::Add) => I::F64Add,
        (Slot::F64, BinOp::Sub) => I::F64Sub,
        (Slot::F64, BinOp::Mul) => I::F64Mul,
        (Slot::F64, BinOp::Div) => I::F64Div,
        (Slot::F64, BinOp::Min) => I::F64Min,
        (Slot::F64, BinOp::Max) => I::F64Max,
        _ => {
            return Err(format!("{op:?} on {slot:?} is not a scalar arithmetic opcode").into());
        }
    })
}
