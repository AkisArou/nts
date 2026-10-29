//! Until error edges have an ownership adapter, only complete quiet call closures
//! can change representation. This uses the helper catalog, not source spelling.

use super::GraphBudget;
use crate::hir::{
    Callee, OpKind, Program,
    runtime::{self, Raising},
};
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::VecDeque;

#[derive(Default)]
struct State {
    blocked: bool,
    pending: usize,
    callers: Vec<usize>,
}

/// A least fixed point: recursive or unknown closures never become quiet merely
/// because no explicit exception terminator exists in the current IR.
pub(super) fn quiet<'a>(
    program: &'a Program,
    graph: &mut GraphBudget,
) -> Option<FxHashSet<&'a str>> {
    graph.take(program.funcs.len()).then_some(())?;
    let names: FxHashMap<_, _> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();
    let mut states: Vec<_> = program.funcs.iter().map(|_| State::default()).collect();
    for (index, func) in program.funcs.iter().enumerate() {
        states[index].blocked = func.abstract_declaration || func.blocks.is_empty();
        for block in &func.blocks {
            graph
                .take(block.ops.len().saturating_add(1))
                .then_some(())?;
            if super::super::outgoing(&block.terminator).is_none() {
                states[index].blocked = true;
            }
            for value in &block.ops {
                let Some(op) = func.values.get(value.0 as usize) else {
                    states[index].blocked = true;
                    continue;
                };
                match effect(&op.kind) {
                    Effect::Direct(name) => {
                        if let Some(&target) = names.get(name) {
                            states[index].pending += 1;
                            states[target].callers.push(index);
                        } else {
                            states[index].blocked = true;
                        }
                    }
                    Effect::Unsupported => states[index].blocked = true,
                    Effect::Quiet => {}
                }
            }
        }
    }
    let mut pending: VecDeque<_> = states
        .iter()
        .enumerate()
        .filter_map(|(index, state)| (!state.blocked && state.pending == 0).then_some(index))
        .collect();
    let mut found = FxHashSet::default();
    while let Some(index) = pending.pop_front() {
        graph
            .take(states[index].callers.len().saturating_add(1))
            .then_some(())?;
        found.insert(program.funcs[index].name.as_str());
        for caller in std::mem::take(&mut states[index].callers) {
            states[caller].pending -= 1;
            if !states[caller].blocked && states[caller].pending == 0 {
                pending.push_back(caller);
            }
        }
    }
    Some(found)
}

enum Effect<'a> {
    Direct(&'a str),
    Quiet,
    Unsupported,
}

// Exhaustive: new operations require a decision at the continuation boundary.
fn effect(op: &OpKind) -> Effect<'_> {
    match op {
        OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } => Effect::Direct(name),
        OpKind::Call {
            callee: Callee::External(name),
            ..
        } => {
            // Source throw lowers to this semantic root even though
            // its present physical helper terminates the process.
            if name != "nts_uncaught"
                && matches!(
                    runtime::raising(name),
                    Some(Raising::NoRaise | Raising::Diverges)
                )
            {
                Effect::Quiet
            } else {
                Effect::Unsupported
            }
        }
        OpKind::Call {
            callee: Callee::Native(_) | Callee::Virtual { .. } | Callee::Closure { .. },
            ..
        }
        | OpKind::DelegateInvoke { .. }
        | OpKind::NativeBridge { .. }
        | OpKind::NativeBlock { .. }
        | OpKind::Await { .. }
        | OpKind::Yield { .. }
        | OpKind::Suspend { .. }
        | OpKind::PromiseSubscribe { .. }
        | OpKind::Validation(_) => Effect::Unsupported,
        // Primitive memory/arithmetic operations have no language-level
        // exceptional continuation. Allocation failure/host refusal is
        // outside JavaScript's catchable value protocol.
        OpKind::Optional { .. }
        | OpKind::OptionalDefined(_)
        | OpKind::OptionalPayload(_)
        | OpKind::ConstHandle(_)
        | OpKind::NativeLoad { .. }
        | OpKind::NativeStore { .. }
        | OpKind::NativeLocal { .. }
        | OpKind::ObjcClass { .. }
        | OpKind::ObjcSelector { .. }
        | OpKind::NativeSizeOf(_)
        | OpKind::NativeMalloc { .. }
        | OpKind::NativeFree { .. }
        | OpKind::NativePointerBits { .. }
        | OpKind::NativeStringView { .. }
        | OpKind::NativeIndexAddress { .. }
        | OpKind::NativeFieldAddress { .. }
        | OpKind::NativeBitLoad { .. }
        | OpKind::NativeBitStore { .. }
        | OpKind::NativeCopy { .. }
        | OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::DispatchSlot(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::Provided(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::Erase { .. }
        | OpKind::TagOf { .. }
        | OpKind::Unerase { .. }
        | OpKind::Binary { .. }
        | OpKind::Unary { .. }
        | OpKind::Convert(_)
        | OpKind::FieldView { .. }
        | OpKind::Return(_)
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_)
        | OpKind::StringUnitAt { .. }
        | OpKind::GlobalGet(_)
        | OpKind::GlobalSet { .. }
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ObjectNew { .. }
        | OpKind::CellReady { .. }
        | OpKind::ClosureStatic
        | OpKind::InstanceOf { .. }
        | OpKind::FieldGet { .. }
        | OpKind::SharedFieldGet { .. }
        | OpKind::OpenFieldGet { .. }
        | OpKind::OpenFieldSet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::ArraySet { .. } => Effect::Quiet,
    }
}
