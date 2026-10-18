//! JS strings stay extern references. Range adapters use Wasm instructions.

use crate::{
    body::Body,
    error::Failure,
    helpers::Helper as ScalarHelper,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    numeric,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{BlockType, Instruction as I, RefType, ValType};

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
    Test,
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
    /// `s[i]`: C's `nts_str_at`, code at its site over the builtins.
    At,
    /// `startsWith` and `endsWith` with no position, over the builtins: a
    /// length test, then `equals` of the end that would match. They were host
    /// calls, a crossing into JS each, a third of a loop that makes three.
    StartsWith,
    EndsWith,
}

impl Helper {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Test => "test",
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
            Self::At => "string.at",
            Self::StartsWith => "string.startsWith",
            Self::EndsWith => "string.endsWith",
        }
    }
    pub(crate) const fn builtin(self) -> bool {
        match self {
            Self::Test
            | Self::Length
            | Self::Unit
            | Self::Equal
            | Self::Compare
            | Self::Concat
            | Self::SubstringBuiltin
            | Self::FromCharCodeBuiltin
            | Self::At => true,
            Self::CharCodeAt
            | Self::CharAt
            | Self::Substring
            | Self::Slice
            | Self::FromCharCode
            | Self::StartsWith
            | Self::EndsWith => false,
        }
    }
    pub(crate) fn signature(self) -> (Vec<Physical>, Physical) {
        match self {
            Self::Test | Self::Length => (vec![STRING], I32),
            Self::Unit => (vec![STRING, I32], I32),
            Self::Equal | Self::Compare | Self::StartsWith | Self::EndsWith => {
                (vec![STRING, STRING], I32)
            }
            Self::Concat => (vec![STRING, STRING], NONNULL_STRING),
            Self::SubstringBuiltin => (vec![STRING, I32, I32], NONNULL_STRING),
            Self::FromCharCodeBuiltin => (vec![I32], NONNULL_STRING),
            Self::CharCodeAt => (vec![STRING, F64], F64),
            Self::CharAt | Self::At => (vec![STRING, F64], STRING),
            Self::Substring | Self::Slice => (vec![STRING, F64, F64], STRING),
            Self::FromCharCode => (vec![F64], STRING),
        }
    }
    /// A module-local adapter body; builtins have none.
    fn body(self, m: &mut Builder<'_>) -> Result<Function, Failure> {
        match self {
            Self::Test
            | Self::Length
            | Self::Unit
            | Self::Equal
            | Self::Compare
            | Self::Concat
            | Self::SubstringBuiltin
            | Self::FromCharCodeBuiltin
            | Self::At => Err(Failure::Invariant(format!(
                "string builtin {self:?} has no module body"
            ))),
            Self::CharCodeAt | Self::CharAt => indexed(self, m),
            Self::StartsWith | Self::EndsWith => affix(self, m),
            Self::Substring | Self::Slice => substring(self, m),
            // The code unit is `ToInt32` reduced to 16 bits, which is `ToUint16`; one
            // below 256 is read from the one-byte table.
            Self::FromCharCode => {
                let to_int = crate::helpers::callee(m, ScalarHelper::ToInt32)?;
                let from = callee(m, Self::FromCharCodeBuiltin)?;
                let (table, ty) = one_byte_strings(m)?;
                let mut f = Function::new([ValType::I32]);
                f.instruction(&I::LocalGet(0));
                f.call(to_int);
                f.instructions(&[
                    I::I32Const(0xffff),
                    I::I32And,
                    I::LocalTee(1),
                    I::I32Const(256),
                    I::I32LtU,
                    I::If(BlockType::Result(ValType::EXTERNREF)),
                ]);
                f.global_get(table);
                f.instructions(&[I::LocalGet(1), I::ArrayGet(ty), I::Else, I::LocalGet(1)]);
                f.call(from);
                f.instructions(&[I::End, I::End]);
                Ok(f)
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
        "nts_str_at" => Some(Helper::At),
        "nts_str_substring" => Some(Helper::Substring),
        "nts_str_slice" => Some(Helper::Slice),
        "nts_str_starts_with" => Some(Helper::StartsWith),
        "nts_str_ends_with" => Some(Helper::EndsWith),
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

pub(crate) fn call(b: &mut Body<'_, '_>, helper: Helper) -> Result<(), Failure> {
    let f = callee(b.m, helper)?;
    b.call(f);
    Ok(())
}

/// A string literal: an immutable imported global, so reading it is free.
pub(crate) fn constant(b: &mut Body<'_, '_>, text: &str) {
    let global = b.m.literal(text);
    b.global_get(global);
}

pub(crate) fn truthy(b: &mut Body<'_, '_>, op: UnOp, value: ValueId) -> Result<(), Failure> {
    if !matches!(op, UnOp::Truthy | UnOp::Not) {
        return Err(format!("string unary {op:?}").into());
    }
    b.load(value)?;
    b.instruction(&I::RefIsNull);
    b.instruction(&I::If(BlockType::Result(ValType::I32)));
    b.instruction(&I::I32Const(0));
    b.instruction(&I::Else);
    b.load(value)?;
    call(b, Helper::Length)?;
    b.instruction(&I::I32Eqz);
    b.instruction(&I::I32Eqz);
    b.instruction(&I::End);
    if op == UnOp::Not {
        b.instruction(&I::I32Eqz);
    }
    Ok(())
}
/// The engine's string builtin, or the module-local adapter around one.
pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let (params, result) = helper.signature();
    let key = FuncKey::String(helper);
    if helper.builtin() {
        return Ok(m.import(
            key,
            "wasm:js-string",
            helper.name(),
            params,
            Some(result),
            true,
        ));
    }
    m.helper(key, helper.name(), params, Some(result), |m| helper.body(m))
}

pub(crate) fn length(b: &mut Body<'_, '_>, result: ValueId, value: ValueId) -> Result<(), Failure> {
    crate::contract::nonnull(b, value, "the length of a null string")?;
    b.load(value)?;
    call(b, Helper::Length)?;
    numeric::convert(b, &UINT, &b.ty(result).clone())
}

pub(crate) fn unit(
    b: &mut Body<'_, '_>,
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
    crate::contract::nonnull(b, string, "a character of a null string")?;
    if checked
        && helper == Helper::CharCodeAt
        && matches!(
            b.ty(index),
            HirType::Int {
                bits: 8 | 16 | 32,
                ..
            }
        )
    {
        return checked_unit(b, result, string, index);
    }
    // HIR already proved this index inside the string. The builtin traps if
    // that proof is ever wrong; no repeated length/range test is needed.
    // Keep the old spelling only as a same-binary measurement diagnostic.
    if !checked && b.m.recheck_string_units {
        unit_index_contract(b, string, index)?;
    }
    let index_type = if checked { HirType::NUMBER } else { UINT };
    b.load(string)?;
    b.load(index)?;
    numeric::convert(b, &b.ty(index).clone(), &index_type)?;
    call(b, helper)?;
    numeric::convert(b, &index_type, &b.ty(result).clone())
}

/// `charCodeAt` with a 32-bit index, in line: one unsigned comparison against
/// the length -- a negative index reads past it, the premise `arrays::within`
/// states -- then the code unit, or `NaN` past either end, as JS answers. The
/// helper takes a number index and tests it whole and in range in `f64`, five
/// conversions a character, and JSON's number scanner reads every digit so.
fn checked_unit(
    b: &mut Body<'_, '_>,
    result: ValueId,
    string: ValueId,
    index: ValueId,
) -> Result<(), Failure> {
    crate::arrays::index(b, index)?;
    b.load(string)?;
    call(b, Helper::Length)?;
    b.instruction(&I::I32LtU);
    b.instruction(&I::If(BlockType::Result(ValType::F64)));
    b.load(string)?;
    crate::arrays::index(b, index)?;
    call(b, Helper::Unit)?;
    b.instruction(&I::F64ConvertI32U);
    b.instruction(&I::Else);
    b.instruction(&I::F64Const(f64::NAN.into()));
    b.instruction(&I::End);
    numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())
}

/// Whether `index` names a code unit of `string`, as an array's index is
/// checked: one unsigned comparison for a 32-bit index, where the whole,
/// nonnegative and below-the-length tests in `f64` cost AWFY-shaped loops
/// over a string's characters five conversions per character.
fn unit_index_contract(
    b: &mut Body<'_, '_>,
    string: ValueId,
    index: ValueId,
) -> Result<(), Failure> {
    crate::arrays::within(b, index, false, |b| {
        b.load(string)?;
        call(b, Helper::Length)
    })?;
    crate::contract::require(b, "a character index outside the string")
}

pub(crate) fn binary(
    b: &mut Body<'_, '_>,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if !is_string(b.ty(lhs)) || !is_string(b.ty(rhs)) {
        return Err("string binary operands have differing logical types".into());
    }
    let helper = binary_helper(op)?;
    if !matches!(op, BinOp::Eq | BinOp::Ne) {
        crate::contract::nonnull(b, lhs, "a null string in a string operation")?;
        crate::contract::nonnull(b, rhs, "a null string in a string operation")?;
    }
    b.load(lhs)?;
    b.load(rhs)?;
    call(b, helper)?;
    match op {
        BinOp::Eq | BinOp::Concat => {}
        BinOp::Ne => b.instruction(&I::I32Eqz),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            b.instruction(&I::I32Const(0));
            b.instruction(&match op {
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

/// `s[i]` with an index the lowering did not prove: C's `nts_str_at`, which
/// stops by name unless `i` is a whole number inside the string. node answers
/// undefined for `s[1.7]` or `s[NaN]`, so neither is read as a character.
fn at(b: &mut Body<'_, '_>, string: ValueId, index: ValueId) -> Result<(), Failure> {
    if !is_string(b.ty(string)) {
        return Err(format!("an index into a {:?}", b.ty(string)).into());
    }
    crate::contract::nonnull(b, string, "a null string in a string operation")?;
    let number = |b: &mut Body<'_, '_>| -> Result<(), Failure> {
        b.load(index)?;
        numeric::convert(b, &b.ty(index).clone(), &HirType::NUMBER)
    };
    number(b)?;
    b.instructions(&[I::F64Const(0.0.into()), I::F64Ge]);
    number(b)?;
    number(b)?;
    b.instructions(&[I::F64Trunc, I::F64Eq, I::I32And]);
    number(b)?;
    b.load(string)?;
    call(b, Helper::Length)?;
    b.instructions(&[I::F64ConvertI32U, I::F64Lt, I::I32And]);
    crate::contract::require(
        b,
        "a string index outside the string, or not a whole number",
    )?;
    b.load(string)?;
    number(b)?;
    b.instruction(&I::I32TruncSatF64U);
    number(b)?;
    b.instructions(&[I::I32TruncSatF64U, I::I32Const(1), I::I32Add]);
    call(b, Helper::SubstringBuiltin)
}

pub(crate) fn runtime(
    b: &mut Body<'_, '_>,
    result: ValueId,
    helper: Helper,
    args: &[ValueId],
) -> Result<(), Failure> {
    let (params, output) = helper.signature();
    if args.len() != params.len() {
        return Err(format!("string helper {helper:?} arity mismatch").into());
    }
    if helper == Helper::At {
        return at(b, args[0], args[1]);
    }
    for (&arg, expected) in args.iter().zip(params) {
        if expected == STRING && helper != Helper::Equal {
            crate::contract::nonnull(b, arg, "a null string in a string operation")?;
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
        I32 if matches!(
            helper,
            Helper::Equal | Helper::StartsWith | Helper::EndsWith
        ) && b.ty(result) == &HirType::Bool => {}
        Physical::Reference(_) if is_string(b.ty(result)) => {}
        _ => {
            return Err(format!("string helper {helper:?} result {:?}", b.ty(result)).into());
        }
    }
    Ok(())
}

/// `ToIntegerOrInfinity` before testing bounds. NaN becomes zero, fractions
/// truncate, and infinities/huge indices stay outside the range until checked.
/// `startsWith` or `endsWith` of `(string, affix)`: false where the affix is
/// the longer, else whether each of its code units matches the string's at
/// the same place from the start, or from the end. A loop rather than
/// `equals` of a `substring`, which allocates a string for every call.
fn affix(helper: Helper, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let length = callee(m, Helper::Length)?;
    let unit = callee(m, Helper::Unit)?;
    // locals: 2 the affix's length, 3 the string's, 4 where the match starts
    // in the string, 5 the code unit compared
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32, ValType::I32]);
    f.instruction(&I::LocalGet(1));
    f.call(length);
    f.instruction(&I::LocalSet(2));
    f.instruction(&I::LocalGet(0));
    f.call(length);
    f.instructions(&[
        I::LocalSet(3),
        I::LocalGet(2),
        I::LocalGet(3),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
    ]);
    if helper == Helper::StartsWith {
        f.instruction(&I::I32Const(0));
    } else {
        f.instructions(&[I::LocalGet(3), I::LocalGet(2), I::I32Sub]);
    }
    f.instructions(&[
        I::LocalSet(4),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(5),
        I::LocalGet(2),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        I::LocalGet(4),
        I::LocalGet(5),
        I::I32Add,
    ]);
    f.call(unit);
    f.instructions(&[I::LocalGet(1), I::LocalGet(5)]);
    f.call(unit);
    f.instructions(&[
        I::I32Ne,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
        I::LocalGet(5),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(5),
        I::Br(0),
        I::End,
        I::End,
        I::I32Const(1),
        I::End,
    ]);
    Ok(f)
}

fn indexed(helper: Helper, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let char_at = helper == Helper::CharAt;
    let length = callee(m, Helper::Length)?;
    let mut f = Function::new([ValType::F64]);
    f.instructions(&[
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
    ]);
    f.call(length);
    f.instructions(&[
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
    ]);
    if char_at {
        let substring = callee(m, Helper::SubstringBuiltin)?;
        let empty = m.literal("");
        f.instructions(&[
            I::LocalGet(2),
            I::I32TruncSatF64U,
            I::I32Const(1),
            I::I32Add,
        ]);
        f.call(substring);
        f.instruction(&I::Else);
        f.global_get(empty);
    } else {
        let unit = callee(m, Helper::Unit)?;
        f.call(unit);
        f.instructions(&[I::F64ConvertI32U, I::Else, I::F64Const(f64::NAN.into())]);
    }
    f.instructions(&[I::End, I::End]);
    Ok(f)
}

fn substring(helper: Helper, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let slice = helper == Helper::Slice;
    let length = callee(m, Helper::Length)?;
    let builtin = callee(m, Helper::SubstringBuiltin)?;
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32, ValType::F64]);
    f.instruction(&I::LocalGet(0));
    f.call(length);
    f.instruction(&I::LocalSet(3));
    for (param, local) in [(1, 4), (2, 5)] {
        crate::indexing::clamp(&mut f, param, local, slice, 3, 6);
    }
    if !slice {
        f.instructions(&[
            I::LocalGet(4),
            I::LocalGet(5),
            I::I32GtU,
            I::If(BlockType::Empty),
            I::LocalGet(4),
            I::LocalGet(5),
            I::LocalSet(4),
            I::LocalSet(5),
            I::End,
        ]);
    }
    f.instructions(&[I::LocalGet(0), I::LocalGet(4), I::LocalGet(5)]);
    f.call(builtin);
    f.instruction(&I::End);
    Ok(f)
}

/// The 256 one-byte strings, U+0000 to U+00FF, as one immutable array built
/// once from imported string constants.
///
/// V8 answers `wasm:js-string`'s `fromCharCode` through its runtime every
/// time (`Runtime_WasmStringFromCodePoint`, then a single-character table
/// lookup), where JavaScript's own `String.fromCharCode` reads that table
/// inline. A UTF-8 decoder building its output a character at a time spent
/// 46% of its time there (`node-utf8`, 2026-10-16).
fn one_byte_strings(m: &mut Builder<'_>) -> Result<(Global, u32), Failure> {
    let ty = m
        .types
        .strings
        .ok_or_else(|| Failure::Invariant("the one-byte string table has no type".into()))?;
    let table = m.global(GlobalKey::OneByteStrings, |m| {
        let mut code = ir::Code::default();
        for unit in 0_u8..=u8::MAX {
            let literal = m.literal(&char::from(unit).to_string());
            code.global_get(literal);
        }
        code.instruction(&I::ArrayNewFixed {
            array_type_index: ty,
            array_size: 256,
        });
        Ok((crate::module::constant_type(ty), code))
    })?;
    Ok((table, ty))
}
