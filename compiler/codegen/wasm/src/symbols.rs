//! Symbols, as the C runtime's `NtsSymbol` (`runtime/c`): a cell whose
//! identity is its address, holding its description.
//!
//! A symbol is an object-root struct whose descriptor's kind is `SYMBOL`, so
//! `typeof` answers "symbol", `===` is `ref.eq`, and a symbol keys a Map by
//! the root's identity hash. Its description is a JS string or null, the
//! difference between `Symbol("")` and `Symbol()`.
//!
//! `Symbol.for` keeps a registry from key to symbol in a string-keyed table,
//! the same table a `Map<string, unknown>` is, made once when the module is.
//! A registered symbol's description is its key, so `Symbol.keyFor` looks its
//! description up and answers it when the registry holds that very symbol.
use crate::{
    body::Body,
    contract,
    error::Failure,
    gc::{Collection, ROOT_FIELDS, SymbolTypes},
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

/// The description, after the root.
const DESCRIPTION: u32 = ROOT_FIELDS;

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    New,
    For,
    KeyFor,
    Description,
    ToString,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_symbol_new" => Op::New,
        "nts_symbol_for" => Op::For,
        "nts_symbol_key_for" => Op::KeyFor,
        "nts_symbol_description" => Op::Description,
        "nts_symbol_to_string" => Op::ToString,
        _ => return None,
    })
}

impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        matches!(self, Self::New | Self::Description)
    }
}

/// A module helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// `(key) -> symbol`: `Symbol.for`.
    For,
    /// `(symbol) -> key or null`: `Symbol.keyFor`.
    KeyFor,
    /// `(symbol) -> text`: `Symbol(description)`.
    Text,
    /// `(symbol) -> text`: `Symbol(description)` as V8 names a key in an
    /// error, a long description cut ([`key_text`]).
    KeyText,
}

/// The symbol type, its descriptor, and the registry's table when one is
/// planned.
fn types(m: &Builder<'_>) -> Result<SymbolTypes, Failure> {
    m.types
        .symbol
        .ok_or_else(|| Failure::Invariant("unplanned symbol type".into()))
}

/// The registry's table type: the one a `Map<string, unknown>` has.
pub(crate) fn registry_type() -> HirType {
    HirType::Managed(ManagedType::Map(
        Box::new(HirType::Managed(ManagedType::String)),
        Box::new(HirType::Erased),
    ))
}

fn symbol_ref(t: SymbolTypes, nullable: bool) -> RefType {
    RefType {
        nullable,
        heap_type: HeapType::Concrete(t.symbol),
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let &[subject] = args else {
        return Err(format!("symbol helper {op:?} arity mismatch").into());
    };
    let t = types(b.m)?;
    match op {
        Op::New => {
            if !strings::is_string(b.ty(subject)) {
                return Err(format!("a symbol described by a {:?}", b.ty(subject)).into());
            }
            let descriptor = objects::descriptor(b.m, t.descriptor)?;
            b.global_get(descriptor);
            b.instruction(&objects::UNHASHED);
            // Null for `Symbol()`, which has no description.
            b.load(subject)?;
            b.instruction(&I::StructNew(t.symbol));
            return Ok(());
        }
        Op::For => {
            contract::nonnull(b, subject, "Symbol.for of a null key")?;
            let target = callee(b.m, Helper::For)?;
            b.load(subject)?;
            b.call(target);
            return Ok(());
        }
        Op::KeyFor | Op::Description | Op::ToString => {}
    }
    contract::nonnull(b, subject, "a property of a null symbol")?;
    b.load(subject)?;
    match op {
        Op::Description => b.instruction(&I::StructGet {
            struct_type_index: t.symbol,
            field_index: DESCRIPTION,
        }),
        Op::KeyFor => {
            let target = callee(b.m, Helper::KeyFor)?;
            b.call(target);
        }
        _ => {
            let target = callee(b.m, Helper::Text)?;
            b.call(target);
        }
    }
    objects::adapt(
        b,
        &HirType::Managed(ManagedType::String),
        &b.ty(result).clone(),
    )
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let t = types(m)?;
    let symbol = Physical::Reference(symbol_ref(t, true));
    let (params, result) = match helper {
        Helper::For => (
            vec![strings::STRING],
            Some(Physical::Reference(symbol_ref(t, false))),
        ),
        Helper::KeyFor | Helper::Text | Helper::KeyText => (vec![symbol], Some(strings::STRING)),
    };
    m.helper(
        FuncKey::Symbol(helper),
        format!("symbol.{helper:?}"),
        params,
        result,
        move |m| match helper {
            Helper::For => for_key(m, t),
            Helper::KeyFor => key_for(m, t),
            Helper::Text => text(m, t),
            Helper::KeyText => abbreviated(m, t),
        },
    )
}

fn registry_table(m: &Builder<'_>) -> Result<Collection, Failure> {
    m.types.collection(&registry_type()).cloned()
}

/// The registry: an empty table made with the module, never replaced.
fn registry(m: &mut Builder<'_>) -> Result<Global, Failure> {
    let table = registry_table(m)?;
    m.global(GlobalKey::SymbolRegistry, |m| {
        let descriptor = objects::descriptor(m, table.descriptor)?;
        let mut code = ir::Code::default();
        code.global_get(descriptor);
        for instruction in crate::collections::empty(&table) {
            code.instruction(&instruction);
        }
        Ok((crate::module::constant_type(table.wrapper), code))
    })
}

/// `Symbol.for(key)`: the registered symbol, or a new one described by the
/// key and registered.
///
/// Params: key. Locals: found, the new symbol.
fn for_key(m: &mut Builder<'_>, t: SymbolTypes) -> Result<Function, Failure> {
    let table = registry_table(m)?;
    let registry = registry(m)?;
    let get = crate::collections::callee(m, &table, crate::collections::Helper::Get)?;
    let set = crate::collections::callee(m, &table, crate::collections::Helper::Set)?;
    let descriptor = objects::descriptor(m, t.descriptor)?;
    let name = m.literal("Symbol.for");
    let (found, made) = (1, 2);
    let mut f = Function::new([
        ValType::Ref(RefType::ANYREF),
        ValType::Ref(symbol_ref(t, true)),
    ]);
    f.global_get(registry);
    f.instruction(&I::LocalGet(0));
    f.global_get(name);
    f.call(get);
    f.instructions(&[
        I::LocalTee(found),
        I::RefTestNonNull(HeapType::Concrete(t.symbol)),
        I::If(BlockType::Empty),
        I::LocalGet(found),
        I::RefCastNonNull(HeapType::Concrete(t.symbol)),
        I::Return,
        I::End,
    ]);
    f.global_get(descriptor);
    f.instructions(&[
        objects::UNHASHED,
        I::LocalGet(0),
        I::StructNew(t.symbol),
        I::LocalSet(made),
    ]);
    f.global_get(registry);
    f.instructions(&[I::LocalGet(0), I::LocalGet(made)]);
    f.global_get(name);
    f.call(set);
    f.instructions(&[I::LocalGet(made), I::RefAsNonNull, I::End]);
    Ok(f)
}

/// `Symbol.keyFor(symbol)`: its description, when the registry holds this
/// very symbol under it; else null, which is `undefined`.
///
/// Params: symbol. Locals: description, what the registry holds under it.
fn key_for(m: &mut Builder<'_>, t: SymbolTypes) -> Result<Function, Failure> {
    let table = registry_table(m)?;
    let registry = registry(m)?;
    let get = crate::collections::callee(m, &table, crate::collections::Helper::Get)?;
    let name = m.literal("Symbol.keyFor");
    let (description, held) = (1, 2);
    let mut f = Function::new([
        ValType::Ref(RefType::EXTERNREF),
        ValType::Ref(RefType::ANYREF),
    ]);
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: t.symbol,
            field_index: DESCRIPTION,
        },
        I::LocalTee(description),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::RefNull(HeapType::EXTERN),
        I::Return,
        I::End,
    ]);
    f.global_get(registry);
    f.instruction(&I::LocalGet(description));
    f.global_get(name);
    f.call(get);
    f.instructions(&[
        I::LocalTee(held),
        I::RefTestNonNull(RefType::EQREF.heap_type),
        I::If(BlockType::Empty),
        I::LocalGet(held),
        I::RefCastNonNull(RefType::EQREF.heap_type),
        I::LocalGet(0),
        I::RefEq,
        I::If(BlockType::Empty),
        I::LocalGet(description),
        I::Return,
        I::End,
        I::End,
        I::RefNull(HeapType::EXTERN),
        I::End,
    ]);
    Ok(f)
}

/// `Symbol(description)`, or `Symbol()` with none, as C's
/// `nts_symbol_to_string`.
///
/// Params: symbol.
fn text(m: &mut Builder<'_>, t: SymbolTypes) -> Result<Function, Failure> {
    let concat = strings::callee(m, strings::Helper::Concat)?;
    let open = m.literal("Symbol(");
    let close = m.literal(")");
    let empty = m.literal("");
    let mut f = Function::new([]);
    f.global_get(open);
    f.instructions(&[
        I::Block(BlockType::Result(ValType::Ref(RefType::EXTERNREF))),
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: t.symbol,
            field_index: DESCRIPTION,
        },
        I::BrOnNonNull(0),
    ]);
    f.global_get(empty);
    f.instruction(&I::End);
    f.call(concat);
    f.global_get(close);
    f.call(concat);
    f.instruction(&I::End);
    Ok(f)
}

/// The most code units of a description V8 writes whole in an error, and how
/// many it keeps from each end of a longer one around `...<omitted>...`
/// (node v24.20.0, `NoSideEffectsToMaybeString`; C's
/// `nts_access_key_description`). Code units, a lone surrogate at a cut
/// included.
const WHOLE: i32 = 128;
const KEPT: i32 = 56;

/// `Symbol(description)` with a description past [`WHOLE`] code units cut to
/// its first and last [`KEPT`].
///
/// Params: symbol. Locals: its description, its length.
fn abbreviated(m: &mut Builder<'_>, t: SymbolTypes) -> Result<Function, Failure> {
    let plain = callee(m, Helper::Text)?;
    let length = strings::callee(m, strings::Helper::Length)?;
    let substring = strings::callee(m, strings::Helper::SubstringBuiltin)?;
    let concat = strings::callee(m, strings::Helper::Concat)?;
    let open = m.literal("Symbol(");
    let omitted = m.literal("...<omitted>...");
    let close = m.literal(")");
    let (description, units) = (1, 2);
    let mut f = Function::new([ValType::Ref(RefType::EXTERNREF), ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: t.symbol,
            field_index: DESCRIPTION,
        },
        I::LocalTee(description),
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::LocalGet(0),
    ]);
    f.call(plain);
    f.instructions(&[I::Return, I::End, I::LocalGet(description)]);
    f.call(length);
    f.instructions(&[
        I::LocalTee(units),
        I::I32Const(WHOLE),
        I::I32LeU,
        I::If(BlockType::Empty),
        I::LocalGet(0),
    ]);
    f.call(plain);
    f.instructions(&[I::Return, I::End]);
    f.global_get(open);
    f.instructions(&[I::LocalGet(description), I::I32Const(0), I::I32Const(KEPT)]);
    f.call(substring);
    f.call(concat);
    f.global_get(omitted);
    f.call(concat);
    f.instructions(&[
        I::LocalGet(description),
        I::LocalGet(units),
        I::I32Const(KEPT),
        I::I32Sub,
        I::LocalGet(units),
    ]);
    f.call(substring);
    f.call(concat);
    f.global_get(close);
    f.call(concat);
    f.instruction(&I::End);
    Ok(f)
}

/// The key text of an erased value already known to be a symbol, for a
/// `TypeError`'s message ([`abbreviated`]).
pub(crate) fn key_text(m: &mut Builder<'_>, f: &mut Function, value: u32) -> Result<(), Failure> {
    let t = types(m)?;
    let text = callee(m, Helper::KeyText)?;
    f.instructions(&[
        I::LocalGet(value),
        I::RefCastNonNull(HeapType::Concrete(t.symbol)),
    ]);
    f.call(text);
    Ok(())
}

/// The text of an erased value already known to be a symbol, for
/// `String(value)`.
pub(crate) fn erased_text(
    m: &mut Builder<'_>,
    f: &mut Function,
    value: u32,
) -> Result<(), Failure> {
    let t = types(m)?;
    let text = callee(m, Helper::Text)?;
    f.instructions(&[
        I::LocalGet(value),
        I::RefCastNonNull(HeapType::Concrete(t.symbol)),
    ]);
    f.call(text);
    Ok(())
}
