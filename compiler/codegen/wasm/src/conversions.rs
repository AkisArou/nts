//! An open value made a number (`nts_value_to_number`, and the explicit
//! `Number(value)` that also takes a bigint), and `Array.isArray` of one, as
//! the C runtime's.
//!
//! A number is itself, a boolean 0 or 1, a string what `Number` makes of it,
//! null 0 and undefined NaN, as C answers. A bigint implicitly converted is a
//! `TypeError` in node and refused by name, as C refuses; `Number(bigint)` is
//! its value. An object, a function or a symbol is refused by name where C
//! answers NaN: node calls an object's `valueOf` and `toString` (`Number([5])`
//! is 5) and throws for a symbol, so NaN would be a wrong answer.
use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    host,
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

const IMPLICIT_BIGINT: &str =
    "an implicit conversion of a bigint to a number, which is a TypeError";
const NOT_PRIMITIVE: &str =
    "a number from an object, a function or a symbol, which this runtime does not convert";

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    ToNumber,
    ToNumberExplicit,
    IsArray,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_value_to_number" => Op::ToNumber,
        "nts_value_to_number_explicit" => Op::ToNumberExplicit,
        "nts_is_array" => Op::IsArray,
        _ => return None,
    })
}

impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        matches!(self, Self::IsArray)
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let &[value] = args else {
        return Err(format!("{op:?} arity mismatch").into());
    };
    if b.ty(value) != &HirType::Erased {
        return Err(format!("{op:?} of a {:?}", b.ty(value)).into());
    }
    match op {
        Op::IsArray => {
            is_array(b, value)?;
            numeric::convert(b, &HirType::Bool, &b.ty(result).clone())
        }
        Op::ToNumber | Op::ToNumberExplicit => {
            let target = callee(b.m, op == Op::ToNumberExplicit)?;
            b.load(value)?;
            strings::constant(b, &b.func.name.clone());
            b.call(target);
            numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())
        }
    }
}

/// `Array.isArray` of an open value. An array's storage is one of the
/// program's array wrappers; a heterogeneous tuple is laid out as a struct and
/// the language calls it an Array too, so an object whose identity is a
/// tuple's answers `true` as well, as C's `NTS_KIND_TUPLE` does.
fn is_array(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    let wrappers: Vec<u32> = b.types().arrays.keys().copied().collect();
    let objects = &b.types().objects;
    let mut tuples = std::collections::BTreeSet::new();
    for descriptor in &objects.descriptors {
        if let Some(class) = descriptor.class
            && nts_core::hir::is_tuple_layout_name(
                &objects
                    .object(&HirType::Managed(nts_core::hir::ManagedType::Object(class)))?
                    .name,
            )
        {
            tuples.insert(descriptor.identity);
        }
    }
    b.instruction(&I::I32Const(0));
    for wrapper in wrappers {
        b.load(value)?;
        b.instructions(&[I::RefTestNonNull(HeapType::Concrete(wrapper)), I::I32Or]);
    }
    if tuples.is_empty() {
        return Ok(());
    }
    let tuple = tuple_test(b.m, tuples)?;
    b.load(value)?;
    b.call(tuple);
    b.instruction(&I::I32Or);
    Ok(())
}

/// `(value) -> i32`: whether an open value is an object whose identity is
/// one of `tuples`.
fn tuple_test(
    m: &mut Builder<'_>,
    tuples: std::collections::BTreeSet<u32>,
) -> Result<Func, Failure> {
    let root = m
        .types
        .root
        .ok_or_else(|| Failure::Invariant("a tuple with no object root".into()))?;
    m.helper(
        FuncKey::IsTuple,
        "value.isTuple",
        vec![Physical::Reference(RefType::ANYREF)],
        Some(Physical::Scalar(Slot::I32)),
        move |_| {
            // Params: value. Locals: its identity.
            let mut f = Function::new([ValType::I32]);
            f.instructions(&[
                I::LocalGet(0),
                I::RefTestNonNull(HeapType::Concrete(root.object)),
                I::I32Eqz,
                I::If(BlockType::Empty),
                I::I32Const(0),
                I::Return,
                I::End,
            ]);
            crate::objects::push_identity(&mut f, root, 0);
            f.instructions(&[I::LocalSet(1), I::I32Const(0)]);
            for identity in tuples {
                f.instructions(&[
                    I::LocalGet(1),
                    I::I32Const(identity.cast_signed()),
                    I::I32Eq,
                    I::I32Or,
                ]);
            }
            f.instruction(&I::End);
            Ok(f)
        },
    )
}

fn callee(m: &mut Builder<'_>, explicit: bool) -> Result<Func, Failure> {
    m.helper(
        FuncKey::ToNumber(explicit),
        if explicit {
            "value.toNumberExplicit"
        } else {
            "value.toNumber"
        },
        vec![Physical::Reference(RefType::ANYREF), strings::STRING],
        Some(Physical::Scalar(Slot::F64)),
        move |m| to_number(m, explicit),
    )
}

/// Params: value, name. Locals: tag.
fn to_number(m: &mut Builder<'_>, explicit: bool) -> Result<Function, Failure> {
    let tag = erased::callee(m, erased::Helper::Tag)?;
    let number = erased::callee(m, erased::Helper::Number)?;
    let boolean = erased::callee(m, erased::Helper::Boolean)?;
    let parse = host::external("nts_str_to_number")
        .ok_or_else(|| Failure::Invariant("string number service".into()))?
        .callee(m);
    let bigint = m.types.erased.and_then(|erased| erased.bigint);
    let mut f = Function::new([ValType::I32]);
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instruction(&I::LocalSet(2));
    let arm = |f: &mut Function, which: i32| {
        f.instructions(&[
            I::LocalGet(2),
            I::I32Const(which),
            I::I32Eq,
            I::If(BlockType::Empty),
        ]);
    };
    arm(&mut f, erased::NUMBER);
    f.instruction(&I::LocalGet(0));
    f.call(number);
    f.instructions(&[I::Return, I::End]);
    arm(&mut f, erased::BOOLEAN);
    f.instruction(&I::LocalGet(0));
    f.call(boolean);
    f.instructions(&[I::F64ConvertI32U, I::Return, I::End]);
    arm(&mut f, erased::STRING);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(&mut f);
    f.call(parse);
    f.instructions(&[I::Return, I::End]);
    arm(&mut f, erased::NULL);
    f.instructions(&[I::F64Const(0.0.into()), I::Return, I::End]);
    arm(&mut f, erased::UNDEFINED);
    f.instructions(&[I::F64Const(f64::NAN.into()), I::Return, I::End]);
    if let Some(boxed) = bigint {
        arm(&mut f, erased::BIGINT);
        if explicit {
            let value = crate::bigints::callee(m, crate::bigints::Helper::ToNumber)?;
            f.instructions(&[
                I::LocalGet(0),
                I::RefCastNonNull(HeapType::Concrete(boxed)),
                I::StructGet {
                    struct_type_index: boxed,
                    field_index: 1,
                },
            ]);
            f.call(value);
            f.instruction(&I::Return);
        } else {
            contract::refuse_in(&mut f, m, 1, IMPLICIT_BIGINT)?;
        }
        f.instruction(&I::End);
    }
    contract::refuse_in(&mut f, m, 1, NOT_PRIMITIVE)?;
    f.instruction(&I::End);
    Ok(f)
}
