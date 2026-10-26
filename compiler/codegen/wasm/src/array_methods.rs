//! Closed array helper contracts over the same identity-preserving wrappers.

use crate::{
    arrays,
    body::Body,
    contract, erased,
    error::Failure,
    gc,
    ir::Function,
    module::{Builder, FuncKey},
    numeric, objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, OpKind, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

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
    /// `push` at the front: the rest move up one slot.
    Unshift(Family),
    Pop(Family),
    /// `pop` at the front: the rest move down one slot.
    Shift(Family),
    Fill(Family),
    Truncate(Family),
    KeepFirst,
    /// `xs[i]` read as an erased value: `undefined` where node answers it.
    Element,
}

pub(crate) fn external(name: &str) -> Option<Method> {
    use Family::{Boolean, Number, Reference, Value};
    use Method::{Fill, Pop, Push, Shift, Truncate, Unshift};
    match name {
        "nts_array_push" => Some(Push(Number)),
        "nts_array_push_ref" => Some(Push(Reference)),
        "nts_array_push_value" => Some(Push(Value)),
        "nts_array_unshift" => Some(Unshift(Number)),
        "nts_array_unshift_ref" => Some(Unshift(Reference)),
        "nts_array_pop" => Some(Pop(Number)),
        "nts_array_pop_ref" => Some(Pop(Reference)),
        // This suffix names the result, unlike push/set_length_value. The
        // shared header explicitly specifies a number array, not an erased one.
        "nts_array_pop_value" => Some(Pop(Value)),
        "nts_array_shift" => Some(Shift(Number)),
        "nts_array_shift_ref" => Some(Shift(Reference)),
        // A number array's first element, erased, as `pop_value` is its last.
        "nts_array_shift_value" => Some(Shift(Value)),
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
        matches!(self, Self::Pop(Family::Value) | Self::Shift(Family::Value))
    }
    /// Writes every slot: the core's `fills_every_slot`, kept equal by test.
    #[cfg(test)]
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
            Self::Push(f)
            | Self::Unshift(f)
            | Self::Pop(f)
            | Self::Shift(f)
            | Self::Fill(f)
            | Self::Truncate(f) => f,
        };
        match family {
            Family::Number if self.truncates() => element.is_scalar(),
            Family::Number => element == &HirType::NUMBER,
            Family::Boolean => element == &HirType::Bool,
            // Every reference kind is one slot of its own type, which the
            // helpers move without looking inside.
            Family::Reference => strings::is_string(element) || objects::is_reference(element),
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
    // An element read also takes the tag a null slot reads as
    // (`nts_array_element`), which the array's own mark overrides
    // (`arrays::null_slot`).
    let arity = match method {
        Method::Pop(_) | Method::Shift(_) => 1,
        Method::Element => 3,
        _ => 2,
    };
    if args.len() != arity {
        return Err(format!("array helper {method:?} arity mismatch").into());
    }
    let array = if method == Method::Element {
        let Some(array) = erased_from(b, args[0]) else {
            return open_element(b, result, args[0], args[1], args[2]);
        };
        array
    } else {
        args[0]
    };
    let shape = b.types().array(b.ty(array))?;
    if !method.accepts(&shape.element) {
        return Err(format!("array helper {method:?} element {:?}", shape.element).into());
    }
    contract::nonnull(b, array, "a method of a null array")?;
    match method {
        Method::Element => element_value(b, result, shape, array, args[1], args[2]),
        Method::Push(_) => append(b, result, shape, args[0], args[1]),
        Method::Unshift(_) => prepend(b, result, shape, args[0], args[1]),
        Method::Pop(family) => take(b, result, shape, args[0], family, End::Back),
        Method::Shift(family) => take(b, result, shape, args[0], family, End::Front),
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
/// `unshift`, answering the new length.
fn prepend(
    b: &mut Body<'_, '_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    input: ValueId,
) -> Result<(), Failure> {
    length(b, shape, array)?;
    b.instruction(&I::I32Const(arrays::capacity(&shape.element)));
    b.instruction(&I::I32LtU);
    contract::require(b, arrays::PAST_CAPACITY)?;
    let grow = arrays::grow(b.m, shape)?;
    b.load(array)?;
    length(b, shape, array)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.call(grow);
    backing(b, shape, array)?;
    // The rest move up one slot; `array.copy` allows the overlap.
    b.instruction(&I::I32Const(1));
    backing(b, shape, array)?;
    b.instruction(&I::I32Const(0));
    length(b, shape, array)?;
    b.instruction(&I::ArrayCopy {
        array_type_index_dst: shape.backing,
        array_type_index_src: shape.backing,
    });
    backing(b, shape, array)?;
    b.instruction(&I::I32Const(0));
    element(b, shape, input)?;
    b.instruction(&I::ArraySet(shape.backing));
    b.load(array)?;
    length(b, shape, array)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.instruction(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: crate::gc::ARRAY_LENGTH,
    });
    length(b, shape, array)?;
    output(b, result, &U32)
}
/// `push`, answering the new length: the length read once into a local of
/// its own, the element stored at it, the length written once.
///
/// Storage grows on the cold path only, where the length has reached the
/// backing's own length, and the capacity refusal moves there with it. No
/// backing is longer than [`arrays::capacity`] -- growth stops there, and
/// the engine traps an `array.new` past it -- so a length below the
/// backing's is below the capacity too. Read back from the struct, the
/// length and the backing were loaded again after the growth branch on
/// every push, which V8 could not remove; array-predicates' `filter` push
/// counted 15.5% fewer instructions with it held.
fn append(
    b: &mut Body<'_, '_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    input: ValueId,
) -> Result<(), Failure> {
    let held = b.fresh_local(ValType::I32);
    length(b, shape, array)?;
    b.instruction(&I::LocalTee(held));
    backing(b, shape, array)?;
    b.instructions(&[I::ArrayLen, I::I32GeU, I::If(BlockType::Empty)]);
    b.instruction(&I::LocalGet(held));
    b.instruction(&I::I32Const(arrays::capacity(&shape.element)));
    b.instruction(&I::I32LtU);
    contract::require(b, arrays::PAST_CAPACITY)?;
    let grow = arrays::grow(b.m, shape)?;
    b.load(array)?;
    b.instructions(&[I::LocalGet(held), I::I32Const(1), I::I32Add]);
    b.call(grow);
    b.instruction(&I::End);
    backing(b, shape, array)?;
    b.instruction(&I::LocalGet(held));
    element(b, shape, input)?;
    b.instruction(&I::ArraySet(shape.backing));
    b.load(array)?;
    b.instructions(&[I::LocalGet(held), I::I32Const(1), I::I32Add]);
    b.instruction(&I::StructSet {
        struct_type_index: shape.wrapper,
        field_index: crate::gc::ARRAY_LENGTH,
    });
    b.instructions(&[I::LocalGet(held), I::I32Const(1), I::I32Add]);
    output(b, result, &U32)
}
/// The array an erased operand was made from.
///
/// `nts_array_element` takes its array erased, and the C runtime asks the
/// descriptor what the slots hold. Where the call erases an array whose
/// storage it knows, the read goes to that array, typed; any other operand
/// is read through [`open_element`].
fn erased_from(b: &Body<'_, '_>, erased: ValueId) -> Option<ValueId> {
    match b.func.value(erased).kind {
        OpKind::Erase { value, .. } if arrays::is_array(b.ty(value)) => Some(value),
        _ => None,
    }
}

const NOT_AN_ARRAY: &str = "an element of an open value that is not an array";

/// `nts_array_element` of an open value whose storage the call cannot see,
/// as C asks the descriptor: one type test per array storage, then that
/// storage's read, as [`element_value`] reads it. A value of no array storage
/// refuses by name.
fn open_element(
    b: &mut Body<'_, '_>,
    result: ValueId,
    value: ValueId,
    at: ValueId,
    null_slot: ValueId,
) -> Result<(), Failure> {
    if b.ty(at) != &HirType::NUMBER {
        return Err(Failure::Invariant("nts_array_element index type".into()));
    }
    if !matches!(b.types().value_slot(b.ty(value))?, Physical::Reference(_)) {
        return Err(format!("an element of a {:?}", b.ty(value)).into());
    }
    let target = b.m.helper(
        FuncKey::OpenElement,
        "array.elementOf",
        vec![
            Physical::Reference(RefType::ANYREF),
            Physical::Scalar(crate::types::Slot::F64),
            strings::STRING,
            Physical::Scalar(crate::types::Slot::I32),
        ],
        Some(Physical::Reference(RefType::ANYREF)),
        open_element_body,
    )?;
    b.load(value)?;
    b.load(at)?;
    strings::constant(b, b.func.name.clone());
    b.load(null_slot)?;
    b.call(target);
    output(b, result, &HirType::Erased)
}

/// Params: value, index, caller's name, the tag a null slot reads as.
fn open_element_body(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let types = m.types;
    let undefined = erased::singleton(m, erased::Singleton::Undefined)?;
    let null = erased::singleton(m, erased::Singleton::Null)?;
    let mut f = Function::new([]);
    for shape in types.arrays.values() {
        let wrapper = HeapType::Concrete(shape.wrapper);
        let array = [I::LocalGet(0), I::RefCastNonNull(wrapper)];
        f.instructions(&[
            I::LocalGet(0),
            I::RefTestNonNull(wrapper),
            I::If(BlockType::Empty),
        ]);
        // A whole index from zero below the length; any other reads
        // `undefined`, as node answers.
        f.instructions(&[
            I::LocalGet(1),
            I::LocalGet(1),
            I::F64Trunc,
            I::F64Eq,
            I::LocalGet(1),
            I::F64Const(0.0.into()),
            I::F64Ge,
            I::I32And,
            I::LocalGet(1),
        ]);
        f.instructions(&array);
        f.instructions(&[
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: gc::ARRAY_LENGTH,
            },
            I::F64ConvertI32U,
            I::F64Lt,
            I::I32And,
            I::I32Eqz,
            I::If(BlockType::Empty),
        ]);
        f.global_get(undefined);
        f.instructions(&[I::Return, I::End]);
        // A null slot may stand for `undefined` or for `null`.
        let present = match types.value_slot(&shape.element)? {
            Physical::Reference(slot) if shape.element != HirType::Erased => Some(RefType {
                nullable: false,
                ..slot
            }),
            Physical::Reference(_) | Physical::Scalar(_) => None,
        };
        if let Some(present) = present {
            f.instruction(&I::Block(BlockType::Result(ValType::Ref(present))));
        }
        f.instructions(&array);
        f.instructions(&[
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: gc::ARRAY_BACKING,
            },
            I::LocalGet(1),
            I::I32TruncSatF64U,
            arrays::get_instruction(shape)?,
        ]);
        // A null slot is `null` where the read site says so or the array's
        // mark does (`arrays::null_slot`), `undefined` otherwise.
        if present.is_some() {
            f.instruction(&I::BrOnNonNull(0));
            f.instructions(&[I::LocalGet(3), I::I32Const(erased::NULL), I::I32Eq]);
            f.instructions(&array);
            f.instructions(&[
                I::StructGet {
                    struct_type_index: shape.wrapper,
                    field_index: gc::ARRAY_FLAGS,
                },
                I::I32Const(gc::NULL_SLOTS),
                I::I32And,
                I::I32Or,
                I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))),
            ]);
            f.global_get(null);
            f.instruction(&I::Else);
            f.global_get(undefined);
            f.instructions(&[I::End, I::Return, I::End]);
        }
        erased::erase_in(m, &mut f, &shape.element)?;
        f.instructions(&[I::Return, I::End]);
    }
    contract::refuse_in(&mut f, m, 2, NOT_AN_ARRAY)?;
    f.instruction(&I::End);
    Ok(f)
}
const NO_LENGTH: &str = "the length of an open value that is not an array";

/// The length of an open value, which lowering reads only where
/// `Array.isArray` proved it an array, as C asks `nts_array_length`. Where the
/// operand was erased from an array the read can see, that array's length;
/// otherwise one type test per array storage (a tagged template's among them),
/// then that storage's live length. A value of no array storage (a tuple has
/// no indexed count) refuses by name.
pub(crate) fn open_length(
    b: &mut Body<'_, '_>,
    result: ValueId,
    value: ValueId,
) -> Result<(), Failure> {
    if let Some(array) = erased_from(b, value) {
        return arrays::length(b, result, array);
    }
    let target = b.m.helper(
        FuncKey::OpenLength,
        "array.lengthOf",
        vec![Physical::Reference(RefType::ANYREF), strings::STRING],
        Some(Physical::Scalar(crate::types::Slot::I32)),
        open_length_body,
    )?;
    b.load(value)?;
    strings::constant(b, b.func.name.clone());
    b.call(target);
    numeric::convert(b, &U32, &b.ty(result).clone())
}

/// Params: value, caller's name.
fn open_length_body(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let types = m.types;
    let mut f = Function::new([]);
    for shape in types.arrays.values() {
        let wrapper = HeapType::Concrete(shape.wrapper);
        f.instructions(&[
            I::LocalGet(0),
            I::RefTestNonNull(wrapper),
            I::If(BlockType::Empty),
            I::LocalGet(0),
            I::RefCastNonNull(wrapper),
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: gc::ARRAY_LENGTH,
            },
            I::Return,
            I::End,
        ]);
    }
    contract::refuse_in(&mut f, m, 1, NO_LENGTH)?;
    f.instruction(&I::End);
    Ok(f)
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
    null_slot: ValueId,
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
        arrays::null_slot(b, array, shape.wrapper, null_slot)?;
        b.instructions(&[I::Br(1), I::End]);
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
/// Which end `take` works at.
#[derive(Clone, Copy, PartialEq, Eq)]
enum End {
    Front,
    Back,
}
/// `pop` and `shift`. A number array that is empty is refused, where node
/// answers `undefined`, which a number result cannot hold; a reference result
/// is null, and an erased one `undefined`.
fn take(
    b: &mut Body<'_, '_>,
    result: ValueId,
    shape: &gc::Array,
    array: ValueId,
    family: Family,
    end: End,
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
        contract::require(
            b,
            "taking from an empty number array, whose undefined a number cannot hold",
        )?;
    } else {
        length(b, shape, array)?;
        b.instruction(&I::If(BlockType::Result(
            b.types().value_slot(&actual)?.wasm(),
        )));
    }
    backing(b, shape, array)?;
    match end {
        End::Front => b.instruction(&I::I32Const(0)),
        End::Back => last(b, shape, array)?,
    }
    b.instruction(&arrays::get_instruction(shape)?);
    if family == Family::Value {
        erased::call(b, erased::Helper::BoxNumber)?;
    }
    if end == End::Front {
        // The rest move down one slot; `array.copy` allows the overlap.
        backing(b, shape, array)?;
        b.instruction(&I::I32Const(0));
        backing(b, shape, array)?;
        b.instruction(&I::I32Const(1));
        last(b, shape, array)?;
        b.instruction(&I::ArrayCopy {
            array_type_index_dst: shape.backing,
            array_type_index_src: shape.backing,
        });
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
        field_index: crate::gc::ARRAY_LENGTH,
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
    contract::require(
        b,
        "a length that is not a whole number up to the current one: growing leaves holes",
    )?;
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
        field_index: crate::gc::ARRAY_LENGTH,
    });
    Ok(())
}
