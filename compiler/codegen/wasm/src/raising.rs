//! Explicit prepared-HIR raising, isolated by module-local host activations.

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

pub(crate) const PREFIX: &str = "$nts$activation$";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    Enter,
    Leave,
    Raising,
    Publish,
    Raise,
    Take,
}
impl Helper {
    pub(crate) const ALL: [Self; 6] = [
        Self::Enter,
        Self::Leave,
        Self::Raising,
        Self::Publish,
        Self::Raise,
        Self::Take,
    ];
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Enter => "$nts$activation$enter",
            Self::Leave => "$nts$activation$leave",
            Self::Raising => "$nts$activation$raising",
            Self::Publish => "$nts$activation$publish",
            Self::Raise => "raise.record",
            Self::Take => "raise.take",
        }
    }
    pub(crate) fn signature(self) -> (Vec<Physical>, Option<Physical>) {
        match self {
            Self::Enter | Self::Leave => (vec![], None),
            Self::Raising => (vec![], Some(Physical::Scalar(Scalar::I32))),
            Self::Publish => (vec![strings::STRING], None),
            Self::Raise => (vec![Physical::Reference(RefType::ANYREF)], None),
            Self::Take => (vec![], Some(Physical::Reference(RefType::ANYREF))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Throw {
    Number,
    Boolean,
    String,
    Undefined,
    Null,
    Decline,
}
impl Throw {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Number => "throwNumber",
            Self::Boolean => "throwBoolean",
            Self::String => "throwString",
            Self::Undefined => "throwUndefined",
            Self::Null => "throwNull",
            Self::Decline => "uncaughtDecline",
        }
    }
    pub(crate) fn params(self) -> Vec<Physical> {
        match self {
            Self::Number => vec![Physical::Scalar(Scalar::F64)],
            Self::Boolean => vec![Physical::Scalar(Scalar::I32)],
            Self::String | Self::Decline => vec![strings::STRING],
            Self::Undefined | Self::Null => vec![],
        }
    }
}

/// The per-instance raising state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Slot {
    Flag,
    Payload,
    Active,
    Stack,
}

fn state(m: &mut Builder<'_>, slot: Slot) -> Result<Global, Failure> {
    m.global(GlobalKey::Raising(slot), |m| {
        let mut init = ir::Code::default();
        let ty = match slot {
            Slot::Flag | Slot::Active => {
                init.instruction(&I::I32Const(0));
                ValType::I32
            }
            Slot::Payload => {
                let undefined = erased::singleton(m, erased::Singleton::Undefined)?;
                init.global_get(undefined);
                ValType::Ref(RefType::ANYREF)
            }
            Slot::Stack => {
                let frame = HeapType::Concrete(activation(m)?);
                init.instruction(&I::RefNull(frame));
                ValType::Ref(RefType {
                    nullable: true,
                    heap_type: frame,
                })
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
fn activation(m: &Builder<'_>) -> Result<u32, Failure> {
    m.types
        .activation
        .ok_or_else(|| Failure::Invariant("unplanned activation frame".into()))
}
fn throw(m: &mut Builder<'_>, throw: Throw) -> Func {
    m.import(
        FuncKey::Throw(throw),
        "nts:host/v1",
        throw.name(),
        throw.params(),
        None,
        false,
    )
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

/// The activation exports exist only when a body used the raising
/// convention; the host wrapper enters and leaves around every public call.
pub(crate) fn exports(m: &mut Builder<'_>) -> Result<Option<crate::Activation>, Failure> {
    if !Helper::ALL
        .iter()
        .any(|helper| m.has(&FuncKey::Raising(*helper)))
    {
        return Ok(None);
    }
    for helper in [
        Helper::Enter,
        Helper::Leave,
        Helper::Raising,
        Helper::Publish,
    ] {
        let f = callee(m, helper)?;
        m.export_func(helper.name(), f);
    }
    Ok(Some(crate::Activation {
        enter: Helper::Enter.name().into(),
        leave: Helper::Leave.name().into(),
        raising: Helper::Raising.name().into(),
        publish: Helper::Publish.name().into(),
    }))
}

fn body(helper: Helper, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let flag = state(m, Slot::Flag)?;
    let payload = state(m, Slot::Payload)?;
    let mut f = match helper {
        Helper::Take => Function::new([ValType::Ref(RefType::ANYREF)]),
        Helper::Publish => Function::new([ValType::I32]),
        Helper::Enter | Helper::Leave | Helper::Raising | Helper::Raise => Function::default(),
    };
    match helper {
        Helper::Enter => {
            let active = state(m, Slot::Active)?;
            let stack = state(m, Slot::Stack)?;
            let frame = activation(m)?;
            f.global_get(active);
            f.instruction(&I::If(BlockType::Empty));
            f.global_get(flag);
            f.global_get(payload);
            f.global_get(stack);
            f.instruction(&I::StructNew(frame));
            f.global_set(stack);
            f.instructions(&[I::End, I::I32Const(1)]);
            f.global_set(active);
            clear(&mut f, m, flag, payload)?;
        }
        Helper::Leave => {
            let active = state(m, Slot::Active)?;
            let stack = state(m, Slot::Stack)?;
            let frame = activation(m)?;
            f.global_get(stack);
            f.instructions(&[I::RefIsNull, I::If(BlockType::Empty)]);
            clear(&mut f, m, flag, payload)?;
            f.instruction(&I::I32Const(0));
            f.global_set(active);
            f.instruction(&I::Else);
            for (field, global) in [(0, flag), (1, payload), (2, stack)] {
                f.global_get(stack);
                f.instruction(&I::StructGet {
                    struct_type_index: frame,
                    field_index: field,
                });
                f.global_set(global);
            }
            f.instruction(&I::End);
        }
        Helper::Raising => f.global_get(flag),
        Helper::Raise => {
            f.instruction(&I::LocalGet(0));
            f.global_set(payload);
            f.instruction(&I::I32Const(1));
            f.global_set(flag);
        }
        Helper::Take => {
            f.global_get(payload);
            f.instruction(&I::LocalSet(0));
            clear(&mut f, m, flag, payload)?;
            f.instruction(&I::LocalGet(0));
        }
        Helper::Publish => publish(&mut f, m, flag, payload)?,
    }
    f.instruction(&I::End);
    Ok(f)
}
fn clear(
    f: &mut Function,
    m: &mut Builder<'_>,
    flag: Global,
    payload: Global,
) -> Result<(), Failure> {
    let undefined = erased::singleton(m, erased::Singleton::Undefined)?;
    f.instruction(&I::I32Const(0));
    f.global_set(flag);
    f.global_get(undefined);
    f.global_set(payload);
    Ok(())
}
fn publish(
    f: &mut Function,
    m: &mut Builder<'_>,
    flag: Global,
    payload: Global,
) -> Result<(), Failure> {
    let tag = erased::callee(m, erased::Helper::Tag)?;
    f.global_get(flag);
    f.instructions(&[I::I32Eqz, I::If(BlockType::Empty), I::Return, I::End]);
    f.global_get(payload);
    f.call(tag);
    f.instruction(&I::LocalSet(1));
    for (kind, throw_kind) in [
        (erased::NUMBER, Throw::Number),
        (erased::BOOLEAN, Throw::Boolean),
        (erased::STRING, Throw::String),
        (erased::UNDEFINED, Throw::Undefined),
        (erased::NULL, Throw::Null),
    ] {
        f.instructions(&[
            I::LocalGet(1),
            I::I32Const(kind),
            I::I32Eq,
            I::If(BlockType::Empty),
        ]);
        match throw_kind {
            Throw::Number | Throw::Boolean => {
                let helper = if throw_kind == Throw::Number {
                    erased::Helper::Number
                } else {
                    erased::Helper::Boolean
                };
                let project = erased::callee(m, helper)?;
                f.global_get(payload);
                f.call(project);
            }
            Throw::String => {
                let ty = m
                    .types
                    .erased
                    .ok_or_else(|| Failure::Invariant("missing erased throw types".into()))?
                    .string;
                f.global_get(payload);
                f.instructions(&[
                    I::RefCastNonNull(HeapType::Concrete(ty)),
                    I::StructGet {
                        struct_type_index: ty,
                        field_index: 1,
                    },
                ]);
            }
            Throw::Undefined | Throw::Null => {}
            Throw::Decline => {
                return Err(Failure::Invariant(
                    "decline classified as primitive throw".into(),
                ));
            }
        }
        let import = throw(m, throw_kind);
        f.call(import);
        f.instructions(&[I::Unreachable, I::End]);
    }
    let decline = throw(m, Throw::Decline);
    f.instruction(&I::LocalGet(0));
    f.call(decline);
    f.instruction(&I::Unreachable);
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
    b.ins(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    b.global_get(undefined);
    b.ins(&I::Else);
    erased::erase(b, value, absent)?;
    b.ins(&I::End);
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
    let helper = match source {
        Source::Raise | Source::Uncaught => Helper::Raise,
        Source::Raising => Helper::Raising,
        Source::Take => Helper::Take,
    };
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
    if let Some(arg) = args.first() {
        b.load(*arg)?;
    }
    let f = callee(b.m, helper)?;
    b.call(f);
    if matches!(source, Source::Uncaught) {
        strings::constant(b, &b.func.name.clone());
        let publish = callee(b.m, Helper::Publish)?;
        b.call(publish);
        b.ins(&I::Unreachable);
    }
    Ok(())
}
