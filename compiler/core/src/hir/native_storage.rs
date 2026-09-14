//! Stack storage is a function-local borrow, not a managed allocation.
//!
//! Run before suspension and inlining, then verify again on prepared HIR.
//! Unknown uses escape. Foreign no-escape annotations are trusted contracts;
//! direct TS callees earn the same fact from their bodies. Returning an alias
//! counts as escape even when its caller could have kept it local.
use rustc_hash::FxHashMap;
use super::{BinOp, BlockId, Callee, Func, HirType, OpKind, Program, Terminator, ValueId};

pub(super) const STACK_LIMIT: u32 = 65536;
type Borrows = FxHashMap<String, Vec<bool>>;

pub(super) fn check(program: &Program) -> Vec<(usize, ValueId, &'static str)> {
    if !program.funcs.iter().any(|f| live(f).any(|v| matches!(f.value(v).kind, OpKind::NativeLocal { .. }))) {
        return Vec::new();
    }
    let borrows = summaries(program);
    let mut problems = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        let mut bytes = 0_u32;
        for (block, body) in func.blocks.iter().enumerate() {
            for &value in &body.ops {
                let OpKind::NativeLocal { count } = func.value(value).kind else { continue };
                let size = match &func.value(value).ty {
                    HirType::NativePointer(p) => super::layout::native_shape(p).and_then(|s| s.size.checked_mul(count)),
                    _ => None,
                };
                let reason = if count == 0 || size.and_then(|size| bytes.checked_add(size)).is_none_or(|total| total > STACK_LIMIT) {
                    Some("native local storage exceeds the 65536-byte function budget")
                } else if suspends(func) {
                    Some("native local storage in a suspending function")
                } else if in_cycle(func, BlockId(u32::try_from(block).unwrap_or(u32::MAX))) {
                    Some("native local storage inside a loop; allocate it outside the loop")
                } else if !borrowed(func, value, &borrows) {
                    Some("native local address escapes: it may not be returned, stored, captured, freed, or passed to a retaining or unclassified callee")
                } else { None };
                bytes = bytes.saturating_add(size.unwrap_or(STACK_LIMIT));
                if let Some(reason) = reason { problems.push((at, value, reason)); }
            }
        }
    }
    problems
}

fn live(func: &Func) -> impl Iterator<Item = ValueId> + '_ {
    func.blocks.iter().flat_map(|b| b.ops.iter().copied())
}

fn suspends(func: &Func) -> bool {
    func.async_result.is_some() || func.frame.is_some() || live(func).any(|v| matches!(func.value(v).kind,
        OpKind::Await { .. } | OpKind::Yield { .. } | OpKind::Suspend { .. }))
}

// Start at unknown, not at "nothing escapes". A recursive cycle with no
// independently established borrow remains unknown and cannot receive locals.
fn summaries(program: &Program) -> Borrows {
    let mut summaries: Borrows = program.funcs.iter().map(|f| (f.name.clone(), vec![false; f.params.len()])).collect();
    loop {
        let mut changes = Vec::new();
        for func in &program.funcs {
            if suspends(func) || func.abstract_declaration { continue; }
            for value in live(func) {
                let OpKind::Param(index) = func.value(value).kind else { continue };
                let index = index as usize;
                if matches!(func.value(value).ty, HirType::NativePointer(_))
                    && !summaries[&func.name][index] && borrowed(func, value, &summaries) {
                    changes.push((func.name.clone(), index));
                }
            }
        }
        if changes.is_empty() { return summaries; }
        for (name, at) in changes { if let Some(summary) = summaries.get_mut(&name) { summary[at] = true; } }
    }
}

fn edges(term: &Terminator) -> Vec<(BlockId, &[ValueId])> {
    match term {
        Terminator::Jump { target, args } => vec![(*target, args)],
        Terminator::Branch { then_target, then_args, else_target, else_args, .. } => vec![(*then_target, then_args), (*else_target, else_args)],
        _ => Vec::new(),
    }
}

fn aliases(func: &Func, root: ValueId) -> Vec<bool> {
    let mut aliases = vec![false; func.values.len()];
    aliases[root.0 as usize] = true;
    loop {
        let mut changed = false;
        for block in &func.blocks {
            for &value in &block.ops {
                let parent = match func.value(value).kind {
                    OpKind::NativeIndexAddress { pointer, .. } | OpKind::NativeFieldAddress { pointer, .. } => Some(pointer),
                    OpKind::Convert(pointer) if matches!(func.value(value).ty, HirType::NativePointer(_)) => Some(pointer),
                    _ => None,
                };
                if parent.is_some_and(|p| aliases[p.0 as usize]) && !aliases[value.0 as usize] {
                    aliases[value.0 as usize] = true;
                    changed = true;
                }
            }
            for (target, args) in edges(&block.terminator) {
                for (&arg, &param) in args.iter().zip(&func.blocks[target.0 as usize].params) {
                    if aliases[arg.0 as usize] && !aliases[param.0 as usize] {
                        aliases[param.0 as usize] = true;
                        changed = true;
                    }
                }
            }
        }
        if !changed { return aliases; }
    }
}

fn borrowed(func: &Func, root: ValueId, summaries: &Borrows) -> bool {
    let aliases = aliases(func, root);
    let is_alias = |v: ValueId| aliases[v.0 as usize];
    for block in &func.blocks {
        for &value in &block.ops {
            let op = func.value(value);
            for operand in super::verify::operands(&op.kind).into_iter().filter(|v| is_alias(*v)) {
                let safe = match &op.kind {
                    OpKind::NativeLoad { pointer, .. } | OpKind::NativeIndexAddress { pointer, .. }
                        | OpKind::NativeFieldAddress { pointer, .. } => operand == *pointer,
                    OpKind::NativeStore { pointer, value, .. } => operand == *pointer && !is_alias(*value),
                    OpKind::Convert(_) => matches!(op.ty, HirType::NativePointer(_)),
                    // A copy reads and writes bytes and keeps nothing -- it is
                    // `*d = *s`, which stores no address anywhere -- so both
                    // its operands are safe, the *source* included. That is
                    // what separates it from a store, where an aliased value
                    // being written is the address escaping into the storage
                    // it points at. Comparison keeps nothing either, which is
                    // why they share an arm.
                    OpKind::NativeCopy { .. }
                    | OpKind::Binary { op: BinOp::Eq | BinOp::Ne, .. } => true,
                    OpKind::Call { callee, args, .. } => args.iter().enumerate().all(|(at, arg)| {
                        if !is_alias(*arg) { return true; }
                        match callee {
                            Callee::Native(target) => matches!(target.retention.get(at), Some(crate::hir::native::Retention::NotRetained)),
                            Callee::Direct(name) => summaries.get(name).and_then(|s| s.get(at)).copied().unwrap_or(false),
                            _ => false,
                        }
                    }),
                    _ => false,
                };
                if !safe { return false; }
            }
        }
        match &block.terminator {
            Terminator::Return(Some(value)) if is_alias(*value) => return false,
            Terminator::Branch { cond, .. } if is_alias(*cond) => return false,
            _ => {},
        }
    }
    true
}

fn in_cycle(func: &Func, start: BlockId) -> bool {
    let mut pending = func.blocks[start.0 as usize].terminator.successors();
    let mut seen = vec![false; func.blocks.len()];
    while let Some(next) = pending.pop() {
        if next == start { return true; }
        if !seen[next.0 as usize] {
            seen[next.0 as usize] = true;
            pending.extend(func.blocks[next.0 as usize].terminator.successors());
        }
    }
    false
}
