//! Closed array helper contracts over the same identity-preserving wrappers.

use crate::{arrays, body::Body, contract, erased, error::Failure, gc, numeric, objects};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, Instruction as I};

const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Family {
    Number,
    Boolean,
    Reference,
    Value,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Method {
    Push(Family),
    Pop(Family),
    Fill(Family),
    Truncate(Family),
    KeepFirst,
}

pub(crate) fn external(name: &str) -> Option<Method> {
    use Family::{Boolean, Number, Reference, Value};
    use Method::{Fill, Pop, Push, Truncate};
    match name {
        "nts_array_push" => Some(Push(Number)),
        "nts_array_push_ref" => Some(Push(Reference)),
        "nts_array_push_value" => Some(Push(Value)),
        "nts_array_pop" => Some(Pop(Number)),
        "nts_array_pop_ref" => Some(Pop(Reference)),
        // This suffix names the result, unlike push/set_length_value. The
        // shared header explicitly specifies a number array, not an erased one.
        "nts_array_pop_value" => Some(Pop(Value)),
        "nts_array_fill" => Some(Fill(Number)),
        "nts_array_fill_bool" => Some(Fill(Boolean)),
        "nts_array_fill_ref" => Some(Fill(Reference)),
        "nts_array_set_length" => Some(Truncate(Number)),
        "nts_array_keep_first" => Some(Method::KeepFirst),
        "nts_array_set_length_ref" => Some(Truncate(Reference)),
        "nts_array_set_length_value" => Some(Truncate(Value)),
        _ => None,
    }
}
impl Method {
    pub(crate) fn grows(self) -> bool {
        matches!(self, Self::Push(_))
    }
    pub(crate) fn boxes_number(self) -> bool {
        self == Self::Pop(Family::Value)
    }
    pub(crate) fn initializes(self) -> bool {
        matches!(self, Self::Fill(_))
    }
    pub(crate) fn truncates(self) -> bool {
        matches!(self, Self::Truncate(_) | Self::KeepFirst)
    }
    fn accepts(self, element: &HirType) -> bool {
        let family = match self {
            Self::KeepFirst => return true, // Header contract is descriptor-width generic.
            Self::Push(f) | Self::Pop(f) | Self::Fill(f) | Self::Truncate(f) => f,
        };
        match family {
            Family::Number if self.truncates() => element.is_scalar(),
            Family::Number => element == &HirType::NUMBER,
            Family::Boolean => element == &HirType::Bool,
            Family::Reference => matches!(
                element,
                HirType::Managed(
                    ManagedType::String | ManagedType::Object(_) | ManagedType::Array(_)
                )
            ),
            Family::Value if self.boxes_number() => element == &HirType::NUMBER,
            Family::Value => element == &HirType::Erased,
        }
    }
}

pub(crate) fn call(
    b: &mut Body<'_>,
    result: ValueId,
    name: &str,
    method: Method,
    args: &[ValueId],
) -> Result<(), Failure> {
    call_inner(b, result, method, args).map_err(|failure| match failure {
        Failure::Unsupported(reason) => {
            Failure::Unsupported(format!("array helper `{name}`: {reason}"))
        }
        Failure::Invariant(reason) => Failure::Invariant(reason),
    })
}
fn call_inner(
    b: &mut Body<'_>,
    result: ValueId,
    method: Method,
    args: &[ValueId],
) -> Result<(), Failure> {
    let arity = if matches!(method, Method::Pop(_)) {
        1
    } else {
        2
    };
    if args.len() != arity {
        return Err(format!("array helper {method:?} arity mismatch").into());
    }
    let shape = b.symbols.types.array(b.ty(args[0]))?;
    if !method.accepts(&shape.element) {
        return Err(format!("array helper {method:?} element {:?}", shape.element).into());
    }
    contract::nonnull(b, args[0])?;
    match method {
        Method::Push(_) => push(b, result, shape, args[0], args[1]),
        Method::Pop(family) => pop(b, result, shape, args[0], family),
        Method::Fill(_) => fill(b, result, shape, args[0], args[1]),
        Method::Truncate(_) | Method::KeepFirst => truncate(b, result, shape, args[0], args[1]),
    }
}
fn length(b: &mut Body<'_>, shape: &gc::Array, array: ValueId) -> Result<(), Failure> {
    arrays::logical_length(b, array, shape.wrapper)
}
fn backing(b: &mut Body<'_>, shape: &gc::Array, array: ValueId) -> Result<(), Failure> {
    arrays::backing(b, array, shape.wrapper)
}
fn output(b: &mut Body<'_>, result: ValueId, actual: &HirType) -> Result<(), Failure> {
    if b.ty(result) == &HirType::Void {
        b.ins(&I::Drop);
        Ok(())
    } else if matches!(actual, HirType::Int { .. } | HirType::Float { .. }) {
        numeric::convert(b, actual, &b.ty(result).clone())
    } else {
        objects::adapt(b, actual, &b.ty(result).clone())
    }
}
fn element(b: &mut Body<'_>, shape: &gc::Array, input: ValueId) -> Result<(), Failure> {
    b.load(input)?;
    objects::adapt(b, &b.ty(input).clone(), &shape.element)
}
fn push(
    b: &mut Body<'_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    input: ValueId,
) -> Result<(), Failure> {
    length(b, shape, array)?;
    b.ins(&I::I32Const(-1));
    b.ins(&I::I32LtU);
    contract::require(b)?;
    let grow = *b
        .symbols
        .array_grow
        .get(&shape.wrapper)
        .ok_or_else(|| Failure::Invariant("unplanned array push growth".into()))?;
    b.load(array)?;
    length(b, shape, array)?;
    b.ins(&I::I32Const(1));
    b.ins(&I::I32Add);
    b.ins(&I::Call(grow));
    backing(b, shape, array)?;
    length(b, shape, array)?;
    element(b, shape, input)?;
    b.ins(&I::ArraySet(shape.backing));
    b.load(array)?;
    length(b, shape, array)?;
    b.ins(&I::I32Const(1));
    b.ins(&I::I32Add);
    b.ins(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: 1,
    });
    length(b, shape, array)?;
    output(b, result, &U32)
}
fn last(b: &mut Body<'_>, shape: &gc::Array, array: ValueId) -> Result<(), Failure> {
    length(b, shape, array)?;
    b.ins(&I::I32Const(1));
    b.ins(&I::I32Sub);
    Ok(())
}
fn pop(
    b: &mut Body<'_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    family: Family,
) -> Result<(), Failure> {
    let actual = if family == Family::Value {
        HirType::Erased
    } else {
        shape.element.clone()
    };
    if family == Family::Number {
        length(b, shape, array)?;
        b.ins(&I::I32Const(0));
        b.ins(&I::I32GtU);
        contract::require(b)?;
    } else {
        length(b, shape, array)?;
        b.ins(&I::If(BlockType::Result(
            b.symbols.types.value_slot(&actual)?.wasm(),
        )));
    }
    backing(b, shape, array)?;
    last(b, shape, array)?;
    b.ins(&arrays::get_instruction(shape)?);
    if family == Family::Value {
        erased::call(b, erased::Helper::BoxNumber)?;
    }
    // Clear the backing tail so pop/truncation release GC roots even while
    // capacity is retained for a later push. The result stays on the stack.
    backing(b, shape, array)?;
    last(b, shape, array)?;
    objects::default(b, &shape.element)?;
    b.ins(&I::ArraySet(shape.backing));
    b.load(array)?;
    last(b, shape, array)?;
    b.ins(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: 1,
    });
    if family != Family::Number {
        b.ins(&I::Else);
        if family == Family::Value {
            b.ins(&I::GlobalGet(
                erased::values(b.symbols)?.for_tag(erased::UNDEFINED)?,
            ));
        } else {
            objects::default(b, &actual)?;
        }
        b.ins(&I::End);
    }
    output(b, result, &actual)
}
fn fill(
    b: &mut Body<'_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    input: ValueId,
) -> Result<(), Failure> {
    backing(b, shape, array)?;
    b.ins(&I::I32Const(0));
    element(b, shape, input)?;
    length(b, shape, array)?;
    b.ins(&I::ArrayFill(shape.backing));
    b.load(array)?;
    output(b, result, &shape.ty)
}
fn truncate(
    b: &mut Body<'_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    count: ValueId,
) -> Result<(), Failure> {
    if b.ty(result) != &HirType::Void {
        return Err("non-void array truncation result".into());
    }
    arrays::whole_nonnegative(b, count)?;
    arrays::number(b, count)?;
    length(b, shape, array)?;
    b.ins(&I::F64ConvertI32U);
    b.ins(&I::F64Le);
    b.ins(&I::I32And);
    contract::require(b)?;
    backing(b, shape, array)?;
    arrays::index(b, count)?;
    objects::default(b, &shape.element)?;
    length(b, shape, array)?;
    arrays::index(b, count)?;
    b.ins(&I::I32Sub);
    b.ins(&I::ArrayFill(shape.backing));
    b.load(array)?;
    arrays::index(b, count)?;
    b.ins(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: 1,
    });
    Ok(())
}
