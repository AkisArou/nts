//! Definedness proofs for the logical optional value.
use super::Payload;
use crate::hir::{
    BlockId, Callee, Func, HirType, Op, OpKind, Terminator, ValueId, verify::Invalid,
};
use rustc_hash::{FxHashMap, FxHashSet};

/// Verify the coupled value before any backend chooses its physical form.
/// Whole optional values cross edges and calls. Only the explicit projection
/// can expose a payload, on a path justified by this same value's test.
pub(in crate::hir) fn verify(
    func: &Func,
    reachable: &FxHashSet<BlockId>,
    problems: &mut Vec<Invalid>,
) {
    if !uses_optional(func) {
        return;
    }
    let mut proofs = DefinedPaths::new(func, reachable);
    for (index, block) in func.blocks.iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        if let Terminator::Branch { cond, .. } = block.terminator
            && matches!(func.value(cond).ty, HirType::PossiblyUndefined(_))
        {
            problems.push(Invalid::OptionalValue { func: func.name.clone(), value: cond,
                reason: "a branch must explicitly consume optional definedness or its proved payload" });
        }
        for &id in &block.ops {
            let op = func.value(id);
            let optional = match &op.ty {
                HirType::PossiblyUndefined(payload) => Some(&**payload),
                _ => None,
            };
            let reason = if optional.is_some_and(|payload| Payload::new(payload.clone()).is_err()) {
                Some("an optional payload has no supported independent representation")
            } else {
                match &op.kind {
                    OpKind::Optional { defined, payload } => {
                        if func.value(*defined).ty != HirType::Bool
                            || optional != Some(&func.value(*payload).ty)
                        {
                            Some("optional construction needs a boolean and its exact payload type")
                        } else {
                            None
                        }
                    }
                    OpKind::OptionalDefined(value) => {
                        if !matches!(func.value(*value).ty, HirType::PossiblyUndefined(_))
                            || op.ty != HirType::Bool
                        {
                            Some("definedness reads one optional value and returns boolean")
                        } else {
                            None
                        }
                    }
                    OpKind::OptionalPayload(value) => {
                        if !matches!(&func.value(*value).ty, HirType::PossiblyUndefined(payload) if **payload == op.ty)
                        {
                            Some("a payload projection must retain its exact payload type")
                        } else if !proofs.defined(func, *value, at) {
                            Some("a payload read requires a proved defined path for the same value")
                        } else {
                            None
                        }
                    }
                    OpKind::Param(_)
                    | OpKind::BlockParam(_)
                    | OpKind::ConstUndefined
                    | OpKind::Call { .. }
                    | OpKind::FieldGet { .. }
                    | OpKind::ArrayGet { .. }
                    | OpKind::GlobalGet(_) => None,
                    _ if optional.is_some() => {
                        Some("this producer does not preserve optional definedness")
                    }
                    _ => None,
                }
            };
            let reason = boundary_error(func, op).or(reason);
            if let Some(reason) = reason {
                problems.push(Invalid::OptionalValue {
                    func: func.name.clone(),
                    value: id,
                    reason,
                });
            }
            let keeps_components = matches!(
                op.kind,
                OpKind::OptionalDefined(_)
                    | OpKind::OptionalPayload(_)
                    | OpKind::Retain(_)
                    | OpKind::Release(_)
                    | OpKind::Call { .. }
                    | OpKind::FieldSet { .. }
                    | OpKind::ArraySet { .. }
                    | OpKind::GlobalSet { .. }
                    | OpKind::Erase { .. }
            );
            if !keeps_components
                && crate::hir::verify::operands(&op.kind)
                    .iter()
                    .any(|value| matches!(func.value(*value).ty, HirType::PossiblyUndefined(_)))
            {
                problems.push(Invalid::OptionalValue {
                    func: func.name.clone(),
                    value: id,
                    reason: "an ordinary operation cannot discard optional definedness",
                });
            }
        }
    }
}

/// The store's value travels as a pair; its receiver/index does not. Foreign
/// ABI tables currently describe ordinary payloads, never the coupled carrier.
fn boundary_error(func: &Func, op: &Op) -> Option<&'static str> {
    let optional = |value: ValueId| matches!(func.value(value).ty, HirType::PossiblyUndefined(_));
    match &op.kind {
        OpKind::FieldSet { object, .. } if optional(*object) => {
            Some("an optional field receiver needs a proved payload projection")
        }
        OpKind::ArraySet { array, index, .. } if optional(*array) || optional(*index) => {
            Some("an optional array receiver or index needs a proved payload projection")
        }
        OpKind::Call {
            callee: Callee::Virtual { .. },
            args,
            ..
        } if args.first().is_some_and(|value| optional(*value)) => {
            Some("an optional dispatch receiver needs a proved payload projection")
        }
        OpKind::Call {
            callee: Callee::Closure { .. },
            args,
            ..
        } if matches!(op.ty, HirType::PossiblyUndefined(_))
            || args.iter().any(|value| optional(*value)) =>
        {
            Some("a closure slot has no declared coupled optional ABI")
        }
        OpKind::Call {
            callee: Callee::External(_) | Callee::Native(_),
            args,
            ..
        } if matches!(op.ty, HirType::PossiblyUndefined(_))
            || args.iter().any(|value| optional(*value)) =>
        {
            Some("a foreign call has no declared coupled optional ABI")
        }
        _ => None,
    }
}

struct DefinedPaths {
    idom: Vec<Option<BlockId>>,
    guarded: FxHashMap<BlockId, ValueId>,
    memo: FxHashMap<(BlockId, ValueId), bool>,
    remaining: usize,
    exceptional_edges: bool,
}

impl DefinedPaths {
    fn new(func: &Func, reachable: &FxHashSet<BlockId>) -> Self {
        let mut incoming = vec![0_usize; func.blocks.len()];
        for block in &func.blocks {
            for target in block.terminator.successors() {
                incoming[target.0 as usize] += 1;
            }
            for id in &block.ops {
                if let OpKind::Await {
                    rejects_to: Some(edge),
                    ..
                } = &func.value(*id).kind
                {
                    incoming[edge.handler.0 as usize] += 1;
                }
            }
        }
        let exceptional_edges = func.blocks.iter().flat_map(|block| &block.ops).any(|id| {
            matches!(
                func.value(*id).kind,
                OpKind::Await {
                    rejects_to: Some(_),
                    ..
                }
            )
        });
        let mut guarded = FxHashMap::default();
        for block in &func.blocks {
            if let Terminator::Branch {
                cond,
                then_target,
                else_target,
                ..
            } = block.terminator
                && then_target != else_target
                && incoming[then_target.0 as usize] == 1
                && let OpKind::OptionalDefined(value) = func.value(cond).kind
            {
                guarded.insert(then_target, value);
            }
        }
        Self {
            idom: crate::hir::verify::dominators(func, reachable),
            guarded,
            memo: FxHashMap::default(),
            remaining: 65_536,
            exceptional_edges,
        }
    }

    fn defined(&mut self, func: &Func, value: ValueId, at: BlockId) -> bool {
        if let OpKind::Optional { defined, .. } = func.value(value).kind
            && matches!(func.value(defined).kind, OpKind::ConstBool(true))
        {
            return true;
        }
        // Before suspension lowering the shared dominator tree covers only
        // terminator edges. Do not infer a defined path across an await's
        // exceptional edge from that incomplete graph.
        if self.exceptional_edges {
            return false;
        }
        let mut path = Vec::new();
        let mut block = Some(at);
        let proved = loop {
            let Some(here) = block else {
                break false;
            };
            if let Some(proved) = self.memo.get(&(here, value)) {
                break *proved;
            }
            if self.remaining == 0 {
                break false;
            }
            self.remaining -= 1;
            path.push(here);
            if self.guarded.get(&here) == Some(&value) {
                break true;
            }
            block = self.idom[here.0 as usize];
        };
        for block in path {
            self.memo.insert((block, value), proved);
        }
        proved
    }
}

fn uses_optional(func: &Func) -> bool {
    func.blocks.iter().flat_map(|block| &block.ops).any(|id| {
        matches!(func.value(*id).ty, HirType::PossiblyUndefined(_))
            || matches!(
                func.value(*id).kind,
                OpKind::OptionalDefined(_) | OpKind::OptionalPayload(_) | OpKind::Optional { .. }
            )
    })
}
