//! A function value's `name` where its type does not settle it, as C's
//! `nts_function_name`: read off the value itself.
//!
//! The core names each layout's functions (`Program::function_names`), and a
//! value's descriptor carries its semantic identity, so the name is one
//! `br_table` on that identity into the layout's literal. A bound function is
//! `"bound "` and the name of the target it holds in its first field, which is
//! where `lower_bind` stores it. An identity with no name (a method whose key
//! is computed at run time) or whose layouts disagree stops by name, as C
//! stops.
use crate::{
    body::Body,
    contract,
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey, Global},
    objects, strings,
    types::Physical,
};
use nts_core::hir::{FunctionName, HirType, ManagedType, ValueId};
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

const UNNAMED: &str = "the name of a function whose type does not say what it is called";

pub(crate) fn is_name(name: &str) -> bool {
    name == "nts_function_name"
}

pub(crate) fn call(b: &mut Body<'_, '_>, result: ValueId, args: &[ValueId]) -> Result<(), Failure> {
    let &[function] = args else {
        return Err("function name arity mismatch".into());
    };
    if !matches!(
        b.types().value_slot(b.ty(function))?,
        Physical::Reference(_)
    ) {
        return Err(format!("the name of a {:?}", b.ty(function)).into());
    }
    let target = callee(b.m)?;
    b.load(function)?;
    strings::constant(b, &b.func.name.clone());
    b.call(target);
    objects::adapt(
        b,
        &HirType::Managed(ManagedType::String),
        &b.ty(result).clone(),
    )
}

pub(crate) fn callee(m: &mut Builder<'_>) -> Result<Func, Failure> {
    m.helper(
        FuncKey::FunctionName,
        "function.name",
        vec![Physical::Reference(RefType::ANYREF), strings::STRING],
        Some(strings::STRING),
        body,
    )
}

/// What a function of one identity is called.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Name {
    Is(String),
    /// Bound: its storage, and where its target is in it.
    Bound {
        physical: u32,
        target: u32,
    },
    /// Layouts of this identity that disagree.
    Ambiguous,
}

/// Each named identity's name.
fn names(m: &Builder<'_>) -> Result<BTreeMap<u32, Name>, Failure> {
    let objects = &m.types.objects;
    let mut names = BTreeMap::<u32, Name>::new();
    for descriptor in &objects.descriptors {
        let Some(class) = descriptor.class else {
            continue;
        };
        let object = objects.object(&HirType::Managed(ManagedType::Object(class)))?;
        let name = match m.program.function_names.get(&object.name) {
            None => continue,
            Some(FunctionName::Is(text)) => Name::Is(text.clone()),
            Some(FunctionName::Bound) if !object.fields.is_empty() => Name::Bound {
                physical: object.physical,
                target: object.field_base,
            },
            Some(FunctionName::Bound) => Name::Ambiguous,
        };
        names
            .entry(descriptor.identity)
            .and_modify(|known| {
                if *known != name {
                    *known = Name::Ambiguous;
                }
            })
            .or_insert(name);
    }
    Ok(names)
}

/// A named identity's answer, pushed and returned.
enum Case {
    Literal(Global),
    Bound { physical: u32, target: u32 },
}

/// Params: function, caller's name. Locals: identity.
fn body(m: &mut Builder<'_>) -> Result<Function, Failure> {
    let root = m
        .types
        .root
        .ok_or_else(|| Failure::Invariant("missing object root".into()))?;
    let mut named: Vec<(u32, Case)> = Vec::new();
    for (identity, name) in names(m)? {
        named.push((
            identity,
            match name {
                Name::Is(text) => Case::Literal(m.literal(&text)),
                Name::Bound { physical, target } => Case::Bound { physical, target },
                Name::Ambiguous => continue,
            },
        ));
    }
    let bound = if named
        .iter()
        .any(|(_, case)| matches!(case, Case::Bound { .. }))
    {
        let concat = strings::callee(m, strings::Helper::Concat)?;
        Some((concat, m.literal("bound "), callee(m)?))
    } else {
        None
    };
    let mut f = Function::new([ValType::I32]);
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::Concrete(root.object)),
        I::I32Eqz,
        I::If(BlockType::Empty),
    ]);
    contract::refuse_in(&mut f, m, 1, UNNAMED)?;
    f.instruction(&I::End);
    objects::push_identity(&mut f, root, 0);
    f.instruction(&I::LocalSet(2));
    objects::identity_switch(&mut f, 2, &named, |f, answer| {
        match (answer, bound) {
            (Case::Literal(literal), _) => f.global_get(*literal),
            (Case::Bound { physical, target }, Some((concat, prefix, itself))) => {
                f.global_get(prefix);
                f.instructions(&[
                    I::LocalGet(0),
                    I::RefCastNonNull(HeapType::Concrete(*physical)),
                    I::StructGet {
                        struct_type_index: *physical,
                        field_index: *target,
                    },
                    I::LocalGet(1),
                ]);
                f.call(itself);
                f.call(concat);
            }
            (Case::Bound { .. }, None) => {
                return Err(Failure::Invariant("a bound name with no bound case".into()));
            }
        }
        f.instruction(&I::Return);
        Ok(())
    })?;
    contract::refuse_in(&mut f, m, 1, UNNAMED)?;
    f.instruction(&I::End);
    Ok(f)
}
