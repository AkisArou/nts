//! Erased primitives use GC storage and the shared semantic tag numbers.

use crate::{
    body::Body,
    error::Failure,
    gc::ErasedTypes,
    module::Symbols,
    numeric,
    types::{Physical, Slot},
};
use nts_core::hir::{Absent, HirType, ManagedType, ValueId};
use wasm_encoder::{
    BlockType, ConstExpr, Function, GlobalSection, GlobalType, HeapType, Instruction as I, RefType,
    ValType,
};

pub(crate) const SINGLETONS: u32 = 4;
pub(crate) const UNDEFINED: i32 = 0;
pub(crate) const BOOLEAN: i32 = 1;
pub(crate) const NUMBER: i32 = 2;
pub(crate) const STRING: i32 = 3;
pub(crate) const NULL: i32 = 7;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Globals {
    undefined: u32,
    null: u32,
    false_: u32,
    true_: u32,
}

impl Globals {
    pub(crate) const fn new(first: u32) -> Self {
        Self {
            undefined: first,
            null: first + 1,
            false_: first + 2,
            true_: first + 3,
        }
    }
    pub(crate) fn for_tag(self, tag: i32) -> Result<u32, Failure> {
        match tag {
            UNDEFINED => Ok(self.undefined),
            NULL => Ok(self.null),
            BOOLEAN => Ok(self.false_),
            _ => Err(Failure::Invariant(format!("tag {tag} has no singleton"))),
        }
    }
    pub(crate) const fn boolean(self, value: bool) -> u32 {
        if value { self.true_ } else { self.false_ }
    }
}

pub(crate) fn globals(types: ErasedTypes, section: &mut GlobalSection) {
    for (ty, code) in [
        (
            types.tagged,
            vec![I::I32Const(UNDEFINED), I::StructNew(types.tagged)],
        ),
        (
            types.tagged,
            vec![I::I32Const(NULL), I::StructNew(types.tagged)],
        ),
        (
            types.boolean,
            vec![
                I::I32Const(BOOLEAN),
                I::I32Const(0),
                I::StructNew(types.boolean),
            ],
        ),
        (
            types.boolean,
            vec![
                I::I32Const(BOOLEAN),
                I::I32Const(1),
                I::StructNew(types.boolean),
            ],
        ),
    ] {
        section.global(
            GlobalType {
                val_type: ValType::Ref(RefType {
                    nullable: false,
                    heap_type: HeapType::Concrete(ty),
                }),
                mutable: false,
                shared: false,
            },
            &ConstExpr::extended(code),
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    BoxNumber,
    Number,
    Tag,
}

impl Helper {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::BoxNumber => "value.boxNumber",
            Self::Number => "value.number",
            Self::Tag => "value.tag",
        }
    }
    pub(crate) fn signature(self) -> (Vec<Physical>, Physical) {
        let number = Physical::Scalar(Slot::F64);
        let erased = Physical::Reference(RefType::ANYREF);
        match self {
            Self::BoxNumber => (vec![number], erased),
            Self::Number => (vec![erased], number),
            Self::Tag => (vec![erased], Physical::Scalar(Slot::I32)),
        }
    }
    pub(crate) fn body(self, types: ErasedTypes) -> Function {
        let mut f = Function::new([]);
        match self {
            Self::BoxNumber => instructions(
                &mut f,
                &[
                    I::LocalGet(0),
                    I::F64Const((-1_073_741_824.0).into()),
                    I::F64Ge,
                    I::LocalGet(0),
                    I::F64Const(1_073_741_823.0.into()),
                    I::F64Le,
                    I::I32And,
                    I::LocalGet(0),
                    I::F64Trunc,
                    I::LocalGet(0),
                    I::F64Eq,
                    I::I32And,
                    I::LocalGet(0),
                    I::I64ReinterpretF64,
                    I::I64Const(i64::MIN),
                    I::I64Ne,
                    I::I32And,
                    I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))),
                    I::LocalGet(0),
                    I::I32TruncSatF64S,
                    I::RefI31,
                    I::Else,
                    I::I32Const(NUMBER),
                    I::LocalGet(0),
                    I::StructNew(types.number),
                    I::End,
                ],
            ),
            Self::Number => instructions(
                &mut f,
                &[
                    I::LocalGet(0),
                    I::RefTestNonNull(HeapType::I31),
                    I::If(BlockType::Result(ValType::F64)),
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::I31),
                    I::I31GetS,
                    I::F64ConvertI32S,
                    I::Else,
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(types.number)),
                    I::StructGet {
                        struct_type_index: types.number,
                        field_index: 1,
                    },
                    I::End,
                ],
            ),
            Self::Tag => instructions(
                &mut f,
                &[
                    I::LocalGet(0),
                    I::RefTestNonNull(HeapType::I31),
                    I::If(BlockType::Result(ValType::I32)),
                    I::I32Const(NUMBER),
                    I::Else,
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(types.tagged)),
                    I::StructGet {
                        struct_type_index: types.tagged,
                        field_index: 0,
                    },
                    I::End,
                ],
            ),
        }
        f.instruction(&I::End);
        f
    }
}

fn instructions(f: &mut Function, code: &[I<'_>]) {
    for i in code {
        f.instruction(i);
    }
}
fn types(symbols: &Symbols<'_>) -> Result<ErasedTypes, Failure> {
    symbols
        .types
        .erased
        .ok_or_else(|| Failure::Invariant("unplanned erased types".into()))
}
fn values(symbols: &Symbols<'_>) -> Result<Globals, Failure> {
    symbols
        .erased_globals
        .ok_or_else(|| Failure::Invariant("unplanned erased singletons".into()))
}
pub(crate) fn call(body: &mut Body<'_>, helper: Helper) -> Result<(), Failure> {
    let index = *body
        .symbols
        .erased
        .get(&helper)
        .ok_or_else(|| Failure::Invariant(format!("unplanned erased helper {helper:?}")))?;
    body.ins(&I::Call(index));
    Ok(())
}

pub(crate) fn constant(body: &mut Body<'_>, result: ValueId, tag: i32) -> Result<(), Failure> {
    match body.symbols.types.slot(body.ty(result))? {
        Some(Physical::Reference(_)) if body.ty(result) == &HirType::Erased => {
            let global = values(body.symbols)?.for_tag(tag)?;
            body.ins(&I::GlobalGet(global));
        }
        Some(Physical::Reference(reference)) => body.ins(&I::RefNull(reference.heap_type)),
        _ => return Err(format!("absence constant in {:?}", body.ty(result)).into()),
    }
    Ok(())
}

pub(crate) fn erase(body: &mut Body<'_>, value: ValueId, absent: Absent) -> Result<(), Failure> {
    match body.ty(value).clone() {
        HirType::Erased => body.load(value)?,
        HirType::Void => body.ins(&I::GlobalGet(values(body.symbols)?.for_tag(UNDEFINED)?)),
        HirType::Bool => {
            let globals = values(body.symbols)?;
            body.load(value)?;
            body.ins(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
            body.ins(&I::GlobalGet(globals.boolean(true)));
            body.ins(&I::Else);
            body.ins(&I::GlobalGet(globals.boolean(false)));
            body.ins(&I::End);
        }
        ty @ (HirType::Int { .. } | HirType::Float { .. }) => {
            body.load(value)?;
            numeric::convert(body, &ty, &HirType::NUMBER)?;
            call(body, Helper::BoxNumber)?;
        }
        HirType::Managed(ManagedType::String) => erase_string(body, value, absent)?,
        ty @ (HirType::Managed(_)
        | HirType::BigInt
        | HirType::NativePointer(_)
        | HirType::Never) => {
            return Err(
                format!("erasing {ty:?} is outside the current primitive implementation").into(),
            );
        }
    }
    Ok(())
}

fn erase_string(body: &mut Body<'_>, value: ValueId, absent: Absent) -> Result<(), Failure> {
    let ty = types(body.symbols)?.string;
    let tag = match absent {
        Absent::Impossible => None,
        Absent::Null => Some(NULL),
        Absent::Undefined => Some(UNDEFINED),
    };
    if let Some(tag) = tag {
        body.load(value)?;
        body.ins(&I::RefIsNull);
        body.ins(&I::If(BlockType::Result(ValType::Ref(RefType::ANYREF))));
        body.ins(&I::GlobalGet(values(body.symbols)?.for_tag(tag)?));
        body.ins(&I::Else);
    }
    body.ins(&I::I32Const(STRING));
    body.load(value)?;
    body.ins(&I::StructNew(ty));
    if tag.is_some() {
        body.ins(&I::End);
    }
    Ok(())
}

pub(crate) fn unerase(body: &mut Body<'_>, result: ValueId, value: ValueId) -> Result<(), Failure> {
    let boxed = types(body.symbols)?;
    body.load(value)?;
    match body.ty(result).clone() {
        HirType::Erased => {}
        HirType::Bool => {
            body.ins(&I::RefCastNonNull(HeapType::Concrete(boxed.boolean)));
            body.ins(&I::StructGet {
                struct_type_index: boxed.boolean,
                field_index: 1,
            });
        }
        ty @ (HirType::Int { .. } | HirType::Float { .. }) => {
            call(body, Helper::Number)?;
            numeric::convert(body, &HirType::NUMBER, &ty)?;
        }
        HirType::Managed(ManagedType::String) => {
            body.ins(&I::Drop);
            body.load(value)?;
            call(body, Helper::Tag)?;
            body.ins(&I::I32Const(NULL));
            body.ins(&I::I32Eq);
            body.load(value)?;
            call(body, Helper::Tag)?;
            body.ins(&I::I32Const(UNDEFINED));
            body.ins(&I::I32Eq);
            body.ins(&I::I32Or);
            body.ins(&I::If(BlockType::Result(ValType::EXTERNREF)));
            body.ins(&I::RefNull(HeapType::EXTERN));
            body.ins(&I::Else);
            body.load(value)?;
            body.ins(&I::RefCastNonNull(HeapType::Concrete(boxed.string)));
            body.ins(&I::StructGet {
                struct_type_index: boxed.string,
                field_index: 1,
            });
            body.ins(&I::End);
        }
        ty => {
            return Err(format!(
                "unerasing {ty:?} is outside the current primitive implementation"
            )
            .into());
        }
    }
    Ok(())
}

pub(crate) fn tag(body: &mut Body<'_>, result: ValueId, value: ValueId) -> Result<(), Failure> {
    body.load(value)?;
    call(body, Helper::Tag)?;
    numeric::convert(
        body,
        &HirType::Int {
            bits: 32,
            signed: false,
        },
        &body.ty(result).clone(),
    )
}
