//! Typed array copying and movement preserve wrappers and element identity.
use crate::{
    array_methods::Family, arrays, body::Body, contract, error::Failure, gc, indexing,
    module::Symbols, objects, types::Physical,
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, Function, HeapType, Instruction as I, RefType, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    Slice,
    Concat,
    Extend,
    Reverse,
}
#[derive(Debug, Clone, Copy)]
pub(crate) struct Method {
    pub(crate) helper: Helper,
    family: Family,
}
pub(crate) fn external(name: &str) -> Option<Method> {
    use Family::{Number, Reference, Value};
    use Helper::{Concat, Extend, Reverse, Slice};
    let (helper, family) = match name {
        "nts_array_slice" => (Slice, Number),
        "nts_array_slice_ref" => (Slice, Reference),
        "nts_array_concat" => (Concat, Number),
        "nts_array_concat_ref" => (Concat, Reference),
        "nts_array_concat_value" => (Concat, Value),
        "nts_array_extend" => (Extend, Number),
        "nts_array_extend_ref" => (Extend, Reference),
        "nts_array_reverse" => (Reverse, Number),
        "nts_array_reverse_ref" => (Reverse, Reference),
        _ => return None,
    };
    Some(Method { helper, family })
}
impl Helper {
    pub(crate) fn signature(self, shape: &gc::Array) -> (Vec<Physical>, Option<Physical>) {
        let array = Physical::Reference(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(shape.wrapper),
        });
        match self {
            Self::Slice => (
                vec![
                    array,
                    Physical::Scalar(crate::types::Slot::F64),
                    Physical::Scalar(crate::types::Slot::F64),
                ],
                Some(array),
            ),
            Self::Concat => (vec![array, array], Some(array)),
            Self::Extend => (vec![array, array], None),
            Self::Reverse => (vec![array], Some(array)),
        }
    }
}

pub(crate) fn call(
    b: &mut Body<'_>,
    result: ValueId,
    name: &str,
    method: Method,
    args: &[ValueId],
) -> Result<(), Failure> {
    inner(b, result, method, args).map_err(|error| match error {
        Failure::Unsupported(reason) => {
            Failure::Unsupported(format!("array helper `{name}`: {reason}"))
        }
        Failure::Invariant(reason) => Failure::Invariant(reason),
    })
}
fn inner(
    b: &mut Body<'_>,
    result: ValueId,
    method: Method,
    args: &[ValueId],
) -> Result<(), Failure> {
    let arity = match method.helper {
        Helper::Slice => 3,
        Helper::Concat | Helper::Extend => 2,
        Helper::Reverse => 1,
    };
    if args.len() != arity {
        return Err("array copying arity mismatch".into());
    }
    let shape = b.symbols.types.array(b.ty(args[0]))?;
    let accepted = match method.family {
        Family::Number => shape.element == HirType::NUMBER,
        Family::Reference => matches!(
            shape.element,
            HirType::Managed(ManagedType::String | ManagedType::Object(_) | ManagedType::Array(_))
        ),
        Family::Value => shape.element == HirType::Erased,
        Family::Boolean => false,
    };
    if !accepted {
        return Err(format!("copying element {:?}", shape.element).into());
    }
    if method.helper == Helper::Extend {
        if b.ty(result) != &HirType::Void {
            return Err("extend result must be void".into());
        }
    } else if b.ty(result) != &shape.ty && b.ty(result) != &HirType::Void {
        return Err("copying result changes mutable array storage".into());
    }
    contract::nonnull(b, args[0])?;
    if matches!(method.helper, Helper::Concat | Helper::Extend) {
        if b.ty(args[1]) != &shape.ty {
            return Err("copying source changes mutable array storage".into());
        }
        contract::nonnull(b, args[1])?;
        arrays::logical_length(b, args[0], shape.wrapper)?;
        b.ins(&I::F64ConvertI32U);
        arrays::logical_length(b, args[1], shape.wrapper)?;
        b.ins(&I::F64ConvertI32U);
        b.ins(&I::F64Add);
        b.ins(&I::F64Const(f64::from(u32::MAX).into()));
        b.ins(&I::F64Le);
        contract::require(b)?;
    }
    b.load(args[0])?;
    if method.helper == Helper::Slice {
        arrays::number(b, args[1])?;
        arrays::number(b, args[2])?;
    } else if args.len() == 2 {
        b.load(args[1])?;
    }
    let target = b
        .symbols
        .array_copy
        .get(&(shape.wrapper, method.helper))
        .ok_or_else(|| Failure::Invariant("unplanned array copying helper".into()))?;
    b.ins(&I::Call(*target));
    if b.ty(result) == &HirType::Void && method.helper != Helper::Extend {
        b.ins(&I::Drop);
    }
    Ok(())
}

fn ins(f: &mut Function, code: &[I<'_>]) {
    for i in code {
        f.instruction(i);
    }
}
fn length(f: &mut Function, shape: &gc::Array, input: u32, local: u32) {
    ins(
        f,
        &[
            I::LocalGet(input),
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: 1,
            },
            I::LocalSet(local),
        ],
    );
}
fn backing(f: &mut Function, shape: &gc::Array, input: u32) {
    ins(
        f,
        &[
            I::LocalGet(input),
            I::StructGet {
                struct_type_index: shape.wrapper,
                field_index: 2,
            },
        ],
    );
}
fn allocate(
    f: &mut Function,
    shape: &gc::Array,
    symbols: &Symbols<'_>,
    count: u32,
    local: u32,
) -> Result<(), Failure> {
    f.instruction(&objects::default_instruction(symbols, &shape.element)?);
    ins(
        f,
        &[
            I::LocalGet(count),
            I::ArrayNew(shape.backing),
            I::LocalSet(local),
        ],
    );
    Ok(())
}
fn wrap(f: &mut Function, shape: &gc::Array, symbols: &Symbols<'_>, count: u32, local: u32) {
    ins(
        f,
        &[
            I::GlobalGet(symbols.descriptor_base + shape.descriptor),
            I::LocalGet(count),
            I::LocalGet(local),
            I::RefAsNonNull,
            I::StructNew(shape.wrapper),
        ],
    );
}
fn copy(f: &mut Function, shape: &gc::Array) {
    f.instruction(&I::ArrayCopy {
        array_type_index_dst: shape.backing,
        array_type_index_src: shape.backing,
    });
}
pub(crate) fn body(
    helper: Helper,
    shape: &gc::Array,
    symbols: &Symbols<'_>,
) -> Result<Function, Failure> {
    let backing_type = ValType::Ref(RefType {
        nullable: true,
        heap_type: HeapType::Concrete(shape.backing),
    });
    let mut f = match helper {
        Helper::Slice => Function::new_with_locals_types([
            ValType::I32,
            ValType::I32,
            ValType::I32,
            ValType::F64,
            backing_type,
        ]),
        Helper::Concat => Function::new_with_locals_types([
            ValType::I32,
            ValType::I32,
            ValType::I32,
            backing_type,
        ]),
        Helper::Extend => {
            Function::new_with_locals_types([ValType::I32, ValType::I32, ValType::I32])
        }
        Helper::Reverse => Function::new_with_locals_types([
            ValType::I32,
            ValType::I32,
            ValType::I32,
            symbols.types.value_slot(&shape.element)?.wasm(),
        ]),
    };
    match helper {
        Helper::Slice => slice(&mut f, shape, symbols)?,
        Helper::Concat => {
            length(&mut f, shape, 0, 2);
            length(&mut f, shape, 1, 3);
            ins(
                &mut f,
                &[I::LocalGet(2), I::LocalGet(3), I::I32Add, I::LocalSet(4)],
            );
            allocate(&mut f, shape, symbols, 4, 5)?;
            ins(&mut f, &[I::LocalGet(5), I::I32Const(0)]);
            backing(&mut f, shape, 0);
            ins(&mut f, &[I::I32Const(0), I::LocalGet(2)]);
            copy(&mut f, shape);
            ins(&mut f, &[I::LocalGet(5), I::LocalGet(2)]);
            backing(&mut f, shape, 1);
            ins(&mut f, &[I::I32Const(0), I::LocalGet(3)]);
            copy(&mut f, shape);
            wrap(&mut f, shape, symbols, 4, 5);
        }
        Helper::Extend => {
            length(&mut f, shape, 0, 2);
            length(&mut f, shape, 1, 3);
            ins(
                &mut f,
                &[
                    I::LocalGet(2),
                    I::LocalGet(3),
                    I::I32Add,
                    I::LocalSet(4),
                    I::LocalGet(0),
                    I::LocalGet(4),
                    I::Call(*symbols.array_grow.get(&shape.wrapper).ok_or_else(|| {
                        Failure::Invariant("unplanned array extend growth".into())
                    })?),
                ],
            );
            backing(&mut f, shape, 0);
            f.instruction(&I::LocalGet(2));
            backing(&mut f, shape, 1);
            ins(&mut f, &[I::I32Const(0), I::LocalGet(3)]);
            copy(&mut f, shape);
            ins(
                &mut f,
                &[
                    I::LocalGet(0),
                    I::LocalGet(4),
                    I::StructSet {
                        struct_type_index: shape.wrapper,
                        field_index: 1,
                    },
                ],
            );
        }
        Helper::Reverse => reverse(&mut f, shape)?,
    }
    f.instruction(&I::End);
    Ok(f)
}
fn slice(f: &mut Function, shape: &gc::Array, symbols: &Symbols<'_>) -> Result<(), Failure> {
    length(f, shape, 0, 3);
    indexing::clamp(f, 1, 4, true, 3, 6);
    indexing::clamp(f, 2, 5, true, 3, 6);
    ins(
        f,
        &[
            I::LocalGet(5),
            I::LocalGet(4),
            I::I32GtU,
            I::If(BlockType::Result(ValType::I32)),
            I::LocalGet(5),
            I::LocalGet(4),
            I::I32Sub,
            I::Else,
            I::I32Const(0),
            I::End,
            I::LocalSet(5),
        ],
    );
    allocate(f, shape, symbols, 5, 7)?;
    ins(f, &[I::LocalGet(7), I::I32Const(0)]);
    backing(f, shape, 0);
    ins(f, &[I::LocalGet(4), I::LocalGet(5)]);
    copy(f, shape);
    wrap(f, shape, symbols, 5, 7);
    Ok(())
}
fn reverse(f: &mut Function, shape: &gc::Array) -> Result<(), Failure> {
    length(f, shape, 0, 1);
    ins(
        f,
        &[
            I::LocalGet(1),
            I::I32Const(2),
            I::I32LtU,
            I::If(BlockType::Empty),
            I::LocalGet(0),
            I::Return,
            I::End,
            I::LocalGet(1),
            I::I32Const(1),
            I::I32Sub,
            I::LocalSet(3),
            I::Block(BlockType::Empty),
            I::Loop(BlockType::Empty),
            I::LocalGet(2),
            I::LocalGet(3),
            I::I32GeU,
            I::BrIf(1),
        ],
    );
    backing(f, shape, 0);
    ins(
        f,
        &[
            I::LocalGet(2),
            arrays::get_instruction(shape)?,
            I::LocalSet(4),
        ],
    );
    backing(f, shape, 0);
    f.instruction(&I::LocalGet(2));
    backing(f, shape, 0);
    ins(
        f,
        &[
            I::LocalGet(3),
            arrays::get_instruction(shape)?,
            I::ArraySet(shape.backing),
        ],
    );
    backing(f, shape, 0);
    ins(
        f,
        &[
            I::LocalGet(3),
            I::LocalGet(4),
            I::ArraySet(shape.backing),
            I::LocalGet(2),
            I::I32Const(1),
            I::I32Add,
            I::LocalSet(2),
            I::LocalGet(3),
            I::I32Const(1),
            I::I32Sub,
            I::LocalSet(3),
            I::Br(0),
            I::End,
            I::End,
            I::LocalGet(0),
        ],
    );
    Ok(())
}
