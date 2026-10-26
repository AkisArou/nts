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
    types::Physical,
};
use nts_core::hir::{HirType, ValueId};
use wasm_encoder::{BlockType, GlobalType, HeapType, Instruction as I, RefType, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    Raise,
    Take,
    Uncaught,
    /// `(thrown value) -> its class's name, or null`.
    ClassName,
}
impl Helper {
    const fn name(self) -> &'static str {
        match self {
            Self::Raise => "raise.record",
            Self::Take => "raise.take",
            Self::Uncaught => "raise.uncaught",
            Self::ClassName => "raise.className",
        }
    }
    fn signature(self) -> (Vec<Physical>, Option<Physical>) {
        let erased = Physical::Reference(RefType::ANYREF);
        match self {
            Self::Raise => (vec![erased], None),
            Self::Take => (vec![], Some(erased)),
            Self::Uncaught => (vec![erased, strings::STRING, strings::STRING], None),
            Self::ClassName => (vec![erased], Some(strings::STRING)),
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
    if helper == Helper::ClassName {
        return class_name(m);
    }
    let flag = state(m, Slot::Flag)?;
    let payload = state(m, Slot::Payload)?;
    let mut f = match helper {
        Helper::Take => Function::new([ValType::Ref(RefType::ANYREF)]),
        Helper::Uncaught | Helper::Raise | Helper::ClassName => Function::default(),
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
        Helper::ClassName => unreachable!("answered above"),
    }
    f.instruction(&I::End);
    Ok(f)
}

/// Throw an erased payload to the host as the JS value it denotes.
///
/// Parameters: 0 payload, 1 the throwing function's name, 2 the payload's
/// message where the core read one (`nts_uncaught`'s detail), or null. A
/// compiled object or function has no identity-preserving JS form yet, so it
/// keeps its named refusal instead of becoming an opaque value or a
/// manufactured Error; the refusal carries its class's name and the message,
/// for a host ending the program to report as C's runtime does.
fn uncaught(f: &mut Function, m: &mut Builder<'_>) -> Result<(), Failure> {
    let host = crate::boundary::host_value(m, crate::boundary::Purpose::Thrown)?;
    let js = m.js_tag();
    clear(f, m)?;
    f.instructions(&[I::LocalGet(0), I::LocalGet(1), I::LocalGet(2)]);
    f.call(host);
    f.throw(js);
    Ok(())
}

/// The most elements one `array.new_fixed` may take, in V8.
const FIXED_ARRAY_LIMIT: usize = 10_000;

/// What an uncaught object reports itself as: its descriptor's semantic
/// identity's name, as C's runtime reads `descriptor->name`. Null for a value
/// that is not an object root's descendant, and for an identity that serves
/// several runtime types.
///
/// Params: value. Locals: its identity.
fn class_name(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let mut f = Function::new([ValType::I32]);
    let (Some(root), Some(names)) = (m.types.root, m.types.strings) else {
        f.instructions(&[I::RefNull(HeapType::EXTERN), I::End]);
        return Ok(f);
    };
    let table = names_global(m, names)?;
    let object = HeapType::Concrete(root.object);
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNonNull(object),
        I::If(BlockType::Result(ValType::EXTERNREF)),
        I::LocalGet(0),
        I::RefCastNonNull(object),
        // The root's descriptor, then the descriptor's semantic identity.
        I::StructGet {
            struct_type_index: root.object,
            field_index: 0,
        },
        I::StructGet {
            struct_type_index: root.descriptor,
            field_index: 0,
        },
        I::LocalTee(1),
    ]);
    f.global_get(table);
    f.instructions(&[
        I::ArrayLen,
        I::I32LtU,
        I::If(BlockType::Result(ValType::EXTERNREF)),
    ]);
    f.global_get(table);
    f.instructions(&[
        I::LocalGet(1),
        I::ArrayGet(names),
        I::Else,
        I::RefNull(HeapType::EXTERN),
        I::End,
        I::Else,
        I::RefNull(HeapType::EXTERN),
        I::End,
        I::End,
    ]);
    Ok(f)
}

/// Every semantic identity's name, by identity: one immutable array, built
/// once as a constant from imported string constants.
fn names_global(m: &mut Builder<'_>, ty: u32) -> Result<Global, Failure> {
    m.global(GlobalKey::IdentityNames, |m| {
        let plan = m.types;
        let names = identity_names(&plan.objects.descriptors);
        let size = u32::try_from(names.len())
            .ok()
            .filter(|_| names.len() <= FIXED_ARRAY_LIMIT)
            .ok_or_else(|| {
                Failure::from(format!(
                    "{} class identities to name, past the {FIXED_ARRAY_LIMIT} one array constant holds",
                    names.len()
                ))
            })?;
        let mut code = ir::Code::default();
        for name in &names {
            match name {
                Some(text) => {
                    let literal = m.literal(text);
                    code.global_get(literal);
                }
                None => code.instruction(&I::RefNull(HeapType::EXTERN)),
            }
        }
        code.instruction(&I::ArrayNewFixed {
            array_type_index: ty,
            array_size: size,
        });
        Ok((crate::module::constant_type(ty), code))
    })
}

/// Each identity's name, where every descriptor of it gives the same one.
fn identity_names(descriptors: &[crate::object_plan::Descriptor]) -> Vec<Option<String>> {
    let count = descriptors
        .iter()
        .map(|d| d.identity as usize + 1)
        .max()
        .unwrap_or(0);
    // Outer `None`: no descriptor of this identity seen yet.
    let mut names: Vec<Option<Option<&str>>> = vec![None; count];
    for descriptor in descriptors {
        let this = descriptor.name.as_deref();
        let slot = &mut names[descriptor.identity as usize];
        *slot = match *slot {
            None => Some(this),
            Some(seen) if seen == this => Some(seen),
            Some(_) => Some(None),
        };
    }
    names
        .into_iter()
        .map(|name| name.flatten().map(str::to_owned))
        .collect()
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
    strings::constant(b, b.func.name.clone());
    // A raise left pending has no message read for it.
    b.instruction(&I::RefNull(HeapType::EXTERN));
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
            let &[payload, detail] = args else {
                return Err(Failure::Invariant("nts_uncaught arity".into()));
            };
            b.load(payload)?;
            strings::constant(b, b.func.name.clone());
            b.load(detail)?;
            let f = callee(b.m, Helper::Uncaught)?;
            b.call(f);
            b.instruction(&I::Unreachable);
        }
    }
    Ok(())
}
