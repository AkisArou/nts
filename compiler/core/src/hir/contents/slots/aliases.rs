//! A may-alias relation used only to destroy slot authority. A component is
//! never evidence that two values are equal, distinct, fresh, or null.

use crate::hir::{self, Func, ValueId};

#[derive(Debug)]
pub(in crate::hir) struct Aliases {
    component: Vec<usize>,
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
        Self { component }
    }

    pub(super) fn may_share(&self, a: ValueId, b: ValueId) -> bool {
        self.component[a.0 as usize] == self.component[b.0 as usize]
    }
}
