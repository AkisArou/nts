//! The values of a function that cannot be null, so a null check of one
//! refuses nothing and is not emitted.
//!
//! A string literal, an object or array just built, a capture-free named
//! function and a string concatenation are never null, and a block parameter is never null when every edge into its
//! block passes one that is not. The parameters are the greatest set that holds
//! of: every one is assumed so, and one is struck while an edge passes it
//! something that may be null. A string built up in a loop is such a parameter:
//! `utf8Decode`'s `output += String.fromCharCode(byte)` checked `output` for
//! null at every concatenation.

use nts_core::hir::{Callee, Func, OpKind, ValueId};
use std::collections::BTreeSet;

/// The function's values that cannot be null.
pub(crate) fn values(func: &Func) -> BTreeSet<ValueId> {
    let mut never: BTreeSet<ValueId> = func
        .values
        .iter()
        .enumerate()
        .filter(|(_, op)| built(&op.kind))
        .map(|(at, _)| ValueId(u32::try_from(at).unwrap_or(u32::MAX)))
        .collect();
    let mut params: BTreeSet<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| block.params.iter().copied())
        .collect();
    // Every edge's arguments, by the parameter each one is passed to.
    let mut passed: Vec<(ValueId, ValueId)> = Vec::new();
    for block in &func.blocks {
        for (to, args) in nts_codegen_common::destruct::outgoing(&block.terminator) {
            let targets = &func.blocks[to.0 as usize].params;
            passed.extend(targets.iter().copied().zip(args.iter().copied()));
        }
    }
    loop {
        let struck: Vec<ValueId> = passed
            .iter()
            .filter(|(param, arg)| {
                params.contains(param) && !never.contains(arg) && !params.contains(arg)
            })
            .map(|(param, _)| *param)
            .collect();
        if struck.is_empty() {
            break;
        }
        for param in struck {
            params.remove(&param);
        }
    }
    never.extend(params);
    never
}

/// Whether an operation's value is a reference it has just made. A
/// capture-free named function is one instance its global is initialized with
/// (`callables::static_value`), so it is never null either: `h.fn = plusOne`
/// checked it for null before erasing it, every round of `optional-chain`.
fn built(kind: &OpKind) -> bool {
    match kind {
        OpKind::ConstString(_)
        | OpKind::ObjectNew { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::ClosureStatic => true,
        OpKind::Call {
            callee: Callee::External(name),
            ..
        } => crate::strings::external(name) == Some(crate::strings::Helper::Concat),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_common::{block, function, value};
    use nts_core::hir::{BlockId, HirType, ManagedType, Terminator};

    fn string() -> HirType {
        HirType::Managed(ManagedType::String)
    }

    /// A loop that appends to a string, starting from `start`: the loop's
    /// string parameter, and the function.
    fn appending(start: impl FnOnce(&mut Func) -> ValueId) -> (Func, ValueId) {
        let mut f = function("appending", &[string(), HirType::Bool], string());
        let more = value(&mut f, OpKind::Param(1), HirType::Bool);
        let first = start(&mut f);
        let suffix = value(&mut f, OpKind::ConstString("x".into()), string());
        let text = value(&mut f, OpKind::BlockParam(0), string());
        let longer = value(
            &mut f,
            OpKind::Call {
                callee: Callee::External("nts_concat".into()),
                args: vec![text, suffix],
                frame: None,
            },
            string(),
        );
        f.blocks = vec![
            block(
                &[],
                &[more, first, suffix],
                Terminator::Jump {
                    target: BlockId(1),
                    args: vec![first],
                },
            ),
            block(
                &[text],
                &[longer],
                Terminator::Branch {
                    cond: more,
                    then_target: BlockId(1),
                    then_args: vec![longer],
                    else_target: BlockId(2),
                    else_args: vec![],
                },
            ),
            block(&[], &[], Terminator::Return(Some(text))),
        ];
        (f, text)
    }

    #[test]
    fn a_string_built_from_a_literal_is_never_null() {
        let (f, text) = appending(|f| value(f, OpKind::ConstString("".into()), string()));
        assert!(values(&f).contains(&text));
    }

    #[test]
    fn one_built_from_a_parameter_may_be() {
        let (f, text) = appending(|f| value(f, OpKind::Param(0), string()));
        assert!(!values(&f).contains(&text));
    }

    #[test]
    fn a_static_closure_is_never_null() {
        let ty = HirType::Managed(ManagedType::Object(nts_core::hir::ClassId(0)));
        let mut f = function("named", &[], ty.clone());
        let named = value(&mut f, OpKind::ClosureStatic, ty);
        f.blocks = vec![block(&[], &[named], Terminator::Return(Some(named)))];
        assert!(values(&f).contains(&named));
    }
}
