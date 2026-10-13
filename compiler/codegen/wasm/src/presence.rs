//! Whether an optional property was written, as C's `nts_presence_*`: one bit
//! per optional property, numbered by the core in layout order.
//!
//! C keeps the bits in a header word every object has. Wasm has no such word,
//! so the storage of a family that records presence carries one of its own,
//! an `i32` right after the header, which [`crate::gc`] plans only where a
//! call asks: a subclass and its base, or an interface and the layouts it
//! holds as a prefix, read the same field. `"k" in v` over a value whose type
//! says nothing reads the word of whichever family the value belongs to, and
//! answers false for any other value, as C answers for a value that is not an
//! object: the core pairs that read with the class test that decides it.
use crate::{
    body::Body,
    contract,
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey},
    numeric, objects,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType};

/// The calls this module answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    /// Record every optional property the construction wrote: an `or` of
    /// the mask the core computed.
    Init,
    Set,
    /// `delete o.x`.
    Clear,
    Has,
    /// `"k" in v` where `v`'s type does not name its storage.
    HasValue,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_presence_init" | "nts_presence_init_fn" => Op::Init,
        "nts_presence_set" | "nts_presence_set_fn" => Op::Set,
        "nts_presence_clear" | "nts_presence_clear_fn" => Op::Clear,
        "nts_presence_has" | "nts_presence_has_fn" => Op::Has,
        "nts_presence_has_value" => Op::HasValue,
        _ => return None,
    })
}

impl Op {
    /// Whether the receiver's type names its storage, which then carries the
    /// word.
    pub(crate) const fn typed(self) -> bool {
        !matches!(self, Self::HasValue)
    }

    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        self.typed()
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let &[receiver, bits] = args else {
        return Err(format!("{op:?} arity mismatch").into());
    };
    if !matches!(b.ty(bits), HirType::Int { bits: 32, .. }) {
        return Err(format!("a presence index of {:?}", b.ty(bits)).into());
    }
    if op == Op::HasValue {
        return has_value(b, result, receiver, bits);
    }
    let HirType::Managed(ManagedType::Object(_)) = b.ty(receiver) else {
        return Err(format!(
            "an optional property's presence on a {:?}, whose storage this does not name",
            b.ty(receiver)
        )
        .into());
    };
    let storage = b.types().objects.object(b.ty(receiver))?;
    let Some(word) = storage.presence else {
        return Err(format!(
            "an optional property's presence on `{}`, a function value's storage",
            storage.name
        )
        .into());
    };
    let physical = storage.physical;
    let get = I::StructGet {
        struct_type_index: physical,
        field_index: word,
    };
    if op == Op::Has {
        contract::nonnull(b, receiver, "reading a field of null")?;
        objects::load_storage(b, receiver, physical)?;
        b.instruction(&get);
        b.load(bits)?;
        b.instructions(&[I::I32ShrU, I::I32Const(1), I::I32And]);
        return numeric::convert(b, &HirType::Bool, &b.ty(result).clone());
    }
    contract::nonnull(b, receiver, "writing a field of null")?;
    objects::load_storage(b, receiver, physical)?;
    objects::load_storage(b, receiver, physical)?;
    b.instruction(&get);
    match op {
        Op::Init => {
            b.load(bits)?;
            b.instruction(&I::I32Or);
        }
        Op::Set => {
            b.instruction(&I::I32Const(1));
            b.load(bits)?;
            b.instructions(&[I::I32Shl, I::I32Or]);
        }
        Op::Clear => {
            b.instruction(&I::I32Const(1));
            b.load(bits)?;
            b.instructions(&[I::I32Shl, I::I32Const(-1), I::I32Xor, I::I32And]);
        }
        Op::Has | Op::HasValue => return Err(Failure::Invariant("presence op routed".into())),
    }
    b.instruction(&I::StructSet {
        struct_type_index: physical,
        field_index: word,
    });
    Ok(())
}

/// The bit, read off whichever family's word the value carries; false for a
/// value of none, which no write can have reached.
fn has_value(
    b: &mut Body<'_, '_>,
    result: ValueId,
    value: ValueId,
    bits: ValueId,
) -> Result<(), Failure> {
    if !matches!(b.types().value_slot(b.ty(value))?, Physical::Reference(_)) {
        return Err(format!("an optional property's presence on a {:?}", b.ty(value)).into());
    }
    if b.types().objects.presence_tops.is_empty() {
        b.instruction(&I::I32Const(0));
    } else {
        let word = callee(b.m)?;
        b.load(value)?;
        b.call(word);
        b.load(bits)?;
        b.instructions(&[I::I32ShrU, I::I32Const(1), I::I32And]);
    }
    numeric::convert(b, &HirType::Bool, &b.ty(result).clone())
}

/// `(value) -> i32`: the presence word of an open value, or zero.
fn callee(m: &mut Builder<'_>) -> Result<Func, Failure> {
    m.helper(
        FuncKey::PresenceOf,
        "object.presence",
        vec![Physical::Reference(RefType::ANYREF)],
        Some(Physical::Scalar(Slot::I32)),
        |m| {
            let mut f = Function::new([]);
            for &(top, word) in &m.types.objects.presence_tops {
                f.instructions(&[
                    I::LocalGet(0),
                    I::RefTestNonNull(HeapType::Concrete(top)),
                    I::If(BlockType::Empty),
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(top)),
                    I::StructGet {
                        struct_type_index: top,
                        field_index: word,
                    },
                    I::Return,
                    I::End,
                ]);
            }
            f.instructions(&[I::I32Const(0), I::End]);
            Ok(f)
        },
    )
}
