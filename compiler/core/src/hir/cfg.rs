//! Shared facts about the control-flow graph of one HIR function.

use super::{BlockId, Func, OpKind, ValueId};

/// A malformed successor prevents publishing a repetition proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidSuccessor {
    /// Block containing the invalid edge.
    pub from: BlockId,
    /// Target named by that edge.
    pub to: BlockId,
}

/// Why a CFG query could not publish a complete graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CfgError {
    /// A terminator or placed Await names a block outside the function.
    InvalidSuccessor(InvalidSuccessor),
    /// A placed operation ID does not resolve in the function's value arena.
    InvalidPlacedOperation { block: BlockId, value: ValueId },
}

impl std::fmt::Display for CfgError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSuccessor(edge) => write!(
                formatter,
                "CFG edge from block {} targets missing block {}",
                edge.from.0, edge.to.0
            ),
            Self::InvalidPlacedOperation { block, value } => write!(
                formatter,
                "block {} places missing operation value {}",
                block.0, value.0
            ),
        }
    }
}

impl std::error::Error for CfgError {}

/// Cyclic-block membership for the exact borrowed function revision.
///
/// Borrowing the function prevents callers from mutating its CFG while they
/// consume the membership snapshot. Recompute this value after any rewrite.
#[derive(Debug)]
pub struct CyclicBlocks<'func> {
    _func: &'func Func,
    members: Vec<bool>,
    successors: Vec<Vec<BlockId>>,
}

impl CyclicBlocks<'_> {
    /// Whether a block is cyclic. `None` means the ID is outside this CFG and
    /// therefore has no repetition proof.
    #[must_use]
    pub fn is_cyclic(&self, block: BlockId) -> Option<bool> {
        self.members.get(block.0 as usize).copied()
    }

    /// Validated outgoing edges for a block in this exact CFG snapshot.
    /// `None` means the block ID is outside this CFG.
    #[must_use]
    pub fn successors(&self, block: BlockId) -> Option<&[BlockId]> {
        self.successors.get(block.0 as usize).map(Vec::as_slice)
    }
}

/// Build, validate, and retain the CFG in O(blocks + placed operations + edges),
/// then compute SCC membership in O(blocks + edges) time and space.
///
/// A block is cyclic iff it belongs to a multi-node strongly connected
/// component or has a self-edge. Invalid successor IDs fail the whole query;
/// omitting an edge could otherwise turn malformed input into a false
/// non-repetition proof.
pub fn cyclic_blocks(func: &Func) -> Result<CyclicBlocks<'_>, CfgError> {
    let count = func.blocks.len();
    let mut successors: Vec<Vec<BlockId>> = vec![Vec::new(); count];
    let mut predecessors = vec![Vec::new(); count];
    for (at, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(at).unwrap_or(u32::MAX));
        let mut targets = block.terminator.successors();
        for value in &block.ops {
            let Some(op) = func.values.get(value.0 as usize) else {
                return Err(CfgError::InvalidPlacedOperation {
                    block: from,
                    value: *value,
                });
            };
            if let OpKind::Await {
                rejects_to: Some(rejection),
                ..
            } = &op.kind
            {
                targets.push(rejection.handler);
            }
        }
        for target in targets {
            let target_index = target.0 as usize;
            if target_index >= count {
                return Err(CfgError::InvalidSuccessor(InvalidSuccessor {
                    from,
                    to: target,
                }));
            }
            successors[at].push(target);
            predecessors[target_index].push(at);
        }
    }

    Ok(CyclicBlocks {
        _func: func,
        members: cycle_members(&successors, &predecessors),
        successors,
    })
}

/// Iterative Kosaraju SCC pass in O(blocks + edges); iterative traversal also
/// handles very deep CFGs.
fn cycle_members(successors: &[Vec<BlockId>], predecessors: &[Vec<usize>]) -> Vec<bool> {
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
                let next = successors[node][edge].0 as usize;
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
        let is_cycle = members.len() > 1
            || successors[root]
                .iter()
                .any(|target| target.0 as usize == root);
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
    use crate::hir::{Absent, Block, HirType, Op, Rejection, Terminator};
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
        assert_eq!(cyclic.successors(BlockId(0)), Some(&[BlockId(1)][..]));
        assert_eq!(cyclic.successors(BlockId(6)), None);
    }

    #[test]
    fn invalid_successors_fail_the_query() {
        let func = func(vec![Terminator::Jump {
            target: BlockId(1),
            args: Vec::new(),
        }]);
        assert!(matches!(
            cyclic_blocks(&func),
            Err(CfgError::InvalidSuccessor(InvalidSuccessor {
                from: BlockId(0),
                to: BlockId(1)
            }))
        ));
    }

    #[test]
    fn placed_await_rejection_is_a_cfg_edge() {
        let mut func = func(vec![
            Terminator::Return(None),
            Terminator::Jump {
                target: BlockId(0),
                args: Vec::new(),
            },
        ]);
        func.values.push(Op {
            kind: OpKind::Await {
                promise: ValueId(0),
                rejects_to: Some(Rejection {
                    handler: BlockId(1),
                    args: Vec::new(),
                    reason_at: 0,
                }),
            },
            ty: HirType::Void,
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            }),
        });
        // An operation only contributes its exceptional edge when placed in
        // the block; dead values in the arena are not CFG edges.
        assert_eq!(
            cyclic_blocks(&func).unwrap().is_cyclic(BlockId(0)),
            Some(false)
        );
        assert_eq!(
            cyclic_blocks(&func).unwrap().successors(BlockId(0)),
            Some(&[][..])
        );
        func.blocks[0].ops.push(ValueId(0));
        let cyclic = cyclic_blocks(&func).unwrap();
        assert_eq!(cyclic.is_cyclic(BlockId(0)), Some(true));
        assert_eq!(cyclic.is_cyclic(BlockId(1)), Some(true));
        assert_eq!(cyclic.successors(BlockId(0)), Some(&[BlockId(1)][..]));
        assert_eq!(cyclic.successors(BlockId(1)), Some(&[BlockId(0)][..]));
    }

    #[test]
    fn successors_preserve_terminator_order_and_duplicate_edges() {
        let mut func = func(vec![
            Terminator::Branch {
                cond: ValueId(0),
                then_target: BlockId(1),
                then_args: Vec::new(),
                else_target: BlockId(2),
                else_args: Vec::new(),
            },
            Terminator::Return(None),
            Terminator::Return(None),
        ]);
        func.values.push(Op {
            kind: OpKind::Await {
                promise: ValueId(0),
                rejects_to: Some(Rejection {
                    handler: BlockId(2),
                    args: Vec::new(),
                    reason_at: 0,
                }),
            },
            ty: HirType::Void,
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            }),
        });
        func.blocks[0].ops.push(ValueId(0));

        let cfg = cyclic_blocks(&func).unwrap();
        assert_eq!(
            cfg.successors(BlockId(0)),
            Some(&[BlockId(1), BlockId(2), BlockId(2)][..])
        );
    }

    #[test]
    fn invalid_await_handler_fails_the_query() {
        let mut func = func(vec![Terminator::Return(None)]);
        func.values.push(Op {
            kind: OpKind::Await {
                promise: ValueId(0),
                rejects_to: Some(Rejection {
                    handler: BlockId(1),
                    args: Vec::new(),
                    reason_at: 0,
                }),
            },
            ty: HirType::Void,
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            }),
        });
        func.blocks[0].ops.push(ValueId(0));
        assert!(matches!(
            cyclic_blocks(&func),
            Err(CfgError::InvalidSuccessor(InvalidSuccessor {
                from: BlockId(0),
                to: BlockId(1)
            }))
        ));
    }

    #[test]
    fn invalid_placed_operation_fails_the_query() {
        let mut func = func(vec![Terminator::Return(None)]);
        func.blocks[0].ops.push(ValueId(1));
        assert!(matches!(
            cyclic_blocks(&func),
            Err(CfgError::InvalidPlacedOperation {
                block: BlockId(0),
                value: ValueId(1)
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
