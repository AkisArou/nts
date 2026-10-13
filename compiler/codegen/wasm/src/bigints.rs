//! `bigint`, as one `v128`: an exact integer in 128 bits of two's complement,
//! lane 0 its low 64 bits and lane 1 its high 64.
//!
//! The core's `HirType::BigInt` is C's `__int128`. C wraps past it, where node
//! grows the number (`outcomes/a-bigint-past-128-bits-wraps`). Here every
//! operation that can leave 128 bits -- add, subtract, negate, multiply, shift
//! left, a number converted, `asUintN` of a negative -- refuses by name ([`PAST`])
//! instead, so within the width the answer is node's and past it there is none.
//!
//! One `v128` per HIR value fits the backend's one-value-one-slot model: a
//! bigint is a local, a parameter, a field, with no allocation. Bitwise
//! operations and equality are single instructions; arithmetic reads the two
//! lanes. Its text and its comparison with a string go through the host's own
//! `BigInt`, which is node's formatting and parsing exactly.
use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, ValType};

/// The refusal every backend gives for a bigint past the width.
pub(crate) const PAST: &str = "a bigint past 128 bits, which this runtime does not hold";
const BY_ZERO: &str = "a bigint divided by zero, where node throws a RangeError";
const NOT_INTEGRAL: &str = "a number that is not an integer, which has no bigint";

pub(crate) fn is_bigint(ty: &HirType) -> bool {
    ty == &HirType::BigInt
}

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    Box,
    Unbox,
    FromNumber,
    Text,
    CompareString,
    AsIntN,
    AsUintN,
    Shl,
    Shr,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_bigint_box" => Op::Box,
        "nts_bigint_unbox" => Op::Unbox,
        "nts_bigint_from_number" => Op::FromNumber,
        "nts_bigint_to_string" => Op::Text,
        "nts_bigint_compare_string" => Op::CompareString,
        "nts_bigint_as_intn" => Op::AsIntN,
        "nts_bigint_as_uintn" => Op::AsUintN,
        "nts_bigint_shl" => Op::Shl,
        "nts_bigint_shr" => Op::Shr,
        _ => return None,
    })
}

impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        matches!(self, Self::Box | Self::Unbox)
    }
}

/// A module helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(a, b, name) -> a + b`, refused past the width; `Sub` likewise.
    Add,
    Sub,
    Mul,
    /// `(a, b, name) -> a / b`, truncated; zero refused by name.
    Div,
    Rem,
    /// `(value, count, name)`: a bigint count, negative reversing it.
    Shl,
    Shr,
    /// `(a, b) -> -1, 0 or 1`.
    Compare,
    /// `(number, name) -> bigint`: an integral number within the width.
    FromNumber,
    /// `(bigint) -> number`, rounded to nearest, ties to even.
    ToNumber,
    /// `(bits, value, name)`: `BigInt.asIntN` and `BigInt.asUintN`.
    AsIntN,
    AsUintN,
    /// `(x, y) -> the high 64 bits of x * y`, unsigned.
    MulHigh,
    /// `(value, count 0..127) -> value << count`, wrapping.
    ShiftLeft,
    /// `(value, count 0..127) -> value >> count`, arithmetic.
    ShiftRight,
    /// `(value, count 0..127) -> value >>> count`.
    ShiftRightLogical,
}

const V128: Physical = Physical::Scalar(Slot::V128);
const I32: Physical = Physical::Scalar(Slot::I32);
const I64: Physical = Physical::Scalar(Slot::I64);
const F64: Physical = Physical::Scalar(Slot::F64);

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let name = strings::STRING;
    let (params, result) = match helper {
        Helper::Add | Helper::Sub | Helper::Mul | Helper::Div | Helper::Rem => {
            (vec![V128, V128, name], Some(V128))
        }
        Helper::Shl | Helper::Shr => (vec![V128, V128, name], Some(V128)),
        Helper::Compare => (vec![V128, V128], Some(I32)),
        Helper::FromNumber => (vec![F64, name], Some(V128)),
        Helper::ToNumber => (vec![V128], Some(F64)),
        Helper::AsIntN | Helper::AsUintN => (vec![F64, V128, name], Some(V128)),
        Helper::MulHigh => (vec![I64, I64], Some(I64)),
        Helper::ShiftLeft | Helper::ShiftRight | Helper::ShiftRightLogical => {
            (vec![V128, I32], Some(V128))
        }
    };
    m.helper(
        FuncKey::BigInt(helper),
        format!("bigint.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::Add => add_sub(m, false),
            Helper::Sub => add_sub(m, true),
            Helper::Mul => mul(m),
            Helper::Div => divide(m, false),
            Helper::Rem => divide(m, true),
            Helper::Shl => shift(m, true),
            Helper::Shr => shift(m, false),
            Helper::Compare => Ok(compare()),
            Helper::FromNumber => from_number(m),
            Helper::ToNumber => Ok(to_number()),
            Helper::AsIntN => as_n(m, true),
            Helper::AsUintN => as_n(m, false),
            Helper::MulHigh => Ok(mul_high()),
            Helper::ShiftLeft => Ok(shift_left()),
            Helper::ShiftRight => Ok(shift_right(true)),
            Helper::ShiftRightLogical => Ok(shift_right(false)),
        },
    )
}

fn call_helper(b: &mut Body<'_, '_>, helper: Helper) -> Result<(), Failure> {
    let target = callee(b.m, helper)?;
    b.call(target);
    Ok(())
}

/// The calling function's name, for a refusal inside a helper.
fn name(b: &mut Body<'_, '_>) {
    strings::constant(b, &b.func.name.clone());
}

pub(crate) fn constant(b: &mut Body<'_, '_>, value: i128) {
    b.instruction(&I::V128Const(value));
}

pub(crate) fn binary(
    b: &mut Body<'_, '_>,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if !is_bigint(b.ty(lhs)) || !is_bigint(b.ty(rhs)) {
        return Err(format!("bigint {op:?} of {:?} and {:?}", b.ty(lhs), b.ty(rhs)).into());
    }
    b.load(lhs)?;
    b.load(rhs)?;
    let helper = match op {
        BinOp::Add => Some(Helper::Add),
        BinOp::Sub => Some(Helper::Sub),
        BinOp::Mul => Some(Helper::Mul),
        BinOp::Div => Some(Helper::Div),
        BinOp::Rem => Some(Helper::Rem),
        BinOp::Shl => Some(Helper::Shl),
        BinOp::Shr => Some(Helper::Shr),
        _ => None,
    };
    if let Some(helper) = helper {
        name(b);
        return call_helper(b, helper);
    }
    match op {
        BinOp::BitAnd => b.instruction(&I::V128And),
        BinOp::BitOr => b.instruction(&I::V128Or),
        BinOp::BitXor => b.instruction(&I::V128Xor),
        BinOp::Eq => b.instructions(&[I::I64x2Eq, I::I64x2AllTrue]),
        BinOp::Ne => b.instructions(&[I::I64x2Eq, I::I64x2AllTrue, I::I32Eqz]),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            call_helper(b, Helper::Compare)?;
            b.instruction(&I::I32Const(0));
            b.instruction(&match op {
                BinOp::Lt => I::I32LtS,
                BinOp::Le => I::I32LeS,
                BinOp::Gt => I::I32GtS,
                _ => I::I32GeS,
            });
        }
        other => return Err(format!("bigint operator {other:?}").into()),
    }
    Ok(())
}

pub(crate) fn unary(b: &mut Body<'_, '_>, op: UnOp, operand: ValueId) -> Result<(), Failure> {
    match op {
        UnOp::Neg => {
            b.instruction(&I::V128Const(0));
            b.load(operand)?;
            name(b);
            call_helper(b, Helper::Sub)
        }
        UnOp::Truthy | UnOp::Not => {
            b.load(operand)?;
            b.instruction(&I::V128AnyTrue);
            if op == UnOp::Not {
                b.instruction(&I::I32Eqz);
            }
            Ok(())
        }
        other => Err(format!("bigint unary {other:?}").into()),
    }
}

/// A conversion with a bigint on one side.
pub(crate) fn convert(b: &mut Body<'_, '_>, value: ValueId, to: &HirType) -> Result<(), Failure> {
    let from = b.ty(value).clone();
    match (&from, to) {
        (HirType::BigInt, HirType::BigInt) => b.load(value),
        (HirType::BigInt, HirType::Bool) => {
            b.load(value)?;
            b.instruction(&I::V128AnyTrue);
            Ok(())
        }
        (HirType::BigInt, HirType::Float { .. } | HirType::Int { .. }) => {
            b.load(value)?;
            call_helper(b, Helper::ToNumber)?;
            numeric::convert(b, &HirType::NUMBER, to)
        }
        (HirType::Float { .. }, HirType::BigInt) => {
            b.load(value)?;
            numeric::convert(b, &from, &HirType::NUMBER)?;
            name(b);
            call_helper(b, Helper::FromNumber)
        }
        // An integer is exact in 128 bits: its low lane, and its sign spread
        // through the high one (zero for an unsigned one or a boolean).
        (HirType::Int { signed, .. }, HirType::BigInt) => widen(b, value, *signed),
        (HirType::Bool, HirType::BigInt) => widen(b, value, false),
        _ => Err(format!("a conversion from {from:?} to {to:?} through a bigint").into()),
    }
}

/// The low lane only: `v128.and` with this keeps lane 0 and zeroes lane 1.
const LOW_LANE: i128 = u64::MAX as i128;

/// An integer value as a bigint: its low lane the value, its high lane the
/// value's sign (signed) or zero.
fn widen(b: &mut Body<'_, '_>, value: ValueId, signed: bool) -> Result<(), Failure> {
    let from = b.ty(value).clone();
    let wide = HirType::Int { bits: 64, signed };
    let word = |b: &mut Body<'_, '_>| -> Result<(), Failure> {
        b.load(value)?;
        if from == HirType::Bool {
            b.instruction(&I::I64ExtendI32U);
            Ok(())
        } else {
            numeric::convert(b, &from, &wide)
        }
    };
    word(b)?;
    b.instruction(&I::I64x2Splat);
    if signed {
        // Lane 0 from the value, lane 1 from its sign.
        word(b)?;
        b.instructions(&[
            I::I64x2Splat,
            I::I32Const(63),
            I::I64x2ShrS,
            I::V128Const(LOW_LANE),
            I::V128Bitselect,
        ]);
    } else {
        b.instructions(&[I::V128Const(LOW_LANE), I::V128And]);
    }
    Ok(())
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let arity = match op {
        Op::Box | Op::Unbox | Op::FromNumber | Op::Text => 1,
        Op::CompareString | Op::AsIntN | Op::AsUintN | Op::Shl | Op::Shr => 2,
    };
    if args.len() != arity {
        return Err(format!("bigint helper {op:?} arity mismatch").into());
    }
    match op {
        Op::Box => {
            let boxed = boxed(b)?;
            b.instruction(&I::I32Const(erased::BIGINT));
            b.load(args[0])?;
            b.instruction(&I::StructNew(boxed));
            Ok(())
        }
        Op::Unbox => {
            let boxed = boxed(b)?;
            contract::nonnull(b, args[0], "the value of a null bigint box")?;
            b.load(args[0])?;
            b.instruction(&I::StructGet {
                struct_type_index: boxed,
                field_index: 1,
            });
            Ok(())
        }
        Op::FromNumber => {
            b.load(args[0])?;
            numeric::convert(b, &b.ty(args[0]).clone(), &HirType::NUMBER)?;
            name(b);
            call_helper(b, Helper::FromNumber)
        }
        Op::Text => {
            let text = host(b.m, "bigintText");
            lanes(b, args[0])?;
            b.call(text);
            crate::objects::adapt(
                b,
                &HirType::Managed(ManagedType::String),
                &b.ty(result).clone(),
            )
        }
        Op::CompareString => {
            if !strings::is_string(b.ty(args[1])) {
                return Err(format!("a bigint compared with a {:?}", b.ty(args[1])).into());
            }
            let compare = host(b.m, "bigintCompareString");
            lanes(b, args[0])?;
            b.load(args[1])?;
            b.call(compare);
            numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())
        }
        Op::AsIntN | Op::AsUintN => {
            b.load(args[0])?;
            numeric::convert(b, &b.ty(args[0]).clone(), &HirType::NUMBER)?;
            b.load(args[1])?;
            name(b);
            call_helper(
                b,
                if op == Op::AsIntN {
                    Helper::AsIntN
                } else {
                    Helper::AsUintN
                },
            )
        }
        Op::Shl | Op::Shr => {
            b.load(args[0])?;
            b.load(args[1])?;
            name(b);
            call_helper(
                b,
                if op == Op::Shl {
                    Helper::Shl
                } else {
                    Helper::Shr
                },
            )
        }
    }
}

fn boxed(b: &Body<'_, '_>) -> Result<u32, Failure> {
    b.types()
        .erased
        .and_then(|erased| erased.bigint)
        .ok_or_else(|| Failure::Invariant("unplanned erased bigint box".into()))
}

/// A bigint's two lanes, low then high, as the host takes them: an `i64` is a
/// JS `BigInt` across the boundary.
fn lanes(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    b.instruction(&I::I64x2ExtractLane(0));
    b.load(value)?;
    b.instruction(&I::I64x2ExtractLane(1));
    Ok(())
}

fn host(m: &mut Builder<'_>, name: &'static str) -> Func {
    let (params, result) = match name {
        "bigintText" => (vec![I64, I64], strings::STRING),
        _ => (vec![I64, I64, strings::STRING], F64),
    };
    m.import(
        FuncKey::BigIntHost(name),
        "nts:host/v1",
        name,
        params,
        Some(result),
        false,
    )
}

// ---- Helper bodies. Locals are numbered after the parameters. ----

/// Split a `v128` parameter or local into two i64 locals.
fn split(f: &mut Function, value: u32, lo: u32, hi: u32) {
    f.instructions(&[
        I::LocalGet(value),
        I::I64x2ExtractLane(0),
        I::LocalSet(lo),
        I::LocalGet(value),
        I::I64x2ExtractLane(1),
        I::LocalSet(hi),
    ]);
}

/// Push the bigint of two i64 locals.
fn join(f: &mut Function, lo: u32, hi: u32) {
    f.instructions(&[
        I::LocalGet(lo),
        I::I64x2Splat,
        I::LocalGet(hi),
        I::I64x2ReplaceLane(1),
    ]);
}

/// Refuse with `why` when the i32 on the stack is nonzero.
fn refuse_if(f: &mut Function, m: &mut Builder<'_>, name: u32, why: &str) -> Result<(), Failure> {
    f.instruction(&I::If(BlockType::Empty));
    contract::refuse_in(f, m, name, why)?;
    f.instruction(&I::End);
    Ok(())
}

/// `a + b` or `a - b`, with the signed overflow test past the width.
///
/// Params: a, b, name. Locals: a lo, a hi, b lo, b hi, lo, hi.
fn add_sub(m: &mut Builder<'_>, subtract: bool) -> Result<Function, Failure> {
    let (alo, ahi, blo, bhi, lo, hi) = (3, 4, 5, 6, 7, 8);
    let mut f = Function::new([ValType::I64; 6]);
    split(&mut f, 0, alo, ahi);
    split(&mut f, 1, blo, bhi);
    if subtract {
        f.instructions(&[
            I::LocalGet(alo),
            I::LocalGet(blo),
            I::I64Sub,
            I::LocalSet(lo),
            I::LocalGet(ahi),
            I::LocalGet(bhi),
            I::I64Sub,
            I::LocalGet(alo),
            I::LocalGet(blo),
            I::I64LtU,
            I::I64ExtendI32U,
            I::I64Sub,
            I::LocalSet(hi),
            // Overflow when the operands' signs differ and the result's
            // differs from the first's.
            I::LocalGet(ahi),
            I::LocalGet(bhi),
            I::I64Xor,
            I::LocalGet(ahi),
            I::LocalGet(hi),
            I::I64Xor,
            I::I64And,
        ]);
    } else {
        f.instructions(&[
            I::LocalGet(alo),
            I::LocalGet(blo),
            I::I64Add,
            I::LocalSet(lo),
            I::LocalGet(ahi),
            I::LocalGet(bhi),
            I::I64Add,
            I::LocalGet(lo),
            I::LocalGet(alo),
            I::I64LtU,
            I::I64ExtendI32U,
            I::I64Add,
            I::LocalSet(hi),
            // Overflow when the operands share a sign the result does not.
            I::LocalGet(ahi),
            I::LocalGet(hi),
            I::I64Xor,
            I::LocalGet(bhi),
            I::LocalGet(hi),
            I::I64Xor,
            I::I64And,
        ]);
    }
    f.instructions(&[I::I64Const(0), I::I64LtS]);
    refuse_if(&mut f, m, 2, PAST)?;
    join(&mut f, lo, hi);
    f.instruction(&I::End);
    Ok(f)
}

/// The two's complement negation of (lo, hi) locals, in place.
fn negate(f: &mut Function, lo: u32, hi: u32) {
    f.instructions(&[
        I::I64Const(0),
        I::LocalGet(hi),
        I::I64Sub,
        I::LocalGet(lo),
        I::I64Const(0),
        I::I64Ne,
        I::I64ExtendI32U,
        I::I64Sub,
        I::LocalSet(hi),
        I::I64Const(0),
        I::LocalGet(lo),
        I::I64Sub,
        I::LocalSet(lo),
    ]);
}

/// Each (lo, hi) pair of locals replaced by its magnitude, as an unsigned
/// 128-bit number (so -2^127 becomes 2^127).
fn magnitudes(f: &mut Function, pairs: [(u32, u32); 2]) {
    for (lo, hi) in pairs {
        f.instructions(&[
            I::LocalGet(hi),
            I::I64Const(0),
            I::I64LtS,
            I::If(BlockType::Empty),
        ]);
        negate(f, lo, hi);
        f.instruction(&I::End);
    }
}

/// The unsigned high half of a 64 by 64 multiply, from 32-bit halves.
///
/// Params: x, y. Locals: x0, x1, y0, y1, p00, p01, p10, middle.
fn mul_high() -> Function {
    let (x0, x1, y0, y1, p00, p01, p10, middle) = (2, 3, 4, 5, 6, 7, 8, 9);
    let low = |f: &mut Function, from: u32, to: u32| {
        f.instructions(&[
            I::LocalGet(from),
            I::I64Const(0xffff_ffff),
            I::I64And,
            I::LocalSet(to),
        ]);
    };
    let high = |f: &mut Function, from: u32, to: u32| {
        f.instructions(&[
            I::LocalGet(from),
            I::I64Const(32),
            I::I64ShrU,
            I::LocalSet(to),
        ]);
    };
    let mut f = Function::new([ValType::I64; 8]);
    low(&mut f, 0, x0);
    high(&mut f, 0, x1);
    low(&mut f, 1, y0);
    high(&mut f, 1, y1);
    let product = |f: &mut Function, a: u32, b: u32, to: u32| {
        f.instructions(&[I::LocalGet(a), I::LocalGet(b), I::I64Mul, I::LocalSet(to)]);
    };
    product(&mut f, x0, y0, p00);
    product(&mut f, x0, y1, p01);
    product(&mut f, x1, y0, p10);
    f.instructions(&[
        // The middle column: carries out of the low word.
        I::LocalGet(p00),
        I::I64Const(32),
        I::I64ShrU,
        I::LocalGet(p01),
        I::I64Const(0xffff_ffff),
        I::I64And,
        I::I64Add,
        I::LocalGet(p10),
        I::I64Const(0xffff_ffff),
        I::I64And,
        I::I64Add,
        I::LocalSet(middle),
        I::LocalGet(x1),
        I::LocalGet(y1),
        I::I64Mul,
        I::LocalGet(p01),
        I::I64Const(32),
        I::I64ShrU,
        I::I64Add,
        I::LocalGet(p10),
        I::I64Const(32),
        I::I64ShrU,
        I::I64Add,
        I::LocalGet(middle),
        I::I64Const(32),
        I::I64ShrU,
        I::I64Add,
        I::End,
    ]);
    f
}

/// `a * b` on magnitudes, signed at the end, refused past the width.
///
/// Params: a, b, name. Locals: a lo, a hi, b lo, b hi, negative, low word,
/// high word, the high word of the high product.
fn mul(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let high = callee(m, Helper::MulHigh)?;
    let (alo, ahi, blo, bhi, negative, word, top, spill) = (3, 4, 5, 6, 7, 8, 9, 10);
    let mut f = Function::new([
        ValType::I64,
        ValType::I64,
        ValType::I64,
        ValType::I64,
        ValType::I32,
        ValType::I64,
        ValType::I64,
        ValType::I64,
    ]);
    split(&mut f, 0, alo, ahi);
    split(&mut f, 1, blo, bhi);
    f.instructions(&[
        I::LocalGet(ahi),
        I::LocalGet(bhi),
        I::I64Xor,
        I::I64Const(0),
        I::I64LtS,
        I::LocalSet(negative),
    ]);
    magnitudes(&mut f, [(alo, ahi), (blo, bhi)]);
    // Both magnitudes at 2^64 or more: past the width.
    f.instructions(&[
        I::LocalGet(ahi),
        I::I64Const(0),
        I::I64Ne,
        I::LocalGet(bhi),
        I::I64Const(0),
        I::I64Ne,
        I::I32And,
    ]);
    refuse_if(&mut f, m, 2, PAST)?;
    // Keep the wide one in a: b's magnitude fits one word.
    f.instructions(&[
        I::LocalGet(bhi),
        I::I64Const(0),
        I::I64Ne,
        I::If(BlockType::Empty),
        I::LocalGet(alo),
        I::LocalGet(blo),
        I::LocalSet(alo),
        I::LocalSet(blo),
        I::LocalGet(bhi),
        I::LocalSet(ahi),
        I::I64Const(0),
        I::LocalSet(bhi),
        I::End,
    ]);
    // (ahi, alo) * blo = alo * blo + (ahi * blo) << 64.
    f.instructions(&[I::LocalGet(alo), I::LocalGet(blo)]);
    f.call(high);
    f.instructions(&[I::LocalSet(top), I::LocalGet(ahi), I::LocalGet(blo)]);
    f.call(high);
    f.instructions(&[
        I::LocalSet(spill),
        I::LocalGet(spill),
        I::I64Const(0),
        I::I64Ne,
    ]);
    refuse_if(&mut f, m, 2, PAST)?;
    f.instructions(&[
        I::LocalGet(top),
        I::LocalGet(ahi),
        I::LocalGet(blo),
        I::I64Mul,
        I::I64Add,
        I::LocalTee(spill),
        I::LocalGet(top),
        I::I64LtU,
    ]);
    refuse_if(&mut f, m, 2, PAST)?;
    f.instructions(&[
        I::LocalGet(spill),
        I::LocalSet(top),
        I::LocalGet(alo),
        I::LocalGet(blo),
        I::I64Mul,
        I::LocalSet(word),
        // The magnitude must be at most 2^127 - 1, or exactly 2^127 when the
        // product is negative.
        I::LocalGet(top),
        I::I64Const(0),
        I::I64LtS,
        I::LocalGet(negative),
        I::LocalGet(top),
        I::I64Const(i64::MIN),
        I::I64Eq,
        I::LocalGet(word),
        I::I64Eqz,
        I::I32And,
        I::I32And,
        I::I32Eqz,
        I::I32And,
    ]);
    refuse_if(&mut f, m, 2, PAST)?;
    f.instructions(&[I::LocalGet(negative), I::If(BlockType::Empty)]);
    negate(&mut f, word, top);
    f.instruction(&I::End);
    join(&mut f, word, top);
    f.instruction(&I::End);
    Ok(f)
}

/// `a / b` (truncated) or `a % b` (the dividend's sign), by long division of
/// magnitudes, with a one-word fast path.
///
/// Params: a, b, name. Locals: a lo, a hi, b lo, b hi, negative quotient,
/// negative dividend, q lo, q hi, r lo, r hi, bit.
fn divide(m: &mut Builder<'_>, remainder: bool) -> Result<Function, Failure> {
    let (alo, ahi, blo, bhi, qneg, aneg, qlo, qhi, rlo, rhi, bit) =
        (3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13);
    let mut f = Function::new([
        ValType::I64,
        ValType::I64,
        ValType::I64,
        ValType::I64,
        ValType::I32,
        ValType::I32,
        ValType::I64,
        ValType::I64,
        ValType::I64,
        ValType::I64,
        ValType::I32,
    ]);
    split(&mut f, 0, alo, ahi);
    split(&mut f, 1, blo, bhi);
    f.instructions(&[I::LocalGet(blo), I::LocalGet(bhi), I::I64Or, I::I64Eqz]);
    refuse_if(&mut f, m, 2, BY_ZERO)?;
    // One word each, and not the one quotient a word cannot hold.
    let fits = |f: &mut Function, lo: u32, hi: u32| {
        f.instructions(&[
            I::LocalGet(hi),
            I::LocalGet(lo),
            I::I64Const(63),
            I::I64ShrS,
            I::I64Eq,
        ]);
    };
    fits(&mut f, alo, ahi);
    fits(&mut f, blo, bhi);
    f.instructions(&[
        I::I32And,
        I::LocalGet(alo),
        I::I64Const(i64::MIN),
        I::I64Eq,
        I::LocalGet(blo),
        I::I64Const(-1),
        I::I64Eq,
        I::I32And,
        I::I32Eqz,
        I::I32And,
        I::If(BlockType::Empty),
        I::LocalGet(alo),
        I::LocalGet(blo),
        if remainder { I::I64RemS } else { I::I64DivS },
        I::LocalTee(qlo),
        I::I64Const(63),
        I::I64ShrS,
        I::LocalSet(qhi),
    ]);
    join(&mut f, qlo, qhi);
    f.instructions(&[I::Return, I::End]);
    // -2^127 / -1 is 2^127.
    f.instructions(&[
        I::LocalGet(ahi),
        I::I64Const(i64::MIN),
        I::I64Eq,
        I::LocalGet(alo),
        I::I64Eqz,
        I::I32And,
        I::LocalGet(blo),
        I::LocalGet(bhi),
        I::I64And,
        I::I64Const(-1),
        I::I64Eq,
        I::I32And,
    ]);
    if remainder {
        f.instructions(&[I::If(BlockType::Empty), I::V128Const(0), I::Return, I::End]);
    } else {
        refuse_if(&mut f, m, 2, PAST)?;
    }
    f.instructions(&[
        I::LocalGet(ahi),
        I::I64Const(0),
        I::I64LtS,
        I::LocalTee(aneg),
        I::LocalGet(bhi),
        I::I64Const(0),
        I::I64LtS,
        I::I32Xor,
        I::LocalSet(qneg),
    ]);
    magnitudes(&mut f, [(alo, ahi), (blo, bhi)]);
    long_division(&mut f, [alo, ahi, blo, bhi, qlo, qhi, rlo, rhi, bit]);
    let (lo, hi, negative) = if remainder {
        (rlo, rhi, aneg)
    } else {
        (qlo, qhi, qneg)
    };
    f.instructions(&[I::LocalGet(negative), I::If(BlockType::Empty)]);
    negate(&mut f, lo, hi);
    f.instruction(&I::End);
    join(&mut f, lo, hi);
    f.instruction(&I::End);
    Ok(f)
}

/// Restoring division of unsigned 128-bit magnitudes, one bit of the
/// dividend at a time, high first: quotient and remainder into their locals.
fn long_division(f: &mut Function, locals: [u32; 9]) {
    let [alo, ahi, blo, bhi, qlo, qhi, rlo, rhi, bit] = locals;
    f.instructions(&[
        I::I32Const(127),
        I::LocalSet(bit),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        // r = r << 1 | bit of a
        I::LocalGet(rhi),
        I::I64Const(1),
        I::I64Shl,
        I::LocalGet(rlo),
        I::I64Const(63),
        I::I64ShrU,
        I::I64Or,
        I::LocalSet(rhi),
        I::LocalGet(rlo),
        I::I64Const(1),
        I::I64Shl,
        // The dividend's bit: from the high word above 63, else the low.
        I::LocalGet(ahi),
        I::LocalGet(alo),
        I::LocalGet(bit),
        I::I32Const(63),
        I::I32GtU,
        I::Select,
        I::LocalGet(bit),
        I::I64ExtendI32U,
        I::I64ShrU,
        I::I64Const(1),
        I::I64And,
        I::I64Or,
        I::LocalSet(rlo),
        // if r >= b (unsigned): r -= b, set the quotient bit
        I::LocalGet(rhi),
        I::LocalGet(bhi),
        I::I64GtU,
        I::LocalGet(rhi),
        I::LocalGet(bhi),
        I::I64Eq,
        I::LocalGet(rlo),
        I::LocalGet(blo),
        I::I64GeU,
        I::I32And,
        I::I32Or,
        I::If(BlockType::Empty),
        I::LocalGet(rhi),
        I::LocalGet(bhi),
        I::I64Sub,
        I::LocalGet(rlo),
        I::LocalGet(blo),
        I::I64LtU,
        I::I64ExtendI32U,
        I::I64Sub,
        I::LocalSet(rhi),
        I::LocalGet(rlo),
        I::LocalGet(blo),
        I::I64Sub,
        I::LocalSet(rlo),
        I::LocalGet(bit),
        I::I32Const(63),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::LocalGet(qhi),
        I::I64Const(1),
        I::LocalGet(bit),
        I::I64ExtendI32U,
        I::I64Shl,
        I::I64Or,
        I::LocalSet(qhi),
        I::Else,
        I::LocalGet(qlo),
        I::I64Const(1),
        I::LocalGet(bit),
        I::I64ExtendI32U,
        I::I64Shl,
        I::I64Or,
        I::LocalSet(qlo),
        I::End,
        I::End,
        I::LocalGet(bit),
        I::I32Eqz,
        I::BrIf(1),
        I::LocalGet(bit),
        I::I32Const(1),
        I::I32Sub,
        I::LocalSet(bit),
        I::Br(0),
        I::End,
        I::End,
    ]);
}

/// `value << count`, count in 0..127, wrapping.
///
/// Params: value, count. Locals: lo, hi.
fn shift_left() -> Function {
    let (lo, hi) = (2, 3);
    let mut f = Function::new([ValType::I64, ValType::I64]);
    split(&mut f, 0, lo, hi);
    f.instructions(&[
        I::LocalGet(1),
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::Return,
        I::End,
        I::LocalGet(1),
        I::I32Const(64),
        I::I32GeU,
        I::If(BlockType::Empty),
        I::LocalGet(lo),
        I::LocalGet(1),
        I::I32Const(64),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64Shl,
        I::LocalSet(hi),
        I::I64Const(0),
        I::LocalSet(lo),
        I::Else,
        I::LocalGet(hi),
        I::LocalGet(1),
        I::I64ExtendI32U,
        I::I64Shl,
        I::LocalGet(lo),
        I::I32Const(64),
        I::LocalGet(1),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64ShrU,
        I::I64Or,
        I::LocalSet(hi),
        I::LocalGet(lo),
        I::LocalGet(1),
        I::I64ExtendI32U,
        I::I64Shl,
        I::LocalSet(lo),
        I::End,
    ]);
    join(&mut f, lo, hi);
    f.instruction(&I::End);
    f
}

/// `value >> count` (arithmetic) or `>>>` (logical), count in 0..127.
///
/// Params: value, count. Locals: lo, hi.
fn shift_right(arithmetic: bool) -> Function {
    let (lo, hi) = (2, 3);
    let down = if arithmetic { I::I64ShrS } else { I::I64ShrU };
    let mut f = Function::new([ValType::I64, ValType::I64]);
    split(&mut f, 0, lo, hi);
    f.instructions(&[
        I::LocalGet(1),
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::Return,
        I::End,
        I::LocalGet(1),
        I::I32Const(64),
        I::I32GeU,
        I::If(BlockType::Empty),
        I::LocalGet(hi),
        I::LocalGet(1),
        I::I32Const(64),
        I::I32Sub,
        I::I64ExtendI32U,
        down.clone(),
        I::LocalSet(lo),
        I::LocalGet(hi),
    ]);
    if arithmetic {
        f.instructions(&[I::I64Const(63), I::I64ShrS]);
    } else {
        f.instructions(&[I::Drop, I::I64Const(0)]);
    }
    f.instructions(&[
        I::LocalSet(hi),
        I::Else,
        I::LocalGet(lo),
        I::LocalGet(1),
        I::I64ExtendI32U,
        I::I64ShrU,
        I::LocalGet(hi),
        I::I32Const(64),
        I::LocalGet(1),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64Shl,
        I::I64Or,
        I::LocalSet(lo),
        I::LocalGet(hi),
        I::LocalGet(1),
        I::I64ExtendI32U,
        down,
        I::LocalSet(hi),
        I::End,
    ]);
    join(&mut f, lo, hi);
    f.instruction(&I::End);
    f
}

/// `value << count` or `value >> count` with a bigint count, as C's
/// `nts_bigint_shl` and `nts_bigint_shr`: a negative count shifts the other
/// way. A right shift saturates at 0 or -1; a left shift that loses a bit is
/// refused, where C makes it 0.
///
/// Params: value, count, name. Locals: count lo, count hi, n, result.
fn shift(m: &mut Builder<'_>, left: bool) -> Result<Function, Failure> {
    let up = callee(m, Helper::ShiftLeft)?;
    let down = callee(m, Helper::ShiftRight)?;
    let (clo, chi, n, out) = (3, 4, 5, 6);
    let mut f = Function::new([ValType::I64, ValType::I64, ValType::I32, ValType::V128]);
    split(&mut f, 1, clo, chi);
    // Whether the count's direction is up: a left shift by a non-negative
    // count, or a right shift by a negative one.
    let negative = [I::LocalGet(chi), I::I64Const(0), I::I64LtS];
    // The count's magnitude, saturated at 128.
    f.instructions(&negative);
    f.instructions(&[I::If(BlockType::Empty)]);
    negate(&mut f, clo, chi);
    f.instruction(&I::End);
    f.instructions(&[
        // The count while it is below 128, else 128.
        I::LocalGet(clo),
        I::I32WrapI64,
        I::I32Const(128),
        I::LocalGet(chi),
        I::I64Eqz,
        I::LocalGet(clo),
        I::I64Const(128),
        I::I64LtU,
        I::I32And,
        I::Select,
        I::LocalSet(n),
    ]);
    // Re-read the count's sign from the parameter: the locals now hold its
    // magnitude.
    f.instructions(&[
        I::LocalGet(1),
        I::I64x2ExtractLane(1),
        I::I64Const(0),
        I::I64LtS,
    ]);
    if left {
        f.instruction(&I::I32Eqz);
    }
    f.instructions(&[I::If(BlockType::Result(ValType::V128))]);
    // Up: past the width unless every lost bit was the sign.
    f.instructions(&[
        I::LocalGet(n),
        I::I32Const(128),
        I::I32Eq,
        I::If(BlockType::Result(ValType::V128)),
        I::LocalGet(0),
        I::V128AnyTrue,
    ]);
    refuse_if(&mut f, m, 2, PAST)?;
    f.instructions(&[I::V128Const(0), I::Else, I::LocalGet(0), I::LocalGet(n)]);
    f.call(up);
    f.instructions(&[I::LocalTee(out), I::LocalGet(n)]);
    f.call(down);
    f.instructions(&[I::LocalGet(0), I::I64x2Eq, I::I64x2AllTrue, I::I32Eqz]);
    refuse_if(&mut f, m, 2, PAST)?;
    f.instructions(&[I::LocalGet(out), I::End, I::Else]);
    // Down: saturating at the sign once every bit is gone.
    f.instructions(&[
        I::LocalGet(0),
        I::LocalGet(n),
        I::I32Const(127),
        I::LocalGet(n),
        I::I32Const(127),
        I::I32LtU,
        I::Select,
    ]);
    f.call(down);
    f.instructions(&[I::End, I::End]);
    Ok(f)
}

/// -1, 0 or 1: the high words signed, then the low unsigned.
///
/// Params: a, b. Locals: a lo, a hi, b lo, b hi.
fn compare() -> Function {
    let (alo, ahi, blo, bhi) = (2, 3, 4, 5);
    let mut f = Function::new([ValType::I64; 4]);
    split(&mut f, 0, alo, ahi);
    split(&mut f, 1, blo, bhi);
    f.instructions(&[
        I::LocalGet(ahi),
        I::LocalGet(bhi),
        I::I64Ne,
        I::If(BlockType::Result(ValType::I32)),
        I::LocalGet(ahi),
        I::LocalGet(bhi),
        I::I64GtS,
        I::LocalGet(ahi),
        I::LocalGet(bhi),
        I::I64LtS,
        I::I32Sub,
        I::Else,
        I::LocalGet(alo),
        I::LocalGet(blo),
        I::I64GtU,
        I::LocalGet(alo),
        I::LocalGet(blo),
        I::I64LtU,
        I::I32Sub,
        I::End,
        I::End,
    ]);
    f
}

/// C's `nts_bigint_from_number`: an integral number in [-2^127, 2^127), exact.
///
/// Params: number, name. Locals: lo, hi.
fn from_number(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let (lo, hi) = (2, 3);
    let two_64 = 18_446_744_073_709_551_616.0_f64;
    let two_127 = 170_141_183_460_469_231_731_687_303_715_884_105_728.0_f64;
    let mut f = Function::new([ValType::I64, ValType::I64]);
    f.instructions(&[I::LocalGet(0), I::LocalGet(0), I::F64Trunc, I::F64Ne]);
    refuse_if(&mut f, m, 1, NOT_INTEGRAL)?;
    f.instructions(&[
        I::LocalGet(0),
        I::F64Const((-two_127).into()),
        I::F64Ge,
        I::LocalGet(0),
        I::F64Const(two_127.into()),
        I::F64Lt,
        I::I32And,
        I::I32Eqz,
    ]);
    refuse_if(&mut f, m, 1, PAST)?;
    // Below 2^63 in magnitude, one word holds it exactly.
    f.instructions(&[
        I::LocalGet(0),
        I::F64Abs,
        I::F64Const(9_223_372_036_854_775_808.0_f64.into()),
        I::F64Lt,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::I64TruncSatF64S,
        I::LocalTee(lo),
        I::I64Const(63),
        I::I64ShrS,
        I::LocalSet(hi),
    ]);
    join(&mut f, lo, hi);
    f.instructions(&[I::Return, I::End]);
    // Beyond, the high word is the floor of x / 2^64 and the low what
    // remains: a multiple of x's spacing (2^11 or more) below 2^64, so exact.
    f.instructions(&[
        I::LocalGet(0),
        I::F64Const(two_64.into()),
        I::F64Div,
        I::F64Floor,
        I::I64TruncSatF64S,
        I::LocalSet(hi),
        I::LocalGet(0),
        I::LocalGet(hi),
        I::F64ConvertI64S,
        I::F64Const(two_64.into()),
        I::F64Mul,
        I::F64Sub,
        I::I64TruncSatF64U,
        I::LocalSet(lo),
    ]);
    join(&mut f, lo, hi);
    f.instruction(&I::End);
    Ok(f)
}

/// The nearest number, ties to even: the magnitude's top 64 bits with a
/// sticky bit for the rest, converted once, scaled by a power of two, signed.
///
/// Params: value. Locals: lo, hi, negative, s (bits in the high word), the
/// magnitude as a number.
fn to_number() -> Function {
    let (lo, hi, negative, s, magnitude) = (1, 2, 3, 4, 5);
    let mut f = Function::new([
        ValType::I64,
        ValType::I64,
        ValType::I32,
        ValType::I32,
        ValType::F64,
    ]);
    split(&mut f, 0, lo, hi);
    f.instructions(&[
        I::LocalGet(hi),
        I::LocalGet(lo),
        I::I64Const(63),
        I::I64ShrS,
        I::I64Eq,
        I::If(BlockType::Empty),
        I::LocalGet(lo),
        I::F64ConvertI64S,
        I::Return,
        I::End,
        I::LocalGet(hi),
        I::I64Const(0),
        I::I64LtS,
        I::LocalTee(negative),
        I::If(BlockType::Empty),
    ]);
    negate(&mut f, lo, hi);
    f.instructions(&[
        I::End,
        I::I32Const(64),
        I::LocalGet(hi),
        I::I64Clz,
        I::I32WrapI64,
        I::I32Sub,
        I::LocalSet(s),
        I::LocalGet(s),
        I::I32Eqz,
        I::If(BlockType::Result(ValType::I64)),
        I::LocalGet(lo),
        I::Else,
        I::LocalGet(s),
        I::I32Const(64),
        I::I32Eq,
        I::If(BlockType::Result(ValType::I64)),
        I::LocalGet(hi),
        I::LocalGet(lo),
        I::I64Const(0),
        I::I64Ne,
        I::I64ExtendI32U,
        I::I64Or,
        I::Else,
        I::LocalGet(hi),
        I::I32Const(64),
        I::LocalGet(s),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64Shl,
        I::LocalGet(lo),
        I::LocalGet(s),
        I::I64ExtendI32U,
        I::I64ShrU,
        I::I64Or,
        I::LocalGet(lo),
        I::I32Const(64),
        I::LocalGet(s),
        I::I32Sub,
        I::I64ExtendI32U,
        I::I64Shl,
        I::I64Const(0),
        I::I64Ne,
        I::I64ExtendI32U,
        I::I64Or,
        I::End,
        I::End,
        I::F64ConvertI64U,
        I::LocalGet(s),
        I::I64ExtendI32U,
        I::I64Const(1023),
        I::I64Add,
        I::I64Const(52),
        I::I64Shl,
        I::F64ReinterpretI64,
        I::F64Mul,
        I::LocalTee(magnitude),
        I::F64Neg,
        I::LocalGet(magnitude),
        I::LocalGet(negative),
        I::Select,
        I::End,
    ]);
    f
}

/// `BigInt.asIntN` and `BigInt.asUintN`, as C's `nts_bigint_low_bits`: the
/// low `bits`, sign-extended or not. A width of 128 or more keeps the value;
/// `asUintN` of a negative there is past the width.
///
/// Params: bits, value, name. Locals: width.
fn as_n(m: &mut Builder<'_>, signed: bool) -> Result<Function, Failure> {
    let up = callee(m, Helper::ShiftLeft)?;
    let down = callee(
        m,
        if signed {
            Helper::ShiftRight
        } else {
            Helper::ShiftRightLogical
        },
    )?;
    let width = 3;
    let mut f = Function::new([ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        I::F64Const(128.0.into()),
        I::F64Ge,
        I::If(BlockType::Empty),
    ]);
    if !signed {
        f.instructions(&[
            I::LocalGet(1),
            I::I64x2ExtractLane(1),
            I::I64Const(0),
            I::I64LtS,
        ]);
        refuse_if(&mut f, m, 2, PAST)?;
    }
    f.instructions(&[
        I::LocalGet(1),
        I::Return,
        I::End,
        // `ToIndex` truncates: anything below one bit is zero bits.
        I::LocalGet(0),
        I::I32TruncSatF64U,
        I::LocalTee(width),
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::V128Const(0),
        I::Return,
        I::End,
        // Up then down by 128 - width keeps the low `width` bits.
        I::LocalGet(1),
        I::I32Const(128),
        I::LocalGet(width),
        I::I32Sub,
    ]);
    f.call(up);
    f.instructions(&[I::I32Const(128), I::LocalGet(width), I::I32Sub]);
    f.call(down);
    f.instruction(&I::End);
    Ok(f)
}

/// The text of an erased value known to be a bigint, for `String(value)`.
pub(crate) fn erased_text(
    m: &mut Builder<'_>,
    f: &mut Function,
    value: u32,
) -> Result<(), Failure> {
    let boxed = m
        .types
        .erased
        .and_then(|erased| erased.bigint)
        .ok_or_else(|| Failure::Invariant("unplanned erased bigint box".into()))?;
    let text = host(m, "bigintText");
    for lane in 0..2 {
        f.instructions(&[
            I::LocalGet(value),
            I::RefCastNonNull(HeapType::Concrete(boxed)),
            I::StructGet {
                struct_type_index: boxed,
                field_index: 1,
            },
            I::I64x2ExtractLane(lane),
        ]);
    }
    f.call(text);
    Ok(())
}
