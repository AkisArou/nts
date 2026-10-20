//! Array wrappers keep identity while typed backing storage grows.

use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    gc, ir,
    ir::Function,
    module::{Builder, Func, FuncKey, GlobalKey},
    numeric, objects,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, OpKind, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
const F64: HirType = HirType::Float { bits: 64 };

pub(crate) fn operation(
    b: &mut Body<'_, '_>,
    result: ValueId,
    kind: &OpKind,
) -> Result<(), Failure> {
    // A view's element is the same operation over a buffer's bytes.
    match kind {
        OpKind::ArrayNew { length, .. } => new(b, result, *length),
        OpKind::ConstTemplate { site, cooked } => template(b, result, *site, cooked),
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } if crate::buffers::is_view(b.ty(*array)) => {
            crate::buffers::get(b, result, *array, *index, *checked)
        }
        OpKind::ArraySet {
            array,
            index,
            value,
            checked,
        } if crate::buffers::is_view(b.ty(*array)) => {
            crate::buffers::set(b, result, *array, *index, *value, *checked)
        }
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } => get(b, result, *array, *index, *checked),
        OpKind::ArraySet {
            array,
            index,
            value,
            checked,
        } => set(b, result, *array, *index, *value, *checked),
        other => Err(Failure::Invariant(format!(
            "non-array operation routed to arrays: {other:?}"
        ))),
    }
}

/// An array, or a tagged template's cooked strings, which are read as one.
pub(crate) fn is_array(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Managed(ManagedType::Array(_) | ManagedType::Template)
    )
}
fn storage<'p>(b: &Body<'_, 'p>, array: ValueId) -> Result<&'p gc::Array, Failure> {
    b.types().array(b.ty(array))
}
pub(crate) fn number(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &F64)
}
pub(crate) fn index(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    numeric::convert(b, &b.ty(value).clone(), &U32)
}
/// Convert only after `valid_index` has guarded this GC-array access (and,
/// when appending, after the capacity check and growth). Its whole,
/// nonnegative index is below the engine's GC-array limit, under 2^30, so a
/// signed trapping conversion is exact, including -0. Floating storage alone
/// proves none of this. Keep `index`'s total conversion for other callers,
/// especially linear-memory views whose offsets can exceed signed i32.
fn checked_gc_index(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    let instruction = match b.ty(value) {
        HirType::Float { bits: 32 } => I::I32TruncF32S,
        HirType::Float { bits: 64 } => I::I32TruncF64S,
        _ => return index(b, value),
    };
    b.load(value)?;
    b.instruction(&instruction);
    Ok(())
}
pub(crate) fn whole_nonnegative(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    match b.ty(value) {
        HirType::Int {
            bits: 8 | 16 | 32,
            signed: true,
        } => {
            b.load(value)?;
            b.instruction(&I::I32Const(0));
            b.instruction(&I::I32GeS);
        }
        HirType::Int {
            bits: 64,
            signed: true,
        } => {
            b.load(value)?;
            b.instruction(&I::I64Const(0));
            b.instruction(&I::I64GeS);
        }
        HirType::Int {
            bits: 8 | 16 | 32 | 64,
            signed: false,
        } => b.instruction(&I::I32Const(1)),
        HirType::Float { bits: 32 | 64 } => {
            number(b, value)?;
            b.instruction(&I::F64Const(0.0.into()));
            b.instruction(&I::F64Ge);
            number(b, value)?;
            number(b, value)?;
            b.instruction(&I::F64Trunc);
            b.instruction(&I::F64Eq);
            b.instruction(&I::I32And);
        }
        HirType::Void
        | HirType::Never
        | HirType::Bool
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::Erased
        | HirType::Managed(_)
        | HirType::BigInt
        | HirType::NativePointer(_) => {
            return Err(format!("array index with type {:?}", b.ty(value)).into());
        }
    }
    Ok(())
}
pub(crate) fn logical_length(b: &mut Body<'_, '_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: ty,
        field_index: crate::gc::ARRAY_LENGTH,
    });
    Ok(())
}
pub(crate) fn valid_index(
    b: &mut Body<'_, '_>,
    array: ValueId,
    value: ValueId,
    append: bool,
) -> Result<(), Failure> {
    let ty = storage(b, array)?.wrapper;
    within(b, value, append, |b| logical_length(b, array, ty))
}
/// Whether `value` is a whole index below the `i32` length `length` pushes,
/// or at it when appending: an array's or a typed array's.
///
/// **Every such length counts the elements of GC-array storage, or the code
/// units of a JS string**, which the engine caps under 2^30, so it is a
/// nonnegative `i32`; a narrow index is checked by one unsigned comparison on
/// that premise. A length that is
/// not GC storage -- a view of linear memory, a buffer past 2^31 -- breaks it:
/// the comparison would accept a negative index wrapped past the length. A
/// debug build of this compiler checks the premise in what it emits.
pub(crate) fn within(
    b: &mut Body<'_, '_>,
    value: ValueId,
    append: bool,
    length: impl Fn(&mut Body<'_, '_>) -> Result<(), Failure>,
) -> Result<(), Failure> {
    if let HirType::Int {
        bits: 8 | 16 | 32, ..
    } = b.ty(value)
    {
        // A signed index below zero reads as at least 2^31 unsigned, past every
        // length, so the unsigned comparison alone refuses it. Tested beside
        // it, the sign cost V8 a third of AWFY's sieve: it computes both
        // comparisons and their `and` rather than branching once.
        if cfg!(debug_assertions) {
            // The premise above, where the debug compiler's tests run it: a
            // length that reads as negative is one this comparison cannot
            // check. A trap, because it is this compiler's defect.
            length(b)?;
            b.instruction(&I::I32Const(0));
            b.instruction(&I::I32LtS);
            b.instruction(&I::If(BlockType::Empty));
            b.instruction(&I::Unreachable);
            b.instruction(&I::End);
        }
        index(b, value)?;
        length(b)?;
        b.instruction(&if append { I::I32LeU } else { I::I32LtU });
        return Ok(());
    }
    whole_nonnegative(b, value)?;
    match b.ty(value) {
        HirType::Int { bits: 64, .. } => {
            b.load(value)?;
            length(b)?;
            b.instruction(&I::I64ExtendI32U);
            b.instruction(&if append { I::I64LeU } else { I::I64LtU });
        }
        HirType::Float { bits: 32 | 64 } => {
            number(b, value)?;
            length(b)?;
            b.instruction(&I::F64ConvertI32U);
            b.instruction(&if append { I::F64Le } else { I::F64Lt });
        }
        HirType::Void
        | HirType::Never
        | HirType::Bool
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::Erased
        | HirType::Managed(_)
        | HirType::BigInt
        | HirType::NativePointer(_) => {
            return Err(format!("array index with type {:?}", b.ty(value)).into());
        }
    }
    b.instruction(&I::I32And);
    Ok(())
}
pub(crate) fn new(b: &mut Body<'_, '_>, result: ValueId, length: ValueId) -> Result<(), Failure> {
    let array = storage(b, result)?;
    if length_test(b, length)? {
        contract::require(
            b,
            "an array length that is not a whole number up to 2^32 - 1",
        )?;
    }
    let descriptor = objects::descriptor(b.m, array.descriptor)?;
    b.global_get(descriptor);
    b.instruction(&objects::UNHASHED);
    index(b, length)?;
    objects::default(b, &array.element)?;
    index(b, length)?;
    b.instruction(&I::ArrayNew(array.backing));
    b.instruction(&I::I32Const(0));
    let prefix = if b.types().array_init.tracks(b.func, result) {
        0
    } else {
        -1
    };
    b.instructions(&wrapper(array, prefix));
    Ok(())
}
/// Push whether `length` is one an array can have, a whole number from 0 to
/// 2^32 - 1, and say whether there was anything to test. A constant that is
/// one, or an unsigned integer of 32 bits or fewer, is one by its value or its
/// type and is not tested again. A signed integer of 32 bits or fewer can fail
/// only by its sign; a 64-bit one is tested by one unsigned comparison, which a
/// negative one fails as a value past 2^63.
fn length_test(b: &mut Body<'_, '_>, length: ValueId) -> Result<bool, Failure> {
    let known = nts_core::hir::holes::constant_length(b.func, length).is_some();
    match b.ty(length).clone() {
        _ if known => return Ok(false),
        HirType::Int {
            bits: 8 | 16 | 32,
            signed: false,
        } => return Ok(false),
        HirType::Int {
            bits: 8 | 16 | 32,
            signed: true,
        } => whole_nonnegative(b, length)?,
        HirType::Int { bits: 64, .. } => {
            b.load(length)?;
            b.instruction(&I::I64Const(i64::from(u32::MAX)));
            b.instruction(&I::I64LeU);
        }
        _ => {
            whole_nonnegative(b, length)?;
            number(b, length)?;
            b.instruction(&I::F64Const(f64::from(u32::MAX).into()));
            b.instruction(&I::F64Le);
            b.instruction(&I::I32And);
        }
    }
    Ok(true)
}
/// A tagged template's cooked strings: one immortal object per source site,
/// shared by every copy of the containing function, as the core asks, and
/// built once as a constant.
fn template(
    b: &mut Body<'_, '_>,
    result: ValueId,
    site: u32,
    cooked: &[String],
) -> Result<(), Failure> {
    let shape = storage(b, result)?;
    let (wrapper, backing, descriptor) = (shape.wrapper, shape.backing, shape.descriptor);
    let global = b.m.global(GlobalKey::Template(site), |m| {
        let descriptor = objects::descriptor(m, descriptor)?;
        let pieces: Vec<_> = cooked.iter().map(|text| m.literal(text)).collect();
        let length =
            u32::try_from(pieces.len()).map_err(|_| Failure::from("too many template pieces"))?;
        let mut code = ir::Code::default();
        code.global_get(descriptor);
        code.instructions(&[objects::UNHASHED, I::I32Const(length.cast_signed())]);
        for piece in pieces {
            code.global_get(piece);
        }
        code.instructions(&[
            I::ArrayNewFixed {
                array_type_index: backing,
                array_size: length,
            },
            I::I32Const(0),
        ]);
        code.instructions(&self::wrapper(shape, -1));
        Ok((crate::module::constant_type(wrapper), code))
    })?;
    b.global_get(global);
    Ok(())
}
pub(crate) fn length(b: &mut Body<'_, '_>, result: ValueId, array: ValueId) -> Result<(), Failure> {
    let ty = storage(b, array)?.wrapper;
    contract::nonnull(b, array, "the length of a null array")?;
    logical_length(b, array, ty)?;
    numeric::convert(b, &U32, &b.ty(result).clone())
}
/// Mark `array`, a `(T | null)[]` being erased, as holding `null` in its null
/// slots: a read where its type is gone answers one as `null` rather than
/// `undefined` (`null_slot`). C's `nts_array_mark_null_slots`; a null array
/// has nothing to mark.
pub(crate) fn mark_null_slots(b: &mut Body<'_, '_>, array: ValueId) -> Result<(), Failure> {
    let wrapper = b.types().array(b.ty(array))?.wrapper;
    let nullable = matches!(
        b.types().value_slot(b.ty(array))?,
        Physical::Reference(RefType { nullable: true, .. })
    );
    if nullable {
        b.instruction(&I::Block(BlockType::Empty));
        b.load(array)?;
        b.instruction(&I::BrOnNull(0));
        b.instruction(&I::Drop);
    }
    b.load(array)?;
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: wrapper,
        field_index: gc::ARRAY_FLAGS,
    });
    b.instructions(&[
        I::I32Const(gc::NULL_SLOTS),
        I::I32Or,
        I::StructSet {
            struct_type_index: wrapper,
            field_index: gc::ARRAY_FLAGS,
        },
    ]);
    if nullable {
        b.instruction(&I::End);
    }
    Ok(())
}

/// What a null slot of `array` reads as where its type is gone, as an open
/// value: `null` where the read site's type says so (`site` is `null`'s tag)
/// or the array was marked when it was erased (`mark_null_slots`),
/// `undefined` otherwise. `site` is the element read's third operand.
pub(crate) fn null_slot(
    b: &mut Body<'_, '_>,
    array: ValueId,
    wrapper: u32,
    site: ValueId,
) -> Result<(), Failure> {
    let null = erased::singleton(b.m, erased::Singleton::Null)?;
    let undefined = erased::singleton(b.m, erased::Singleton::Undefined)?;
    match b.func.value(site).kind {
        OpKind::ConstInt(tag) if tag == i128::from(erased::NULL) => {
            b.global_get(null);
            return Ok(());
        }
        OpKind::ConstInt(tag) if tag == i128::from(erased::UNDEFINED) => {}
        _ => {
            b.load(site)?;
            b.instructions(&[I::I32Const(erased::NULL), I::I32Eq]);
        }
    }
    b.load(array)?;
    b.instructions(&[
        I::StructGet {
            struct_type_index: wrapper,
            field_index: gc::ARRAY_FLAGS,
        },
        I::I32Const(gc::NULL_SLOTS),
        I::I32And,
    ]);
    if !matches!(b.func.value(site).kind, OpKind::ConstInt(_)) {
        b.instruction(&I::I32Or);
    }
    b.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    b.global_get(null);
    b.instruction(&I::Else);
    b.global_get(undefined);
    b.instruction(&I::End);
    Ok(())
}

pub(crate) fn backing(b: &mut Body<'_, '_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: ty,
        field_index: crate::gc::ARRAY_BACKING,
    });
    Ok(())
}
pub(crate) fn get_instruction(array: &gc::Array) -> Result<I<'static>, Failure> {
    Ok(match &array.element {
        HirType::Int {
            bits: 8 | 16,
            signed: true,
        } => I::ArrayGetS(array.backing),
        HirType::Int {
            bits: 8 | 16,
            signed: false,
        } => I::ArrayGetU(array.backing),
        HirType::Bool
        | HirType::Int { bits: 32 | 64, .. }
        | HirType::Float { bits: 32 | 64 }
        | HirType::BigInt
        | HirType::Erased
        | HirType::Managed(_) => I::ArrayGet(array.backing),
        HirType::Void
        | HirType::Never
        | HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::NativePointer(_) => {
            return Err(format!("array element read of {:?}", array.element).into());
        }
    })
}
pub(crate) fn get(
    b: &mut Body<'_, '_>,
    result: ValueId,
    array: ValueId,
    at: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    let shape = storage(b, array)?;
    contract::nonnull(b, array, "reading an element of a null array")?;
    // An unchecked read's index the core proved whole and inside the array
    // (`proven`), so only a checked one is tested.
    if checked {
        valid_index(b, array, at, false)?;
    }
    let absent = checked && shape.element == HirType::Erased;
    if absent {
        if b.ty(result) != &HirType::Erased {
            return Err(Failure::Invariant(
                "non-erased checked value-array read".into(),
            ));
        }
        b.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    } else if checked {
        contract::require(
            b,
            "an index past the end, whose undefined this element type cannot hold",
        )?;
    }
    initialized(b, shape, array, at)?;
    backing(b, array, shape.wrapper)?;
    checked_gc_index(b, at)?;
    b.instruction(&get_instruction(shape)?);
    objects::adapt(b, &shape.element, &b.ty(result).clone())?;
    if absent {
        b.instruction(&I::Else);
        let undefined = erased::singleton(b.m, erased::Singleton::Undefined)?;
        b.global_get(undefined);
        b.instruction(&I::End);
    }
    Ok(())
}
pub(crate) fn set(
    b: &mut Body<'_, '_>,
    result: ValueId,
    array: ValueId,
    at: ValueId,
    value: ValueId,
    checked: bool,
) -> Result<(), Failure> {
    if b.ty(result) != &HirType::Void {
        return Err(Failure::Invariant("non-void ArraySet result".into()));
    }
    if b.ty(array) == &HirType::Managed(ManagedType::Template) {
        return Err("a write into a template object, whose strings are immutable".into());
    }
    let shape = storage(b, array)?;
    contract::nonnull(b, array, "writing an element of a null array")?;
    // An unchecked write's index the core proved whole and inside the array
    // (`proven`): it is stored with no test.
    if !checked {
        return store(b, shape, array, at, value);
    }
    valid_index(b, array, at, false)?;
    if !nts_core::hir::array_write_may_grow(b.func, array) {
        contract::require(b, PAST_THE_END)?;
        return store(b, shape, array, at, value);
    }
    // A write inside the array is the one a loop makes nearly every time, so
    // it is tested alone and guards the store alone. Growing by the slot at
    // the end, and refusing past it, are the other arm. In line, their
    // comparisons and the call to grow ran on every write, and the call kept
    // the engine reloading the length and the storage each iteration: AWFY's
    // sieve took 13.1 us on V8 against 6.2 for its C++ as WebAssembly.
    b.instruction(&I::If(BlockType::Empty));
    store(b, shape, array, at, value)?;
    b.instruction(&I::Else);
    valid_index(b, array, at, true)?;
    contract::require(b, PAST_THE_END)?;
    append_slot(b, array, shape.wrapper)?;
    store(b, shape, array, at, value)?;
    b.instruction(&I::End);
    Ok(())
}
/// Why a write that is not inside the array and not at its end refuses.
const PAST_THE_END: &str = "a write past the end, which would leave holes this array cannot hold";

// # Proven
//
// An access the core marks unchecked (`checked: false`) has an index it proved
// whole and inside the array, so its read or write tests nothing: C stores
// through the bare index on the same proof (`slot_expression`), and here the
// backing's own `array.get` or `array.set` still traps past its storage, so a
// false proof -- a compiler bug on every backend -- cannot reach past it. The
// written-prefix test (`initialized`) is another question and stays.
//
// Re-testing them cost more than the tests: a module-scope literal of 2048
// records is that many unchecked writes into one `array.new`, and a refusal
// `if` per write over a local per record made V8's baseline compiler, whose
// state spans every local at every merge, take 480 MB for module evaluation,
// and fail under the differential's 2 GB address-space bound. Untested it
// takes 57 MB (2026-10-20).
/// Store `value` in the slot `at` of `array`, an index already known to be in
/// its storage.
fn store(
    b: &mut Body<'_, '_>,
    shape: &gc::Array,
    array: ValueId,
    at: ValueId,
    value: ValueId,
) -> Result<(), Failure> {
    backing(b, array, shape.wrapper)?;
    checked_gc_index(b, at)?;
    b.load(value)?;
    objects::adapt(b, &b.ty(value).clone(), &shape.element)?;
    b.instruction(&I::ArraySet(shape.backing));
    if let Some(prefix) = shape.prefix {
        checked_gc_index(b, at)?;
        b.load(array)?;
        b.instruction(&I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: prefix,
        });
        b.instruction(&I::I32Eq);
        b.instruction(&I::If(BlockType::Empty));
        b.load(array)?;
        checked_gc_index(b, at)?;
        b.instructions(&[
            I::I32Const(1),
            I::I32Add,
            I::StructSet {
                struct_type_index: shape.wrapper,
                field_index: prefix,
            },
            I::End,
        ]);
    }
    Ok(())
}

/// Construct one wrapper. A negative prefix means every logical slot is
/// proven written; a nonnegative prefix holds its exact conservative bound.
/// A separate word holds every prefix through `i32::MAX` without flag packing.
pub(crate) fn wrapper(shape: &gc::Array, prefix: i32) -> Vec<I<'static>> {
    let mut code = Vec::new();
    if shape.prefix.is_some() {
        code.push(I::I32Const(prefix));
    }
    code.push(I::StructNew(shape.wrapper));
    code
}

fn initialized(
    b: &mut Body<'_, '_>,
    shape: &gc::Array,
    array: ValueId,
    at: ValueId,
) -> Result<(), Failure> {
    let Some(prefix) = shape.prefix else {
        return Ok(());
    };
    // Bounds have already guarded the total-to-GC index conversion. The
    // dense sentinel (-1 as unsigned) admits every representable valid index.
    checked_gc_index(b, at)?;
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: shape.wrapper,
        field_index: prefix,
    });
    b.instruction(&I::I32LtU);
    contract::require(b, crate::array_init::HOLE)
}

/// Consumers that do not carry a partial initialization contract require all
/// logical slots. Null is left to the consumer's existing null contract.
pub(crate) fn dense(b: &mut Body<'_, '_>, array: ValueId) -> Result<(), Failure> {
    if !is_array(b.ty(array)) {
        return Ok(());
    }
    let shape = storage(b, array)?;
    let Some(prefix) = shape.prefix else {
        return Ok(());
    };
    b.load(array)?;
    b.instructions(&[I::RefIsNull, I::I32Eqz, I::If(BlockType::Empty)]);
    b.load(array)?;
    b.instruction(&I::StructGet {
        struct_type_index: shape.wrapper,
        field_index: prefix,
    });
    logical_length(b, array, shape.wrapper)?;
    b.instruction(&I::I32GeU);
    contract::require(b, crate::array_init::HOLE)?;
    b.instruction(&I::End);
    Ok(())
}

pub(crate) fn mark_dense(b: &mut Body<'_, '_>, array: ValueId) -> Result<(), Failure> {
    if !is_array(b.ty(array)) {
        return Ok(());
    }
    let shape = storage(b, array)?;
    let Some(prefix) = shape.prefix else {
        return Ok(());
    };
    b.load(array)?;
    b.instructions(&[I::RefIsNull, I::I32Eqz, I::If(BlockType::Empty)]);
    b.load(array)?;
    b.instructions(&[
        I::I32Const(-1),
        I::StructSet {
            struct_type_index: shape.wrapper,
            field_index: prefix,
        },
        I::End,
    ]);
    Ok(())
}

/// Preserve an array on the stack while enforcing the erasure boundary's
/// dense-array contract. Helpers erasing nested array elements use this path.
pub(crate) fn dense_stack(
    m: &mut Builder<'_>,
    code: &mut ir::Code,
    ty: &HirType,
) -> Result<(), Failure> {
    if !is_array(ty) {
        return Ok(());
    }
    let shape = m.types.array(ty)?;
    let Some(prefix) = shape.prefix else {
        return Ok(());
    };
    let wrapper = shape.wrapper;
    let physical = m.types.value_slot(ty)?;
    let target = m.helper(
        FuncKey::ArrayDense(wrapper),
        format!("array.require_dense<{wrapper}>"),
        vec![physical],
        Some(physical),
        |m| {
            let decline = contract::decline(m)?;
            let name = m.literal("erasing a typed array");
            let reason = m.literal(crate::array_init::HOLE);
            let mut f = Function::default();
            f.instructions(&[
                I::LocalGet(0),
                I::RefIsNull,
                I::If(BlockType::Empty),
                I::LocalGet(0),
                I::Return,
                I::End,
                I::LocalGet(0),
                I::StructGet {
                    struct_type_index: wrapper,
                    field_index: prefix,
                },
                I::LocalGet(0),
                I::StructGet {
                    struct_type_index: wrapper,
                    field_index: gc::ARRAY_LENGTH,
                },
                I::I32LtU,
                I::If(BlockType::Empty),
            ]);
            f.global_get(name);
            f.global_get(reason);
            f.call(decline);
            f.instructions(&[I::Unreachable, I::End, I::LocalGet(0), I::End]);
            Ok(f)
        },
    )?;
    code.call(target);
    Ok(())
}
/// Grow the array by the slot at its end, which the index is known to name.
fn append_slot(b: &mut Body<'_, '_>, array: ValueId, ty: u32) -> Result<(), Failure> {
    let shape = b
        .types()
        .arrays
        .get(&ty)
        .ok_or_else(|| Failure::Invariant(format!("unplanned array growth for type {ty}")))?;
    let helper = grow(b.m, shape)?;
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Const(capacity(&shape.element)));
    b.instruction(&I::I32LtU);
    contract::require(b, PAST_CAPACITY)?;
    b.load(array)?;
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.call(helper);
    b.load(array)?;
    logical_length(b, array, ty)?;
    b.instruction(&I::I32Const(1));
    b.instruction(&I::I32Add);
    b.instruction(&I::StructSet {
        struct_type_index: ty,
        field_index: crate::gc::ARRAY_LENGTH,
    });
    Ok(())
}
/// Growth past [`capacity`]: the engine would trap allocating the storage.
pub(crate) const PAST_CAPACITY: &str =
    "an array longer than this engine holds, where node throws a RangeError";

/// The longest an array of `element` grows. The engine refuses a GC array
/// past 2^30 bytes (V8, measured: 2^30 - 25 one-byte elements, 2^27 - 4
/// eight-byte ones, a reference taking eight), and its `array.new` traps
/// there, so growth stops a little short and refuses by name. Node's own
/// arrays throw a `RangeError` near the same length.
pub(crate) fn capacity(element: &HirType) -> i32 {
    let bytes = match element {
        HirType::Int { bits: 8, .. } => 1,
        HirType::Int { bits: 16, .. } => 2,
        HirType::Int { bits: 32, .. } | HirType::Float { bits: 32 } | HirType::Bool => 4,
        HirType::BigInt => 16,
        _ => 8,
    };
    ((1 << 30) - 64) / bytes
}

/// The helper that grows an array's backing to at least a capacity,
/// preserving the wrapper and therefore every alias of it. A capacity past
/// [`capacity`] refuses by name; doubling stops at it.
pub(crate) fn grow(m: &mut Builder<'_>, shape: &gc::Array) -> Result<Func, Failure> {
    m.helper(
        FuncKey::ArrayGrow(shape.wrapper),
        format!("array.grow<{:?}>", shape.element),
        vec![
            Physical::Reference(RefType {
                nullable: true,
                heap_type: HeapType::Concrete(shape.wrapper),
            }),
            Physical::Scalar(Slot::I32),
        ],
        None,
        |m| grow_body(shape, m),
    )
}
fn grow_body(shape: &gc::Array, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let limit = capacity(&shape.element);
    let decline = contract::decline(m)?;
    let name = m.literal("array growth");
    let why = m.literal(PAST_CAPACITY);
    let mut f = Function::new([
        ValType::I32,
        ValType::Ref(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(shape.backing),
        }),
    ]);
    f.instructions(&[
        I::LocalGet(1),
        I::I32Const(limit),
        I::I32GtU,
        I::If(BlockType::Empty),
    ]);
    f.global_get(name);
    f.global_get(why);
    f.call(decline);
    f.instructions(&[I::Unreachable, I::End]);
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_BACKING,
        },
        I::ArrayLen,
        I::LocalTee(2),
        I::LocalGet(1),
        I::I32GeU,
        I::If(BlockType::Empty),
        I::Return,
        I::End,
        I::LocalGet(2),
        I::I32Const(i32::MAX),
        I::I32LeU,
        I::If(BlockType::Result(ValType::I32)),
        I::LocalGet(2),
        I::I32Const(1),
        I::I32Shl,
        I::Else,
        I::I32Const(-1),
        I::End,
        I::LocalSet(2),
        I::LocalGet(2),
        I::LocalGet(1),
        I::I32LtU,
        I::If(BlockType::Empty),
        I::LocalGet(1),
        I::LocalSet(2),
        I::End,
        I::LocalGet(2),
        I::I32Const(4),
        I::I32LtU,
        I::If(BlockType::Empty),
        I::I32Const(4),
        I::LocalSet(2),
        I::End,
        I::LocalGet(2),
        I::I32Const(limit),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::I32Const(limit),
        I::LocalSet(2),
        I::End,
    ]);
    objects::push_default(m, &mut f, &shape.element)?;
    f.instructions(&[
        I::LocalGet(2),
        I::ArrayNew(shape.backing),
        I::LocalSet(3),
        I::LocalGet(3),
        I::I32Const(0),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_BACKING,
        },
        I::I32Const(0),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_LENGTH,
        },
        I::ArrayCopy {
            array_type_index_dst: shape.backing,
            array_type_index_src: shape.backing,
        },
        I::LocalGet(0),
        I::LocalGet(3),
        I::RefAsNonNull,
        I::StructSet {
            struct_type_index: shape.wrapper,
            field_index: crate::gc::ARRAY_BACKING,
        },
        I::End,
    ]);
    Ok(f)
}
