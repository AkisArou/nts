//! A cold input-contract refusal, distinct from source exceptions and traps.

use crate::{body::Body, error::Failure, strings};
use nts_core::hir::ValueId;
use wasm_encoder::{BlockType, Instruction as I};

pub(crate) const IMPORT: &str = "inputDecline";

/// Consume an i32 validity condition; a failed condition never reaches storage.
pub(crate) fn require(b: &mut Body<'_>) -> Result<(), Failure> {
    let target = b
        .symbols
        .input_decline
        .ok_or_else(|| Failure::Invariant("unplanned input-contract diagnostic".into()))?;
    b.ins(&I::I32Eqz);
    b.ins(&I::If(BlockType::Empty));
    strings::constant(b, &b.func.name.clone())?;
    b.ins(&I::Call(target));
    b.ins(&I::Unreachable);
    b.ins(&I::End);
    Ok(())
}
pub(crate) fn nonnull(b: &mut Body<'_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    b.ins(&I::RefIsNull);
    b.ins(&I::I32Eqz);
    require(b)
}
