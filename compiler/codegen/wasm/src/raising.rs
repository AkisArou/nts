//! Prepared HIR's explicit raising convention within one instance.
//!
//! A raise records an erased payload and sets a flag; callers test the flag
//! after each raising call and either take the payload or propagate. An
//! uncaught throw leaves wasm as the thrown JS value itself, through
//! `WebAssembly.JSTag`, so no host wrapper does per-call bookkeeping.
//!
//! No exit to the host leaves a raise pending. An uncaught throw and an input
//! refusal clear it. A host entry's return tests the flag and throws a pending
//! raise uncaught: lowering never leaves one there, and if it ever did, the
//! exception would surface as a throw rather than be lost or seen by a later
//! call. A module that never raises pays nothing.
//!
//! This is the interim lowering. Native exception handling replaces it once
//! prepared HIR carries exception regions.

use crate::{
    body::Body,
    erased,
    error::Failure,
    ir::{self, Function},
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    strings,
    types::{Physical, Slot as Scalar},
};
use nts_core::hir::{HirType, ValueId};
use wasm_encoder::{BlockType, GlobalType, HeapType, Instruction as I, RefType, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    Raise,
    Take,
    Uncaught,
}
impl Helper {
    const fn name(self) -> &'static str {
        match self {
            Self::Raise => "raise.record",
            Self::Take => "raise.take",
            Self::Uncaught => "raise.uncaught",
        }
    }
    fn signature(self) -> (Vec<Physical>, Option<Physical>) {
        let erased = Physical::Reference(RefType::ANYREF);
        match self {
            Self::Raise => (vec![erased], None),
            Self::Take => (vec![], Some(erased)),
            Self::Uncaught => (vec![erased, strings::STRING], None),
        }
    }
}

/// The per-instance raising state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Slot {
    Flag,
    Payload,
}

pub(crate) fn state(m: &mut Builder<'_>, slot: Slot) -> Result<Global, Failure> {
    m.global(GlobalKey::Raising(slot), |m| {
        let mut init = ir::Code::default();
        let ty = match slot {
            Slot::Flag => {
                init.instruction(&I::I32Const(0));
                ValType::I32
            }
            Slot::Payload => {
                let undefined = erased::singleton(m, erased::Singleton::Undefined)?;
                init.global_get(undefined);
                ValType::Ref(RefType::ANYREF)
            }
        };
        Ok((
            GlobalType {
                val_type: ty,
                mutable: true,
                shared: false,
            },
            init,
        ))
    })
}

pub(crate) fn callee(m: &mut Builder<'_>, helper: Helper) -> Result<Func, Failure> {
    let (params, result) = helper.signature();
    m.helper(
        FuncKey::Raising(helper),
        helper.name(),
        params,
        result,
        |m| body(helper, m),
    )
}

/// Reset the pending raise: done before any exit to the host.
pub(crate) fn clear(f: &mut Function, m: &mut Builder<'_>) -> Result<(), Failure> {
    let flag = state(m, Slot::Flag)?;
    let payload = state(m, Slot::Payload)?;
    let undefined = erased::singleton(m, erased::Singleton::Undefined)?;
    f.instruction(&I::I32Const(0));
    f.global_set(flag);
    f.global_get(undefined);
    f.global_set(payload);
    Ok(())
}

fn body(helper: Helper, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let flag = state(m, Slot::Flag)?;
    let payload = state(m, Slot::Payload)?;
    let mut f = match helper {
        Helper::Take => Function::new([ValType::Ref(RefType::ANYREF)]),
        Helper::Uncaught => Function::new([ValType::I32, ValType::EXTERNREF]),
        Helper::Raise => Function::default(),
    };
    match helper {
        Helper::Raise => {
            f.instruction(&I::LocalGet(0));
            f.global_set(payload);
            f.instruction(&I::I32Const(1));
            f.global_set(flag);
        }
        Helper::Take => {
            f.global_get(payload);
            f.instruction(&I::LocalSet(0));
            clear(&mut f, m)?;
            f.instruction(&I::LocalGet(0));
        }
        Helper::Uncaught => uncaught(&mut f, m)?,
    }
    f.instruction(&I::End);
    Ok(f)
}

/// Throw an erased payload to the host as the JS value it denotes.
///
/// Parameters: 0 payload, 1 the throwing function's name. Locals: 2 tag,
/// 3 the JS value. A compiled object or function has no identity-preserving
/// JS form yet, so it keeps its named refusal instead of becoming an opaque
/// value or a manufactured Error.
fn uncaught(f: &mut Function, m: &mut Builder<'_>) -> Result<(), Failure> {
    let tag = erased::callee(m, erased::Helper::Tag)?;
    let number = erased::callee(m, erased::Helper::Number)?;
    let boolean = erased::callee(m, erased::Helper::Boolean)?;
    let to_number = m.import(
        FuncKey::Host("toNumber"),
        "nts:host/v1",
        "toNumber",
        vec![Physical::Scalar(Scalar::F64)],
        Some(strings::STRING),
        false,
    );
    let decline = m.import(
        FuncKey::Host("uncaughtDecline"),
        "nts:host/v1",
        "uncaughtDecline",
        vec![strings::STRING],
        None,
        false,
    );
    let undefined = m.host_global("undefined");
    let yes = m.host_global("true");
    let no = m.host_global("false");
    let js = m.js_tag();
    clear(f, m)?;
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instruction(&I::LocalSet(2));
    f.instruction(&I::Block(BlockType::Empty));
    let case = |f: &mut Function, kind: i32| {
        f.instructions(&[
            I::LocalGet(2),
            I::I32Const(kind),
            I::I32Eq,
            I::If(BlockType::Empty),
        ]);
    };
    let found = |f: &mut Function| f.instructions(&[I::LocalSet(3), I::Br(1), I::End]);
    // A small integer is an i31, which externalizes as the same JS number.
    case(f, erased::NUMBER);
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::I31),
        I::If(BlockType::Result(ValType::EXTERNREF)),
        I::LocalGet(0),
        I::ExternConvertAny,
        I::Else,
        I::LocalGet(0),
    ]);
    f.call(number);
    f.call(to_number);
    f.instruction(&I::End);
    found(f);
    case(f, erased::BOOLEAN);
    f.instruction(&I::LocalGet(0));
    f.call(boolean);
    f.instruction(&I::If(BlockType::Result(ValType::EXTERNREF)));
    f.global_get(yes);
    f.instruction(&I::Else);
    f.global_get(no);
    f.instruction(&I::End);
    found(f);
    case(f, erased::STRING);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(f);
    found(f);
    case(f, erased::UNDEFINED);
    f.global_get(undefined);
    found(f);
    case(f, erased::NULL);
    f.instruction(&I::RefNull(HeapType::EXTERN));
    found(f);
    f.instruction(&I::LocalGet(1));
    f.call(decline);
    f.instructions(&[I::Unreachable, I::End, I::LocalGet(3)]);
    f.throw(js);
    Ok(())
}

/// The check before a host entry returns: a raise still pending is thrown
/// uncaught, as the JS value it denotes. The return value, if any, stays on
/// the stack beneath the check.
pub(crate) fn leave(b: &mut Body<'_, '_>) -> Result<(), Failure> {
    let flag = state(b.m, Slot::Flag)?;
    let take = callee(b.m, Helper::Take)?;
    let uncaught = callee(b.m, Helper::Uncaught)?;
    b.global_get(flag);
    b.instruction(&I::If(BlockType::Empty));
    b.call(take);
    strings::constant(b, &b.func.name.clone());
    b.call(uncaught);
    b.instructions(&[I::Unreachable, I::End]);
    Ok(())
}

pub(crate) fn erase_result(
    b: &mut Body<'_, '_>,
    value: ValueId,
    absent: nts_core::hir::Absent,
) -> Result<(), Failure> {
    let flag = state(b.m, Slot::Flag)?;
    let undefined = erased::singleton(b.m, erased::Singleton::Undefined)?;
    b.global_get(flag);
    b.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    b.global_get(undefined);
    b.instruction(&I::Else);
    erased::erase(b, value, absent)?;
    b.instruction(&I::End);
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum Source {
    Raise,
    Raising,
    Take,
    Uncaught,
}
pub(crate) fn external(name: &str) -> Option<Source> {
    match name {
        "nts_raise" => Some(Source::Raise),
        "nts_raising" => Some(Source::Raising),
        "nts_raise_take" => Some(Source::Take),
        "nts_uncaught" => Some(Source::Uncaught),
        _ => None,
    }
}
pub(crate) fn call(
    b: &mut Body<'_, '_>,
    id: ValueId,
    name: &str,
    source: Source,
    args: &[ValueId],
) -> Result<(), Failure> {
    let valid = match source {
        Source::Raise => {
            args.len() == 1
                && b.ty(args[0]) == &HirType::Erased
                && matches!(b.ty(id), HirType::Void | HirType::Never)
        }
        Source::Uncaught => {
            args.len() == 2
                && b.ty(args[0]) == &HirType::Erased
                && strings::is_string(b.ty(args[1]))
                && matches!(b.ty(id), HirType::Void | HirType::Never)
        }
        Source::Take => args.is_empty() && b.ty(id) == &HirType::Erased,
        Source::Raising => {
            args.is_empty()
                && matches!(
                    b.ty(id),
                    HirType::Bool
                        | HirType::Int {
                            bits: 8 | 16 | 32,
                            ..
                        }
                )
        }
    };
    if !valid {
        return Err(
            format!("runtime helper `{name}` signature outside explicit raising contract").into(),
        );
    }
    match source {
        Source::Raising => {
            let flag = state(b.m, Slot::Flag)?;
            b.global_get(flag);
        }
        Source::Raise | Source::Take => {
            for arg in args {
                b.load(*arg)?;
            }
            let helper = if matches!(source, Source::Raise) {
                Helper::Raise
            } else {
                Helper::Take
            };
            let f = callee(b.m, helper)?;
            b.call(f);
        }
        Source::Uncaught => {
            b.load(args[0])?;
            strings::constant(b, &b.func.name.clone());
            let f = callee(b.m, Helper::Uncaught)?;
            b.call(f);
            b.instruction(&I::Unreachable);
        }
    }
    Ok(())
}
