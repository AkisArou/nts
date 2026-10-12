//! Tag-guarded erased operations. No allocation is needed for typed equality.

use crate::{
    body::Body,
    erased::{self, BOOLEAN, Helper, NULL, NUMBER, STRING, UNDEFINED},
    error::Failure,
    gc::ErasedTypes,
    module::Symbols,
    numeric, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{BinOp, HirType, ManagedType, UnOp, ValueId};
use wasm_encoder::{BlockType, Function, HeapType, Instruction as I, RefType, ValType};

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
        _ => None,
    }
}

pub(crate) fn runtime(
    b: &mut Body<'_>,
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
    b: &mut Body<'_>,
    result: ValueId,
    op: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Result<(), Failure> {
    if !matches!(op, BinOp::Eq | BinOp::Ne) {
        return Err(format!("erased binary {op:?}").into());
    }
    let (helper, swap) = equality_helper(b.ty(lhs), b.ty(rhs))
        .ok_or_else(|| Failure::Unsupported("erased equality with this typed operand".into()))?;
    let args = if swap { [rhs, lhs] } else { [lhs, rhs] };
    runtime(b, result, helper, &args)?;
    if op == BinOp::Ne {
        b.ins(&I::I32Eqz);
    }
    Ok(())
}
pub(crate) fn truthy(b: &mut Body<'_>, op: UnOp, value: ValueId) -> Result<(), Failure> {
    if !matches!(op, UnOp::Truthy | UnOp::Not) {
        return Err(format!("erased unary {op:?}").into());
    }
    b.load(value)?;
    erased::call(b, Helper::Truthy)?;
    if op == UnOp::Not {
        b.ins(&I::I32Eqz);
    }
    Ok(())
}

pub(crate) fn body(
    helper: Helper,
    symbols: &Symbols<'_>,
    types: ErasedTypes,
) -> Result<Function, Failure> {
    match helper {
        Helper::BoxBoolean => {
            let globals = erased::values(symbols)?;
            let mut f = Function::new([]);
            instructions(
                &mut f,
                &[
                    I::LocalGet(0),
                    I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))),
                    I::GlobalGet(globals.boolean(true)),
                    I::Else,
                    I::GlobalGet(globals.boolean(false)),
                    I::End,
                    I::End,
                ],
            );
            Ok(f)
        }
        Helper::Boolean => {
            let mut f = Function::new([]);
            payload(&mut f, 0, types.boolean);
            f.instruction(&I::End);
            Ok(f)
        }
        Helper::Truthy => truthiness(symbols, types),
        Helper::Equal => equality(symbols, types),
        Helper::EqualNumber | Helper::EqualBoolean | Helper::EqualString => {
            typed_equality(helper, symbols, types)
        }
        Helper::BoxNumber | Helper::Number | Helper::Tag => Err(Failure::Invariant(format!(
            "primitive helper {helper:?} routed to operators"
        ))),
    }
}
fn instructions(f: &mut Function, code: &[I<'_>]) {
    for i in code {
        f.instruction(i);
    }
}
fn payload(f: &mut Function, local: u32, ty: u32) {
    instructions(
        f,
        &[
            I::LocalGet(local),
            I::RefCastNonNull(HeapType::Concrete(ty)),
            I::StructGet {
                struct_type_index: ty,
                field_index: 1,
            },
        ],
    );
}
fn when_tag(f: &mut Function, local: u32, tag: i32) {
    instructions(
        f,
        &[
            I::LocalGet(local),
            I::I32Const(tag),
            I::I32Eq,
            I::If(BlockType::Empty),
        ],
    );
}
fn equality(symbols: &Symbols<'_>, types: ErasedTypes) -> Result<Function, Failure> {
    let tag = erased::callee(symbols, Helper::Tag)?;
    let number = erased::callee(symbols, Helper::Number)?;
    let string_eq = strings::callee(symbols, strings::Helper::Equal)?;
    let mut f = Function::new_with_locals_types([ValType::I32]);
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::Call(tag),
            I::LocalTee(2),
            I::LocalGet(1),
            I::Call(tag),
            I::I32Ne,
            I::If(BlockType::Empty),
            I::I32Const(0),
            I::Return,
            I::End,
        ],
    );
    when_tag(&mut f, 2, NUMBER);
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::Call(number),
            I::LocalGet(1),
            I::Call(number),
            I::F64Eq,
            I::Return,
            I::End,
        ],
    );
    when_tag(&mut f, 2, STRING);
    payload(&mut f, 0, types.string);
    payload(&mut f, 1, types.string);
    instructions(&mut f, &[I::Call(string_eq), I::Return, I::End]);
    when_tag(&mut f, 2, BOOLEAN);
    payload(&mut f, 0, types.boolean);
    payload(&mut f, 1, types.boolean);
    instructions(&mut f, &[I::I32Eq, I::Return, I::End]);
    // The remaining admitted tags are the two unique absence singletons.
    // Object/function identity will use this same reference comparison.
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::RefCastNullable(RefType::EQREF.heap_type),
            I::LocalGet(1),
            I::RefCastNullable(RefType::EQREF.heap_type),
            I::RefEq,
            I::End,
        ],
    );
    Ok(f)
}
fn typed_equality(
    helper: Helper,
    symbols: &Symbols<'_>,
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
    let mut f = Function::new([]);
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::Call(erased::callee(symbols, Helper::Tag)?),
            I::I32Const(expected),
            I::I32Eq,
            I::If(BlockType::Result(ValType::I32)),
        ],
    );
    match helper {
        Helper::EqualNumber => instructions(
            &mut f,
            &[
                I::LocalGet(0),
                I::Call(erased::callee(symbols, Helper::Number)?),
                I::LocalGet(1),
                I::F64Eq,
            ],
        ),
        Helper::EqualBoolean => {
            payload(&mut f, 0, types.boolean);
            instructions(&mut f, &[I::LocalGet(1), I::I32Eq]);
        }
        Helper::EqualString => {
            payload(&mut f, 0, types.string);
            instructions(
                &mut f,
                &[
                    I::LocalGet(1),
                    I::Call(strings::callee(symbols, strings::Helper::Equal)?),
                ],
            );
        }
        _ => {
            return Err(Failure::Invariant(format!(
                "non-typed equality helper {helper:?}"
            )));
        }
    }
    instructions(&mut f, &[I::Else, I::I32Const(0), I::End, I::End]);
    Ok(f)
}
fn truthiness(symbols: &Symbols<'_>, types: ErasedTypes) -> Result<Function, Failure> {
    let mut f = Function::new_with_locals_types([ValType::I32, ValType::F64]);
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::Call(erased::callee(symbols, Helper::Tag)?),
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
        ],
    );
    when_tag(&mut f, 1, BOOLEAN);
    payload(&mut f, 0, types.boolean);
    instructions(&mut f, &[I::Return, I::End]);
    when_tag(&mut f, 1, NUMBER);
    instructions(
        &mut f,
        &[
            I::LocalGet(0),
            I::Call(erased::callee(symbols, Helper::Number)?),
            I::LocalTee(2),
            I::F64Const(0.0.into()),
            I::F64Ne,
            I::LocalGet(2),
            I::LocalGet(2),
            I::F64Eq,
            I::I32And,
            I::Return,
            I::End,
        ],
    );
    when_tag(&mut f, 1, STRING);
    payload(&mut f, 0, types.string);
    instructions(
        &mut f,
        &[
            I::RefIsNull,
            I::If(BlockType::Result(ValType::I32)),
            I::I32Const(0),
            I::Else,
        ],
    );
    payload(&mut f, 0, types.string);
    instructions(
        &mut f,
        &[
            I::Call(strings::callee(symbols, strings::Helper::Length)?),
            I::I32Eqz,
            I::I32Eqz,
            I::End,
            I::Return,
            I::End,
            I::LocalGet(0),
            I::RefIsNull,
            I::I32Eqz,
            I::End,
        ],
    );
    Ok(f)
}
