//! Shared facts about the control-flow graph of one HIR function.

use super::{BlockId, Func};

/// A malformed successor prevents publishing a repetition proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidSuccessor {
    /// Block containing the invalid edge.
    pub from: BlockId,
    /// Target named by that edge.
    pub to: BlockId,
}

impl std::fmt::Display for InvalidSuccessor {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "CFG edge from block {} targets missing block {}",
            self.from.0, self.to.0
        )
    }
}

impl std::error::Error for InvalidSuccessor {}

/// Cyclic-block membership for the exact borrowed function revision.
///
/// Borrowing the function prevents callers from mutating its CFG while they
/// consume the membership snapshot. Recompute this value after any rewrite.
#[derive(Debug)]
pub struct CyclicBlocks<'func> {
    _func: &'func Func,
    members: Vec<bool>,
}

impl CyclicBlocks<'_> {
    /// Whether a block is cyclic. `None` means the ID is outside this CFG and
    /// therefore has no repetition proof.
    #[must_use]
    pub fn is_cyclic(&self, block: BlockId) -> Option<bool> {
        self.members.get(block.0 as usize).copied()
    }
}

/// Compute cyclic-block membership in O(V + E) time and space.
///
/// A block is cyclic iff it belongs to a multi-node strongly connected
/// component or has a self-edge. Invalid successor IDs fail the whole query;
/// omitting an edge could otherwise turn malformed input into a false
/// non-repetition proof.
pub fn cyclic_blocks(func: &Func) -> Result<CyclicBlocks<'_>, InvalidSuccessor> {
    let count = func.blocks.len();
    let mut successors = vec![Vec::new(); count];
    let mut predecessors = vec![Vec::new(); count];
    for (at, block) in func.blocks.iter().enumerate() {
        for target in block.terminator.successors() {
            let target_index = target.0 as usize;
            if target_index >= count {
                return Err(InvalidSuccessor {
                    from: BlockId(u32::try_from(at).unwrap_or(u32::MAX)),
                    to: target,
                });
            }
            successors[at].push(target_index);
            predecessors[target_index].push(at);
        }
    }

    Ok(CyclicBlocks {
        _func: func,
        members: cycle_members(&successors, &predecessors),
    })
}

/// Iterative Kosaraju SCC pass; iterative traversal also handles very deep CFGs.
fn cycle_members(successors: &[Vec<usize>], predecessors: &[Vec<usize>]) -> Vec<bool> {
    let count = successors.len();
    debug_assert_eq!(predecessors.len(), count);

    let mut visited = vec![false; count];
    let mut finish = Vec::with_capacity(count);
    for root in 0..count {
        if visited[root] {
            continue;
        }
        visited[root] = true;
        let mut stack = vec![(root, 0_usize)];
        while let Some(&(node, edge)) = stack.last() {
            if edge < successors[node].len() {
                let next = successors[node][edge];
                stack.last_mut().expect("nonempty DFS stack").1 += 1;
                if !visited[next] {
                    visited[next] = true;
                    stack.push((next, 0));
                }
            } else {
                stack.pop();
                finish.push(node);
            }
        }
    }

    let mut component = vec![usize::MAX; count];
    let mut cyclic = vec![false; count];
    let mut next_component = 0;
    for root in finish.into_iter().rev() {
        if component[root] != usize::MAX {
            continue;
        }
        component[root] = next_component;
        let mut members = vec![root];
        let mut stack = vec![root];
        while let Some(node) = stack.pop() {
            for &next in &predecessors[node] {
                if component[next] == usize::MAX {
                    component[next] = next_component;
                    members.push(next);
                    stack.push(next);
                }
            }
        }
        let is_cycle = members.len() > 1 || successors[root].contains(&root);
        if is_cycle {
            for node in members {
                cyclic[node] = true;
            }
        }
        next_component += 1;
    }
    cyclic
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Absent, Block, HirType, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn func(terminators: Vec<Terminator>) -> Func {
        Func {
            name: "cfg-test".to_owned(),
            params: Vec::new(),
            return_type: HirType::Void,
            written_return: None,
            written_return_elements: Vec::new(),
            validation: None,
            result_absent: Absent::Impossible,
            values: Vec::new(),
            blocks: terminators
                .into_iter()
                .map(|terminator| Block {
                    params: Vec::new(),
                    ops: Vec::new(),
                    terminator,
                })
                .collect(),
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            }),
            exported: false,
            initializes_receiver: false,
            frame: None,
            abstract_declaration: false,
            async_result: None,
            obligations: Vec::new(),
            exact: Default::default(),
        }
    }

    #[test]
    fn membership_marks_cycles_but_not_connectors_or_tails() {
        let func = func(vec![
            Terminator::Jump {
                target: BlockId(1),
                args: Vec::new(),
            },
            Terminator::Jump {
                target: BlockId(2),
                args: Vec::new(),
            },
            Terminator::Branch {
                cond: super::super::ValueId(0),
                then_target: BlockId(3),
                then_args: Vec::new(),
                else_target: BlockId(4),
                else_args: Vec::new(),
            },
            Terminator::Jump {
                target: BlockId(2),
                args: Vec::new(),
            },
            Terminator::Jump {
                target: BlockId(5),
                args: Vec::new(),
            },
            Terminator::Jump {
                target: BlockId(5),
                args: Vec::new(),
            },
        ]);
        let cyclic = cyclic_blocks(&func).unwrap();
        assert_eq!(
            (0..6)
                .map(|index| cyclic.is_cyclic(BlockId(index)))
                .collect::<Vec<_>>(),
            [
                Some(false),
                Some(false),
                Some(true),
                Some(true),
                Some(false),
                Some(true)
            ]
        );
        assert_eq!(cyclic.is_cyclic(BlockId(6)), None);
    }

    #[test]
    fn invalid_successors_fail_the_query() {
        let func = func(vec![Terminator::Jump {
            target: BlockId(1),
            args: Vec::new(),
        }]);
        assert!(matches!(
            cyclic_blocks(&func),
            Err(InvalidSuccessor {
                from: BlockId(0),
                to: BlockId(1)
            })
        ));
    }

    #[test]
    fn iterative_scc_handles_deep_control_flow() {
        let count = 20_000;
        let mut terminators: Vec<_> = (1..count)
            .map(|target| Terminator::Jump {
                target: BlockId(target as u32),
                args: Vec::new(),
            })
            .collect();
        terminators.push(Terminator::Return(None));
        let func = func(terminators);
        let cyclic = cyclic_blocks(&func).unwrap();
        assert!((0..count).all(|index| cyclic.is_cyclic(BlockId(index as u32)) == Some(false)));
    }
}
