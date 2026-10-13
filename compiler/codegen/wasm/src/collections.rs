//! Maps, Sets and string-keyed tables: insertion-ordered tables, as the C
//! runtime's `NtsMap`.
//!
//! A collection is an object (it has a descriptor, so `typeof` answers
//! "object") whose fields after the root's are its live count (`size`), the
//! entries written with holes included (`used`), the keys, each entry's hash,
//! the probe index, and for a Map or a table the values.
//! - **Entries stay where they are written.** A delete leaves a hole (hash 0),
//!   and growth copies the entries in place and rebuilds the index from their
//!   hashes, so a walk's cursor, one entry number, stays valid: an entry
//!   appended during a walk is visited, and one deleted ahead of it is not.
//!   `clear` keeps `used` for the same reason.
//! - **The index** holds 0 for an empty slot, -1 for a deleted one, and an
//!   entry number plus one otherwise. It keeps at least twice as many slots as
//!   entries, so a probe always reaches an empty slot.
//! - **Keys compare by `SameValueZero`.** A number key is stored with -0 as +0,
//!   every NaN hashes alike, and two NaNs compare equal.
//! - **Storage is typed by the static collection type**: string keys as
//!   externref, number keys as f64, erased keys as anyref; a number or boolean
//!   value typed, any other value erased, since a null reference slot cannot say
//!   which absence it held. The core passes keys and values erased (the C
//!   ABI's `NtsValue`), and each call converts them, refusing by name what the
//!   storage cannot hold.
use crate::{
    body::Body,
    contract,
    erased::{self, Singleton},
    error::Failure,
    gc::{Collection, KeyKind},
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, objects, strings,
    types::{Physical, Slot},
};
use nts_core::hir::{Absent, HirType, ManagedType, OpKind, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

const EMPTY: i32 = 0;
const DELETED: i32 = -1;
/// FNV-1a's 32-bit offset basis and prime.
const FNV_BASIS: i32 = 0x811c_9dc5_u32.cast_signed();
const FNV_PRIME: i32 = 0x0100_0193;
/// The golden-ratio multiplier that spreads a number's folded bits.
const SPREAD: i32 = 0x9e37_79b1_u32.cast_signed();

/// What a collection call does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Op {
    New,
    Get,
    Has,
    Set,
    Add,
    Delete,
    Clear,
    Next,
    KeyAt,
    ValueAt,
    Copy,
    Extend,
    KeysStr,
}

#[cfg(test)]
impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    pub(crate) const fn inline(self) -> bool {
        matches!(self, Self::New | Self::KeyAt | Self::ValueAt)
    }
}

/// A module helper of one collection storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    Find,
    Grow,
    Put,
    Get,
    Has,
    Set,
    Delete,
    Clear,
    Next,
    Copy,
    Extend,
}

/// A module helper of one key kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum KeyHelper {
    Hash(KeyKind),
    Equal(KeyKind),
    /// An erased key with -0 made +0, as a Map stores it.
    Normal,
    /// A string's value as an array index, or -1 when it is not one.
    ArrayIndex,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_map_new" | "nts_set_new" | "nts_table_new" => Op::New,
        "nts_map_get" => Op::Get,
        "nts_map_has" => Op::Has,
        "nts_map_set" => Op::Set,
        "nts_set_add" => Op::Add,
        "nts_map_delete" => Op::Delete,
        "nts_map_clear" => Op::Clear,
        "nts_map_next" => Op::Next,
        "nts_map_key_at" => Op::KeyAt,
        "nts_map_value_at" => Op::ValueAt,
        "nts_map_copy" => Op::Copy,
        "nts_map_extend" => Op::Extend,
        "nts_map_keys_str" => Op::KeysStr,
        _ => return None,
    })
}

pub(crate) const fn is_collection(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Managed(ManagedType::Map(..) | ManagedType::Table(..) | ManagedType::Set(_))
    )
}

fn key_storage(key: KeyKind) -> HirType {
    match key {
        KeyKind::String => HirType::Managed(ManagedType::String),
        KeyKind::Number => HirType::NUMBER,
        KeyKind::Erased | KeyKind::Reference => HirType::Erased,
    }
}
fn key_physical(key: KeyKind) -> Physical {
    match key {
        KeyKind::String => strings::STRING,
        KeyKind::Number => Physical::Scalar(Slot::F64),
        KeyKind::Erased | KeyKind::Reference => Physical::Reference(RefType::ANYREF),
    }
}
fn root_type(m: &Builder<'_>) -> Result<u32, Failure> {
    m.types
        .root
        .map(|root| root.object)
        .ok_or_else(|| Failure::Invariant("unplanned object root".into()))
}
fn concrete(index: u32) -> ValType {
    ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(index),
    })
}
fn map_physical(c: &Collection) -> Physical {
    Physical::Reference(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(c.wrapper),
    })
}
/// The values' physical storage, and whether a hole's value is cleared (a
/// reference the collector would otherwise keep alive).
fn value_physical(c: &Collection) -> Option<Physical> {
    c.value.as_ref().map(|value| match value {
        HirType::Float { .. } => Physical::Scalar(Slot::F64),
        HirType::Bool => Physical::Scalar(Slot::I32),
        _ => Physical::Reference(RefType::ANYREF),
    })
}
const fn reference_keys(c: &Collection) -> bool {
    !matches!(c.key, KeyKind::Number)
}
fn reference_values(c: &Collection) -> bool {
    matches!(value_physical(c), Some(Physical::Reference(_)))
}
fn field(c: &Collection, index: u32) -> I<'static> {
    I::StructGet {
        struct_type_index: c.wrapper,
        field_index: index,
    }
}
fn store(c: &Collection, index: u32) -> I<'static> {
    I::StructSet {
        struct_type_index: c.wrapper,
        field_index: index,
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let subject = if op == Op::New {
        result
    } else {
        *args
            .first()
            .ok_or_else(|| Failure::Invariant(format!("collection {op:?} with no collection")))?
    };
    let c = b.types().collection(b.ty(subject))?.clone();
    let arity = match op {
        Op::New | Op::Clear | Op::Copy | Op::KeysStr => 1,
        Op::Get
        | Op::Has
        | Op::Add
        | Op::Delete
        | Op::Next
        | Op::KeyAt
        | Op::ValueAt
        | Op::Extend => 2,
        Op::Set => 3,
    };
    if args.len() != arity {
        return Err(format!("collection {op:?} arity mismatch").into());
    }
    if op != Op::New {
        contract::nonnull(b, subject, "a method of a null collection")?;
    }
    match op {
        Op::New => {
            let descriptor = objects::descriptor(b.m, c.descriptor)?;
            b.global_get(descriptor);
            for instruction in empty(&c) {
                b.instruction(&instruction);
            }
        }
        Op::Get | Op::Has | Op::Delete | Op::Add | Op::Set => entry(b, result, op, &c, args)?,
        Op::Clear | Op::Copy => {
            let helper = if op == Op::Clear {
                Helper::Clear
            } else {
                Helper::Copy
            };
            let target = callee(b.m, &c, helper)?;
            b.load(subject)?;
            b.call(target);
        }
        Op::Next => {
            let target = callee(b.m, &c, Helper::Next)?;
            b.load(subject)?;
            b.load(args[1])?;
            numeric::convert(b, &b.ty(args[1]).clone(), &HirType::NUMBER)?;
            b.call(target);
            numeric::convert(b, &HirType::NUMBER, &b.ty(result).clone())?;
        }
        Op::KeyAt | Op::ValueAt => at(b, op, &c, subject, args[1])?,
        Op::Extend => {
            let source = b.types().collection(b.ty(args[1]))?.clone();
            if source.wrapper != c.wrapper {
                return Err("assigning one table onto another of a different storage".into());
            }
            contract::nonnull(b, args[1], "assigning a null table")?;
            let target = callee(b.m, &c, Helper::Extend)?;
            b.load(subject)?;
            b.load(args[1])?;
            b.call(target);
            if b.types().slot(&b.ty(result).clone())?.is_some() {
                b.load(subject)?;
            }
        }
        Op::KeysStr => {
            if c.key != KeyKind::String {
                return Err("`Object.keys` of a table whose keys are not strings".into());
            }
            let target = keys_str(b.m, &c, &b.ty(result).clone())?;
            b.load(subject)?;
            b.call(target);
        }
    }
    Ok(())
}

/// A call that reads or writes one key's entry.
fn entry(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    c: &Collection,
    args: &[ValueId],
) -> Result<(), Failure> {
    let helper = match op {
        Op::Get => Helper::Get,
        Op::Has => Helper::Has,
        Op::Delete => Helper::Delete,
        _ => Helper::Set,
    };
    match (op, &c.value) {
        (Op::Get | Op::Set, None) => return Err(format!("`{op:?}` on a Set").into()),
        (Op::Add, Some(_)) => return Err("`add` on a Map".into()),
        _ => {}
    }
    let target = callee(b.m, c, helper)?;
    b.load(args[0])?;
    key_operand(b, c, args[1])?;
    if op == Op::Set {
        value_operand(b, c, args[2])?;
    }
    strings::constant(b, &b.func.name.clone());
    b.call(target);
    // `set` and `add` answer the collection.
    if matches!(op, Op::Set | Op::Add) && b.types().slot(&b.ty(result).clone())?.is_some() {
        b.load(args[0])?;
    }
    Ok(())
}

/// `key_at` and `value_at`: the entry a cursor landed on, erased.
fn at(
    b: &mut Body<'_, '_>,
    op: Op,
    c: &Collection,
    subject: ValueId,
    cursor: ValueId,
) -> Result<(), Failure> {
    let (index, array, storage) = if op == Op::KeyAt {
        (c.key_field(), c.keys, key_storage(c.key))
    } else {
        let values = c.values.ok_or_else(|| "`value_at` on a Set".to_owned())?;
        (
            c.value_field(),
            values,
            c.value.clone().unwrap_or(HirType::Erased),
        )
    };
    b.load(subject)?;
    b.instruction(&field(c, index));
    b.load(cursor)?;
    numeric::convert(b, &b.ty(cursor).clone(), &HirType::NUMBER)?;
    b.instruction(&I::I32TruncSatF64U);
    b.instruction(&I::ArrayGet(array));
    erased::erase_stack(b, &storage)
}

/// The `size` of a collection: its live count.
pub(crate) fn size(b: &mut Body<'_, '_>, result: ValueId, subject: ValueId) -> Result<(), Failure> {
    let c = b.types().collection(b.ty(subject))?.clone();
    contract::nonnull(b, subject, "the size of a null collection")?;
    b.load(subject)?;
    b.instruction(&field(&c, c.live()));
    numeric::convert(
        b,
        &HirType::Int {
            bits: 32,
            signed: false,
        },
        &b.ty(result).clone(),
    )
}

/// After a descriptor: an empty collection, with no entries and an index of
/// one empty slot, which the first insertion grows.
pub(crate) fn empty(c: &Collection) -> Vec<I<'static>> {
    let mut code = vec![
        objects::UNHASHED,
        I::I32Const(0),
        I::I32Const(0),
        I::ArrayNewFixed {
            array_type_index: c.keys,
            array_size: 0,
        },
        I::ArrayNewFixed {
            array_type_index: c.ints,
            array_size: 0,
        },
        I::I32Const(EMPTY),
        I::I32Const(1),
        I::ArrayNew(c.ints),
    ];
    if let Some(values) = c.values {
        code.push(I::ArrayNewFixed {
            array_type_index: values,
            array_size: 0,
        });
    }
    code.push(I::StructNew(c.wrapper));
    code
}

/// The typed value an erased operand was made from, when its type is
/// `storage` and it cannot be absent: then the call reads it directly. Purely
/// an optimization: any other operand takes the dynamic conversion, so a change
/// in how a call's operands are built can only make it slower, never wrong.
fn erased_from(b: &Body<'_, '_>, operand: ValueId, storage: &HirType) -> Option<ValueId> {
    match b.func.value(operand).kind {
        OpKind::Erase {
            value,
            absent: Absent::Impossible,
        } if b.ty(value) == storage => Some(value),
        _ => None,
    }
}

/// An erased key, in the collection's key storage; a key the storage cannot
/// hold is refused by name, and a number key is stored with -0 as +0.
fn key_operand(b: &mut Body<'_, '_>, c: &Collection, key: ValueId) -> Result<(), Failure> {
    if b.ty(key) != &HirType::Erased {
        return Err(format!("a collection key of type {:?}", b.ty(key)).into());
    }
    if c.key == KeyKind::Reference {
        // An object erases to itself; the key must be one.
        if let OpKind::Erase {
            value,
            absent: Absent::Impossible,
        } = b.func.value(key).kind
            && matches!(
                b.ty(value),
                HirType::Managed(ManagedType::Object(_) | ManagedType::Array(_))
            )
        {
            contract::nonnull(b, value, "a null object as a collection key")?;
            return b.load(value);
        }
        let root = root_type(b.m)?;
        b.load(key)?;
        b.instruction(&I::RefTestNonNull(HeapType::Concrete(root)));
        contract::require(
            b,
            "a key that is not an object, for an object-keyed collection",
        )?;
        return b.load(key);
    }
    if let Some(typed) = erased_from(b, key, &key_storage(c.key)) {
        if c.key == KeyKind::String {
            contract::nonnull(b, typed, "a null string as a collection key")?;
        }
        b.load(typed)?;
        if c.key == KeyKind::Number {
            b.instruction(&I::F64Const(0.0.into()));
            b.instruction(&I::F64Add);
        }
        return Ok(());
    }
    match c.key {
        KeyKind::Erased => {
            b.load(key)?;
            let normal = key_callee(b.m, KeyHelper::Normal)?;
            b.call(normal);
        }
        KeyKind::Reference => return Err(Failure::Invariant("object key past its arm".into())),
        KeyKind::String => {
            b.load(key)?;
            erased::call(b, erased::Helper::Tag)?;
            b.instruction(&I::I32Const(erased::STRING));
            b.instruction(&I::I32Eq);
            contract::require(
                b,
                "a key that is not a string, for a string-keyed collection",
            )?;
            b.load(key)?;
            erased::string_payload(&mut b.code);
        }
        KeyKind::Number => {
            erased::unerase_to(b, key, &HirType::NUMBER)?;
            b.instruction(&I::F64Const(0.0.into()));
            b.instruction(&I::F64Add);
        }
    }
    Ok(())
}

/// An erased value, in the collection's value storage.
fn value_operand(b: &mut Body<'_, '_>, c: &Collection, value: ValueId) -> Result<(), Failure> {
    if b.ty(value) != &HirType::Erased {
        return Err(format!("a collection value of type {:?}", b.ty(value)).into());
    }
    if let Some(typed) = c
        .value
        .as_ref()
        .filter(|storage| **storage != HirType::Erased)
        .and_then(|storage| erased_from(b, value, storage))
    {
        return b.load(typed);
    }
    match &c.value {
        None => Err("`set` on a Set".into()),
        Some(HirType::Erased) => b.load(value),
        Some(storage) => erased::unerase_to(b, value, &storage.clone()),
    }
}

pub(crate) fn callee(m: &mut Builder<'_>, c: &Collection, helper: Helper) -> Result<Func, Failure> {
    let map = map_physical(c);
    let key = key_physical(c.key);
    let value = value_physical(c);
    let i32 = Physical::Scalar(Slot::I32);
    let f64 = Physical::Scalar(Slot::F64);
    let (params, result) = match helper {
        Helper::Find => (vec![map, key, i32], Some(i32)),
        Helper::Grow | Helper::Clear => (vec![map], None),
        Helper::Put => {
            let mut params = vec![map, key, i32];
            params.extend(value);
            (params, None)
        }
        Helper::Get => (
            vec![map, key, strings::STRING],
            Some(Physical::Reference(RefType::ANYREF)),
        ),
        Helper::Has | Helper::Delete => (vec![map, key, strings::STRING], Some(i32)),
        Helper::Set => {
            let mut params = vec![map, key];
            params.extend(value);
            params.push(strings::STRING);
            (params, None)
        }
        Helper::Next => (vec![map, f64], Some(f64)),
        Helper::Copy => (
            vec![map],
            Some(Physical::Reference(RefType {
                nullable: false,
                heap_type: HeapType::Concrete(c.wrapper),
            })),
        ),
        Helper::Extend => (vec![map, map], None),
    };
    let collection = c.clone();
    m.helper(
        FuncKey::Collection(c.wrapper, helper),
        format!("collection<{}>.{helper:?}", c.wrapper),
        params,
        result,
        move |m| match helper {
            Helper::Find => find(m, &collection),
            Helper::Grow => Ok(grow(&collection)),
            Helper::Put => put(m, &collection),
            Helper::Get | Helper::Has | Helper::Delete => lookup(m, &collection, helper),
            Helper::Set => set(m, &collection),
            Helper::Clear => Ok(clear(&collection)),
            Helper::Next => Ok(next(&collection)),
            Helper::Copy | Helper::Extend => copy(m, &collection, helper),
        },
    )
}

/// The index slot of `key`: holding its entry plus one when present, else
/// the slot an insertion takes, the first deleted one on the chain if any.
///
/// Params: map, key, hash. Locals: index, mask, slot, reuse, entry, steps.
fn find(m: &mut Builder<'_>, c: &Collection) -> Result<Function, Failure> {
    let equal = key_callee(m, KeyHelper::Equal(c.key))?;
    let (index, mask, slot, reuse, entry, steps) = (3, 4, 5, 6, 7, 8);
    let mut f = Function::new([
        concrete(c.ints),
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
    ]);
    // The slot to insert at: the first deleted one seen, else this one.
    let insertion = [
        I::LocalGet(reuse),
        I::LocalGet(slot),
        I::LocalGet(reuse),
        I::I32Const(0),
        I::I32GeS,
        I::Select,
    ];
    f.instructions(&chain_start(c, index, mask, slot, reuse));
    f.instructions(&[
        I::Block(BlockType::Result(ValType::I32)),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(slot),
        I::ArrayGet(c.ints),
        I::LocalTee(entry),
        I::I32Const(EMPTY),
        I::I32Eq,
        I::If(BlockType::Empty),
    ]);
    f.instructions(&insertion);
    f.instructions(&[
        I::Br(2),
        I::End,
        I::LocalGet(entry),
        I::I32Const(DELETED),
        I::I32Eq,
        I::If(BlockType::Empty),
    ]);
    f.instructions(&insertion);
    f.instructions(&[
        I::LocalSet(reuse),
        I::Else,
        // An entry: the same hash, then an equal key.
        I::LocalGet(0),
        field(c, c.hashes()),
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Sub,
        I::ArrayGet(c.ints),
        I::LocalGet(2),
        I::I32Eq,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        field(c, c.key_field()),
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Sub,
        I::ArrayGet(c.keys),
        I::LocalGet(1),
    ]);
    f.call(equal);
    f.instructions(&[
        I::If(BlockType::Empty),
        I::LocalGet(slot),
        I::Br(4),
        I::End,
        I::End,
        I::End,
        I::LocalGet(slot),
        I::I32Const(1),
        I::I32Add,
        I::LocalGet(mask),
        I::I32And,
        I::LocalSet(slot),
        // The index keeps half its slots empty, so a chain longer than the
        // index is a broken invariant, never a program's.
        I::LocalGet(steps),
        I::I32Const(1),
        I::I32Add,
        I::LocalTee(steps),
        I::LocalGet(mask),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::Unreachable,
        I::End,
        I::Br(0),
        I::End,
        I::Unreachable,
        I::End,
        I::End,
    ]);
    Ok(f)
}

/// The start of a probe chain: the index, its mask, the hash's slot, and no
/// deleted slot seen yet. The hash is parameter 2.
fn chain_start(c: &Collection, index: u32, mask: u32, slot: u32, reuse: u32) -> [I<'static>; 12] {
    [
        I::LocalGet(0),
        field(c, c.index()),
        I::LocalTee(index),
        I::ArrayLen,
        I::I32Const(1),
        I::I32Sub,
        I::LocalTee(mask),
        I::LocalGet(2),
        I::I32And,
        I::LocalSet(slot),
        I::I32Const(-1),
        I::LocalSet(reuse),
    ]
}

/// Grow the entry arrays to twice the entries written (at least eight),
/// copying every entry where it is, and rebuild the index from their hashes
/// at the smallest power of two of at least twice that many slots.
///
/// Params: map. Locals: used, capacity, slots, entry, slot, hash, index,
/// then an old and a new local per entry array.
fn grow(c: &Collection) -> Function {
    let (used, capacity, slots, entry, slot, hash, index) = (1, 2, 3, 4, 5, 6, 7);
    let mut arrays = vec![(c.key_field(), c.keys), (c.hashes(), c.ints)];
    if let Some(values) = c.values {
        arrays.push((c.value_field(), values));
    }
    let mut locals = vec![
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        ValType::I32,
        concrete(c.ints),
    ];
    for &(_, array) in &arrays {
        locals.push(concrete(array));
        locals.push(concrete(array));
    }
    let mut f = Function::new(locals);
    f.instructions(&[
        I::LocalGet(0),
        field(c, c.used()),
        I::LocalTee(used),
        I::I32Const(1),
        I::I32Shl,
        I::LocalTee(capacity),
        I::I32Const(8),
        I::LocalGet(capacity),
        I::I32Const(8),
        I::I32GtU,
        I::Select,
        I::LocalSet(capacity),
    ]);
    for (at, &(slot_field, array)) in arrays.iter().enumerate() {
        let old = 8 + 2 * u32::try_from(at).unwrap_or(0);
        let new = old + 1;
        f.instructions(&[
            I::LocalGet(0),
            field(c, slot_field),
            I::LocalSet(old),
            I::LocalGet(capacity),
            I::ArrayNewDefault(array),
            I::LocalSet(new),
            I::LocalGet(new),
            I::I32Const(0),
            I::LocalGet(old),
            I::I32Const(0),
            I::LocalGet(used),
            I::ArrayCopy {
                array_type_index_dst: array,
                array_type_index_src: array,
            },
            I::LocalGet(0),
            I::LocalGet(new),
            I::RefAsNonNull,
            store(c, slot_field),
        ]);
    }
    f.instructions(&[
        I::I32Const(16),
        I::LocalSet(slots),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(slots),
        I::LocalGet(capacity),
        I::I32Const(1),
        I::I32Shl,
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(slots),
        I::I32Const(1),
        I::I32Shl,
        I::LocalSet(slots),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(slots),
        I::ArrayNewDefault(c.ints),
        I::LocalSet(index),
        I::LocalGet(0),
        I::LocalGet(index),
        I::RefAsNonNull,
        store(c, c.index()),
    ]);
    rebuild_index(&mut f, c, (used, slots, entry, slot, hash, index));
    f.instructions(&[I::End]);
    f
}

/// Place every live entry at the first empty slot of its chain in a new
/// index of `slots` slots.
fn rebuild_index(f: &mut Function, c: &Collection, locals: (u32, u32, u32, u32, u32, u32)) {
    let (used, slots, entry, slot, hash, index) = locals;
    f.instructions(&[
        // Each live entry, placed at the first empty slot of its chain.
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(entry),
        I::LocalGet(used),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        field(c, c.hashes()),
        I::LocalGet(entry),
        I::ArrayGet(c.ints),
        I::LocalTee(hash),
        I::If(BlockType::Empty),
        I::LocalGet(hash),
        I::LocalGet(slots),
        I::I32Const(1),
        I::I32Sub,
        I::I32And,
        I::LocalSet(slot),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(index),
        I::LocalGet(slot),
        I::ArrayGet(c.ints),
        I::I32Eqz,
        I::BrIf(1),
        I::LocalGet(slot),
        I::I32Const(1),
        I::I32Add,
        I::LocalGet(slots),
        I::I32Const(1),
        I::I32Sub,
        I::I32And,
        I::LocalSet(slot),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(index),
        I::LocalGet(slot),
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        I::ArraySet(c.ints),
        I::End,
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(entry),
        I::Br(0),
        I::End,
        I::End,
    ]);
}

/// Write `key` with `hash` (and `value`): in place when present, else
/// appended, growing first when the entries are full.
///
/// Params: map, key, hash, [value]. Locals: slot, entry.
fn put(m: &mut Builder<'_>, c: &Collection) -> Result<Function, Failure> {
    let find = callee(m, c, Helper::Find)?;
    let grow = callee(m, c, Helper::Grow)?;
    let has_value = c.values.is_some();
    let (slot, entry) = if has_value { (4, 5) } else { (3, 4) };
    let mut f = Function::new([ValType::I32, ValType::I32]);
    let lookup = |f: &mut Function| {
        f.instructions(&[I::LocalGet(0), I::LocalGet(1), I::LocalGet(2)]);
        f.call(find);
        f.instructions(&[
            I::LocalSet(slot),
            I::LocalGet(0),
            field(c, c.index()),
            I::LocalGet(slot),
            I::ArrayGet(c.ints),
            I::LocalSet(entry),
        ]);
    };
    lookup(&mut f);
    f.instructions(&[
        I::LocalGet(entry),
        I::I32Const(0),
        I::I32GtS,
        I::If(BlockType::Empty),
    ]);
    if let Some(values) = c.values {
        f.instructions(&[
            I::LocalGet(0),
            field(c, c.value_field()),
            I::LocalGet(entry),
            I::I32Const(1),
            I::I32Sub,
            I::LocalGet(3),
            I::ArraySet(values),
        ]);
    }
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(0),
        field(c, c.used()),
        I::LocalGet(0),
        field(c, c.key_field()),
        I::ArrayLen,
        I::I32Eq,
        I::If(BlockType::Empty),
        I::LocalGet(0),
    ]);
    f.call(grow);
    lookup(&mut f);
    f.instructions(&[
        I::End,
        I::LocalGet(0),
        field(c, c.used()),
        I::LocalSet(entry),
        I::LocalGet(0),
        field(c, c.key_field()),
        I::LocalGet(entry),
        I::LocalGet(1),
        I::ArraySet(c.keys),
        I::LocalGet(0),
        field(c, c.hashes()),
        I::LocalGet(entry),
        I::LocalGet(2),
        I::ArraySet(c.ints),
    ]);
    if let Some(values) = c.values {
        f.instructions(&[
            I::LocalGet(0),
            field(c, c.value_field()),
            I::LocalGet(entry),
            I::LocalGet(3),
            I::ArraySet(values),
        ]);
    }
    f.instructions(&[
        I::LocalGet(0),
        field(c, c.index()),
        I::LocalGet(slot),
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        I::ArraySet(c.ints),
        I::LocalGet(0),
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        store(c, c.used()),
        I::LocalGet(0),
        I::LocalGet(0),
        field(c, c.live()),
        I::I32Const(1),
        I::I32Add,
        store(c, c.live()),
        I::End,
    ]);
    Ok(f)
}

/// `get`, `has` and `delete`.
///
/// Params: map, key, name. Locals: slot, entry.
fn lookup(m: &mut Builder<'_>, c: &Collection, helper: Helper) -> Result<Function, Failure> {
    let hash = key_callee(m, KeyHelper::Hash(c.key))?;
    let find = callee(m, c, Helper::Find)?;
    let (slot, entry) = (3, 4);
    let mut f = Function::new([ValType::I32, ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        I::LocalGet(1),
        I::LocalGet(1),
        I::LocalGet(2),
    ]);
    f.call(hash);
    f.call(find);
    f.instructions(&[
        I::LocalSet(slot),
        I::LocalGet(0),
        field(c, c.index()),
        I::LocalGet(slot),
        I::ArrayGet(c.ints),
        I::LocalSet(entry),
    ]);
    match helper {
        Helper::Has => f.instructions(&[I::LocalGet(entry), I::I32Const(0), I::I32GtS]),
        Helper::Get => {
            let values = c
                .values
                .ok_or_else(|| Failure::Invariant("`get` of a Set".into()))?;
            f.instructions(&[
                I::LocalGet(entry),
                I::I32Const(0),
                I::I32LeS,
                I::If(BlockType::Empty),
            ]);
            let undefined = erased::singleton(m, Singleton::Undefined)?;
            f.global_get(undefined);
            f.instructions(&[
                I::Return,
                I::End,
                I::LocalGet(0),
                field(c, c.value_field()),
                I::LocalGet(entry),
                I::I32Const(1),
                I::I32Sub,
                I::ArrayGet(values),
            ]);
            erase_value(m, c, &mut f)?;
        }
        _ => {
            f.instructions(&[
                I::LocalGet(entry),
                I::I32Const(0),
                I::I32LeS,
                I::If(BlockType::Empty),
                I::I32Const(0),
                I::Return,
                I::End,
            ]);
            clear_entry(c, &mut f, entry, true);
            f.instructions(&[
                I::LocalGet(0),
                field(c, c.index()),
                I::LocalGet(slot),
                I::I32Const(DELETED),
                I::ArraySet(c.ints),
                I::LocalGet(0),
                I::LocalGet(0),
                field(c, c.live()),
                I::I32Const(1),
                I::I32Sub,
                store(c, c.live()),
                I::I32Const(1),
            ]);
        }
    }
    f.instruction(&I::End);
    Ok(f)
}

/// A stored value on the stack, erased.
fn erase_value(m: &mut Builder<'_>, c: &Collection, f: &mut Function) -> Result<(), Failure> {
    match &c.value {
        Some(HirType::Float { .. }) => {
            let boxed = erased::callee(m, erased::Helper::BoxNumber)?;
            f.call(boxed);
        }
        Some(HirType::Bool) => {
            let yes = erased::singleton(m, Singleton::True)?;
            let no = erased::singleton(m, Singleton::False)?;
            f.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
            f.global_get(yes);
            f.instruction(&I::Else);
            f.global_get(no);
            f.instruction(&I::End);
        }
        _ => {}
    }
    Ok(())
}

/// Make the entry whose number plus one is in `local` (minus one when
/// `plus_one`) a hole, and drop the references it held.
fn clear_entry(c: &Collection, f: &mut Function, local: u32, plus_one: bool) {
    let at = |f: &mut Function| {
        f.instruction(&I::LocalGet(local));
        if plus_one {
            f.instructions(&[I::I32Const(1), I::I32Sub]);
        }
    };
    f.instructions(&[I::LocalGet(0), field(c, c.hashes())]);
    at(f);
    f.instructions(&[I::I32Const(0), I::ArraySet(c.ints)]);
    if reference_keys(c) {
        f.instructions(&[I::LocalGet(0), field(c, c.key_field())]);
        at(f);
        let heap = if c.key == KeyKind::String {
            HeapType::EXTERN
        } else {
            HeapType::ANY
        };
        f.instructions(&[I::RefNull(heap), I::ArraySet(c.keys)]);
    }
    if let (true, Some(values)) = (reference_values(c), c.values) {
        f.instructions(&[I::LocalGet(0), field(c, c.value_field())]);
        at(f);
        f.instructions(&[I::RefNull(HeapType::ANY), I::ArraySet(values)]);
    }
}

/// `set` and `add`: hash the key and write the entry.
///
/// Params: map, key, [value], name.
fn set(m: &mut Builder<'_>, c: &Collection) -> Result<Function, Failure> {
    let hash = key_callee(m, KeyHelper::Hash(c.key))?;
    let put = callee(m, c, Helper::Put)?;
    let name = if c.values.is_some() { 3 } else { 2 };
    let mut f = Function::default();
    f.instructions(&[
        I::LocalGet(0),
        I::LocalGet(1),
        I::LocalGet(1),
        I::LocalGet(name),
    ]);
    f.call(hash);
    if c.values.is_some() {
        f.instruction(&I::LocalGet(2));
    }
    f.call(put);
    f.instruction(&I::End);
    Ok(f)
}

/// Every live entry a hole, and the index emptied. `used` stays, so a walk in
/// progress still reaches what is added after.
///
/// Params: map. Locals: entry, used.
fn clear(c: &Collection) -> Function {
    let (entry, used) = (1, 2);
    let mut f = Function::new([ValType::I32, ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        field(c, c.used()),
        I::LocalSet(used),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(entry),
        I::LocalGet(used),
        I::I32GeU,
        I::BrIf(1),
    ]);
    clear_entry(c, &mut f, entry, false);
    f.instructions(&[
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(entry),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(0),
        field(c, c.index()),
        I::I32Const(0),
        I::I32Const(EMPTY),
        I::LocalGet(0),
        field(c, c.index()),
        I::ArrayLen,
        I::ArrayFill(c.ints),
        I::LocalGet(0),
        I::I32Const(0),
        store(c, c.live()),
        I::End,
    ]);
    f
}

/// The next live entry at or after `from`, or -1. `used` is read on every
/// call, so an entry appended during a walk is reached.
///
/// Params: map, from. Locals: at, used.
fn next(c: &Collection) -> Function {
    let (at, used) = (2, 3);
    let mut f = Function::new([ValType::I32, ValType::I32]);
    f.instructions(&[
        I::LocalGet(1),
        I::F64Const(0.0.into()),
        I::F64Ge,
        I::I32Eqz,
        I::If(BlockType::Empty),
        I::F64Const((-1.0).into()),
        I::Return,
        I::End,
        I::LocalGet(1),
        I::I32TruncSatF64U,
        I::LocalSet(at),
        I::LocalGet(0),
        field(c, c.used()),
        I::LocalSet(used),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
        I::LocalGet(used),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        field(c, c.hashes()),
        I::LocalGet(at),
        I::ArrayGet(c.ints),
        I::If(BlockType::Empty),
        I::LocalGet(at),
        I::F64ConvertI32U,
        I::Return,
        I::End,
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
        I::F64Const((-1.0).into()),
        I::End,
    ]);
    f
}

/// `copy` (a new collection of the same storage holding every live entry, in
/// order) and `extend` (every live entry of the second written into the
/// first, later entries winning).
///
/// Params: map (and source). Locals: target, entry, used.
fn copy(m: &mut Builder<'_>, c: &Collection, helper: Helper) -> Result<Function, Failure> {
    let put = callee(m, c, Helper::Put)?;
    let (source, target, entry, used) = if helper == Helper::Copy {
        (0, 1, 2, 3)
    } else {
        (1, 0, 2, 3)
    };
    let mut f = if helper == Helper::Copy {
        Function::new([concrete(c.wrapper), ValType::I32, ValType::I32])
    } else {
        Function::new([ValType::I32, ValType::I32])
    };
    if helper == Helper::Copy {
        let descriptor = objects::descriptor(m, c.descriptor)?;
        f.global_get(descriptor);
        f.instructions(&empty(c));
        f.instruction(&I::LocalSet(target));
    }
    f.instructions(&[
        I::LocalGet(source),
        field(c, c.used()),
        I::LocalSet(used),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(entry),
        I::LocalGet(used),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(source),
        field(c, c.hashes()),
        I::LocalGet(entry),
        I::ArrayGet(c.ints),
        I::If(BlockType::Empty),
        I::LocalGet(target),
        I::LocalGet(source),
        field(c, c.key_field()),
        I::LocalGet(entry),
        I::ArrayGet(c.keys),
        I::LocalGet(source),
        field(c, c.hashes()),
        I::LocalGet(entry),
        I::ArrayGet(c.ints),
    ]);
    if let Some(values) = c.values {
        f.instructions(&[
            I::LocalGet(source),
            field(c, c.value_field()),
            I::LocalGet(entry),
            I::ArrayGet(values),
        ]);
    }
    f.call(put);
    f.instructions(&[
        I::End,
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(entry),
        I::Br(0),
        I::End,
        I::End,
    ]);
    if helper == Helper::Copy {
        f.instructions(&[I::LocalGet(target), I::RefAsNonNull]);
    }
    f.instruction(&I::End);
    Ok(f)
}

/// `Object.keys` of a string-keyed table: every key that is an array index
/// first, ascending, then the rest in insertion order, which is JavaScript's
/// own-property order.
///
/// Params: map. Locals: backing, written, entry, used, held, value, j.
fn keys_str(m: &mut Builder<'_>, c: &Collection, result: &HirType) -> Result<Func, Failure> {
    let (wrapper, backing_type, array_descriptor) = {
        let array = m.types.array(result)?;
        if array.element != HirType::Managed(ManagedType::String) {
            return Err(format!("`Object.keys` answering {result:?}").into());
        }
        (array.wrapper, array.backing, array.descriptor)
    };
    let collection = c.clone();
    m.helper(
        FuncKey::CollectionKeys(c.wrapper, wrapper),
        format!("collection<{}>.keys", c.wrapper),
        vec![map_physical(c)],
        Some(Physical::Reference(RefType {
            nullable: false,
            heap_type: HeapType::Concrete(wrapper),
        })),
        move |m| {
            let c = &collection;
            let index_of = key_callee(m, KeyHelper::ArrayIndex)?;
            let descriptor = objects::descriptor(m, array_descriptor)?;
            let (backing, written, entry, used, held, value, j) = (1, 2, 3, 4, 5, 6, 7);
            let mut f = Function::new([
                concrete(backing_type),
                ValType::I32,
                ValType::I32,
                ValType::I32,
                ValType::Ref(RefType::EXTERNREF),
                ValType::I64,
                ValType::I32,
            ]);
            f.instructions(&[
                I::LocalGet(0),
                field(c, c.live()),
                I::ArrayNewDefault(backing_type),
                I::LocalSet(backing),
                I::LocalGet(0),
                field(c, c.used()),
                I::LocalSet(used),
            ]);
            // Two passes over the live entries: index keys, then the rest.
            for indices in [true, false] {
                key_pass(
                    &mut f,
                    c,
                    (backing_type, index_of),
                    indices,
                    (backing, written, entry, used, held),
                );
                if indices {
                    insertion_sort(
                        &mut f,
                        backing_type,
                        index_of,
                        (backing, written, entry, held, value, j),
                    );
                }
            }
            f.global_get(descriptor);
            f.instructions(&[
                objects::UNHASHED,
                I::LocalGet(written),
                I::LocalGet(backing),
                I::RefAsNonNull,
                I::StructNew(wrapper),
                I::End,
            ]);
            Ok(f)
        },
    )
}

/// Append every live key that is (or, with `indices` false, is not) an array
/// index to `backing`, in insertion order.
fn key_pass(
    f: &mut Function,
    c: &Collection,
    (array, index_of): (u32, Func),
    indices: bool,
    (backing, written, entry, used, held): (u32, u32, u32, u32, u32),
) {
    f.instructions(&[
        I::I32Const(0),
        I::LocalSet(entry),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(entry),
        I::LocalGet(used),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        field(c, c.hashes()),
        I::LocalGet(entry),
        I::ArrayGet(c.ints),
        I::If(BlockType::Empty),
        I::LocalGet(0),
        field(c, c.key_field()),
        I::LocalGet(entry),
        I::ArrayGet(c.keys),
        I::LocalTee(held),
    ]);
    f.call(index_of);
    f.instructions(&[I::I64Const(0), I::I64GeS]);
    if !indices {
        f.instruction(&I::I32Eqz);
    }
    f.instructions(&[
        I::If(BlockType::Empty),
        I::LocalGet(backing),
        I::LocalGet(written),
        I::LocalGet(held),
        I::ArraySet(array),
        I::LocalGet(written),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(written),
        I::End,
        I::End,
        I::LocalGet(entry),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(entry),
        I::Br(0),
        I::End,
        I::End,
    ]);
}

/// Sort the first `written` keys of `backing`, all array indices, by value.
fn insertion_sort(
    f: &mut Function,
    array: u32,
    index_of: Func,
    (backing, written, i, held, value, j): (u32, u32, u32, u32, u32, u32),
) {
    f.instructions(&[
        I::I32Const(1),
        I::LocalSet(i),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(i),
        I::LocalGet(written),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(backing),
        I::LocalGet(i),
        I::ArrayGet(array),
        I::LocalTee(held),
    ]);
    f.call(index_of);
    f.instructions(&[
        I::LocalSet(value),
        I::LocalGet(i),
        I::LocalSet(j),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(j),
        I::I32Eqz,
        I::BrIf(1),
        I::LocalGet(backing),
        I::LocalGet(j),
        I::I32Const(1),
        I::I32Sub,
        I::ArrayGet(array),
    ]);
    f.call(index_of);
    f.instructions(&[
        I::LocalGet(value),
        I::I64LeS,
        I::BrIf(1),
        I::LocalGet(backing),
        I::LocalGet(j),
        I::LocalGet(backing),
        I::LocalGet(j),
        I::I32Const(1),
        I::I32Sub,
        I::ArrayGet(array),
        I::ArraySet(array),
        I::LocalGet(j),
        I::I32Const(1),
        I::I32Sub,
        I::LocalSet(j),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(backing),
        I::LocalGet(j),
        I::LocalGet(held),
        I::ArraySet(array),
        I::LocalGet(i),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(i),
        I::Br(0),
        I::End,
        I::End,
    ]);
}

fn key_callee(m: &mut Builder<'_>, helper: KeyHelper) -> Result<Func, Failure> {
    let i32 = Physical::Scalar(Slot::I32);
    let (params, result) = match helper {
        KeyHelper::Hash(kind) => (vec![key_physical(kind), strings::STRING], i32),
        KeyHelper::Equal(kind) => (vec![key_physical(kind), key_physical(kind)], i32),
        KeyHelper::Normal => (
            vec![Physical::Reference(RefType::ANYREF)],
            Physical::Reference(RefType::ANYREF),
        ),
        KeyHelper::ArrayIndex => (vec![strings::STRING], Physical::Scalar(Slot::I64)),
    };
    m.helper(
        FuncKey::Key(helper),
        format!("key.{helper:?}"),
        params,
        Some(result),
        move |m| match helper {
            KeyHelper::Hash(kind) => hash(m, kind),
            KeyHelper::Equal(kind) => equal(m, kind),
            KeyHelper::Normal => normal(m),
            KeyHelper::ArrayIndex => array_index(m),
        },
    )
}

/// A key's hash, never zero (zero marks a hole).
fn hash(m: &mut Builder<'_>, kind: KeyKind) -> Result<Function, Failure> {
    let mut f = match kind {
        KeyKind::String => hash_string(m)?,
        KeyKind::Number => hash_number(),
        KeyKind::Erased => return hash_erased(m),
        KeyKind::Reference => return hash_reference(m),
    };
    // Zero marks a hole, so a zero hash becomes one.
    let h = hash_local(kind);
    f.instructions(&[I::LocalTee(h), I::LocalGet(h), I::I32Eqz, I::I32Or, I::End]);
    Ok(f)
}

/// FNV-1a over a string's code units, before the zero test.
fn hash_string(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let length = strings::callee(m, strings::Helper::Length)?;
    let unit = strings::callee(m, strings::Helper::Unit)?;
    let (at, units, h) = (2, 3, 4);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32]);
    f.instruction(&I::LocalGet(0));
    f.call(length);
    f.instructions(&[
        I::LocalSet(units),
        I::I32Const(FNV_BASIS),
        I::LocalSet(h),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
        I::LocalGet(units),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(h),
        I::LocalGet(0),
        I::LocalGet(at),
    ]);
    f.call(unit);
    f.instructions(&[
        I::I32Xor,
        I::I32Const(FNV_PRIME),
        I::I32Mul,
        I::LocalSet(h),
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(h),
    ]);
    Ok(f)
}

/// A number's bits, -0 as +0 and every NaN alike, folded and spread, before
/// the zero test.
fn hash_number() -> Function {
    let (bits, h) = (2, 3);
    let mut f = Function::new([ValType::I64, ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        I::LocalGet(0),
        I::F64Ne,
        I::If(BlockType::Result(ValType::I64)),
        I::I64Const(0x7ff8_0000_0000_0000),
        I::Else,
        I::LocalGet(0),
        I::F64Const(0.0.into()),
        I::F64Add,
        I::I64ReinterpretF64,
        I::End,
        I::LocalTee(bits),
        I::LocalGet(bits),
        I::I64Const(32),
        I::I64ShrU,
        I::I64Xor,
        I::I32WrapI64,
        I::I32Const(SPREAD),
        I::I32Mul,
        I::LocalTee(h),
        I::LocalGet(h),
        I::I32Const(16),
        I::I32ShrU,
        I::I32Xor,
    ]);
    f
}

/// An erased key by its tag, its hash already nonzero; an object needs an
/// identity hash, which is refused by name.
fn hash_erased(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let tag = erased::callee(m, erased::Helper::Tag)?;
    let number = erased::callee(m, erased::Helper::Number)?;
    let boolean = erased::callee(m, erased::Helper::Boolean)?;
    let text = key_callee(m, KeyHelper::Hash(KeyKind::String))?;
    let numeric = key_callee(m, KeyHelper::Hash(KeyKind::Number))?;
    let which = 2;
    let mut f = Function::new([ValType::I32]);
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instruction(&I::LocalSet(which));
    let arm = |f: &mut Function, tag: i32| {
        f.instructions(&[
            I::LocalGet(which),
            I::I32Const(tag),
            I::I32Eq,
            I::If(BlockType::Empty),
        ]);
    };
    arm(&mut f, erased::STRING);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(&mut f);
    f.instruction(&I::LocalGet(1));
    f.call(text);
    f.instructions(&[I::Return, I::End]);
    arm(&mut f, erased::NUMBER);
    f.instruction(&I::LocalGet(0));
    f.call(number);
    f.instruction(&I::LocalGet(1));
    f.call(numeric);
    f.instructions(&[I::Return, I::End]);
    arm(&mut f, erased::BOOLEAN);
    f.instruction(&I::LocalGet(0));
    f.call(boolean);
    f.instructions(&[I::I32Const(0x1001), I::I32Add, I::Return, I::End]);
    arm(&mut f, erased::UNDEFINED);
    f.instructions(&[I::I32Const(0x2001), I::Return, I::End]);
    arm(&mut f, erased::NULL);
    f.instructions(&[I::I32Const(0x3001), I::Return, I::End]);
    let root = root_type(m)?;
    let identity = objects::identity(m)?;
    for tag in [erased::OBJECT, erased::FUNCTION] {
        arm(&mut f, tag);
        f.instructions(&[I::LocalGet(0), I::RefCastNonNull(HeapType::Concrete(root))]);
        f.call(identity);
        f.instructions(&[I::Return, I::End]);
    }
    contract::refuse_in(&mut f, m, 1, "a key of a kind this collection cannot hash")?;
    f.instruction(&I::End);
    Ok(f)
}

/// The i32 local a string or number hash is left in before the zero test.
const fn hash_local(kind: KeyKind) -> u32 {
    match kind {
        KeyKind::String => 4,
        KeyKind::Number | KeyKind::Erased | KeyKind::Reference => 3,
    }
}

/// An object's identity hash, which is never zero.
///
/// Params: key, name.
fn hash_reference(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let root = root_type(m)?;
    let identity = objects::identity(m)?;
    let mut f = Function::default();
    f.instructions(&[I::LocalGet(0), I::RefCastNonNull(HeapType::Concrete(root))]);
    f.call(identity);
    f.instruction(&I::End);
    Ok(f)
}

/// Two keys equal by `SameValueZero`.
///
/// Params: a, b.
fn equal(m: &mut Builder<'_>, kind: KeyKind) -> Result<Function, Failure> {
    let mut f = Function::default();
    match kind {
        KeyKind::String => {
            let equals = strings::callee(m, strings::Helper::Equal)?;
            f.instructions(&[I::LocalGet(0), I::LocalGet(1)]);
            f.call(equals);
        }
        KeyKind::Number => f.instructions(&[
            I::LocalGet(0),
            I::LocalGet(1),
            I::F64Eq,
            I::LocalGet(0),
            I::LocalGet(0),
            I::F64Ne,
            I::LocalGet(1),
            I::LocalGet(1),
            I::F64Ne,
            I::I32And,
            I::I32Or,
        ]),
        KeyKind::Reference => f.instructions(&[
            I::LocalGet(0),
            I::RefCastNullable(RefType::EQREF.heap_type),
            I::LocalGet(1),
            I::RefCastNullable(RefType::EQREF.heap_type),
            I::RefEq,
        ]),
        KeyKind::Erased => {
            let tag = erased::callee(m, erased::Helper::Tag)?;
            let number = erased::callee(m, erased::Helper::Number)?;
            let text = key_callee(m, KeyHelper::Equal(KeyKind::String))?;
            let numeric = key_callee(m, KeyHelper::Equal(KeyKind::Number))?;
            let which = 2;
            f = Function::new([ValType::I32]);
            f.instruction(&I::LocalGet(0));
            f.call(tag);
            f.instruction(&I::LocalTee(which));
            f.instruction(&I::LocalGet(1));
            f.call(tag);
            f.instructions(&[
                I::I32Ne,
                I::If(BlockType::Empty),
                I::I32Const(0),
                I::Return,
                I::End,
                I::LocalGet(which),
                I::I32Const(erased::STRING),
                I::I32Eq,
                I::If(BlockType::Empty),
                I::LocalGet(0),
            ]);
            erased::string_payload(&mut f);
            f.instruction(&I::LocalGet(1));
            erased::string_payload(&mut f);
            f.call(text);
            f.instructions(&[
                I::Return,
                I::End,
                I::LocalGet(which),
                I::I32Const(erased::NUMBER),
                I::I32Eq,
                I::If(BlockType::Empty),
                I::LocalGet(0),
            ]);
            f.call(number);
            f.instruction(&I::LocalGet(1));
            f.call(number);
            f.call(numeric);
            f.instructions(&[
                I::Return,
                I::End,
                // A boolean, an absence or an object: the same reference.
                I::LocalGet(0),
                I::RefCastNullable(RefType::EQREF.heap_type),
                I::LocalGet(1),
                I::RefCastNullable(RefType::EQREF.heap_type),
                I::RefEq,
            ]);
        }
    }
    f.instruction(&I::End);
    Ok(f)
}

/// An erased key as a Map stores it: a boxed -0 becomes +0.
///
/// Params: key.
fn normal(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let types = m
        .types
        .erased
        .ok_or_else(|| Failure::Invariant("unplanned erased types".into()))?;
    let boxed = erased::callee(m, erased::Helper::BoxNumber)?;
    let mut f = Function::default();
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::Concrete(types.number)),
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::RefCastNonNull(HeapType::Concrete(types.number)),
        I::StructGet {
            struct_type_index: types.number,
            field_index: 1,
        },
        I::F64Const(0.0.into()),
        I::F64Eq,
        I::If(BlockType::Empty),
        I::F64Const(0.0.into()),
    ]);
    f.call(boxed);
    f.instructions(&[I::Return, I::End, I::End, I::LocalGet(0), I::End]);
    Ok(f)
}

/// A string's value as an array index (all digits, no leading zero unless it
/// is "0", below 2^32 - 1), or -1 when it is not one.
///
/// Params: key. Locals: units, at, unit, value.
fn array_index(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let length = strings::callee(m, strings::Helper::Length)?;
    let unit_of = strings::callee(m, strings::Helper::Unit)?;
    let (units, at, unit, value) = (1, 2, 3, 4);
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::I32, ValType::I64]);
    f.instruction(&I::LocalGet(0));
    f.call(length);
    f.instructions(&[
        I::LocalTee(units),
        I::I32Eqz,
        I::LocalGet(units),
        I::I32Const(10),
        I::I32GtU,
        I::I32Or,
        I::If(BlockType::Empty),
        I::I64Const(-1),
        I::Return,
        I::End,
        I::LocalGet(units),
        I::I32Const(1),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::LocalGet(0),
        I::I32Const(0),
    ]);
    f.call(unit_of);
    f.instructions(&[
        I::I32Const(i32::from(b'0')),
        I::I32Eq,
        I::If(BlockType::Empty),
        I::I64Const(-1),
        I::Return,
        I::End,
        I::End,
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
        I::LocalGet(units),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(0),
        I::LocalGet(at),
    ]);
    f.call(unit_of);
    f.instructions(&[
        I::I32Const(i32::from(b'0')),
        I::I32Sub,
        I::LocalTee(unit),
        I::I32Const(9),
        I::I32GtU,
        I::If(BlockType::Empty),
        I::I64Const(-1),
        I::Return,
        I::End,
        I::LocalGet(value),
        I::I64Const(10),
        I::I64Mul,
        I::LocalGet(unit),
        I::I64ExtendI32U,
        I::I64Add,
        I::LocalSet(value),
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(value),
        I::I64Const(4_294_967_295),
        I::I64GeU,
        I::If(BlockType::Empty),
        I::I64Const(-1),
        I::Return,
        I::End,
        I::LocalGet(value),
        I::End,
    ]);
    Ok(f)
}
