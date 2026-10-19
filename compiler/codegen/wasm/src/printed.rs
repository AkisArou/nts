//! `String(value)` of an object or a function in an erased slot, as the core
//! decides it per class (`Program::printing`, the layout's entry where the
//! class has none of its own), read off the value's identity the way C reads
//! `NtsDescriptor.to_string`:
//! - **the class's own `toString`** (or the compiler's for the `Error`
//!   family), a function of this program taking the object;
//! - **`"[object Object]"`**;
//! - **a function's text**, `function NAME() { [native code] }`, with the name
//!   [`crate::function_names`] reads;
//! - **a bound function's**, `function () { [native code] }`.
//!
//! - **an array's** (a tagged template's among them) and **a typed array's**
//!   elements joined by commas, `null` and `undefined` as empty text and every
//!   other element as `String()` prints it, as `Array.prototype.toString` and
//!   `%TypedArray%.prototype.toString` join;
//! - **a runtime object's** class tag: `[object Map]`, `[object Set]`,
//!   `[object Object]` for a `Record`, `[object Promise]`,
//!   `[object ArrayBuffer]`, `[object DataView]`.
//!
//! An identity the core refuses, or whose layouts disagree, stops by name.
use crate::{
    contract, erased,
    error::Failure,
    gc,
    ir::Function,
    module::{Builder, Func, FuncKey, Global, GlobalKey},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, ManagedType, Printed};
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, GlobalType, HeapType, Instruction as I, RefType, ValType};

const UNPRINTED: &str =
    "String() of an object or a function, whose type says nothing here about how it prints";

/// `(value, caller's name) -> text`, for an erased value tagged as an object
/// or a function.
pub(crate) fn callee(m: &mut Builder<'_>) -> Result<Func, Failure> {
    m.helper(
        FuncKey::ObjectText,
        "object.toString",
        vec![Physical::Reference(RefType::ANYREF), strings::STRING],
        Some(strings::STRING),
        body,
    )
}

/// How each identity prints, where all its layouts agree.
fn printing(m: &Builder<'_>) -> Result<BTreeMap<u32, Option<Printed>>, Failure> {
    let objects = &m.types.objects;
    let mut found = BTreeMap::<u32, Option<Printed>>::new();
    for descriptor in &objects.descriptors {
        let Some(class) = descriptor.class else {
            continue;
        };
        // Per class where classes share the layout (`Program::printing`,
        // through `printing_of_type` so the derivation lives in core once):
        // this descriptor already names the class its identity serves, so
        // ask as that class rather than by the shared layout's agreement.
        objects.object(&HirType::Managed(ManagedType::Object(class)))?;
        let printed = m.program.printing_of_type(class).cloned();
        found
            .entry(descriptor.identity)
            .and_modify(|known| {
                if *known != printed {
                    *known = None;
                }
            })
            .or_insert(printed);
    }
    Ok(found)
}

/// One identity's text.
enum Case {
    /// A program function taking the object, and the type it takes it at.
    By {
        function: Func,
        param: HirType,
        result: HirType,
    },
    Literal(Global),
    /// `function ` + the value's name + the rest.
    Function {
        head: Global,
        tail: Global,
    },
}

/// Params: value, caller's name. Locals: identity.
fn body(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let root = m
        .types
        .root
        .ok_or_else(|| Failure::Invariant("missing object root".into()))?;
    let mut cases = Vec::new();
    let mut functions = false;
    for (identity, printed) in printing(m)? {
        let case = match printed {
            Some(Printed::By(name)) => {
                let (function, declaration) = m.direct(&name)?;
                let [param] = declaration.params.as_slice() else {
                    continue;
                };
                Case::By {
                    function,
                    param: param.ty.clone(),
                    result: declaration.return_type.clone(),
                }
            }
            Some(Printed::Object) => Case::Literal(m.literal("[object Object]")),
            Some(Printed::BoundFunction) => {
                Case::Literal(m.literal("function () { [native code] }"))
            }
            Some(Printed::Function) => {
                functions = true;
                Case::Function {
                    head: m.literal("function "),
                    tail: m.literal("() { [native code] }"),
                }
            }
            Some(Printed::Refused) | None => continue,
        };
        cases.push((identity, case));
    }
    let named = if functions {
        Some((
            crate::function_names::callee(m)?,
            strings::callee(m, strings::Helper::Concat)?,
        ))
    } else {
        None
    };
    let types = m.types;
    let mut f = Function::new([ValType::I32]);
    storage_cases(m, &mut f)?;
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::Concrete(root.object)),
        I::I32Eqz,
        I::If(BlockType::Empty),
    ]);
    contract::refuse_in(&mut f, m, 1, UNPRINTED)?;
    f.instruction(&I::End);
    objects::push_identity(&mut f, root, 0);
    f.instruction(&I::LocalSet(2));
    objects::identity_switch(&mut f, 2, &cases, |f, case| {
        match case {
            Case::By {
                function,
                param,
                result,
            } => {
                // The switch established the layout, so the value is the
                // parameter's storage or extends it.
                f.instruction(&I::LocalGet(0));
                if param != &HirType::Erased {
                    let Physical::Reference(RefType { heap_type, .. }) = types.value_slot(param)?
                    else {
                        return Err(format!("a toString taking a {param:?}").into());
                    };
                    f.instruction(&I::RefCastNonNull(heap_type));
                }
                // Core selects the ordinary or raising printer. A raising
                // printer's null result is a placeholder: forward it without
                // consuming it, and let the caller's HIR take the payload.
                f.call(*function);
                crate::transfer::transfer(
                    f,
                    types,
                    result,
                    &HirType::Managed(ManagedType::String),
                )?;
            }
            Case::Literal(text) => f.global_get(*text),
            Case::Function { head, tail } => {
                let Some((name, concat)) = named else {
                    return Err(Failure::Invariant("a function's text with no name".into()));
                };
                f.global_get(*head);
                f.instructions(&[I::LocalGet(0), I::LocalGet(1)]);
                f.call(name);
                f.call(concat);
                f.global_get(*tail);
                f.call(concat);
            }
        }
        f.instruction(&I::Return);
        Ok(())
    })?;
    contract::refuse_in(&mut f, m, 1, UNPRINTED)?;
    f.instruction(&I::End);
    Ok(f)
}

/// The values whose text their storage decides: arrays, typed arrays and the
/// runtime's objects, each tested by its type and answered before the class
/// identities.
fn storage_cases(m: &mut Builder<'_>, f: &mut Function) -> Result<(), Failure> {
    let types = m.types;
    let tested = |f: &mut Function, ty: u32| {
        f.instructions(&[
            I::LocalGet(0),
            I::RefTestNonNull(HeapType::Concrete(ty)),
            I::If(BlockType::Empty),
        ]);
    };
    for shape in types.arrays.values() {
        let text = array_text(m, shape.wrapper)?;
        tested(f, shape.wrapper);
        f.instructions(&[I::LocalGet(0), I::LocalGet(1)]);
        f.call(text);
        f.instructions(&[I::Return, I::End]);
    }
    let mut tags = Vec::new();
    for c in types.collections.values() {
        let tag = if c.table {
            "[object Object]"
        } else if c.value.is_some() {
            "[object Map]"
        } else {
            "[object Set]"
        };
        tags.push((c.wrapper, tag));
    }
    if let Some(p) = types.promise {
        tags.push((p.promise, "[object Promise]"));
    }
    if let Some(t) = types.buffers {
        tags.push((t.buffer, "[object ArrayBuffer]"));
        tags.push((t.dataview, "[object DataView]"));
        let join = crate::buffer_methods::callee(m, crate::buffer_methods::Helper::Join)?;
        let comma = m.literal(",");
        tested(f, t.view);
        f.instructions(&[
            I::LocalGet(0),
            I::RefCastNonNull(HeapType::Concrete(t.view)),
        ]);
        f.global_get(comma);
        f.call(join);
        f.instructions(&[I::Return, I::End]);
    }
    for (ty, tag) in tags {
        let text = m.literal(tag);
        tested(f, ty);
        f.global_get(text);
        f.instructions(&[I::Return, I::End]);
    }
    Ok(())
}

/// `(array, caller's name) -> text` for arrays of one storage.
fn array_text(m: &mut Builder<'_>, wrapper: u32) -> Result<Func, Failure> {
    m.helper(
        FuncKey::ArrayText(wrapper),
        format!("array.text<{wrapper}>"),
        vec![Physical::Reference(RefType::ANYREF), strings::STRING],
        Some(strings::STRING),
        move |m| array_text_body(m, wrapper),
    )
}

/// Params: value, caller's name. Locals: array, at, count, text, element.
fn array_text_body(m: &mut Builder<'_>, wrapper: u32) -> Result<Function, Failure> {
    let types = m.types;
    let shape = types
        .arrays
        .get(&wrapper)
        .ok_or_else(|| Failure::Invariant(format!("unplanned array text {wrapper}")))?;
    let text = crate::values::value_text(m)?;
    let tag = erased::callee(m, erased::Helper::Tag)?;
    let concat = strings::callee(m, strings::Helper::Concat)?;
    let empty = m.literal("");
    let comma = m.literal(",");
    let (array, at, count, joined, element) = (2, 3, 4, 5, 6);
    let mut f = Function::new([
        ValType::Ref(RefType {
            nullable: true,
            heap_type: HeapType::Concrete(wrapper),
        }),
        ValType::I32,
        ValType::I32,
        ValType::Ref(RefType::EXTERNREF),
        ValType::Ref(RefType::ANYREF),
    ]);
    f.instructions(&[
        I::LocalGet(0),
        I::RefCastNonNull(HeapType::Concrete(wrapper)),
        I::LocalTee(array),
        I::StructGet {
            struct_type_index: wrapper,
            field_index: gc::ARRAY_LENGTH,
        },
        I::LocalSet(count),
    ]);
    enter_join(m, &mut f, array, at)?;
    f.global_get(empty);
    f.instructions(&[
        I::LocalSet(joined),
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
        I::LocalGet(count),
        I::I32GeU,
        I::BrIf(1),
        I::LocalGet(at),
        I::If(BlockType::Empty),
        I::LocalGet(joined),
    ]);
    f.global_get(comma);
    f.call(concat);
    // An element `null` or `undefined` adds nothing: a null slot, or an open
    // value of either tag.
    f.instructions(&[
        I::LocalSet(joined),
        I::End,
        I::Block(BlockType::Empty),
        I::LocalGet(array),
        I::StructGet {
            struct_type_index: wrapper,
            field_index: gc::ARRAY_BACKING,
        },
        I::LocalGet(at),
        crate::arrays::get_instruction(shape)?,
    ]);
    if matches!(types.value_slot(&shape.element)?, Physical::Reference(_)) {
        f.instruction(&I::BrOnNull(0));
    }
    erased::erase_in(m, &mut f, &shape.element)?;
    f.instruction(&I::LocalTee(element));
    f.call(tag);
    f.instructions(&[I::I32Const(erased::NULL), I::I32Eq, I::LocalGet(element)]);
    f.call(tag);
    f.instructions(&[
        I::I32Const(erased::UNDEFINED),
        I::I32Eq,
        I::I32Or,
        I::BrIf(0),
        I::LocalGet(joined),
        I::LocalGet(element),
        I::LocalGet(1),
    ]);
    f.call(text);
    if m.raises {
        let flag = crate::raising::state(m, crate::raising::Slot::Flag)?;
        f.global_get(flag);
        f.instruction(&I::If(BlockType::Empty));
        // Both the partial prefix and the null result are still on the
        // operand stack. Return discards them and the local references;
        // only our own join frame needs explicit cleanup. Never concatenate
        // the placeholder or call another printer with a raise pending.
        leave_join(m, &mut f)?;
        f.instructions(&[I::RefNull(HeapType::EXTERN), I::Return, I::End]);
    }
    f.call(concat);
    f.instructions(&[
        I::LocalSet(joined),
        I::End,
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
    ]);
    leave_join(m, &mut f)?;
    f.instructions(&[I::LocalGet(joined), I::End]);
    Ok(f)
}

/// How deep one `String()` join nests arrays, as C's `NTS_JOIN_DEPTH`.
const JOIN_DEPTH: i32 = 64;

/// The arrays a join is inside of, as C's `nts_joining`, and how many: an
/// array met again inside its own join prints as empty, as node's join does,
/// rather than recursing until the stack runs out. The stack is made at the
/// first join.
pub(crate) fn joining(m: &mut Builder<'_>) -> Result<(Global, Global, u32), Failure> {
    let ty = m
        .types
        .joining
        .ok_or_else(|| Failure::Invariant("unplanned join stack".into()))?;
    let stack = m.global(GlobalKey::Joining, |_| {
        let mut init = crate::ir::Code::default();
        init.instruction(&I::RefNull(HeapType::Concrete(ty)));
        Ok((
            GlobalType {
                val_type: ValType::Ref(RefType {
                    nullable: true,
                    heap_type: HeapType::Concrete(ty),
                }),
                mutable: true,
                shared: false,
            },
            init,
        ))
    })?;
    let depth = m.global(GlobalKey::JoiningDepth, |_| {
        let mut init = crate::ir::Code::default();
        init.instruction(&I::I32Const(0));
        Ok((
            GlobalType {
                val_type: ValType::I32,
                mutable: true,
                shared: false,
            },
            init,
        ))
    })?;
    Ok((stack, depth, ty))
}

/// On entry to an array's join: an array already being joined answers empty
/// text at once; one nested past [`JOIN_DEPTH`] refuses by name; any other is
/// pushed. Locals: `array` the array, `at` free.
fn enter_join(m: &mut Builder<'_>, f: &mut Function, array: u32, at: u32) -> Result<(), Failure> {
    let (stack, depth, ty) = joining(m)?;
    let empty = m.literal("");
    f.global_get(stack);
    f.instructions(&[
        I::RefIsNull,
        I::If(BlockType::Empty),
        I::I32Const(JOIN_DEPTH),
    ]);
    f.instruction(&I::ArrayNewDefault(ty));
    f.global_set(stack);
    f.instructions(&[
        I::End,
        I::Block(BlockType::Empty),
        I::Loop(BlockType::Empty),
        I::LocalGet(at),
    ]);
    f.global_get(depth);
    f.instructions(&[I::I32GeU, I::BrIf(1)]);
    f.global_get(stack);
    f.instructions(&[
        I::LocalGet(at),
        I::ArrayGet(ty),
        I::LocalGet(array),
        I::RefEq,
        I::If(BlockType::Empty),
    ]);
    f.global_get(empty);
    f.instructions(&[
        I::Return,
        I::End,
        I::LocalGet(at),
        I::I32Const(1),
        I::I32Add,
        I::LocalSet(at),
        I::Br(0),
        I::End,
        I::End,
        I::I32Const(0),
        I::LocalSet(at),
    ]);
    f.global_get(depth);
    f.instructions(&[I::I32Const(JOIN_DEPTH), I::I32GeU, I::If(BlockType::Empty)]);
    contract::refuse_in(f, m, 1, "the text of an array nested more than 64 deep")?;
    f.instruction(&I::End);
    f.global_get(stack);
    f.global_get(depth);
    f.instruction(&I::LocalGet(array));
    f.instruction(&I::ArraySet(ty));
    f.global_get(depth);
    f.instructions(&[I::I32Const(1), I::I32Add]);
    f.global_set(depth);
    Ok(())
}

/// On leaving an array's join: pop and release this frame's GC root. The
/// cycle shortcut in `enter_join` returns before pushing, so never comes here.
fn leave_join(m: &mut Builder<'_>, f: &mut Function) -> Result<(), Failure> {
    let (stack, depth, ty) = joining(m)?;
    f.global_get(depth);
    f.instructions(&[I::I32Const(1), I::I32Sub]);
    f.global_set(depth);
    f.global_get(stack);
    f.global_get(depth);
    f.instructions(&[I::RefNull(RefType::EQREF.heap_type), I::ArraySet(ty)]);
    Ok(())
}
