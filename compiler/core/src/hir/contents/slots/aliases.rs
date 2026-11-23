//! A may-alias relation used only to destroy slot authority. A component is
//! never evidence that two values are equal, distinct, fresh, or null.

use crate::hir::{self, Func, ValueId};

#[derive(Debug)]
pub(in crate::hir) struct Aliases {
    component: Vec<usize>,
    members: Vec<Vec<ValueId>>,
}

impl Aliases {
    pub(in crate::hir) fn of(func: &Func) -> Self {
        let mut edges = vec![Vec::new(); func.values.len()];
        let mut connect = |a: usize, b: usize| {
            edges[a].push(b);
            edges[b].push(a);
        };
        for (at, op) in func.values.iter().enumerate() {
            if let Some(source) = hir::carried_source(&op.kind) {
                connect(at, source.0 as usize);
            }
        }
        for (block, incoming) in func.blocks.iter().zip(hir::loops::predecessors(func)) {
            for (_, args) in incoming {
                for (param, arg) in block.params.iter().zip(args) {
                    connect(param.0 as usize, arg.0 as usize);
                }
            }
        }
        let component = hir::strongly_connected(&edges);
        let mut members = vec![Vec::new(); component.iter().max().map_or(0, |at| at + 1)];
        for (at, group) in component.iter().enumerate() {
            // HIR identities are u32; an index outside that space cannot be an
            // operand, allocation or tracked fresh base.
            if let Ok(id) = u32::try_from(at) {
                members[*group].push(ValueId(id));
            }
        }
        Self { component, members }
    }

    pub(super) fn members(&self, value: ValueId) -> &[ValueId] {
        &self.members[self.component[value.0 as usize]]
    }
}
