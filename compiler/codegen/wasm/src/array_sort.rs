//! `sort()` with no comparator over a string array: in place, stable, in
//! UTF-16 code unit order, one module-local helper per storage shape.
use crate::{
    arrays,
    body::Body,
    contract,
    error::Failure,
    gc,
    ir::Function,
    module::{Builder, Func, FuncKey},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) fn external(name: &str) -> bool {
    name == "nts_array_sort_str"
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    name: &str,
    args: &[ValueId],
) -> Result<(), Failure> {
    inner(b, result, args).map_err(|error| match error {
        Failure::Unsupported(reason) => {
            Failure::Unsupported(format!("array helper `{name}`: {reason}"))
        }
        Failure::Invariant(reason) => Failure::Invariant(reason),
    })
}
fn inner(b: &mut Body<'_, '_>, result: ValueId, args: &[ValueId]) -> Result<(), Failure> {
    let [array] = args else {
        return Err("sort arity mismatch".into());
    };
    let shape = b.types().array(b.ty(*array))?;
    if !strings::is_string(&shape.element) {
        return Err(format!("default sort over element {:?}", shape.element).into());
    }
    contract::nonnull(b, *array, "sorting a null array")?;
    b.load(*array)?;
    strings::constant(b, &b.func.name.clone());
    let target = callee(b.m, shape)?;
    b.call(target);
    if b.ty(result) == &HirType::Void {
        b.instruction(&I::Drop);
        Ok(())
    } else {
        objects::adapt(b, &b.ty(*array).clone(), &b.ty(result).clone())
    }
}
fn callee(m: &mut Builder<'_>, shape: &gc::Array) -> Result<Func, Failure> {
    let array = Physical::Reference(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(shape.wrapper),
    });
    m.helper(
        FuncKey::ArraySort(shape.wrapper),
        format!("array.sort<{:?}>", shape.element),
        vec![array, strings::STRING],
        Some(array),
        |m| body(shape, m),
    )
}
// Params: the array, and the caller's name for a refusal. Then the locals.
const LENGTH: u32 = 2;
/// The runs being read.
const FROM: u32 = 3;
/// The runs being written.
const INTO: u32 = 4;
const WIDTH: u32 = 5;
/// One merge: `[START, MIDDLE)` and `[MIDDLE, END)` into `[START, END)`.
const START: u32 = 6;
const MIDDLE: u32 = 7;
const END: u32 = 8;
const LEFT: u32 = 9;
const RIGHT: u32 = 10;
/// The slot being scanned or written.
const AT: u32 = 11;

/// A null slot is refused by name: node sorts `undefined` last and `null` as
/// the text "null", and one storage holds both. Then a bottom-up merge sort,
/// as the C runtime's: widths double until one run covers the array. A width
/// doubles only while twice it is below the length, so it cannot overflow.
fn body(shape: &gc::Array, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let run = ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(shape.backing),
    });
    let mut f = Function::new([
        ValType::I32,
        run,
        run,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
    ]);
    let backing = I::StructGet {
        struct_type_index: shape.wrapper,
        field_index: 2,
    };
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: 1,
        },
        I::LocalTee(LENGTH),
        I::I32Const(2),
        I::I32LtU,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::Return,
        I::End,
        I::LocalGet(0),
        backing.clone(),
        I::LocalSet(FROM),
    ]);
    no_null_slot(&mut f, shape, m)?;
    f.instructions(&[
        I::RefNull(HeapType::EXTERN),
        I::LocalGet(LENGTH),
        I::ArrayNew(shape.backing),
        I::LocalSet(INTO),
        I::I32Const(1),
        I::LocalSet(WIDTH),
        // One pass per width, and one merge per pair of runs.
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::I32Const(0),
        I::LocalSet(START),
        I::Loop(BlockType::Empty),
        I::LocalGet(START),
    ]);
    min(&mut f, WIDTH, START);
    f.instructions(&[I::I32Add, I::LocalSet(MIDDLE), I::LocalGet(MIDDLE)]);
    min(&mut f, WIDTH, MIDDLE);
    f.instructions(&[I::I32Add, I::LocalSet(END)]);
    merge(&mut f, shape, m)?;
    f.instructions(&[
        I::LocalGet(END),
        I::LocalTee(START),
        I::LocalGet(LENGTH),
        I::I32LtU,
        I::BrIf(0),
        I::End,
        // The runs just written are read next.
        I::LocalGet(FROM),
        I::LocalGet(INTO),
        I::LocalSet(FROM),
        I::LocalSet(INTO),
        // Done once one run covers the array.
        I::LocalGet(WIDTH),
        I::LocalGet(LENGTH),
        I::LocalGet(WIDTH),
        I::I32Sub,
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(WIDTH),
        I::I32Const(1),
        I::I32Shl,
        I::LocalSet(WIDTH),
        I::Br(0),
        I::End,
        I::End,
    ]);
    copy_back(&mut f, shape);
    Ok(f)
}
/// The sorted run is the array's own storage, or is copied back into it; then
/// the array, which `sort` answers.
fn copy_back(f: &mut Function, shape: &gc::Array) {
    let backing = I::StructGet {
        struct_type_index: shape.wrapper,
        field_index: 2,
    };
    f.instructions(&[
        I::LocalGet(FROM),
        I::LocalGet(0),
        backing.clone(),
        I::RefEq,
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        backing,
        I::I32Const(0),
        I::LocalGet(FROM),
        I::I32Const(0),
        I::LocalGet(LENGTH),
        I::ArrayCopy {
            array_type_index_dst: shape.backing,
            array_type_index_src: shape.backing,
        },
        I::End,
        I::LocalGet(0),
        I::End,
    ]);
}
/// Pushes `min(width, length - from)`: `select` keeps the first where the
/// condition holds.
fn min(f: &mut Function, width: u32, from: u32) {
    let rest = [I::LocalGet(LENGTH), I::LocalGet(from), I::I32Sub];
    f.instruction(&I::LocalGet(width));
    f.instructions(&rest);
    f.instruction(&I::LocalGet(width));
    f.instructions(&rest);
    f.instructions(&[I::I32LtU, I::Select]);
}
fn no_null_slot(f: &mut Function, shape: &gc::Array, m: &mut Builder<'_>) -> Result<(), Failure> {
    f.instructions(&[
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(AT),
        I::LocalGet(LENGTH),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(FROM),
        I::LocalGet(AT),
        arrays::get_instruction(shape)?,
        I::RefIsNull,
        I::If(BlockType::Empty),
    ]);
    contract::refuse_in(
        f,
        m,
        1,
        "sorting a null slot: undefined sorts last and null as \"null\", and the slot does not say which",
    )?;
    f.instructions(&[
        I::End,
        I::LocalGet(AT),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(AT),
        I::Br(0),
        I::End,
        I::End,
    ]);
    Ok(())
}
/// One merge. The left element is taken unless the left run is spent or the
/// right element sorts strictly before it: `<=` on a tie is what makes the
/// sort stable.
fn merge(f: &mut Function, shape: &gc::Array, m: &mut Builder<'_>) -> Result<(), Failure> {
    let compare = strings::callee(m, strings::Helper::Compare)?;
    let get = arrays::get_instruction(shape)?;
    let take = |cursor| {
        [
            I::LocalGet(FROM),
            I::LocalGet(cursor),
            get.clone(),
            I::LocalGet(cursor),
            I::I32Const(1),
            I::I32Add,
            I::LocalSet(cursor),
        ]
    };
    f.instructions(&[
        I::LocalGet(START),
        I::LocalSet(LEFT),
        I::LocalGet(MIDDLE),
        I::LocalSet(RIGHT),
        I::LocalGet(START),
        I::LocalSet(AT),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(AT),
        I::LocalGet(END),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(INTO),
        I::LocalGet(AT),
        I::LocalGet(LEFT),
        I::LocalGet(MIDDLE),
        I::I32LtU,
        I::If(BlockType::Result(ValType::I32)),
        I::LocalGet(RIGHT),
        I::LocalGet(END),
        I::I32GeU,
        I::If(BlockType::Result(ValType::I32)),
        I::I32Const(1),
        I::Else,
        I::LocalGet(FROM),
        I::LocalGet(LEFT),
        get.clone(),
        I::LocalGet(FROM),
        I::LocalGet(RIGHT),
        get.clone(),
    ]);
    f.call(compare);
    f.instructions(&[
        I::I32Const(0),
        I::I32LeS,
        I::End,
        I::Else,
        I::I32Const(0),
        I::End,
        I::If(BlockType::Result(ValType::Ref(RefType::EXTERNREF))),
    ]);
    f.instructions(&take(LEFT));
    f.instruction(&I::Else);
    f.instructions(&take(RIGHT));
    f.instructions(&[
        I::End,
        I::ArraySet(shape.backing),
        I::LocalGet(AT),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(AT),
        I::Br(0),
        I::End,
        I::End,
    ]);
    Ok(())
}
