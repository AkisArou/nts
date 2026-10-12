//! Closed array lookup contracts: numeric value, string value and GC identity.
use crate::{
    arrays,
    body::Body,
    contract, erased,
    error::Failure,
    gc,
    module::Symbols,
    numeric, objects, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, Function, HeapType, Instruction as I, RefType, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    At,
    AtValue,
    IndexOf,
    Includes,
    LastIndexOf,
    IndexOfStringValue,
    IncludesStringValue,
}
#[derive(Debug, Clone, Copy)]
enum Family {
    Number,
    Reference,
    String,
}
#[derive(Debug, Clone, Copy)]
pub(crate) struct Method {
    pub(crate) helper: Helper,
    family: Family,
}
pub(crate) fn external(name: &str) -> Option<Method> {
    use Family::{Number, Reference, String};
    use Helper::{
        At, AtValue, Includes, IncludesStringValue, IndexOf, IndexOfStringValue, LastIndexOf,
    };
    let (helper, family) = match name {
        "nts_array_at" => (At, Number),
        "nts_array_at_ref" => (At, Reference),
        // This suffix denotes a number-array result, not erased element storage.
        "nts_array_at_value" => (AtValue, Number),
        "nts_array_index_of" => (IndexOf, Number),
        "nts_array_includes" => (Includes, Number),
        "nts_array_last_index_of" => (LastIndexOf, Number),
        "nts_array_index_of_ref" => (IndexOf, Reference),
        "nts_array_includes_ref" => (Includes, Reference),
        "nts_array_index_of_str" => (IndexOf, String),
        "nts_array_includes_str" => (Includes, String),
        "nts_array_index_of_str_value" => (IndexOfStringValue, String),
        "nts_array_includes_str_value" => (IncludesStringValue, String),
        _ => return None,
    };
    Some(Method { helper, family })
}
impl Helper {
    pub(crate) fn indexed(self) -> bool {
        matches!(self, Self::At | Self::AtValue)
    }
    pub(crate) fn erased_needle(self) -> bool {
        matches!(self, Self::IndexOfStringValue | Self::IncludesStringValue)
    }
    fn boolean(self) -> bool {
        matches!(self, Self::Includes | Self::IncludesStringValue)
    }
    pub(crate) fn signature(
        self,
        shape: &gc::Array,
        symbols: &Symbols<'_>,
    ) -> Result<(Vec<Physical>, Physical), Failure> {
        let array = Physical::Reference(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(shape.wrapper),
        });
        let element = symbols.types.value_slot(&shape.element)?;
        let needle = if self.indexed() {
            Physical::Scalar(Slot::F64)
        } else if self.erased_needle() {
            Physical::Reference(RefType::ANYREF)
        } else {
            element
        };
        let output = match self {
            Self::At => element,
            Self::AtValue => Physical::Reference(RefType::ANYREF),
            Self::Includes | Self::IncludesStringValue => Physical::Scalar(Slot::I32),
            Self::IndexOf | Self::LastIndexOf | Self::IndexOfStringValue => {
                Physical::Scalar(Slot::F64)
            }
        };
        Ok((vec![array, needle, strings::STRING], output))
    }
}
pub(crate) fn call(
    b: &mut Body<'_>,
    result: ValueId,
    name: &str,
    method: Method,
    args: &[ValueId],
) -> Result<(), Failure> {
    inner(b, result, method, args).map_err(|error| match error {
        Failure::Unsupported(reason) => {
            Failure::Unsupported(format!("array helper `{name}`: {reason}"))
        }
        Failure::Invariant(reason) => Failure::Invariant(reason),
    })
}
fn inner(
    b: &mut Body<'_>,
    result: ValueId,
    method: Method,
    args: &[ValueId],
) -> Result<(), Failure> {
    if args.len() != 2 {
        return Err("lookup arity mismatch".into());
    }
    let helper = method.helper;
    let shape = b.symbols.types.array(b.ty(args[0]))?;
    let accepted = match method.family {
        Family::Number => shape.element == HirType::NUMBER,
        Family::String => strings::is_string(&shape.element),
        Family::Reference => {
            matches!(
                shape.element,
                HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_))
            ) || (helper.indexed() && strings::is_string(&shape.element))
        }
    };
    if !accepted {
        return Err(format!("lookup element {:?}", shape.element).into());
    }
    if helper.erased_needle() {
        if b.ty(args[1]) != &HirType::Erased {
            return Err("string-value lookup requires an erased needle".into());
        }
    } else if !helper.indexed() && b.ty(args[1]) != &shape.element {
        return Err("lookup needle changes element storage".into());
    }
    contract::nonnull(b, args[0])?;
    if !helper.indexed() && !helper.erased_needle() && !matches!(method.family, Family::Number) {
        contract::nonnull(b, args[1])?;
    }
    b.load(args[0])?;
    if helper.indexed() {
        arrays::number(b, args[1])?;
    } else {
        b.load(args[1])?;
    }
    strings::constant(b, &b.func.name.clone())?;
    let target = b
        .symbols
        .array_lookup
        .get(&(shape.wrapper, helper))
        .ok_or_else(|| Failure::Invariant("unplanned array lookup helper".into()))?;
    b.ins(&I::Call(*target));
    let actual = if helper == Helper::At {
        shape.element.clone()
    } else if helper == Helper::AtValue {
        HirType::Erased
    } else if helper.boolean() {
        HirType::Bool
    } else {
        HirType::NUMBER
    };
    if b.ty(result) == &HirType::Void {
        b.ins(&I::Drop);
        Ok(())
    } else if actual == HirType::NUMBER {
        numeric::convert(b, &actual, &b.ty(result).clone())
    } else {
        objects::adapt(b, &actual, &b.ty(result).clone())
    }
}
fn ins(f: &mut Function, code: &[I<'_>]) {
    for i in code {
        f.instruction(i);
    }
}
fn length(f: &mut Function, shape: &gc::Array) {
    ins(
        f,
        &[
            I::LocalGet(0),
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: 1,
            },
            I::LocalSet(3),
        ],
    );
}
fn get(f: &mut Function, shape: &gc::Array, index: &[I<'_>]) -> Result<(), Failure> {
    ins(
        f,
        &[
            I::LocalGet(0),
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: 2,
            },
        ],
    );
    ins(f, index);
    f.instruction(&arrays::get_instruction(shape)?);
    Ok(())
}
/// A helper consumes a validity condition and the caller's diagnostic name.
fn require(f: &mut Function, symbols: &Symbols<'_>) -> Result<(), Failure> {
    let target = symbols
        .input_decline
        .ok_or_else(|| Failure::Invariant("unplanned array lookup diagnostic".into()))?;
    ins(
        f,
        &[
            I::I32Eqz,
            I::If(BlockType::Empty),
            I::LocalGet(2),
            I::Call(target),
            I::Unreachable,
            I::End,
        ],
    );
    Ok(())
}
pub(crate) fn body(
    helper: Helper,
    shape: &gc::Array,
    symbols: &Symbols<'_>,
) -> Result<Function, Failure> {
    if helper.indexed() {
        indexed(helper, shape, symbols)
    } else {
        search(helper, shape, symbols)
    }
}
fn indexed(helper: Helper, shape: &gc::Array, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let mut f = Function::new_with_locals_types([ValType::I32, ValType::F64]);
    length(&mut f, shape);
    crate::indexing::integer(&mut f, 1);
    ins(
        &mut f,
        &[
            I::LocalTee(4),
            I::F64Const(0.0.into()),
            I::F64Lt,
            I::If(BlockType::Empty),
            I::LocalGet(3),
            I::F64ConvertI32U,
            I::LocalGet(4),
            I::F64Add,
            I::LocalSet(4),
            I::End,
            I::LocalGet(4),
            I::F64Const(0.0.into()),
            I::F64Ge,
            I::LocalGet(4),
            I::LocalGet(3),
            I::F64ConvertI32U,
            I::F64Lt,
            I::I32And,
        ],
    );
    if helper == Helper::AtValue {
        f.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    } else {
        require(&mut f, symbols)?;
    }
    get(&mut f, shape, &[I::LocalGet(4), I::I32TruncSatF64U])?;
    if helper == Helper::AtValue {
        ins(
            &mut f,
            &[
                I::Call(erased::callee(symbols, erased::Helper::BoxNumber)?),
                I::Else,
                I::GlobalGet(erased::values(symbols)?.for_tag(erased::UNDEFINED)?),
                I::End,
            ],
        );
    }
    f.instruction(&I::End);
    Ok(f)
}
fn search(helper: Helper, shape: &gc::Array, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let element = symbols.types.value_slot(&shape.element)?.wasm();
    // Params: array, needle, diagnostic name. Locals: length, step, index,
    // element, projected string needle, string-tag validity.
    let mut f = Function::new_with_locals_types([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        element,
        ValType::Ref(RefType::EXTERNREF),
        ValType::I32,
    ]);
    length(&mut f, shape);
    if strings::is_string(&shape.element) {
        string_needle(&mut f, helper, symbols)?;
    }
    ins(
        &mut f,
        &[
            I::Block(BlockType::Empty),
            I::Loop(BlockType::Empty),
            I::LocalGet(4),
            I::LocalGet(3),
            I::I32GeU,
            I::BrIf(1),
        ],
    );
    if helper == Helper::LastIndexOf {
        ins(
            &mut f,
            &[
                I::LocalGet(3),
                I::I32Const(1),
                I::I32Sub,
                I::LocalGet(4),
                I::I32Sub,
            ],
        );
    } else {
        f.instruction(&I::LocalGet(4));
    }
    f.instruction(&I::LocalSet(5));
    get(&mut f, shape, &[I::LocalGet(5)])?;
    f.instruction(&I::LocalSet(6));
    equal(&mut f, helper, shape, symbols)?;
    f.instruction(&I::If(BlockType::Empty));
    if helper.boolean() {
        f.instruction(&I::I32Const(1));
    } else {
        ins(&mut f, &[I::LocalGet(5), I::F64ConvertI32U]);
    }
    ins(
        &mut f,
        &[
            I::Return,
            I::End,
            I::LocalGet(4),
            I::I32Const(1),
            I::I32Add,
            I::LocalSet(4),
            I::Br(0),
            I::End,
            I::End,
        ],
    );
    f.instruction(&if helper.boolean() {
        I::I32Const(0)
    } else {
        I::F64Const((-1.0).into())
    });
    f.instruction(&I::End);
    Ok(f)
}
fn string_needle(f: &mut Function, helper: Helper, symbols: &Symbols<'_>) -> Result<(), Failure> {
    if helper.erased_needle() {
        let types = symbols
            .types
            .erased
            .ok_or_else(|| Failure::Invariant("unplanned string needle types".into()))?;
        ins(
            f,
            &[
                I::LocalGet(1),
                I::Call(erased::callee(symbols, erased::Helper::Tag)?),
                I::I32Const(erased::STRING),
                I::I32Eq,
                I::LocalTee(8),
                I::If(BlockType::Empty),
                I::LocalGet(1),
                I::RefCastNonNull(HeapType::Concrete(types.string)),
                I::StructGet {
                    struct_type_index: types.string,
                    field_index: 1,
                },
                I::LocalSet(7),
                I::End,
            ],
        );
    } else {
        ins(
            f,
            &[
                I::LocalGet(1),
                I::LocalSet(7),
                I::I32Const(1),
                I::LocalSet(8),
            ],
        );
    }
    Ok(())
}
fn equal(
    f: &mut Function,
    helper: Helper,
    shape: &gc::Array,
    symbols: &Symbols<'_>,
) -> Result<(), Failure> {
    if shape.element == HirType::NUMBER {
        ins(f, &[I::LocalGet(6), I::LocalGet(1), I::F64Eq]);
        if helper.boolean() {
            ins(
                f,
                &[
                    I::LocalGet(6),
                    I::LocalGet(6),
                    I::F64Ne,
                    I::LocalGet(1),
                    I::LocalGet(1),
                    I::F64Ne,
                    I::I32And,
                    I::I32Or,
                ],
            );
        }
    } else if strings::is_string(&shape.element) {
        // Nullable string storage cannot distinguish a hole, undefined and
        // null. Refuse those observations rather than inventing presence bits.
        ins(f, &[I::LocalGet(6), I::RefIsNull, I::I32Eqz]);
        require(f, symbols)?;
        ins(
            f,
            &[
                I::LocalGet(8),
                I::If(BlockType::Result(ValType::I32)),
                I::LocalGet(6),
                I::LocalGet(7),
                I::Call(strings::callee(symbols, strings::Helper::Equal)?),
                I::Else,
                I::I32Const(0),
                I::End,
            ],
        );
    } else {
        ins(f, &[I::LocalGet(6), I::LocalGet(1), I::RefEq]);
    }
    Ok(())
}
