//! Dominator-tree translation analysis (Ramsey, ICFP 2022, sections 5–6).
//!
//! Every RPO-backward edge in a reducible graph targets a dominator of its
//! source. A failed test certifies irreducibility; only that route dispatches.
//! Merge nodes have at least two forward inedges. Their dominator-tree siblings
//! are ordered by RPO, which ensures each forward branch's label is in scope.

use nts_codegen_common::block_order;
use nts_core::hir::{BlockId, Func};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Structured,
    Dispatcher,
}

#[derive(Debug)]
pub(crate) struct Plan {
    pub(crate) order: Vec<BlockId>,
    pub(crate) structure: Option<Structure>,
}

impl Plan {
    pub(crate) fn route(&self) -> Route {
        if self.structure.is_some() {
            Route::Structured
        } else {
            Route::Dispatcher
        }
    }
}

#[derive(Debug)]
pub(crate) struct Structure {
    pub(crate) rank: Vec<usize>,
    pub(crate) parent: Vec<Option<BlockId>>,
    /// Immediate-dominator children in increasing RPO order.
    pub(crate) children: Vec<Vec<BlockId>>,
    pub(crate) merges: Vec<bool>,
    pub(crate) loop_headers: Vec<bool>,
}

type Set = BTreeSet<BlockId>;

pub(crate) fn plan(func: &Func) -> Result<Plan, String> {
    let order = block_order(func);
    let reached: Set = order.iter().copied().collect();
    let preds = predecessors(func, &reached);
    let dom = dominators(&order, &preds);
    let mut rank = vec![usize::MAX; func.blocks.len()];
    for (at, id) in order.iter().enumerate() {
        rank[id.0 as usize] = at;
    }
    let mut forward = vec![0; func.blocks.len()];
    let mut loop_headers = vec![false; func.blocks.len()];
    for from in &order {
        for to in func.blocks[from.0 as usize].terminator.successors() {
            if rank[to.0 as usize] <= rank[from.0 as usize] {
                if !dom[from.0 as usize].contains(&to) {
                    return Ok(Plan {
                        order,
                        structure: None,
                    });
                }
                loop_headers[to.0 as usize] = true;
            } else {
                forward[to.0 as usize] += 1;
            }
        }
    }
    let mut children = vec![Vec::new(); func.blocks.len()];
    let mut parent = vec![None; func.blocks.len()];
    for id in order.iter().copied().skip(1) {
        // Strict dominators form a chain. Its deepest member is the immediate
        // dominator; the size of its dominator set gives its depth.
        let immediate = dom[id.0 as usize]
            .iter()
            .copied()
            .filter(|candidate| *candidate != id)
            .max_by_key(|candidate| dom[candidate.0 as usize].len())
            .ok_or_else(|| format!("b{} has no immediate dominator", id.0))?;
        parent[id.0 as usize] = Some(immediate);
        children[immediate.0 as usize].push(id);
    }
    Ok(Plan {
        order,
        structure: Some(Structure {
            rank,
            parent,
            children,
            merges: forward.into_iter().map(|count| count >= 2).collect(),
            loop_headers,
        }),
    })
}

fn predecessors(func: &Func, reached: &Set) -> Vec<Set> {
    let mut preds = vec![Set::new(); func.blocks.len()];
    for from in reached {
        for to in func.blocks[from.0 as usize].terminator.successors() {
            preds[to.0 as usize].insert(*from);
        }
    }
    preds
}

fn dominators(order: &[BlockId], preds: &[Set]) -> Vec<Set> {
    let all: Set = order.iter().copied().collect();
    let mut dom = vec![all; preds.len()];
    dom[0] = Set::from([BlockId(0)]);
    loop {
        let mut changed = false;
        for block in order.iter().copied().filter(|id| id.0 != 0) {
            let mut sources = preds[block.0 as usize].iter();
            let Some(first) = sources.next() else {
                continue;
            };
            let mut next = dom[first.0 as usize].clone();
            for pred in sources {
                next.retain(|id| dom[pred.0 as usize].contains(id));
            }
            next.insert(block);
            if next != dom[block.0 as usize] {
                dom[block.0 as usize] = next;
                changed = true;
            }
        }
        if !changed {
            return dom;
        }
    }
}
