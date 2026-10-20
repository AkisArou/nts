//! Erased primitives use GC storage and the shared semantic tag numbers.
//!
//! An erased value is an anyref: an i31 or a boxed number, a boolean box, an
//! absence singleton, a compiled object, or a JS string itself, internalized
//! with `any.convert_extern`. The string representation supplies its positive
//! predicate; the tag helper does not infer strings from other kinds' absence.

use crate::{
    body::Body,
    contract,
    error::Failure,
    gc::ErasedTypes,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    numeric,
    types::{Physical, Slot},
};
use nts_core::hir::{Absent, BinOp, HirType, ManagedType, OpKind, ValueId, tags};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) const UNDEFINED: i32 = tags::UNDEFINED.cast_signed();
pub(crate) const BOOLEAN: i32 = tags::BOOLEAN.cast_signed();
pub(crate) const NUMBER: i32 = tags::NUMBER.cast_signed();
pub(crate) const STRING: i32 = tags::STRING.cast_signed();
pub(crate) const NULL: i32 = tags::NULL.cast_signed();
pub(crate) const SYMBOL: i32 = tags::SYMBOL.cast_signed();
pub(crate) const BIGINT: i32 = tags::BIGINT.cast_signed();
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
    /// `(value, fallback) -> number`: C's `nts_value_number_or`.
    NumberOr,
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
            Self::NumberOr => "value.numberOr",
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
            Self::Tag => {
                let test = crate::strings::callee(m, crate::strings::Helper::Test)?;
                physical_tag(&mut f, types, m.types.root, test);
            }
            Self::BoxBoolean
            | Self::Boolean
            | Self::Truthy
            | Self::Equal
            | Self::EqualNumber
            | Self::EqualBoolean
            | Self::EqualString
            | Self::NumberOr => return crate::erased_ops::body(self, m, types),
        }
        f.instruction(&I::End);
        Ok(f)
    }
}

fn physical_tag(
    f: &mut Function,
    types: ErasedTypes,
    root: Option<crate::gc::RootTypes>,
    string_test: Func,
) {
    // Ask the selected string representation, rather than treating every
    // reference outside `eq` as a string. A null reference still fails the
    // predicate and reaches the trapping cast below, as it did before.
    f.instructions(&[I::LocalGet(0), I::ExternConvertAny]);
    f.call(string_test);
    f.instructions(&[
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

/// `undefined` or `null` in a slot of the result's type.
///
/// In a scalar slot it is what JavaScript converts it to: a number is NaN for
/// `undefined` and 0 for `null`, an integer 0, a boolean false. The core puts
/// one there on a path it has proved no read reaches -- an optional chain's
/// absent arm after its `??` folded away -- where C writes a zero; the
/// conversion is the same answer wherever that holds, and node's where not.
pub(crate) fn constant(body: &mut Body<'_, '_>, result: ValueId, tag: i32) -> Result<(), Failure> {
    let nan = tag == UNDEFINED;
    match body.types().slot(body.ty(result))? {
        Some(Physical::Reference(_)) if body.ty(result) == &HirType::Erased => {
            get_singleton(body, Singleton::for_tag(tag)?)?;
        }
        Some(Physical::Reference(reference)) => body.instruction(&I::RefNull(reference.heap_type)),
        Some(Physical::Scalar(Slot::F64)) => {
            body.instruction(&I::F64Const(if nan { f64::NAN } else { 0.0 }.into()));
        }
        Some(Physical::Scalar(Slot::F32)) => {
            body.instruction(&I::F32Const(if nan { f32::NAN } else { 0.0 }.into()));
        }
        Some(Physical::Scalar(Slot::I32)) => body.instruction(&I::I32Const(0)),
        Some(Physical::Scalar(Slot::I64)) => body.instruction(&I::I64Const(0)),
        Some(Physical::Scalar(Slot::V128)) => body.instruction(&I::V128Const(0)),
        None => return Err(format!("absence constant in {:?}", body.ty(result)).into()),
    }
    Ok(())
}

pub(crate) fn erase(
    body: &mut Body<'_, '_>,
    value: ValueId,
    absent: Absent,
) -> Result<(), Failure> {
    crate::arrays::dense(body, value)?;
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
    erase_in(body.m, &mut body.code, ty)
}

/// [`erase_stack`] into any code: a module helper's as well as a body's.
pub(crate) fn erase_in(
    m: &mut Builder<'_>,
    code: &mut ir::Code,
    ty: &HirType,
) -> Result<(), Failure> {
    crate::arrays::dense_stack(m, code, ty)?;
    match ty {
        HirType::Erased
        | HirType::Managed(
            ManagedType::Object(_)
            | ManagedType::Array(_)
            | ManagedType::Map(..)
            | ManagedType::Table(..)
            | ManagedType::Set(_)
            | ManagedType::Date
            | ManagedType::Promise(_)
            | ManagedType::Buffer
            | ManagedType::View(_)
            | ManagedType::AnyView
            | ManagedType::DataView
            | ManagedType::Symbol
            | ManagedType::Template
            | ManagedType::BoxedBigInt,
        ) => {}
        HirType::Bool => {
            code.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
            code.global_get(singleton(m, Singleton::True)?);
            code.instruction(&I::Else);
            code.global_get(singleton(m, Singleton::False)?);
            code.instruction(&I::End);
        }
        HirType::Int { .. } | HirType::Float { .. } => {
            numeric::convert_in(code, ty, &HirType::NUMBER)?;
            code.call(callee(m, Helper::BoxNumber)?);
        }
        HirType::Managed(ManagedType::String) => code.instruction(&I::AnyConvertExtern),
        // A bigint is boxed with its tag, which goes before it in the box.
        HirType::BigInt => {
            code.call(crate::bigints::callee(m, crate::bigints::Helper::Box)?);
        }
        HirType::Void | HirType::NativePointer(_) | HirType::Never => {
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
    if let Some(map) = body.typed_get(value) {
        return crate::collections::typed_value(body, value, map);
    }
    // Held as the stored type, which is what this asks for.
    if body.typed_read(value).is_some() {
        return body.load(value);
    }
    let ty = body.ty(result).clone();
    // A class test on the only edge in already answered this unerase:
    // the value is a non-null object of the type, so one cast is it.
    if body.guarded_cast(result)
        && let Physical::Reference(reference) = body.types().value_slot(&ty)?
    {
        body.load(value)?;
        body.instruction(&I::RefCastNonNull(reference.heap_type));
        return Ok(());
    }
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
                &number_cases(boxed),
                "an erased value read as a number, which it is not",
            )?;
            body.load(value)?;
            call(body, Helper::Number)?;
            numeric::convert(body, &HirType::NUMBER, &ty)?;
        }
        HirType::Managed(ManagedType::String) => {
            body.instruction(&I::Drop);
            nullish(body, value)?;
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
            | ManagedType::Date
            | ManagedType::Promise(_)
            | ManagedType::Buffer
            | ManagedType::View(_)
            | ManagedType::AnyView
            | ManagedType::DataView
            | ManagedType::Symbol
            | ManagedType::Template
            | ManagedType::BoxedBigInt,
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
    let why = "an erased value read as an object of a type it is not";
    // Every typed array is one struct type; its element kind is a field, so a
    // view is told apart by more than its type.
    if let HirType::Managed(ManagedType::View(element)) = ty {
        nullish(body, value)?;
        body.instruction(&I::If(BlockType::Result(ValType::Ref(reference))));
        body.instruction(&I::RefNull(reference.heap_type));
        body.instruction(&I::Else);
        projection_guard(body, value, &[reference.heap_type], why)?;
        crate::buffers::kind_guard(body, value, element)?;
        body.load(value)?;
        body.instruction(&I::RefCastNonNull(reference.heap_type));
        body.instruction(&I::End);
        return Ok(());
    }
    // **The type first.** An erased value read as an object is one nearly
    // always, so one `br_on_cast` answers it. Asking whether it was null or
    // undefined first cost two calls of `value.tag` -- three type tests and
    // two loads apiece -- before the test and the cast the answer needed
    // anyway: four tag calls a round where `h.fn?.(x)` reads one field twice
    // (`optional-chain`, 2026-10-15). A value that is not one is the absence
    // when it is null or undefined, and refused by name otherwise.
    body.instruction(&I::Block(BlockType::Result(ValType::Ref(reference))));
    body.load(value)?;
    body.instruction(&I::BrOnCast {
        relative_depth: 0,
        from_ref_type: RefType::ANYREF,
        to_ref_type: RefType {
            nullable: false,
            heap_type: reference.heap_type,
        },
    });
    body.instruction(&I::Drop);
    nullish(body, value)?;
    contract::require(body, why)?;
    body.instruction(&I::RefNull(reference.heap_type));
    body.instruction(&I::End);
    Ok(())
}

/// Whether erased `value` is null or undefined, as an i32 left on the stack.
/// Whether erased `value` is `null` or `undefined`, as an i32: one of the two
/// singleton boxes (`box_tag_is`), not two whole tags. An optional field read
/// as an object asked it twice per absent read, each `value.tag` opening with
/// a `wasm:js-string` `test` crossing: `optional-chain`, 23.3% of the row by
/// hand (2026-10-20).
fn nullish(body: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    box_tag_is(body, value, &[NULL, UNDEFINED])
}

pub(crate) fn projection_guard(
    body: &mut Body<'_, '_>,
    value: ValueId,
    cases: &[HeapType],
    why: &str,
) -> Result<(), Failure> {
    is_one_of(body, value, cases)?;
    contract::require(body, why)
}

/// Whether `value` is one of `cases`, as an i32.
fn is_one_of(body: &mut Body<'_, '_>, value: ValueId, cases: &[HeapType]) -> Result<(), Failure> {
    for (at, case) in cases.iter().enumerate() {
        body.load(value)?;
        body.instruction(&I::RefTestNonNull(*case));
        if at != 0 {
            body.instruction(&I::I32Or);
        }
    }
    Ok(())
}

/// What an erased number is: an i31, or the number box. One list, so what an
/// unerase admits as a number and what a tag test answers is one cannot
/// drift apart.
fn number_cases(boxed: ErasedTypes) -> [HeapType; 2] {
    [HeapType::I31, HeapType::Concrete(boxed.number)]
}

/// Whether erased `value` has tag `tag`, as an i32, without the rest of the
/// tag (`tag_tests`): a number is an i31 or the number box (`number_cases`),
/// and `undefined`, `null` or a boolean is a box whose first field is its tag.
pub(crate) fn tag_test(body: &mut Body<'_, '_>, value: ValueId, tag: i32) -> Result<(), Failure> {
    let boxed = types(body.m)?;
    if tag == NUMBER {
        return is_one_of(body, value, &number_cases(boxed));
    }
    if ![UNDEFINED, NULL, BOOLEAN].contains(&tag) {
        return Err(Failure::Invariant(format!(
            "tag {tag} has no test of its own"
        )));
    }
    box_tag_is(body, value, &[tag])
}

/// Whether erased `value` is a box whose tag, its first field, is one of
/// `tags`, as an i32. `undefined`, `null` and the booleans are such boxes, and
/// nothing else an erased value holds is a box with their tags.
fn box_tag_is(body: &mut Body<'_, '_>, value: ValueId, tags: &[i32]) -> Result<(), Failure> {
    let tagged = types(body.m)?.tagged;
    body.load(value)?;
    body.instruction(&I::RefTestNonNull(HeapType::Concrete(tagged)));
    body.instruction(&I::If(BlockType::Result(ValType::I32)));
    for (at, tag) in tags.iter().enumerate() {
        body.load(value)?;
        body.instruction(&I::RefCastNonNull(HeapType::Concrete(tagged)));
        body.instruction(&I::StructGet {
            struct_type_index: tagged,
            field_index: 0,
        });
        body.instruction(&I::I32Const(*tag));
        body.instruction(&I::I32Eq);
        if at != 0 {
            body.instruction(&I::I32Or);
        }
    }
    body.instruction(&I::Else);
    body.instruction(&I::I32Const(0));
    body.instruction(&I::End);
    Ok(())
}

/// The tag of an erased value. Of a typed one it is refused by name: a typed
/// reference's null does not say which absence it stands for.
pub(crate) fn tag(body: &mut Body<'_, '_>, result: ValueId, value: ValueId) -> Result<(), Failure> {
    if let Some(map) = body.typed_get(value) {
        return crate::collections::typed_tag(body, result, value, map);
    }
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
