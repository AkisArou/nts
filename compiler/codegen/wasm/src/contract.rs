//! A cold input-contract refusal, distinct from source exceptions and traps.

use crate::{body::Body, error::Failure, module::FuncKey, strings};
use nts_core::hir::ValueId;
use wasm_encoder::{BlockType, Instruction as I};

pub(crate) const IMPORT: &str = "inputDecline";

/// Consume an i32 validity condition; a failed condition never reaches storage.
pub(crate) fn require(b: &mut Body<'_, '_>) {
    let target = b.m.import(
        FuncKey::InputDecline,
        "nts:host/v1",
        IMPORT,
        vec![strings::STRING],
        None,
        false,
    );
    b.ins(&I::I32Eqz);
    b.ins(&I::If(BlockType::Empty));
    strings::constant(b, &b.func.name.clone());
    b.call(target);
    b.ins(&I::Unreachable);
    b.ins(&I::End);
}
pub(crate) fn nonnull(b: &mut Body<'_, '_>, value: ValueId) -> Result<(), Failure> {
    b.load(value)?;
    b.ins(&I::RefIsNull);
    b.ins(&I::I32Eqz);
    require(b);
    Ok(())
}
