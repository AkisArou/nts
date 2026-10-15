//! A cold input-contract refusal, distinct from source exceptions and traps.

use crate::{
    body::Body,
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey},
    strings,
};
use nts_core::hir::{OpKind, ValueId};
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
            // A refusal ends the call inside any join it was in, so the next
            // call starts with none.
            if m.types.joining.is_some() {
                let (_, depth, _) = crate::printed::joining(m)?;
                f.instruction(&I::I32Const(0));
                f.global_set(depth);
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
    let target = refusal(b.m, &b.func.name.clone(), why)?;
    b.call(target);
    b.instruction(&I::Unreachable);
    Ok(())
}

/// One function's refusal for `why`, out of line.
///
/// A site is then one call, not the two names it reports and the call that
/// reports them. A short method carries a refusal for every field it reads of
/// a value that may be null, and V8 inlines by size: AWFY's towers spent a
/// third of its time in two six-line methods the engine would not inline.
fn refusal(m: &mut Builder<'_>, function: &str, why: &str) -> Result<Func, Failure> {
    m.helper(
        FuncKey::Refusal(function.to_owned(), why.to_owned()),
        format!("refuse<{function}>: {why}"),
        Vec::new(),
        None,
        |m| {
            let target = decline(m)?;
            let name = m.literal(function);
            let reason = m.literal(why);
            let mut f = Function::default();
            f.global_get(name);
            f.global_get(reason);
            f.call(target);
            f.instructions(&[I::Unreachable, I::End]);
            Ok(f)
        },
    )
}
pub(crate) fn nonnull(b: &mut Body<'_, '_>, value: ValueId, why: &str) -> Result<(), Failure> {
    // A string literal and an object just built are never null.
    if matches!(
        b.func.value(value).kind,
        OpKind::ConstString(_) | OpKind::ObjectNew { .. }
    ) {
        return Ok(());
    }
    b.load(value)?;
    b.instruction(&I::RefIsNull);
    b.instruction(&I::If(BlockType::Empty));
    refuse(b, why)?;
    b.instruction(&I::End);
    Ok(())
}
