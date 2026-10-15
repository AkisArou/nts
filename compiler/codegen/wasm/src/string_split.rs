//! `String.prototype.split` with a string separator, as C's `nts_str_split`:
//! an empty separator cuts every code unit; any other is found from the left,
//! counted once and cut once, into the program's own `string[]` storage.
//!
//! The search is the host's `indexOf` (`nts_str_index_of_from`), so a match is
//! node's; the pieces are substrings through the string builtins. Nothing
//! crosses back as a JS array.
use crate::{
    body::Body,
    contract,
    error::Failure,
    gc, host,
    ir::Function,
    module::{Builder, Func, FuncKey},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

pub(crate) fn is_split(name: &str) -> bool {
    name == "nts_str_split"
}

pub(crate) fn call(b: &mut Body<'_, '_>, result: ValueId, args: &[ValueId]) -> Result<(), Failure> {
    let &[text, separator] = args else {
        return Err("split arity mismatch".into());
    };
    for &arg in args {
        if !strings::is_string(b.ty(arg)) {
            return Err(format!("split of a {:?}", b.ty(arg)).into());
        }
        contract::nonnull(b, arg, "a null string in a string operation")?;
    }
    let shape = b.types().array(b.ty(result))?;
    if shape.element != HirType::Managed(ManagedType::String) {
        return Err(format!("split into an array of {:?}", shape.element).into());
    }
    let target = callee(b.m, shape)?;
    b.load(text)?;
    b.load(separator)?;
    b.call(target);
    Ok(())
}

fn callee(m: &mut Builder<'_>, shape: &gc::Array) -> Result<Func, Failure> {
    let wrapper = shape.wrapper;
    let backing = shape.backing;
    let descriptor = shape.descriptor;
    m.helper(
        FuncKey::StringSplit(wrapper),
        "string.split",
        vec![strings::STRING, strings::STRING],
        Some(Physical::Reference(RefType {
            nullable: false,
            heap_type: HeapType::Concrete(wrapper),
        })),
        move |m| body(m, wrapper, backing, descriptor),
    )
}

// Params: text, separator. Locals: the text's length, the separator's, the
// piece count, a search position, a match, the backing, pieces written, and
// where the next piece starts.
const TEXT: u32 = 0;
const SEPARATOR: u32 = 1;
const TEXT_LENGTH: u32 = 2;
const SEPARATOR_LENGTH: u32 = 3;
const PIECES: u32 = 4;
const AT: u32 = 5;
const FOUND: u32 = 6;
const STORE: u32 = 7;
const WRITTEN: u32 = 8;
const FROM: u32 = 9;

/// The functions the body calls, and the backing it fills.
struct Calls {
    find: Func,
    substring: Func,
    backing: u32,
}

fn body(
    m: &mut Builder<'_>,
    wrapper: u32,
    backing: u32,
    descriptor: u32,
) -> Result<Function, Failure> {
    let length = strings::callee(m, strings::Helper::Length)?;
    let calls = Calls {
        find: host::external("nts_str_index_of_from")
            .ok_or_else(|| Failure::Invariant("string search service".into()))?
            .callee(m),
        substring: strings::callee(m, strings::Helper::SubstringBuiltin)?,
        backing,
    };
    let descriptor = objects::descriptor(m, descriptor)?;
    let mut f = Function::new([
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::F64,
        ValType::Ref(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(backing),
        }),
        ValType::I32,
        ValType::I32,
    ]);
    f.instruction(&I::LocalGet(TEXT));
    f.call(length);
    f.instructions(&[I::LocalSet(TEXT_LENGTH), I::LocalGet(SEPARATOR)]);
    f.call(length);
    f.instruction(&I::LocalSet(SEPARATOR_LENGTH));
    count(&mut f, &calls);
    objects::push_default(m, &mut f, &HirType::Managed(ManagedType::String))?;
    f.instructions(&[
        I::LocalGet(PIECES),
        I::ArrayNew(backing),
        I::LocalSet(STORE),
    ]);
    cut(&mut f, &calls);
    f.global_get(descriptor);
    f.instructions(&[
        objects::UNHASHED,
        I::LocalGet(PIECES),
        I::LocalGet(STORE),
        I::RefAsNonNull,
        I::I32Const(0),
        I::StructNew(wrapper),
        I::End,
    ]);
    Ok(f)
}

/// The piece count: every unit for an empty separator, else one more than the
/// matches found left to right, each search resuming past the last match.
fn count(f: &mut Function, calls: &Calls) {
    f.instructions(&[
        I::LocalGet(SEPARATOR_LENGTH),
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::LocalGet(TEXT_LENGTH),
        I::LocalSet(PIECES),
        I::Else,
        I::I32Const(1),
        I::LocalSet(PIECES),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(AT),
        I::LocalGet(SEPARATOR_LENGTH),
        I::I32Add,
        I::LocalGet(TEXT_LENGTH),
        I::I32GtU,
        I::BrIf(1),
        I::LocalGet(TEXT),
        I::LocalGet(SEPARATOR),
        I::LocalGet(AT),
        I::F64ConvertI32U,
    ]);
    f.call(calls.find);
    f.instructions(&[
        I::LocalTee(FOUND),
        I::F64Const(0.0.into()),
        I::F64Lt,
        I::BrIf(1),
        I::LocalGet(PIECES),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(PIECES),
        I::LocalGet(FOUND),
        I::I32TruncSatF64U,
        I::LocalGet(SEPARATOR_LENGTH),
        I::I32Add,
        I::LocalSet(AT),
        I::Br(0),
        I::End,
        I::End,
        I::End,
    ]);
}

/// Cut the pieces: each unit, or each piece before a match and then what
/// remains after the last. An empty separator over an empty text has none.
fn cut(f: &mut Function, calls: &Calls) {
    let unit = [I::LocalGet(WRITTEN), I::I32Const(1), I::I32Add];
    f.instructions(&[
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(WRITTEN),
        I::I32Const(1),
        I::I32Add,
        I::LocalGet(PIECES),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(SEPARATOR_LENGTH),
        I::I32Eqz,
        I::If(BlockType::Empty),
    ]);
    piece(f, calls, &[I::LocalGet(WRITTEN)], &unit);
    f.instructions(&[
        I::Br(1),
        I::End,
        I::LocalGet(TEXT),
        I::LocalGet(SEPARATOR),
        I::LocalGet(FROM),
        I::F64ConvertI32U,
    ]);
    f.call(calls.find);
    f.instruction(&I::LocalSet(FOUND));
    piece(
        f,
        calls,
        &[I::LocalGet(FROM)],
        &[I::LocalGet(FOUND), I::I32TruncSatF64U],
    );
    f.instructions(&[
        I::LocalGet(FOUND),
        I::I32TruncSatF64U,
        I::LocalGet(SEPARATOR_LENGTH),
        I::I32Add,
        I::LocalSet(FROM),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(WRITTEN),
        I::LocalGet(PIECES),
        I::I32LtU,
        I::If(BlockType::Empty),
        I::LocalGet(SEPARATOR_LENGTH),
        I::I32Eqz,
        I::If(BlockType::Empty),
    ]);
    piece(f, calls, &[I::LocalGet(WRITTEN)], &unit);
    f.instruction(&I::Else);
    piece(f, calls, &[I::LocalGet(FROM)], &[I::LocalGet(TEXT_LENGTH)]);
    f.instructions(&[I::End, I::End]);
}

/// Store the text's units from `start` to `end` as the next piece.
fn piece(f: &mut Function, calls: &Calls, start: &[I<'static>], end: &[I<'static>]) {
    f.instructions(&[I::LocalGet(STORE), I::LocalGet(WRITTEN), I::LocalGet(TEXT)]);
    f.instructions(start);
    f.instructions(end);
    f.call(calls.substring);
    f.instructions(&[
        I::ArraySet(calls.backing),
        I::LocalGet(WRITTEN),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(WRITTEN),
    ]);
}
