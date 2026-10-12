//! Explicit prepared-HIR raising, isolated by module-local host activations.

use crate::{
    body::Body,
    erased,
    error::Failure,
    module::Symbols,
    strings,
    types::{Physical, Slot},
};
use nts_core::hir::{HirType, ValueId};
use std::collections::BTreeMap;
use wasm_encoder::{
    BlockType, ConstExpr, ExportKind, ExportSection, Function, GlobalSection, GlobalType, HeapType,
    Instruction as I, RefType, ValType,
};

pub(crate) const PREFIX: &str = "$nts$activation$";
pub(crate) const GLOBALS: u32 = 4;

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
            Self::Raising => (vec![], Some(Physical::Scalar(Slot::I32))),
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
    pub(crate) const ALL: [Self; 6] = [
        Self::Number,
        Self::Boolean,
        Self::String,
        Self::Undefined,
        Self::Null,
        Self::Decline,
    ];
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
            Self::Number => vec![Physical::Scalar(Slot::F64)],
            Self::Boolean => vec![Physical::Scalar(Slot::I32)],
            Self::String | Self::Decline => vec![strings::STRING],
            Self::Undefined | Self::Null => vec![],
        }
    }
}

#[derive(Debug)]
pub(crate) struct State {
    first: u32,
    pub(crate) functions: BTreeMap<Helper, u32>,
    pub(crate) imports: BTreeMap<Throw, u32>,
}
impl State {
    pub(crate) fn new(first: u32) -> Self {
        Self {
            first,
            functions: BTreeMap::new(),
            imports: BTreeMap::new(),
        }
    }
    const fn flag(&self) -> u32 {
        self.first
    }
    const fn payload(&self) -> u32 {
        self.first + 1
    }
    const fn active(&self) -> u32 {
        self.first + 2
    }
    const fn stack(&self) -> u32 {
        self.first + 3
    }
    pub(crate) fn function(&self, helper: Helper) -> Result<u32, Failure> {
        self.functions.get(&helper).copied().ok_or_else(|| {
            Failure::Invariant(format!("unplanned raising helper {}", helper.name()))
        })
    }
    fn import(&self, throw: Throw) -> Result<u32, Failure> {
        self.imports
            .get(&throw)
            .copied()
            .ok_or_else(|| Failure::Invariant(format!("unplanned throw import {}", throw.name())))
    }
}

fn state<'a>(symbols: &'a Symbols<'_>) -> Result<&'a State, Failure> {
    symbols
        .raising
        .as_ref()
        .ok_or_else(|| Failure::Invariant("unplanned raising state".into()))
}
fn undefined(symbols: &Symbols<'_>) -> Result<u32, Failure> {
    symbols
        .erased_globals
        .ok_or_else(|| Failure::Invariant("missing raising undefined singleton".into()))?
        .for_tag(erased::UNDEFINED)
}
fn activation(symbols: &Symbols<'_>) -> Result<u32, Failure> {
    symbols
        .types
        .activation
        .ok_or_else(|| Failure::Invariant("unplanned activation frame".into()))
}
fn ins(f: &mut Function, code: &[I<'_>]) {
    for i in code {
        f.instruction(i);
    }
}
fn erased_binding(symbols: &Symbols<'_>, helper: erased::Helper) -> Result<u32, Failure> {
    symbols.erased.get(&helper).copied().ok_or_else(|| {
        Failure::Invariant(format!("unplanned publication helper {}", helper.name()))
    })
}

pub(crate) fn globals(symbols: &Symbols<'_>, section: &mut GlobalSection) -> Result<(), Failure> {
    if symbols.raising.is_none() {
        return Ok(());
    }
    let frame = HeapType::Concrete(activation(symbols)?);
    for (ty, initial) in [
        (ValType::I32, ConstExpr::i32_const(0)),
        (
            ValType::Ref(RefType::ANYREF),
            ConstExpr::global_get(undefined(symbols)?),
        ),
        (ValType::I32, ConstExpr::i32_const(0)),
        (
            ValType::Ref(RefType {
                nullable: true,
                heap_type: frame,
            }),
            ConstExpr::ref_null(frame),
        ),
    ] {
        section.global(
            GlobalType {
                val_type: ty,
                mutable: true,
                shared: false,
            },
            &initial,
        );
    }
    Ok(())
}

pub(crate) fn exports(
    symbols: &Symbols<'_>,
    section: &mut ExportSection,
) -> Result<Option<crate::Activation>, Failure> {
    let Some(state) = &symbols.raising else {
        return Ok(None);
    };
    for helper in [
        Helper::Enter,
        Helper::Leave,
        Helper::Raising,
        Helper::Publish,
    ] {
        section.export(helper.name(), ExportKind::Func, state.function(helper)?);
    }
    Ok(Some(crate::Activation {
        enter: Helper::Enter.name().into(),
        leave: Helper::Leave.name().into(),
        raising: Helper::Raising.name().into(),
        publish: Helper::Publish.name().into(),
    }))
}

pub(crate) fn body(helper: Helper, symbols: &Symbols<'_>) -> Result<Function, Failure> {
    let s = state(symbols)?;
    let mut f = match helper {
        Helper::Take => Function::new([(1, ValType::Ref(RefType::ANYREF))]),
        Helper::Publish => Function::new([(1, ValType::I32)]),
        Helper::Enter | Helper::Leave | Helper::Raising | Helper::Raise => Function::new([]),
    };
    match helper {
        Helper::Enter => {
            ins(
                &mut f,
                &[
                    I::GlobalGet(s.active()),
                    I::If(BlockType::Empty),
                    I::GlobalGet(s.flag()),
                    I::GlobalGet(s.payload()),
                    I::GlobalGet(s.stack()),
                    I::StructNew(activation(symbols)?),
                    I::GlobalSet(s.stack()),
                    I::End,
                    I::I32Const(1),
                    I::GlobalSet(s.active()),
                ],
            );
            clear(&mut f, s, symbols)?;
        }
        Helper::Leave => {
            ins(
                &mut f,
                &[
                    I::GlobalGet(s.stack()),
                    I::RefIsNull,
                    I::If(BlockType::Empty),
                ],
            );
            clear(&mut f, s, symbols)?;
            ins(&mut f, &[I::I32Const(0), I::GlobalSet(s.active()), I::Else]);
            for (field, global) in [(0, s.flag()), (1, s.payload()), (2, s.stack())] {
                ins(
                    &mut f,
                    &[
                        I::GlobalGet(s.stack()),
                        I::StructGet {
                            struct_type_index: activation(symbols)?,
                            field_index: field,
                        },
                        I::GlobalSet(global),
                    ],
                );
            }
            f.instruction(&I::End);
        }
        Helper::Raising => {
            f.instruction(&I::GlobalGet(s.flag()));
        }
        Helper::Raise => {
            ins(
                &mut f,
                &[
                    I::LocalGet(0),
                    I::GlobalSet(s.payload()),
                    I::I32Const(1),
                    I::GlobalSet(s.flag()),
                ],
            );
        }
        Helper::Take => {
            ins(&mut f, &[I::GlobalGet(s.payload()), I::LocalSet(0)]);
            clear(&mut f, s, symbols)?;
            f.instruction(&I::LocalGet(0));
        }
        Helper::Publish => publish(&mut f, s, symbols)?,
    }
    f.instruction(&I::End);
    Ok(f)
}
fn clear(f: &mut Function, s: &State, symbols: &Symbols<'_>) -> Result<(), Failure> {
    ins(
        f,
        &[
            I::I32Const(0),
            I::GlobalSet(s.flag()),
            I::GlobalGet(undefined(symbols)?),
            I::GlobalSet(s.payload()),
        ],
    );
    Ok(())
}
fn publish(f: &mut Function, s: &State, symbols: &Symbols<'_>) -> Result<(), Failure> {
    ins(
        f,
        &[
            I::GlobalGet(s.flag()),
            I::I32Eqz,
            I::If(BlockType::Empty),
            I::Return,
            I::End,
            I::GlobalGet(s.payload()),
            I::Call(erased_binding(symbols, erased::Helper::Tag)?),
            I::LocalSet(1),
        ],
    );
    for (tag, throw) in [
        (erased::NUMBER, Throw::Number),
        (erased::BOOLEAN, Throw::Boolean),
        (erased::STRING, Throw::String),
        (erased::UNDEFINED, Throw::Undefined),
        (erased::NULL, Throw::Null),
    ] {
        ins(
            f,
            &[
                I::LocalGet(1),
                I::I32Const(tag),
                I::I32Eq,
                I::If(BlockType::Empty),
            ],
        );
        match throw {
            Throw::Number | Throw::Boolean => {
                let helper = if throw == Throw::Number {
                    erased::Helper::Number
                } else {
                    erased::Helper::Boolean
                };
                ins(
                    f,
                    &[
                        I::GlobalGet(s.payload()),
                        I::Call(erased_binding(symbols, helper)?),
                    ],
                );
            }
            Throw::String => {
                let ty = symbols
                    .types
                    .erased
                    .ok_or_else(|| Failure::Invariant("missing erased throw types".into()))?
                    .string;
                ins(
                    f,
                    &[
                        I::GlobalGet(s.payload()),
                        I::RefCastNonNull(HeapType::Concrete(ty)),
                        I::StructGet {
                            struct_type_index: ty,
                            field_index: 1,
                        },
                    ],
                );
            }
            Throw::Undefined | Throw::Null => {}
            Throw::Decline => {
                return Err(Failure::Invariant(
                    "decline classified as primitive throw".into(),
                ));
            }
        }
        ins(f, &[I::Call(s.import(throw)?), I::Unreachable, I::End]);
    }
    ins(
        f,
        &[
            I::LocalGet(0),
            I::Call(s.import(Throw::Decline)?),
            I::Unreachable,
        ],
    );
    Ok(())
}

pub(crate) fn erase_result(
    b: &mut Body<'_>,
    value: ValueId,
    absent: nts_core::hir::Absent,
) -> Result<(), Failure> {
    b.ins(&I::GlobalGet(state(b.symbols)?.flag()));
    b.ins(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
    b.ins(&I::GlobalGet(undefined(b.symbols)?));
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
    b: &mut Body<'_>,
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
    b.ins(&I::Call(state(b.symbols)?.function(helper)?));
    if matches!(source, Source::Uncaught) {
        strings::constant(b, &b.func.name.clone())?;
        b.ins(&I::Call(state(b.symbols)?.function(Helper::Publish)?));
        b.ins(&I::Unreachable);
    }
    Ok(())
}
