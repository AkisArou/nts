//! `Array.prototype.join` over string and number arrays: one module-local
//! helper per storage shape, concatenating through the string builtins.
use crate::{
    body::Body,
    contract,
    error::Failure,
    gc, host,
    ir::Function,
    module::{Builder, Func, FuncKey},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

const STRING: HirType = HirType::Managed(ManagedType::String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Join {
    Strings,
    Numbers,
}

pub(crate) fn external(name: &str) -> Option<Join> {
    match name {
        "nts_array_join_str" => Some(Join::Strings),
        "nts_array_join_num" => Some(Join::Numbers),
        _ => None,
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    name: &str,
    join: Join,
    args: &[ValueId],
) -> Result<(), Failure> {
    inner(b, result, join, args).map_err(|error| match error {
        Failure::Unsupported(reason) => {
            Failure::Unsupported(format!("array helper `{name}`: {reason}"))
        }
        Failure::Invariant(reason) => Failure::Invariant(reason),
    })
}
fn inner(
    b: &mut Body<'_, '_>,
    result: ValueId,
    join: Join,
    args: &[ValueId],
) -> Result<(), Failure> {
    let [array, separator] = args else {
        return Err("join arity mismatch".into());
    };
    let shape = b.types().array(b.ty(*array))?;
    let accepted = match join {
        Join::Strings => strings::is_string(&shape.element),
        Join::Numbers => shape.element == HirType::NUMBER,
    };
    if !accepted {
        return Err(format!("join over element {:?}", shape.element).into());
    }
    if !strings::is_string(b.ty(*separator)) {
        return Err(format!("join separator {:?}", b.ty(*separator)).into());
    }
    contract::nonnull(b, *array, "joining a null array")?;
    // `undefined` joins with "," and `null` with "null", and a typed string's
    // null does not say which it stands for.
    contract::nonnull(
        b,
        *separator,
        "a null separator, which may stand for undefined or for null",
    )?;
    b.load(*array)?;
    b.load(*separator)?;
    let target = callee(b.m, join, shape)?;
    b.call(target);
    if b.ty(result) == &HirType::Void {
        b.instruction(&I::Drop);
        Ok(())
    } else {
        objects::adapt(b, &STRING, &b.ty(result).clone())
    }
}
fn callee(m: &mut Builder<'_>, join: Join, shape: &gc::Array) -> Result<Func, Failure> {
    let array = Physical::Reference(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(shape.wrapper),
    });
    m.helper(
        FuncKey::ArrayJoin(shape.wrapper),
        format!("array.join<{:?}>", shape.element),
        vec![array, strings::STRING],
        Some(strings::STRING),
        |m| body(join, shape, m),
    )
}
/// Params: array, separator. Locals: length, index, the text so far.
///
/// Each element's text is appended after the separator, from the second on. A
/// null string slot joins as the empty string, as `null` and `undefined` both
/// do in node; a number's text is `Number.prototype.toString`'s.
fn body(join: Join, shape: &gc::Array, m: &mut Builder<'_>) -> Result<Function, Failure> {
    let concat = strings::callee(m, strings::Helper::Concat)?;
    let empty = m.literal("");
    let text = match join {
        Join::Strings => None,
        Join::Numbers => Some(
            host::external("nts_number_to_string")
                .ok_or_else(|| Failure::Invariant("number text service".into()))?
                .callee(m),
        ),
    };
    let mut f = Function::new([ValType::I32, ValType::I32, ValType::Ref(RefType::EXTERNREF)]);
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: 1,
        },
        I::LocalSet(2),
    ]);
    f.global_get(empty);
    f.instructions(&[
        I::LocalSet(4),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(3),
        I::LocalGet(2),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(3),
        I::If(BlockType::Empty),
        I::LocalGet(4),
        I::LocalGet(1),
    ]);
    f.call(concat);
    f.instructions(&[I::LocalSet(4), I::End, I::LocalGet(4)]);
    if text.is_none() {
        f.instruction(&I::Block(BlockType::Result(ValType::Ref(
            RefType::EXTERNREF,
        ))));
    }
    f.instructions(&[
        I::LocalGet(0),
        I::StructGet {
            struct_type_index: shape.wrapper,
            field_index: 2,
        },
        I::LocalGet(3),
        crate::arrays::get_instruction(shape)?,
    ]);
    if let Some(text) = text {
        f.call(text);
    } else {
        f.instruction(&I::BrOnNonNull(0));
        f.global_get(empty);
        f.instruction(&I::End);
    }
    f.call(concat);
    f.instructions(&[
        I::LocalSet(4),
        I::LocalGet(3),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(3),
        I::Br(0),
        I::End,
        I::End,
        I::LocalGet(4),
        I::End,
    ]);
    Ok(f)
}
