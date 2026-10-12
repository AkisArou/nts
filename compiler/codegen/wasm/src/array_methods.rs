//! Closed array helper contracts over the same identity-preserving wrappers.

use crate::{
    arrays, body::Body, contract, erased, error::Failure, gc, numeric, objects, types::Physical,
};
use nts_core::hir::{HirType, ManagedType, OpKind, ValueId};
use wasm_encoder::{BlockType, Instruction as I, RefType, ValType};

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
    /// `xs[i]` read as an erased value: `undefined` where node answers it.
    Element,
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
        "nts_array_element" => Some(Method::Element),
        _ => None,
    }
}
impl Method {
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
            // Header contracts that are descriptor-width generic.
            Self::KeepFirst | Self::Element => return true,
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
    b: &mut Body<'_, '_>,
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
    b: &mut Body<'_, '_>,
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
    let array = if method == Method::Element {
        erased_from(b, args[0])?
    } else {
        args[0]
    };
    let shape = b.types().array(b.ty(array))?;
    if !method.accepts(&shape.element) {
        return Err(format!("array helper {method:?} element {:?}", shape.element).into());
    }
    contract::nonnull(b, array)?;
    match method {
        Method::Element => element_value(b, result, shape, array, args[1]),
        Method::Push(_) => push(b, result, shape, args[0], args[1]),
        Method::Pop(family) => pop(b, result, shape, args[0], family),
        Method::Fill(_) => fill(b, result, shape, args[0], args[1]),
        Method::Truncate(_) | Method::KeepFirst => truncate(b, result, shape, args[0], args[1]),
    }
}
fn length(b: &mut Body<'_, '_>, shape: &gc::Array, array: ValueId) -> Result<(), Failure> {
    arrays::logical_length(b, array, shape.wrapper)
}
fn backing(b: &mut Body<'_, '_>, shape: &gc::Array, array: ValueId) -> Result<(), Failure> {
    arrays::backing(b, array, shape.wrapper)
}
fn output(b: &mut Body<'_, '_>, result: ValueId, actual: &HirType) -> Result<(), Failure> {
    if b.ty(result) == &HirType::Void {
        b.instruction(&I::Drop);
        Ok(())
    } else if matches!(actual, HirType::Int { .. } | HirType::Float { .. }) {
        numeric::convert(b, actual, &b.ty(result).clone())
    } else {
        objects::adapt(b, actual, &b.ty(result).clone())
    }
}
fn element(b: &mut Body<'_, '_>, shape: &gc::Array, input: ValueId) -> Result<(), Failure> {
    b.load(input)?;
    objects::adapt(b, &b.ty(input).clone(), &shape.element)
}
fn push(
    b: &mut Body<'_, '_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    input: ValueId,
) -> Result<(), Failure> {
    length(b, shape, array)?;
    b.instruction(&I::I32Const(-1));
    b.instruction(&I::I32LtU);
    contract::require(b)?;
    let grow = arrays::grow(b.m, shape)?;
    b.load(array)?;
    length(b, shape, array)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.call(grow);
    backing(b, shape, array)?;
    length(b, shape, array)?;
    element(b, shape, input)?;
    b.instruction(&I::ArraySet(shape.backing));
    b.load(array)?;
    length(b, shape, array)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.instruction(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: 1,
    });
    length(b, shape, array)?;
    output(b, result, &U32)
}
/// The array an erased operand was made from.
///
/// `nts_array_element` takes its array erased, and the C runtime asks the
/// descriptor what the slots hold. Every caller erases an array whose storage
/// it knows, and a Wasm array is typed by that storage, so the read goes to
/// the array the erasure was made from. An erased operand from anywhere else
/// is refused by name.
fn erased_from(b: &Body<'_, '_>, erased: ValueId) -> Result<ValueId, Failure> {
    match b.func.value(erased).kind {
        OpKind::Erase { value, .. } if arrays::is_array(b.ty(value)) => Ok(value),
        _ => Err("an erased array whose storage this read cannot see".into()),
    }
}
/// `nts_array_element`: an element read that answers `undefined` for an index
/// naming no element, as node does, where a typed read traps.
///
/// A null reference slot is refused by name. One storage type holds both
/// absences: `(T | null)[]` stores `null` there and a JavaScript array
/// `undefined`, so either answer is wrong for the other. (The C runtime
/// answers `undefined`, which node contradicts for the first.) Holes never get
/// here: an array whose unset slots are observed is declined before this.
fn element_value(
    b: &mut Body<'_, '_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    at: ValueId,
) -> Result<(), Failure> {
    if b.ty(at) != &HirType::NUMBER {
        return Err(Failure::Invariant("nts_array_element index type".into()));
    }
    let present = match b.types().value_slot(&shape.element)? {
        Physical::Reference(slot) if shape.element != HirType::Erased => Some(RefType {
            nullable: false,
            ..slot
        }),
        Physical::Reference(_) | Physical::Scalar(_) => None,
    };
    arrays::valid_index(b, array, at, false)?;
    b.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    if let Some(present) = present {
        b.instruction(&I::Block(BlockType::Result(ValType::Ref(present))));
    }
    backing(b, shape, array)?;
    arrays::index(b, at)?;
    b.instruction(&arrays::get_instruction(shape)?);
    if present.is_some() {
        b.instruction(&I::BrOnNonNull(0));
        contract::refuse(b)?;
        b.instruction(&I::End);
    }
    erased::erase_stack(b, &shape.element)?;
    b.instruction(&I::Else);
    let undefined = erased::singleton(b.m, erased::Singleton::Undefined)?;
    b.global_get(undefined);
    b.instruction(&I::End);
    output(b, result, &HirType::Erased)
}
fn last(b: &mut Body<'_, '_>, shape: &gc::Array, array: ValueId) -> Result<(), Failure> {
    length(b, shape, array)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Sub);
    Ok(())
}
fn pop(
    b: &mut Body<'_, '_>,
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
        b.instruction(&I::I32Const(0));
        b.instruction(&I::I32GtU);
        contract::require(b)?;
    } else {
        length(b, shape, array)?;
        b.instruction(&I::If(BlockType::Result(
            b.types().value_slot(&actual)?.wasm(),
        )));
    }
    backing(b, shape, array)?;
    last(b, shape, array)?;
    b.instruction(&arrays::get_instruction(shape)?);
    if family == Family::Value {
        erased::call(b, erased::Helper::BoxNumber)?;
    }
    // Clear the backing tail so pop/truncation release GC roots even while
    // capacity is retained for a later push. The result stays on the stack.
    backing(b, shape, array)?;
    last(b, shape, array)?;
    objects::default(b, &shape.element)?;
    b.instruction(&I::ArraySet(shape.backing));
    b.load(array)?;
    last(b, shape, array)?;
    b.instruction(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: 1,
    });
    if family != Family::Number {
        b.instruction(&I::Else);
        if family == Family::Value {
            let undefined = erased::singleton(b.m, erased::Singleton::Undefined)?;
            b.global_get(undefined);
        } else {
            objects::default(b, &actual)?;
        }
        b.instruction(&I::End);
    }
    output(b, result, &actual)
}
fn fill(
    b: &mut Body<'_, '_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    input: ValueId,
) -> Result<(), Failure> {
    backing(b, shape, array)?;
    b.instruction(&I::I32Const(0));
    element(b, shape, input)?;
    length(b, shape, array)?;
    b.instruction(&I::ArrayFill(shape.backing));
    b.load(array)?;
    output(b, result, &shape.ty)
}
fn truncate(
    b: &mut Body<'_, '_>,
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
    b.instruction(&I::F64ConvertI32U);
    b.instruction(&I::F64Le);
    b.instruction(&I::I32And);
    contract::require(b)?;
    backing(b, shape, array)?;
    arrays::index(b, count)?;
    objects::default(b, &shape.element)?;
    length(b, shape, array)?;
    arrays::index(b, count)?;
    b.instruction(&I::I32Sub);
    b.instruction(&I::ArrayFill(shape.backing));
    b.load(array)?;
    arrays::index(b, count)?;
    b.instruction(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: 1,
    });
    Ok(())
}
