//! One dependency closure for operations and their actual merge inputs.
#[cfg(test)]
use super::work::{Counter, note};
use crate::hir::{BlockId, Func, OpKind, Terminator, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Roots {
    Effects,
    Parameters,
    Operations,
}

struct Graph<'a> {
    func: &'a Func,
    placed: FxHashSet<ValueId>,
    dependencies: FxHashMap<ValueId, Vec<ValueId>>,
    pending: Vec<ValueId>,
    invalid_targets: FxHashSet<BlockId>,
}

pub(super) fn marked(func: &Func, roots: Roots) -> FxHashSet<ValueId> {
    let mut graph = Graph {
        func,
        placed: FxHashSet::default(),
        dependencies: FxHashMap::default(),
        pending: Vec::new(),
        invalid_targets: FxHashSet::default(),
    };
    graph.index(roots);
    graph.mark()
}

impl Graph<'_> {
    fn index(&mut self, roots: Roots) {
        let hole_reads = crate::hir::holes::read_observations(self.func);
        let mut fresh = FxHashSet::default();
        let func = self.func;
        for block in &func.blocks {
            #[cfg(test)]
            note(Counter::Block);
            for &value in &block.ops {
                #[cfg(test)]
                note(Counter::FreshOperation);
                self.placed.insert(value);
                if matches!(
                    self.func.values[value.0 as usize].kind,
                    OpKind::ObjectNew { .. }
                ) {
                    fresh.insert(value);
                }
            }
        }
        for block in &func.blocks {
            #[cfg(test)]
            note(Counter::Block);
            for &param in &block.params {
                #[cfg(test)]
                note(Counter::Parameter);
                if roots == Roots::Parameters {
                    self.pending.push(param);
                }
            }
            for &value in &block.ops {
                #[cfg(test)]
                note(Counter::Operation);
                let op = &self.func.values[value.0 as usize];
                let object = super::store_into(op, &fresh);
                if let Some(object) = object {
                    #[cfg(test)]
                    note(Counter::Store);
                    self.dependencies.entry(object).or_default().push(value);
                }
                if roots == Roots::Operations
                    || hole_reads.contains(&value)
                    || (super::has_effects(op) && object.is_none())
                {
                    self.pending.push(value);
                }
            }
            self.terminator(&block.terminator);
        }
    }

    fn terminator(&mut self, terminator: &Terminator) {
        match terminator {
            Terminator::Return(value) => self.pending.extend(*value),
            Terminator::Jump { target, args } => self.edge(*target, args),
            Terminator::Branch {
                cond,
                then_target,
                then_args,
                else_target,
                else_args,
            } => {
                self.pending.push(*cond);
                self.edge(*then_target, then_args);
                self.edge(*else_target, else_args);
            }
            Terminator::Unreachable | Terminator::FellThrough => {}
        }
    }

    fn edge(&mut self, target: BlockId, args: &[ValueId]) {
        let Some(block) = self.func.blocks.get(target.0 as usize) else {
            self.pending.extend_from_slice(args);
            return;
        };
        // Preserve malformed edges for the verifier rather than repairing their
        // arity by deleting parameters. Each bad target is expanded only once.
        if block.params.len() != args.len() {
            self.pending.extend_from_slice(args);
            if self.invalid_targets.insert(target) {
                self.pending.extend_from_slice(&block.params);
            }
            return;
        }
        for (&param, &arg) in block.params.iter().zip(args) {
            #[cfg(test)]
            note(Counter::Argument);
            self.dependencies.entry(param).or_default().push(arg);
        }
    }

    fn mark(mut self) -> FxHashSet<ValueId> {
        let mut live = FxHashSet::default();
        while let Some(value) = self.pending.pop() {
            if !live.insert(value) {
                continue;
            }
            #[cfg(test)]
            note(Counter::Value);
            if self.placed.contains(&value) {
                for operand in
                    crate::hir::verify::operands(&self.func.values[value.0 as usize].kind)
                {
                    #[cfg(test)]
                    note(Counter::Operand);
                    self.pending.push(operand);
                }
            }
            if let Some(inputs) = self.dependencies.get(&value) {
                for &input in inputs {
                    #[cfg(test)]
                    note(Counter::Operand);
                    self.pending.push(input);
                }
            }
        }
        live
    }
}
