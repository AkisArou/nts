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
    stop(m, Kind::Input)
}

/// A construct the compiler cannot execute, rather than an input that violates
/// the compiled representation's contract. The host keeps that distinction.
pub(crate) fn compiler_stop(m: &mut Builder<'_>) -> Result<Func, Failure> {
    stop(m, Kind::Compiler)
}

#[derive(Clone, Copy)]
enum Kind {
    Input,
    Compiler,
}

fn stop(m: &mut Builder<'_>, kind: Kind) -> Result<Func, Failure> {
    let (key, symbol, import_key, import) = match kind {
        Kind::Input => (
            FuncKey::DeclineInput,
            "contract.decline",
            FuncKey::InputDecline,
            IMPORT,
        ),
        Kind::Compiler => (
            FuncKey::CompilerStop,
            "contract.compilerStop",
            FuncKey::Host("compilerStop"),
            "compilerStop",
        ),
    };
    m.helper(
        key,
        symbol,
        vec![strings::STRING, strings::STRING],
        None,
        move |m| {
            let report = m.import(
                import_key,
                "nts:host/v1",
                import,
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

/// A projection carrying core's compiler-stop contract, rather than an input
/// restriction. Consume its validity condition and preserve that distinction.
pub(crate) fn require_compiler(b: &mut Body<'_, '_>, why: &str) -> Result<(), Failure> {
    b.instruction(&I::I32Eqz);
    b.instruction(&I::If(BlockType::Empty));
    let target = compiler_stop(b.m)?;
    strings::constant(b, &b.func.name.clone());
    strings::constant(b, why);
    b.call(target);
    b.instruction(&I::Unreachable);
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
    if b.never_null(value) {
        return Ok(());
    }
    b.load(value)?;
    b.instruction(&I::RefIsNull);
    b.instruction(&I::If(BlockType::Empty));
    refuse(b, why)?;
    b.instruction(&I::End);
    Ok(())
}
