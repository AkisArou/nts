//! Erased primitives use GC storage and the shared semantic tag numbers.
//!
//! An erased value is an anyref: an i31 or a boxed number, a boolean box, an
//! absence singleton, a compiled object, or a JS string itself, internalized
//! with `any.convert_extern`. Erasure internalizes nothing but strings, so an
//! anyref that is neither an i31 nor a struct is a string.

use crate::{
    body::Body,
    contract,
    error::Failure,
    gc::ErasedTypes,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    numeric,
    types::Physical,
};
use nts_core::hir::{Absent, BinOp, HirType, ManagedType, OpKind, ValueId, tags};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) const UNDEFINED: i32 = tags::UNDEFINED.cast_signed();
pub(crate) const BOOLEAN: i32 = tags::BOOLEAN.cast_signed();
pub(crate) const NUMBER: i32 = tags::NUMBER.cast_signed();
pub(crate) const STRING: i32 = tags::STRING.cast_signed();
pub(crate) const NULL: i32 = tags::NULL.cast_signed();
pub(crate) const OBJECT: i32 = tags::OBJECT.cast_signed();
pub(crate) const FUNCTION: i32 = tags::FUNCTION.cast_signed();

/// The four immutable erased values with no payload of their own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Singleton {
    Undefined,
    Null,
    False,
    True,
}

impl Singleton {
    pub(crate) fn for_tag(tag: i32) -> Result<Self, Failure> {
        match tag {
            UNDEFINED => Ok(Self::Undefined),
            NULL => Ok(Self::Null),
            BOOLEAN => Ok(Self::False),
            _ => Err(Failure::Invariant(format!("tag {tag} has no singleton"))),
        }
    }
}

/// An erased singleton: an immutable global built once per instance.
pub(crate) fn singleton(m: &mut Builder<'_>, which: Singleton) -> Result<Global, Failure> {
    let types = types(m)?;
    m.global(GlobalKey::Singleton(which), |_| {
        let mut code = ir::Code::default();
        let ty = match which {
            Singleton::Undefined | Singleton::Null => {
                code.instructions(&[
                    I::I32Const(if which == Singleton::Null {
                        NULL
                    } else {
                        UNDEFINED
                    }),
                    I::StructNew(types.tagged),
                ]);
                types.tagged
            }
            Singleton::False | Singleton::True => {
                code.instructions(&[
                    I::I32Const(BOOLEAN),
                    I::I32Const(i32::from(which == Singleton::True)),
                    I::StructNew(types.boolean),
                ]);
                types.boolean
            }
        };
        Ok((crate::module::constant_type(ty), code))
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    BoxNumber,
    Number,
    Tag,
    BoxBoolean,
    Boolean,
    Truthy,
    Equal,
    EqualNumber,
    EqualBoolean,
    EqualString,
}

impl Helper {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::BoxNumber => "value.boxNumber",
            Self::Number => "value.number",
            Self::Tag => "value.tag",
            Self::BoxBoolean => "value.boxBoolean",
            Self::Boolean => "value.boolean",
            Self::Truthy => "value.truthy",
            Self::Equal => "value.equal",
            Self::EqualNumber => "value.equalNumber",
            Self::EqualBoolean => "value.equalBoolean",
            Self::EqualString => "value.equalString",
        }
    }
    fn body(self, m: &mut Builder<'_>) -> Result<Function, Failure> {
        let types = types(m)?;
        let mut f = Function::default();
        match self {
            Self::BoxNumber => f.instructions(&[
                I::LocalGet(0),
                I::F64Const((-1_073_741_824.0).into()),
                I::F64Ge,
                I::LocalGet(0),
                I::F64Const(1_073_741_823.0.into()),
                I::F64Le,
                I::I32And,
                I::LocalGet(0),
                I::F64Trunc,
                I::LocalGet(0),
                I::F64Eq,
                I::I32And,
                I::LocalGet(0),
                I::I64ReinterpretF64,
                I::I64Const(i64::MIN),
                I::I64Ne,
                I::I32And,
                I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))),
                I::LocalGet(0),
                I::I32TruncSatF64S,
                I::RefI31,
                I::Else,
                I::I32Const(NUMBER),
                I::LocalGet(0),
                I::StructNew(types.number),
                I::End,
            ]),
            Self::Number => f.instructions(&[
                I::LocalGet(0),
                I::RefTestNonNull(HeapType::I31),
                I::If(BlockType::Result(ValType::F64)),
                I::LocalGet(0),
                I::RefCastNonNull(HeapType::I31),
                I::I31GetS,
                I::F64ConvertI32S,
                I::Else,
                I::LocalGet(0),
                I::RefCastNonNull(HeapType::Concrete(types.number)),
                I::StructGet {
                    struct_type_index: types.number,
                    field_index: 1,
                },
                I::End,
            ]),
            Self::Tag => physical_tag(&mut f, types, m.types.root),
            Self::BoxBoolean
            | Self::Boolean
            | Self::Truthy
            | Self::Equal
            | Self::EqualNumber
            | Self::EqualBoolean
            | Self::EqualString => return crate::erased_ops::body(self, m, types),
        }
        f.instruction(&I::End);
        Ok(f)
    }
}

fn physical_tag(f: &mut Function, types: ErasedTypes, root: Option<crate::gc::RootTypes>) {
    // A JS string is the one erased value outside `eq` (no i31, no struct),
    // so it is told apart by one test, first. The test admits null, so a null
    // reference, which no erased value is, still reaches the cast below and
    // traps rather than reading as a string.
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNullable(RefType::EQREF.heap_type),
        I::I32Eqz,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(STRING),
        I::Else,
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::I31),
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(NUMBER),
        I::Else,
    ]);
    if let Some(root) = root {
        f.instructions(&[
            I::LocalGet(0),
            I::RefTestNonNull(HeapType::Concrete(root.object)),
            I::If(BlockType::Result(ValType::I32)),
            I::LocalGet(0),
            I::RefCastNonNull(HeapType::Concrete(root.object)),
            I::StructGet {
                struct_type_index: root.object,
                field_index: 0,
            },
            I::StructGet {
                struct_type_index: root.descriptor,
                field_index: 1,
            },
            I::Else,
        ]);
    }
    f.instructions(&[
        I::LocalGet(0),
        I::RefCastNonNull(HeapType::Concrete(types.tagged)),
        I::StructGet {
            struct_type_index: types.tagged,
            field_index: 0,
        },
    ]);
    if root.is_some() {
        f.instruction(&I::End);
    }
    f.instructions(&[I::End, I::End]);
}

/// The JS string an erased string holds, from an anyref already known to be
/// one: its external form.
pub(crate) fn string_payload(f: &mut ir::Code) {
    f.instruction(&I::ExternConvertAny);
}
fn types(m: &Builder<'_>) -> Result<ErasedTypes, Failure> {
    m.types
        .erased
        .ok_or_else(|| Failure::Invariant("unplanned erased types".into()))
}
pub(crate) fn call(body: &mut Body<'_, '_>, helper: Helper) -> Result<(), Failure> {
    let f = callee(body.m, helper)?;
    body.call(f);
    Ok(())
}
pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let (params, result) = helper.signature();
    m.helper(
        FuncKey::Erased(helper),
        helper.name(),
        params,
        Some(result),
        |m| helper.body(m),
    )
}
fn get_singleton(body: &mut Body<'_, '_>, which: Singleton) -> Result<(), Failure> {
    let global = singleton(body.m, which)?;
    body.global_get(global);
    Ok(())
}

pub(crate) fn constant(body: &mut Body<'_, '_>, result: ValueId, tag: i32) -> Result<(), Failure> {
    match body.types().slot(body.ty(result))? {
        Some(Physical::Reference(_)) if body.ty(result) == &HirType::Erased => {
            get_singleton(body, Singleton::for_tag(tag)?)?;
        }
        Some(Physical::Reference(reference)) => body.instruction(&I::RefNull(reference.heap_type)),
        _ => return Err(format!("absence constant in {:?}", body.ty(result)).into()),
    }
    Ok(())
}

pub(crate) fn erase(
    body: &mut Body<'_, '_>,
    value: ValueId,
    absent: Absent,
) -> Result<(), Failure> {
    match body.ty(value).clone() {
        HirType::Void => get_singleton(body, Singleton::Undefined)?,
        HirType::Managed(ManagedType::String) => erase_string(body, value, absent)?,
        ref ty if crate::objects::is_reference(ty) => {
            erase_reference(body, value, absent)?;
        }
        ty => {
            if !erase_integer(body, value)? {
                body.load(value)?;
                erase_stack(body, &ty)?;
            }
        }
    }
    Ok(())
}

/// Erases a number that an integer of at most 32 bits produced, from the
/// integer itself: an i31 where it fits, the form `boxNumber` gives that value
/// too, and otherwise the boxed double. False, emitting nothing, for a value
/// with no such source. An integer is never `-0`, so the range is the whole
/// test, and none is needed where the integer's own definition bounds it.
fn erase_integer(body: &mut Body<'_, '_>, value: ValueId) -> Result<bool, Failure> {
    let source = match (body.ty(value), &body.func.value(value).kind) {
        (
            HirType::Int {
                bits: 8 | 16 | 32, ..
            },
            _,
        ) => value,
        (HirType::Float { bits: 64 }, OpKind::Convert(from))
            if matches!(
                body.ty(*from),
                HirType::Int {
                    bits: 8 | 16 | 32,
                    ..
                }
            ) =>
        {
            *from
        }
        _ => return Ok(false),
    };
    let HirType::Int { signed, .. } = *body.ty(source) else {
        return Ok(false);
    };
    if body.local(source).is_err() {
        return Ok(false);
    }
    if fits_i31(body.func, source) {
        body.load(source)?;
        body.instruction(&I::RefI31);
        return Ok(true);
    }
    body.load(source)?;
    if signed {
        // Fits where dropping the top bit and extending the sign gives it back.
        body.instruction(&I::I32Const(1));
        body.instruction(&I::I32Shl);
        body.instruction(&I::I32Const(1));
        body.instruction(&I::I32ShrS);
        body.load(source)?;
        body.instruction(&I::I32Eq);
    } else {
        body.instruction(&I::I32Const(0x3fff_ffff));
        body.instruction(&I::I32LeU);
    }
    body.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    body.load(source)?;
    body.instruction(&I::RefI31);
    body.instruction(&I::Else);
    body.load(source)?;
    body.instruction(&if signed {
        I::F64ConvertI32S
    } else {
        I::F64ConvertI32U
    });
    call(body, Helper::BoxNumber)?;
    body.instruction(&I::End);
    Ok(true)
}

/// Whether an integer's own definition puts it inside i31's range: a type of
/// at most 16 bits, a constant, or an `and` with a mask that fits. An 8- or
/// 16-bit value is in range by the core's width contract; see
/// `numeric::arithmetic`.
fn fits_i31(func: &nts_core::hir::Func, id: ValueId) -> bool {
    const LOW: i128 = -(1 << 30);
    const HIGH: i128 = (1 << 30) - 1;
    let constant = |id: ValueId| match func.value(id).kind {
        OpKind::ConstInt(c) => Some(c),
        _ => None,
    };
    match (&func.value(id).ty, &func.value(id).kind) {
        (HirType::Int { bits: 8 | 16, .. }, _) => true,
        (_, OpKind::ConstInt(c)) => (LOW..=HIGH).contains(c),
        (
            HirType::Int { bits: 32, .. },
            OpKind::Binary {
                op: BinOp::BitAnd,
                lhs,
                rhs,
            },
        ) => [*lhs, *rhs]
            .into_iter()
            .filter_map(constant)
            .any(|mask| (0..=HIGH).contains(&mask)),
        _ => false,
    }
}

/// Erases the value on the stack, held in storage of type `ty`. A string or a
/// reference arrives non-null: what a null one means is the caller's to say.
pub(crate) fn erase_stack(body: &mut Body<'_, '_>, ty: &HirType) -> Result<(), Failure> {
    match ty {
        HirType::Erased
        | HirType::Managed(
            ManagedType::Object(_)
            | ManagedType::Array(_)
            | ManagedType::Map(..)
            | ManagedType::Table(..)
            | ManagedType::Set(_)
            | ManagedType::Promise(_),
        ) => {}
        HirType::Bool => {
            body.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
            get_singleton(body, Singleton::True)?;
            body.instruction(&I::Else);
            get_singleton(body, Singleton::False)?;
            body.instruction(&I::End);
        }
        HirType::Int { .. } | HirType::Float { .. } => {
            numeric::convert(body, ty, &HirType::NUMBER)?;
            call(body, Helper::BoxNumber)?;
        }
        HirType::Managed(ManagedType::String) => body.instruction(&I::AnyConvertExtern),
        HirType::Void
        | HirType::Managed(_)
        | HirType::BigInt
        | HirType::NativePointer(_)
        | HirType::Never => {
            return Err(
                format!("erasing {ty:?} is outside the current primitive implementation").into(),
            );
        }
    }
    Ok(())
}

fn erase_string(body: &mut Body<'_, '_>, value: ValueId, absent: Absent) -> Result<(), Failure> {
    let tag = match absent {
        Absent::Impossible => None,
        Absent::Null => Some(NULL),
        Absent::Undefined => Some(UNDEFINED),
    };
    if tag.is_none() {
        contract::nonnull(
            body,
            value,
            "a null string where the type says none is absent",
        )?;
    }
    if let Some(tag) = tag {
        body.load(value)?;
        body.instruction(&I::RefIsNull);
        body.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
        get_singleton(body, Singleton::for_tag(tag)?)?;
        body.instruction(&I::Else);
    }
    body.load(value)?;
    erase_stack(body, &HirType::Managed(ManagedType::String))?;
    if tag.is_some() {
        body.instruction(&I::End);
    }
    Ok(())
}

fn erase_reference(body: &mut Body<'_, '_>, value: ValueId, absent: Absent) -> Result<(), Failure> {
    match absent {
        Absent::Impossible => {
            contract::nonnull(
                body,
                value,
                "a null reference where the type says none is absent",
            )?;
            body.load(value)?;
        }
        Absent::Null | Absent::Undefined => {
            body.load(value)?;
            body.instruction(&I::RefIsNull);
            body.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
            let tag = if absent == Absent::Null {
                NULL
            } else {
                UNDEFINED
            };
            get_singleton(body, Singleton::for_tag(tag)?)?;
            body.instruction(&I::Else);
            body.load(value)?;
            body.instruction(&I::End);
        }
    }
    Ok(())
}

pub(crate) fn unerase(
    body: &mut Body<'_, '_>,
    result: ValueId,
    value: ValueId,
) -> Result<(), Failure> {
    let ty = body.ty(result).clone();
    unerase_to(body, value, &ty)
}

/// `value`, erased, read as `ty` and left on the stack; a value it is not is
/// refused by name.
pub(crate) fn unerase_to(
    body: &mut Body<'_, '_>,
    value: ValueId,
    ty: &HirType,
) -> Result<(), Failure> {
    let boxed = types(body.m)?;
    body.load(value)?;
    match ty.clone() {
        HirType::Erased => {}
        HirType::Bool => {
            body.instruction(&I::Drop);
            projection_guard(
                body,
                value,
                &[HeapType::Concrete(boxed.boolean)],
                "an erased value read as a boolean, which it is not",
            )?;
            body.load(value)?;
            body.instruction(&I::RefCastNonNull(HeapType::Concrete(boxed.boolean)));
            body.instruction(&I::StructGet {
                struct_type_index: boxed.boolean,
                field_index: 1,
            });
        }
        ty @ (HirType::Int { .. } | HirType::Float { .. }) => {
            body.instruction(&I::Drop);
            projection_guard(
                body,
                value,
                &[HeapType::I31, HeapType::Concrete(boxed.number)],
                "an erased value read as a number, which it is not",
            )?;
            body.load(value)?;
            call(body, Helper::Number)?;
            numeric::convert(body, &HirType::NUMBER, &ty)?;
        }
        HirType::Managed(ManagedType::String) => {
            body.instruction(&I::Drop);
            body.load(value)?;
            call(body, Helper::Tag)?;
            body.instruction(&I::I32Const(NULL));
            body.instruction(&I::I32Eq);
            body.load(value)?;
            call(body, Helper::Tag)?;
            body.instruction(&I::I32Const(UNDEFINED));
            body.instruction(&I::I32Eq);
            body.instruction(&I::I32Or);
            body.instruction(&I::If(BlockType::Result(ValType::EXTERNREF)));
            body.instruction(&I::RefNull(HeapType::EXTERN));
            body.instruction(&I::Else);
            body.load(value)?;
            call(body, Helper::Tag)?;
            body.instruction(&I::I32Const(STRING));
            body.instruction(&I::I32Eq);
            contract::require(body, "an erased value read as a string, which it is not")?;
            body.load(value)?;
            string_payload(&mut body.code);
            body.instruction(&I::End);
        }
        ty @ HirType::Managed(
            ManagedType::Object(_)
            | ManagedType::Array(_)
            | ManagedType::Map(..)
            | ManagedType::Table(..)
            | ManagedType::Set(_)
            | ManagedType::Promise(_),
        ) => {
            body.instruction(&I::Drop);
            unerase_reference(body, value, &ty)?;
        }
        ty => {
            return Err(format!(
                "unerasing {ty:?} is outside the current primitive implementation"
            )
            .into());
        }
    }
    Ok(())
}

fn unerase_reference(body: &mut Body<'_, '_>, value: ValueId, ty: &HirType) -> Result<(), Failure> {
    let Physical::Reference(reference) = body.types().value_slot(ty)? else {
        return Err(Failure::Invariant(
            "non-reference managed projection".into(),
        ));
    };
    body.load(value)?;
    call(body, Helper::Tag)?;
    body.instruction(&I::I32Const(NULL));
    body.instruction(&I::I32Eq);
    body.load(value)?;
    call(body, Helper::Tag)?;
    body.instruction(&I::I32Const(UNDEFINED));
    body.instruction(&I::I32Eq);
    body.instruction(&I::I32Or);
    body.instruction(&I::If(BlockType::Result(ValType::Ref(reference))));
    body.instruction(&I::RefNull(reference.heap_type));
    body.instruction(&I::Else);
    projection_guard(
        body,
        value,
        &[reference.heap_type],
        "an erased value read as an object of a type it is not",
    )?;
    body.load(value)?;
    body.instruction(&I::RefCastNonNull(reference.heap_type));
    body.instruction(&I::End);
    Ok(())
}

pub(crate) fn projection_guard(
    body: &mut Body<'_, '_>,
    value: ValueId,
    cases: &[HeapType],
    why: &str,
) -> Result<(), Failure> {
    for (at, case) in cases.iter().enumerate() {
        body.load(value)?;
        body.instruction(&I::RefTestNonNull(*case));
        if at != 0 {
            body.instruction(&I::I32Or);
        }
    }
    contract::require(body, why)
}

/// The tag of an erased value. Of a typed one it is refused by name: a typed
/// reference's null does not say which absence it stands for.
pub(crate) fn tag(body: &mut Body<'_, '_>, result: ValueId, value: ValueId) -> Result<(), Failure> {
    if body.ty(value) != &HirType::Erased {
        return Err(format!("the tag of a typed {:?} value", body.ty(value)).into());
    }
    body.load(value)?;
    call(body, Helper::Tag)?;
    numeric::convert(
        body,
        &HirType::Int {
            bits: 32,
            signed: false,
        },
        &body.ty(result).clone(),
    )
}
