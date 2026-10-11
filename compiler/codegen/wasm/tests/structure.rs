//! Arbitrary CFGs: independent T1/T2 reducibility, validation, bounded execution.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::{I32, U32, block, function, origin, program, value};
use nts_codegen_wasm::Route;
use nts_core::hir::{BinOp, Block, BlockId, Func, Global, HirType, OpKind, Terminator, ValueId};
use std::collections::BTreeSet;

fn binary(f: &mut Func, op: BinOp, lhs: ValueId, rhs: ValueId, ty: HirType) -> ValueId {
    value(f, OpKind::Binary { op, lhs, rhs }, ty)
}

fn guard(f: &mut Func, at: usize, fuel: ValueId, exit: BlockId) -> (ValueId, Block) {
    let count = value(f, OpKind::GlobalGet(0), I32);
    let cond = binary(f, BinOp::Lt, count, fuel, HirType::Bool);
    (
        count,
        block(
            &[],
            &[count, cond],
            Terminator::Branch {
                cond,
                then_target: BlockId(u32::try_from(2 + 2 * at).unwrap()),
                then_args: vec![],
                else_target: exit,
                else_args: vec![],
            },
        ),
    )
}

fn choice(
    f: &mut Func,
    at: usize,
    successors: &[usize],
    seed: ValueId,
    count: ValueId,
    exit: BlockId,
) -> Block {
    let one = value(f, OpKind::ConstInt(1), I32);
    let next = binary(f, BinOp::Add, count, one, I32);
    let store = value(
        f,
        OpKind::GlobalSet {
            global: 0,
            value: next,
        },
        HirType::Void,
    );
    let old = value(f, OpKind::GlobalGet(1), I32);
    let scale = value(f, OpKind::ConstInt(33), I32);
    let tag = value(f, OpKind::ConstInt(i128::try_from(at + 1).unwrap()), I32);
    let product = binary(f, BinOp::Mul, old, scale, I32);
    let trace = binary(f, BinOp::Add, product, tag, I32);
    let record = value(
        f,
        OpKind::GlobalSet {
            global: 1,
            value: trace,
        },
        HirType::Void,
    );
    let mut ops = vec![one, next, store, old, scale, tag, product, trace, record];
    let terminator = if successors.is_empty() {
        Terminator::Jump {
            target: exit,
            args: vec![],
        }
    } else {
        let shift = value(f, OpKind::Convert(count), U32);
        let bit = binary(f, BinOp::UShr, seed, shift, U32);
        let mask = value(f, OpKind::ConstInt(1), U32);
        let low = binary(f, BinOp::BitAnd, bit, mask, U32);
        let zero = value(f, OpKind::ConstInt(0), U32);
        let cond = binary(f, BinOp::Ne, low, zero, HirType::Bool);
        ops.extend([shift, bit, mask, low, zero, cond]);
        Terminator::Branch {
            cond,
            then_target: BlockId(u32::try_from(1 + 2 * successors[0]).unwrap()),
            then_args: vec![],
            else_target: BlockId(u32::try_from(1 + 2 * successors[1]).unwrap()),
            else_args: vec![],
        }
    };
    block(&[], &ops, terminator)
}

fn graph_function(graph: &[Vec<usize>], at: usize) -> Func {
    let mut f = function(&format!("graph{at}"), &[U32, I32], I32);
    let seed = value(&mut f, OpKind::Param(0), U32);
    let fuel = value(&mut f, OpKind::Param(1), I32);
    let zero = value(&mut f, OpKind::ConstInt(0), I32);
    let reset = value(
        &mut f,
        OpKind::GlobalSet {
            global: 0,
            value: zero,
        },
        HirType::Void,
    );
    let trace = value(
        &mut f,
        OpKind::GlobalSet {
            global: 1,
            value: zero,
        },
        HirType::Void,
    );
    f.blocks.push(block(
        &[],
        &[seed, fuel, zero, reset, trace],
        Terminator::Jump {
            target: BlockId(1),
            args: vec![],
        },
    ));
    let exit = BlockId(u32::try_from(1 + 2 * graph.len()).unwrap());
    for (at, successors) in graph.iter().enumerate() {
        let (count, head) = guard(&mut f, at, fuel, exit);
        let body = choice(&mut f, at, successors, seed, count, exit);
        f.blocks.extend([head, body]);
    }
    let result = value(&mut f, OpKind::GlobalGet(1), I32);
    f.blocks
        .push(block(&[], &[result], Terminator::Return(Some(result))));
    f
}

/// Hecht–Ullman flow-graph reduction: remove self edges (T1); contract a node
/// into its sole predecessor (T2). Independent of RPO and dominator analysis.
fn reducible(f: &Func) -> bool {
    let mut edges: Vec<BTreeSet<usize>> = f
        .blocks
        .iter()
        .map(|b| {
            b.terminator
                .successors()
                .iter()
                .map(|id| id.0 as usize)
                .collect()
        })
        .collect();
    let mut active = BTreeSet::new();
    let mut pending = vec![0];
    while let Some(at) = pending.pop() {
        if active.insert(at) {
            pending.extend(&edges[at]);
        }
    }
    loop {
        for at in &active {
            edges[*at].remove(at);
        }
        if active.len() == 1 {
            return true;
        }
        let contraction = active.iter().copied().filter(|at| *at != 0).find_map(|at| {
            let predecessors: Vec<_> = active
                .iter()
                .copied()
                .filter(|p| edges[*p].contains(&at))
                .collect();
            (predecessors.len() == 1).then(|| (at, predecessors[0]))
        });
        let Some((at, predecessor)) = contraction else {
            return false;
        };
        let successors = edges[at].clone();
        edges[predecessor].remove(&at);
        edges[predecessor].extend(successors);
        active.remove(&at);
    }
}

fn graphs() -> Vec<Vec<Vec<usize>>> {
    let mut result = vec![
        vec![vec![]],
        vec![vec![0, 0]],
        vec![vec![1, 2], vec![2, 2], vec![1, 1]],
    ];
    let mut random = 0x8465_8291_u32;
    for at in 0..597 {
        let size = 2 + at % 11;
        let mut graph = Vec::new();
        for node in 0..size {
            random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let target = (random >> 8) as usize % size;
            graph.push(if node + 1 < size {
                vec![node + 1, target]
            } else if random & 1 == 0 {
                vec![]
            } else {
                vec![target, (random >> 16) as usize % size]
            });
        }
        result.push(graph);
    }
    result
}

#[test]
fn arbitrary_graphs_use_the_certified_route_and_execute_without_cloning_actions() {
    let graphs = graphs();
    let funcs: Vec<_> = graphs
        .iter()
        .enumerate()
        .map(|(at, g)| graph_function(g, at))
        .collect();
    let expected: Vec<_> = funcs.iter().map(reducible).collect();
    let mut p = program(funcs);
    p.globals = ["visits", "trace"]
        .iter()
        .map(|name| Global {
            name: (*name).to_owned(),
            ty: I32,
            written: None,
            constant: false,
            initial: 0.0,
            exported: false,
            deferred: false,
            origin: origin(),
        })
        .collect();
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert_eq!(emitted.manifest.functions.len(), expected.len());
    let mut structured = 0;
    for (route, expected) in emitted.manifest.functions.iter().zip(expected) {
        assert_eq!(route.route == Route::Structured, expected, "{}", route.name);
        structured += usize::from(expected);
    }
    assert!(structured > 0 && structured < graphs.len());
    let source = std::env::temp_dir().join(format!("wasm-graphs-{}.json", std::process::id()));
    std::fs::write(&source, serde_json::to_vec(&graphs).unwrap()).unwrap();
    let output = common::run(
        "structure",
        &emitted,
        "tooling/wasm/check-structure.mjs",
        &[&source],
    );
    std::fs::remove_file(source).unwrap();
    assert_eq!(output["functions"], 600);
    assert_eq!(output["cases"], 48_000);
    println!(
        "{structured} structured, {} dispatched; {output}",
        graphs.len() - structured
    );
}
