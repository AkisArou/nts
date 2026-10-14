//! Dates, as the C runtime's `NtsDate` (`runtime/c`): a time value and
//! nothing else.
//!
//! A date is an object-root struct holding one double, under a descriptor
//! whose kind is `OBJECT`, so `typeof` answers "object", `===` is `ref.eq`,
//! and a date keys a Map by the root's identity hash. The lowering keeps the
//! rest of `Date` out: a wall clock no differential can check, and a local
//! calendar that would answer differently on two machines, are refused by
//! name before a backend sees them.
use crate::{
    body::Body,
    contract,
    error::Failure,
    gc::{DateTypes, ROOT_FIELDS},
    objects,
};
use nts_core::hir::{HirType, ValueId};
use wasm_encoder::{BlockType, Instruction as I, ValType};

/// The time value, after the root.
const TIME: u32 = ROOT_FIELDS;

/// The largest time value either side of the epoch: 100,000,000 days.
const LIMIT: f64 = 8.64e15;

/// The calls this module answers. Both are code at their site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    /// `new Date(ms)`: `TimeClip`, then the struct.
    New,
    /// `getTime()` and `valueOf()`.
    Value,
}

pub(crate) fn external(name: &str) -> Option<Op> {
    Some(match name {
        "nts_date_new" => Op::New,
        "nts_date_value" => Op::Value,
        _ => return None,
    })
}

impl Op {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    #[cfg(test)]
    pub(crate) const fn inline(self) -> bool {
        matches!(self, Self::New | Self::Value)
    }
}

fn types(b: &Body<'_, '_>) -> Result<DateTypes, Failure> {
    b.m.types
        .date
        .ok_or_else(|| Failure::Invariant("unplanned date type".into()))
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    op: Op,
    args: &[ValueId],
) -> Result<(), Failure> {
    let &[subject] = args else {
        return Err(format!("date helper {op:?} arity mismatch").into());
    };
    let t = types(b)?;
    match op {
        Op::New => {
            if b.ty(subject) != &HirType::NUMBER {
                return Err(format!("a date of a {:?}", b.ty(subject)).into());
            }
            let descriptor = objects::descriptor(b.m, t.descriptor)?;
            b.global_get(descriptor);
            b.instruction(&objects::UNHASHED);
            time_clip(b, subject)?;
            b.instruction(&I::StructNew(t.date));
        }
        Op::Value => {
            // Never null in practice: lowering checks a `d!` receiver before
            // the call, as it does every non-null assertion. Refused by name
            // should that change, where C's helper would answer NaN.
            contract::nonnull(b, subject, "a time value read from a null date")?;
            b.load(subject)?;
            b.instruction(&I::StructGet {
                struct_type_index: t.date,
                field_index: TIME,
            });
            objects::adapt(b, &HirType::NUMBER, &b.ty(result).clone())?;
        }
    }
    Ok(())
}

/// The specification's `TimeClip`, as C's `nts_time_clip`: NaN outside
/// ±8.64e15 (NaN and the infinities fail the comparison), otherwise the
/// number truncated toward zero, and `+0` for `-0` (adding `+0` is the one
/// operation that maps `-0` to `+0` and leaves every other value alone).
fn time_clip(b: &mut Body<'_, '_>, ms: ValueId) -> Result<(), Failure> {
    b.load(ms)?;
    b.code.instructions(&[
        I::F64Abs,
        I::F64Const(LIMIT.into()),
        I::F64Le,
        I::If(BlockType::Result(ValType::F64)),
    ]);
    b.load(ms)?;
    b.code.instructions(&[
        I::F64Trunc,
        I::F64Const(0.0.into()),
        I::F64Add,
        I::Else,
        I::F64Const(f64::NAN.into()),
        I::End,
    ]);
    Ok(())
}
