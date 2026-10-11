//! A certified loop forest for reducible CFGs; dispatch only for irreducible CFGs.
//!
//! Removing edges to dominating headers makes a reducible graph acyclic. Those
//! edges define natural loops. Condense immediate child loops in each region,
//! topologically order the remaining nodes, and bind forward destinations to
//! block labels. The body emitter checks every edge against its lexical scopes.

use nts_codegen_common::block_order;
use nts_core::hir::{BlockId, Func};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Structured,
    Dispatcher,
}

#[derive(Debug)]
pub(crate) struct Plan {
    pub(crate) order: Vec<BlockId>,
    pub(crate) region: Option<Region>,
}

impl Plan {
    pub(crate) fn route(&self) -> Route {
        if self.region.is_some() {
            Route::Structured
        } else {
            Route::Dispatcher
        }
    }
}

#[derive(Debug)]
pub(crate) struct Region {
    pub(crate) header: Option<BlockId>,
    pub(crate) nodes: Vec<Node>,
}

#[derive(Debug)]
pub(crate) enum Node {
    Block(BlockId),
    Loop(Region),
}

impl Node {
    pub(crate) fn entry(&self) -> BlockId {
        match self {
            Self::Block(id) => *id,
            Self::Loop(region) => region.header.expect("a loop has its header"),
        }
    }
}

type Set = BTreeSet<BlockId>;
type Loops = BTreeMap<BlockId, Set>;

pub(crate) fn plan(func: &Func) -> Result<Plan, String> {
    let order = block_order(func);
    let reached: Set = order.iter().copied().collect();
    let preds = predecessors(func, &reached);
    let dom = dominators(&order, &preds);
    let forward: Vec<_> = order
        .iter()
        .flat_map(|from| {
            func.blocks[from.0 as usize]
                .terminator
                .successors()
                .into_iter()
                .filter(|to| !dom[from.0 as usize].contains(to))
                .map(|to| (*from, to))
                .collect::<Vec<_>>()
        })
        .collect();
    if topological(&reached, &forward, &order).is_none() {
        return Ok(Plan {
            order,
            region: None,
        });
    }
    let loops = natural_loops(func, &order, &preds, &dom);
    check_forest(&loops)?;
    let region = region(func, None, &reached, &loops, &order)?;
    Ok(Plan {
        order,
        region: Some(region),
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

fn natural_loops(func: &Func, order: &[BlockId], preds: &[Set], dom: &[Set]) -> Loops {
    let mut loops = Loops::new();
    for tail in order {
        for head in func.blocks[tail.0 as usize].terminator.successors() {
            if !dom[tail.0 as usize].contains(&head) {
                continue;
            }
            let members = loops.entry(head).or_default();
            members.insert(head);
            let mut pending = vec![*tail];
            while let Some(id) = pending.pop() {
                if members.insert(id) {
                    pending.extend(preds[id.0 as usize].iter().copied());
                }
            }
        }
    }
    loops
}

fn check_forest(loops: &Loops) -> Result<(), String> {
    for (head, members) in loops {
        for (other, theirs) in
            loops.range((std::ops::Bound::Excluded(head), std::ops::Bound::Unbounded))
        {
            if !members.is_disjoint(theirs)
                && !members.is_subset(theirs)
                && !theirs.is_subset(members)
            {
                return Err(format!(
                    "overlapping natural loops b{} and b{}",
                    head.0, other.0
                ));
            }
        }
    }
    Ok(())
}

fn topological(
    nodes: &Set,
    edges: &[(BlockId, BlockId)],
    rank: &[BlockId],
) -> Option<Vec<BlockId>> {
    let mut indegree: BTreeMap<_, usize> = nodes.iter().map(|id| (*id, 0)).collect();
    for (_, to) in edges {
        *indegree.get_mut(to)? += 1;
    }
    let ranks: BTreeMap<_, _> = rank.iter().enumerate().map(|(i, id)| (*id, i)).collect();
    let mut ready: BTreeSet<_> = indegree
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| (ranks[id], *id))
        .collect();
    let mut order = Vec::new();
    while let Some((_, from)) = ready.pop_first() {
        order.push(from);
        for (_, to) in edges.iter().filter(|(source, _)| *source == from) {
            let count = indegree.get_mut(to)?;
            *count -= 1;
            if *count == 0 {
                ready.insert((ranks[to], *to));
            }
        }
    }
    (order.len() == nodes.len()).then_some(order)
}

fn region(
    func: &Func,
    header: Option<BlockId>,
    members: &Set,
    loops: &Loops,
    rank: &[BlockId],
) -> Result<Region, String> {
    let nested: Vec<_> = loops
        .iter()
        .filter(|(head, set)| Some(**head) != header && set.is_subset(members))
        .collect();
    let children: Vec<_> = nested
        .iter()
        .copied()
        .filter(|(head, set)| {
            !nested
                .iter()
                .any(|(other, theirs)| other != head && set.is_subset(theirs))
        })
        .collect();
    let mut owners: BTreeMap<_, _> = members.iter().map(|id| (*id, *id)).collect();
    for (head, set) in &children {
        for id in *set {
            owners.insert(*id, **head);
        }
    }
    let nodes: Set = owners.values().copied().collect();
    let mut edges = BTreeSet::new();
    for from in members {
        for to in func.blocks[from.0 as usize].terminator.successors() {
            if Some(to) == header || !members.contains(&to) {
                continue;
            }
            if owners[from] != owners[&to] {
                edges.insert((owners[from], owners[&to]));
            }
        }
    }
    let order = topological(&nodes, &edges.into_iter().collect::<Vec<_>>(), rank)
        .ok_or_else(|| "a reducible region whose condensed forward edges are cyclic".to_owned())?;
    if order.first().copied() != Some(header.unwrap_or(BlockId(0))) {
        return Err("a reducible region whose entry was not ordered first".to_owned());
    }
    let mut result = Vec::new();
    for id in order {
        if let Some((head, set)) = children.iter().find(|(head, _)| **head == id) {
            result.push(Node::Loop(region(func, Some(**head), set, loops, rank)?));
        } else {
            result.push(Node::Block(id));
        }
    }
    Ok(Region {
        header,
        nodes: result,
    })
}
