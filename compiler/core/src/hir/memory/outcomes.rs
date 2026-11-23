//! Escaping outcomes are a column of the existing shared call index.
//! A return type or entry name never proves `NoRaise`. Only accepted placed
//! producers, their actual bodies and the helper contract can close an edge.

use std::collections::{BTreeMap, VecDeque};

use super::super::{Callee, HirType, Op, OpKind, Program, runtime};

/// A direct-call view of the existing escaping-outcome column. An indirect
/// producer is unsealed by `intrinsic`, so no dispatch precision is assumed.
/// This exposes effects only; it computes no memory homes or value ownership.
pub(in crate::hir) struct DirectEffects<'p> {
    by_name: BTreeMap<&'p str, usize>,
    raises: Vec<bool>,
}

impl<'p> DirectEffects<'p> {
    pub(in crate::hir) fn of(program: &'p Program) -> Self {
        let by_name: BTreeMap<_, _> = program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, func)| (func.name.as_str(), at))
            .collect();
        let edges = program
            .funcs
            .iter()
            .map(|func| {
                func.blocks
                    .iter()
                    .flat_map(|block| &block.ops)
                    .filter_map(|id| {
                        if let OpKind::Call {
                            callee: Callee::Direct(name),
                            ..
                        } = &func.value(*id).kind
                        {
                            by_name.get(name.as_str()).copied()
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .collect::<Vec<_>>();
        let (raises, _, _) = escaping(program, &edges, &by_name);
        Self { by_name, raises }
    }

    pub(in crate::hir) fn unsealed(&self, op: &Op) -> bool {
        unsealed(op, &self.by_name, &self.raises).is_some()
    }
}

/// Whether this operation itself has an outcome not represented by a complete
/// exceptional successor. Direct body calls are propagated by the call index.
fn intrinsic(op: &Op, by_name: &BTreeMap<&str, usize>) -> bool {
    match &op.kind {
        OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } => !by_name.contains_key(name.as_str()),
        OpKind::Call {
            callee: Callee::External(name),
            ..
        } => runtime::has_exceptional_outcome(name),
        OpKind::Binary { .. } | OpKind::Unary { .. } => op.ty == HirType::BigInt,
        OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ConstString(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::ClosureStatic
        | OpKind::ObjectNew { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::Erase { .. }
        | OpKind::Unerase { .. }
        | OpKind::Convert(_)
        | OpKind::FieldView { .. }
        | OpKind::NativeStringView { .. }
        | OpKind::OptionalPayload(_)
        | OpKind::Optional { .. }
        | OpKind::OptionalDefined(_)
        | OpKind::GlobalGet(_)
        | OpKind::GlobalSet { .. }
        | OpKind::FieldGet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::ArrayGet { .. }
        | OpKind::ArraySet { .. }
        | OpKind::Length(_)
        | OpKind::StringUnitAt { .. }
        | OpKind::TagOf { .. }
        | OpKind::InstanceOf { .. }
        | OpKind::CellReady { .. }
        | OpKind::NativeMalloc { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_) => false,
        // Includes suspension/reentry and future implicit producers. An
        // unrecognised producer never grants a proved-empty event set. A
        // dispatch slot alone does not seal incoming implementations.
        _ => true,
    }
}

/// Share the function/dispatch SCC index's edges rather than build another
/// call graph. Each boolean promotes at most once and visits each caller edge
/// at most twice across the two columns; recursive bodies cannot refill a
/// cleared state.
pub(super) fn escaping(
    program: &Program,
    edges: &[Vec<usize>],
    by_name: &BTreeMap<&str, usize>,
) -> (Vec<bool>, Vec<bool>, usize) {
    let mut work = edges.len();
    let mut callers = vec![Vec::new(); edges.len()];
    for (from, targets) in edges.iter().enumerate() {
        for &to in targets {
            callers[to].push(from);
            work += 1;
        }
    }
    let mut raises = vec![false; edges.len()];
    let mut reenters = vec![false; edges.len()];
    let mut pending = VecDeque::new();
    for (at, function) in program.funcs.iter().enumerate() {
        let mut unknown = function.abstract_declaration || function.blocks.is_empty();
        let mut reentry = unknown;
        for &id in function.blocks.iter().flat_map(|block| &block.ops) {
            work += 1;
            let op = function.values.get(id.0 as usize);
            unknown |= op.is_none_or(|op| intrinsic(op, by_name));
            reentry |= op.is_none_or(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } => !by_name.contains_key(name.as_str()),
                OpKind::Call {
                    callee: Callee::External(name),
                    ..
                } => {
                    super::super::regions::helper(name, program.entry_unwind).is_none()
                        || runtime::has_exceptional_outcome(name)
                }
                OpKind::Call { .. }
                | OpKind::Await { .. }
                | OpKind::Suspend { .. }
                | OpKind::PromiseSubscribe { .. } => true,
                _ => intrinsic(op, by_name),
            });
        }
        raises[at] = unknown;
        reenters[at] = reentry;
        if unknown || reentry {
            pending.push_back(at);
        }
    }
    while let Some(child) = pending.pop_front() {
        for &parent in &callers[child] {
            work += 1;
            let changed =
                (raises[child] && !raises[parent]) || (reenters[child] && !reenters[parent]);
            raises[parent] |= raises[child];
            reenters[parent] |= reenters[child];
            if changed {
                pending.push_back(parent);
            }
        }
    }
    raises.truncate(program.funcs.len());
    reenters.truncate(program.funcs.len());
    (raises, reenters, work)
}

pub(super) fn unsealed(
    op: &Op,
    by_name: &BTreeMap<&str, usize>,
    raises: &[bool],
) -> Option<String> {
    if let OpKind::Call {
        callee: Callee::Direct(name),
        ..
    } = &op.kind
    {
        return by_name
            .get(name.as_str())
            .is_none_or(|at| raises[*at])
            .then(|| format!("unsealed body outcome: {name}"));
    }
    intrinsic(op, by_name).then(|| match &op.kind {
        OpKind::Call { callee, .. } => format!("unsealed call outcome: {callee:?}"),
        _ => "unsealed producer outcome".to_owned(),
    })
}
