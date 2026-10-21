//! Tag-guarded erased operations. No allocation is needed for typed equality.

use crate::{
    body::Body,
    erased::{self, BOOLEAN, Helper, NULL, NUMBER, STRING, UNDEFINED},
    error::Failure,
    gc::ErasedTypes,
    ir::Function,
    module::Builder,
    numeric, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

#[derive(Clone, Copy)]
enum Value {
    Erased,
    Number,
    Boolean,
    String,
    Tag,
}
impl Value {
    fn physical(self) -> Physical {
        match self {
            Self::Erased => Physical::Reference(RefType::ANYREF),
            Self::Number => Physical::Scalar(Slot::F64),
            Self::Boolean | Self::Tag => Physical::Scalar(Slot::I32),
            Self::String => strings::STRING,
        }
    }
    fn logical(self) -> HirType {
        match self {
            Self::Erased => HirType::Erased,
            Self::Number => HirType::NUMBER,
            Self::Boolean => HirType::Bool,
            Self::String => HirType::Managed(ManagedType::String),
            Self::Tag => HirType::Int {
                bits: 32,
                signed: false,
            },
        }
    }
}
impl Helper {
    fn contract(self) -> (&'static [Value], Value) {
        use Value::{Boolean, Erased, Number, String, Tag};
        match self {
            Self::BoxNumber => (&[Number], Erased),
            Self::Number => (&[Erased], Number),
            Self::Tag => (&[Erased], Tag),
            Self::BoxBoolean => (&[Boolean], Erased),
            Self::Boolean | Self::Truthy => (&[Erased], Boolean),
            Self::Equal => (&[Erased, Erased], Boolean),
            Self::EqualNumber => (&[Erased, Number], Boolean),
            Self::EqualBoolean => (&[Erased, Boolean], Boolean),
            Self::EqualString => (&[Erased, String], Boolean),
            Self::NumberOr => (&[Erased, Number], Number),
        }
    }
    pub(crate) fn signature(self) -> (Vec<Physical>, Physical) {
        let (params, result) = self.contract();
        (
            params.iter().map(|ty| ty.physical()).collect(),
            result.physical(),
        )
    }
}

/// Unknown names reach Body's named refusal; aliases here have the same contract.
pub(crate) fn external(name: &str) -> Option<Helper> {
    match name {
        "nts_value_of_number" => Some(Helper::BoxNumber),
        "nts_value_number" => Some(Helper::Number),
        "nts_value_tag" => Some(Helper::Tag),
        "nts_value_of_boolean" => Some(Helper::BoxBoolean),
        "nts_value_boolean" => Some(Helper::Boolean),
        "nts_value_truthy" | "nts_value_truthy_fn" => Some(Helper::Truthy),
        "nts_value_strict_eq" => Some(Helper::Equal),
        "nts_value_eq_number" | "nts_value_eq_number_fn" => Some(Helper::EqualNumber),
        "nts_value_eq_boolean" | "nts_value_eq_boolean_fn" => Some(Helper::EqualBoolean),
        "nts_value_eq_string" => Some(Helper::EqualString),
        "nts_value_number_or" => Some(Helper::NumberOr),
        _ => None,
    }
}

pub(crate) fn runtime(
    b: &mut Body<'_, '_>,
    result: ValueId,
    helper: Helper,
    args: &[ValueId],
) -> Result<(), Failure> {
    let (params, output) = helper.contract();
    if args.len() != params.len() {
        return Err(format!("erased helper {helper:?} arity mismatch").into());
    }
    for (&arg, expected) in args.iter().zip(params) {
        let logical = expected.logical();
        b.load(arg)?;
        if matches!(expected, Value::Number | Value::Tag) {
            numeric::convert(b, &b.ty(arg).clone(), &logical)?;
        } else if b.ty(arg) != &logical {
            return Err(format!("erased helper {helper:?} expects {logical:?}").into());
        }
    }
    // Equality helpers guard their own tags before projecting a payload.
    if matches!(helper, Helper::Number | Helper::Boolean) {
        b.instruction(&I::Drop);
        let types = b
            .types()
            .erased
            .ok_or_else(|| Failure::Invariant("unplanned erased projection".into()))?;
        let (cases, why) = if helper == Helper::Number {
            (
                vec![HeapType::I31, HeapType::Concrete(types.number)],
                "an erased value read as a number, which it is not",
            )
        } else {
            (
                vec![HeapType::Concrete(types.boolean)],
                "an erased value read as a boolean, which it is not",
            )
        };
        erased::projection_guard(b, args[0], &cases, why)?;
        b.load(args[0])?;
    }
    erased::call(b, helper)?;
    let logical = output.logical();
    if matches!(output, Value::Number | Value::Tag) {
        numeric::convert(b, &logical, &b.ty(result).clone())?;
    } else if b.ty(result) != &logical {
        return Err(format!("erased helper {helper:?} result {:?}", b.ty(result)).into());
    }
    Ok(())
}

pub(crate) fn equality_helper(lhs: &HirType, rhs: &HirType) -> Option<(Helper, bool)> {
    let (other, swap) = if lhs == &HirType::Erased {
        (rhs, false)
    } else if rhs == &HirType::Erased {
        (lhs, true)
    } else {
        return None;
    };
    let helper = match other {
        HirType::Erased => Helper::Equal,
        HirType::Bool => Helper::EqualBoolean,
        HirType::Int { .. } | HirType::Float { .. } => Helper::EqualNumber,
        HirType::Managed(ManagedType::String) => Helper::EqualString,
        HirType::Managed(_)
        | HirType::Void
        | HirType::Never
        | HirType::BigInt
        | HirType::NativePointer(_) => return None,
    };
    Some((helper, swap))
}

pub(crate) fn binary(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if !matches!(op, BinOp::Eq | BinOp::Ne) {
        return Err(format!("erased binary {op:?}").into());
    }
    let typed = |value| crate::objects::is_reference(b.ty(value));
    if typed(lhs) || typed(rhs) {
        let (erased, reference) = if typed(rhs) { (lhs, rhs) } else { (rhs, lhs) };
        reference_equality(b, erased, reference)?;
        if op == BinOp::Ne {
            b.instruction(&I::I32Eqz);
        }
        return Ok(());
    }
    let (helper, swap) = equality_helper(b.ty(lhs), b.ty(rhs))
        .ok_or_else(|| Failure::Unsupported("erased equality with this typed operand".into()))?;
    let args = if swap { [rhs, lhs] } else { [lhs, rhs] };
    runtime(b, result, helper, &args)?;
    if op == BinOp::Ne {
        b.instruction(&I::I32Eqz);
    }
    Ok(())
}
/// An erased value `===` a typed reference: the same object or not. Every
/// object, array, collection, promise and view is in `eq`, and nothing else an
/// erased value holds is that object. A typed reference's null does not say
/// whether it stands for undefined or for null, so comparing one is refused.
fn reference_equality(
    b: &mut Body<'_, '_>,
    erased: ValueId,
    reference: ValueId,
) -> Result<(), Failure> {
    if b.ty(erased) != &HirType::Erased {
        return Err(Failure::Invariant(
            "reference equality without an erased side".into(),
        ));
    }
    crate::contract::nonnull(
        b,
        reference,
        "an erased value compared with a null reference, which may stand for undefined or for null",
    )?;
    b.load(erased)?;
    b.instructions(&[
        I::RefTestNonNull(RefType::EQREF.heap_type),
        I::If(BlockType::Result(ValType::I32)),
    ]);
    b.load(erased)?;
    b.instruction(&I::RefCastNonNull(RefType::EQREF.heap_type));
    b.load(reference)?;
    b.instructions(&[I::RefEq, I::Else, I::I32Const(0), I::End]);
    Ok(())
}
pub(crate) fn truthy(b: &mut Body<'_, '_>, op: UnOp, value: ValueId) -> Result<(), Failure> {
    if !matches!(op, UnOp::Truthy | UnOp::Not) {
        return Err(format!("erased unary {op:?}").into());
    }
    if let Some(map) = b.typed_get(value) {
        return crate::collections::typed_truthy(b, op, value, map);
    }
    b.load(value)?;
    erased::call(b, Helper::Truthy)?;
    if op == UnOp::Not {
        b.instruction(&I::I32Eqz);
    }
    Ok(())
}

pub(crate) fn body(
    helper: Helper,
    m: &mut Builder<'_>,
    types: ErasedTypes,
) -> Result<Function, Failure> {
    match helper {
        Helper::BoxBoolean => {
            let yes = erased::singleton(m, erased::Singleton::True)?;
            let no = erased::singleton(m, erased::Singleton::False)?;
            let mut f = Function::default();
            f.instructions(&[
                I::LocalGet(0),
                I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))),
            ]);
            f.global_get(yes);
            f.instruction(&I::Else);
            f.global_get(no);
            f.instructions(&[I::End, I::End]);
            Ok(f)
        }
        Helper::Boolean => {
            let mut f = Function::default();
            payload(&mut f, 0, types.boolean);
            f.instruction(&I::End);
            Ok(f)
        }
        Helper::Truthy => truthiness(m, types),
        Helper::Equal => equality(m, types),
        Helper::EqualNumber | Helper::EqualBoolean | Helper::EqualString => {
            typed_equality(helper, m, types)
        }
        Helper::NumberOr => number_or(m, types),
        Helper::BoxNumber | Helper::Number | Helper::Tag => Err(Failure::Invariant(format!(
            "primitive helper {helper:?} routed to operators"
        ))),
    }
}
/// C's `nts_value_number_or`: the fallback for undefined and null, a number
/// as itself, a boolean as 1 or 0, and NaN for anything else, as C answers.
///
/// Params: value, fallback. Locals: tag.
fn number_or(m: &mut Builder<'_>, types: ErasedTypes) -> Result<Function, Failure> {
    let tag = erased::callee(m, Helper::Tag)?;
    let number = erased::callee(m, Helper::Number)?;
    let mut f = Function::new([ValType::I32]);
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instructions(&[
        I::LocalSet(2),
        I::LocalGet(2),
        I::I32Const(UNDEFINED),
        I::I32Eq,
        I::LocalGet(2),
        I::I32Const(NULL),
        I::I32Eq,
        I::I32Or,
        I::If(BlockType::Empty),
        I::LocalGet(1),
        I::Return,
        I::End,
        I::LocalGet(2),
        I::I32Const(NUMBER),
        I::I32Eq,
        I::If(BlockType::Empty),
        I::LocalGet(0),
    ]);
    f.call(number);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(2),
        I::I32Const(BOOLEAN),
        I::I32Eq,
        I::If(BlockType::Empty),
    ]);
    payload(&mut f, 0, types.boolean);
    f.instructions(&[
        I::F64ConvertI32U,
        I::Return,
        I::End,
        I::F64Const(f64::NAN.into()),
        I::End,
    ]);
    Ok(f)
}
fn payload(f: &mut Function, local: u32, ty: u32) {
    f.instructions(&[
        I::LocalGet(local),
        I::RefCastNonNull(HeapType::Concrete(ty)),
        I::StructGet {
            struct_type_index: ty,
            field_index: 1,
        },
    ]);
}
fn when_tag(f: &mut Function, local: u32, tag: i32) {
    f.instructions(&[
        I::LocalGet(local),
        I::I32Const(tag),
        I::I32Eq,
        I::If(BlockType::Empty),
    ]);
}
fn equality(m: &mut Builder<'_>, types: ErasedTypes) -> Result<Function, Failure> {
    let tag = erased::callee(m, Helper::Tag)?;
    let number = erased::callee(m, Helper::Number)?;
    let string_eq = strings::callee(m, strings::Helper::Equal)?;
    let mut f = Function::new([ValType::I32]);
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instructions(&[I::LocalTee(2), I::LocalGet(1)]);
    f.call(tag);
    f.instructions(&[
        I::I32Ne,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
    ]);
    when_tag(&mut f, 2, NUMBER);
    f.instruction(&I::LocalGet(0));
    f.call(number);
    f.instruction(&I::LocalGet(1));
    f.call(number);
    f.instructions(&[I::F64Eq, I::Return, I::End]);
    when_tag(&mut f, 2, STRING);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(&mut f);
    f.instruction(&I::LocalGet(1));
    erased::string_payload(&mut f);
    f.call(string_eq);
    f.instructions(&[I::Return, I::End]);
    when_tag(&mut f, 2, BOOLEAN);
    payload(&mut f, 0, types.boolean);
    payload(&mut f, 1, types.boolean);
    f.instructions(&[I::I32Eq, I::Return, I::End]);
    // Two bigints are equal by value, not by box.
    if let Some(bigint) = types.bigint {
        when_tag(&mut f, 2, erased::BIGINT);
        payload(&mut f, 0, bigint);
        payload(&mut f, 1, bigint);
        f.instructions(&[I::I64x2Eq, I::I64x2AllTrue, I::Return, I::End]);
    }
    // The remaining admitted tags are the two unique absence singletons.
    // Object/function identity will use this same reference comparison.
    f.instructions(&[
        I::LocalGet(0),
        I::RefCastNullable(RefType::EQREF.heap_type),
        I::LocalGet(1),
        I::RefCastNullable(RefType::EQREF.heap_type),
        I::RefEq,
        I::End,
    ]);
    Ok(f)
}
fn typed_equality(
    helper: Helper,
    m: &mut Builder<'_>,
    types: ErasedTypes,
) -> Result<Function, Failure> {
    let expected = match helper {
        Helper::EqualNumber => NUMBER,
        Helper::EqualBoolean => BOOLEAN,
        Helper::EqualString => STRING,
        _ => {
            return Err(Failure::Invariant(format!(
                "non-typed equality helper {helper:?}"
            )));
        }
    };
    let tag = erased::callee(m, Helper::Tag)?;
    let mut f = Function::default();
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instructions(&[
        I::I32Const(expected),
        I::I32Eq,
        I::If(BlockType::Result(ValType::I32)),
    ]);
    match helper {
        Helper::EqualNumber => {
            let number = erased::callee(m, Helper::Number)?;
            f.instruction(&I::LocalGet(0));
            f.call(number);
            f.instructions(&[I::LocalGet(1), I::F64Eq]);
        }
        Helper::EqualBoolean => {
            payload(&mut f, 0, types.boolean);
            f.instructions(&[I::LocalGet(1), I::I32Eq]);
        }
        Helper::EqualString => {
            let equal = strings::callee(m, strings::Helper::Equal)?;
            f.instruction(&I::LocalGet(0));
            erased::string_payload(&mut f);
            f.instruction(&I::LocalGet(1));
            f.call(equal);
        }
        _ => {
            return Err(Failure::Invariant(format!(
                "non-typed equality helper {helper:?}"
            )));
        }
    }
    f.instructions(&[I::Else, I::I32Const(0), I::End, I::End]);
    Ok(f)
}
fn truthiness(m: &mut Builder<'_>, types: ErasedTypes) -> Result<Function, Failure> {
    let tag = erased::callee(m, Helper::Tag)?;
    let number = erased::callee(m, Helper::Number)?;
    let length = strings::callee(m, strings::Helper::Length)?;
    let mut f = Function::new([ValType::I32, ValType::F64]);
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instructions(&[
        I::LocalSet(1),
        I::LocalGet(1),
        I::I32Const(UNDEFINED),
        I::I32Eq,
        I::LocalGet(1),
        I::I32Const(NULL),
        I::I32Eq,
        I::I32Or,
        I::If(BlockType::Empty),
        I::I32Const(0),
        I::Return,
        I::End,
    ]);
    when_tag(&mut f, 1, BOOLEAN);
    payload(&mut f, 0, types.boolean);
    f.instructions(&[I::Return, I::End]);
    // A bigint is false only at zero.
    if let Some(bigint) = types.bigint {
        when_tag(&mut f, 1, erased::BIGINT);
        payload(&mut f, 0, bigint);
        f.instructions(&[I::V128AnyTrue, I::Return, I::End]);
    }
    when_tag(&mut f, 1, NUMBER);
    f.instruction(&I::LocalGet(0));
    f.call(number);
    f.instructions(&[
        I::LocalTee(2),
        I::F64Const(0.0.into()),
        I::F64Ne,
        I::LocalGet(2),
        I::LocalGet(2),
        I::F64Eq,
        I::I32And,
        I::Return,
        I::End,
    ]);
    when_tag(&mut f, 1, STRING);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(&mut f);
    f.instructions(&[
        I::RefIsNull,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(0),
        I::Else,
    ]);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(&mut f);
    f.call(length);
    f.instructions(&[
        I::I32Eqz,
        I::I32Eqz,
        I::End,
        I::Return,
        I::End,
        I::LocalGet(0),
        I::RefIsNull,
        I::I32Eqz,
        I::End,
    ]);
    Ok(f)
}
