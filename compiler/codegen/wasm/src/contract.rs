//! A cold input-contract refusal, distinct from source exceptions and traps.

use crate::{
    body::Body,
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey},
    strings,
};
use nts_core::hir::ValueId;
use wasm_encoder::{BlockType, Instruction as I};

pub(crate) const IMPORT: &str = "inputDecline";

/// The module-local refusal: given the refusing function's name and the cause,
/// it clears any pending raise, so no stale state survives into a later call,
/// and reports the named refusal through the host.
pub(crate) fn decline(m: &mut Builder<'_>) -> Result<Func, Failure> {
    m.helper(
        FuncKey::DeclineInput,
        "contract.decline",
        vec![strings::STRING, strings::STRING],
        None,
        |m| {
            let report = m.import(
                FuncKey::InputDecline,
                "nts:host/v1",
                IMPORT,
                vec![strings::STRING, strings::STRING],
                None,
                false,
            );
            let mut f = Function::default();
            if m.raising {
                crate::raising::clear(&mut f, m)?;
            }
            f.instructions(&[I::LocalGet(0), I::LocalGet(1)]);
            f.call(report);
            f.instructions(&[I::Unreachable, I::End]);
            Ok(f)
        },
    )
}

/// In a helper that takes the caller's name as parameter `name`: refuse, for
/// `why`, where control reaching it is the failed condition.
pub(crate) fn refuse_in(
    f: &mut Function,
    m: &mut Builder<'_>,
    name: u32,
    why: &str,
) -> Result<(), Failure> {
    let target = decline(m)?;
    let why = m.literal(why);
    f.instruction(&I::LocalGet(name));
    f.global_get(why);
    f.call(target);
    f.instruction(&I::Unreachable);
    Ok(())
}

/// Consume an i32 validity condition; a failed condition never reaches
/// storage, and is refused for `why`.
pub(crate) fn require(b: &mut Body<'_, '_>, why: &str) -> Result<(), Failure> {
    b.instruction(&I::I32Eqz);
    b.instruction(&I::If(BlockType::Empty));
    refuse(b, why)?;
    b.instruction(&I::End);
    Ok(())
}

/// The refusal itself, for `why`, where control reaching it is the failed
/// condition.
pub(crate) fn refuse(b: &mut Body<'_, '_>, why: &str) -> Result<(), Failure> {
    let target = decline(b.m)?;
    strings::constant(b, &b.func.name.clone());
    strings::constant(b, why);
    b.call(target);
    b.instruction(&I::Unreachable);
    Ok(())
}
pub(crate) fn nonnull(b: &mut Body<'_, '_>, value: ValueId, why: &str) -> Result<(), Failure> {
    b.load(value)?;
    b.instruction(&I::RefIsNull);
    b.instruction(&I::I32Eqz);
    require(b, why)
}
