//! `String(value)` of an object or a function in an erased slot, as the core
//! decides it per layout (`Program::printed`), read off the value's identity
//! the way C reads `NtsDescriptor.to_string`:
//! - **the class's own `toString`** (or the compiler's for the `Error`
//!   family), a function of this program taking the object;
//! - **`"[object Object]"`**;
//! - **a function's text**, `function NAME() { [native code] }`, with the name
//!   [`crate::function_names`] reads;
//! - **a bound function's**, `function () { [native code] }`.
//!
//! An identity the core refuses, or whose layouts disagree, stops by name.
use crate::{
    contract,
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey, Global},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{HirType, ManagedType, Printed};
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

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
        let object = objects.object(&HirType::Managed(ManagedType::Object(class)))?;
        let printed = m.program.printed.get(&object.name).cloned();
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
