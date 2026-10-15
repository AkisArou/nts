//! Definite slot initialization, source-shaped holes and alias/branch/loop
//! controls.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, I32, U32, block, function, program, value};
use nts_core::hir::{
    ArrayFill, BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId,
};

fn array() -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(F64)))
}
fn op(f: &mut Func, ops: &mut Vec<ValueId>, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(f, kind, ty);
    ops.push(id);
    id
}
fn base(name: &str) -> (Func, Vec<ValueId>, ValueId, ValueId, ValueId) {
    let mut f = function(name, &[], F64);
    let mut ops = vec![];
    let len = op(&mut f, &mut ops, OpKind::ConstInt(2), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(),
    );
    let at = op(&mut f, &mut ops, OpKind::ConstInt(0), U32);
    let n = op(&mut f, &mut ops, OpKind::ConstFloat(17.0), F64);
    (f, ops, a, at, n)
}
fn set(f: &mut Func, ops: &mut Vec<ValueId>, a: ValueId, at: ValueId, n: ValueId) {
    op(
        f,
        ops,
        OpKind::ArraySet {
            array: a,
            index: at,
            value: n,
            checked: true,
        },
        HirType::Void,
    );
}
fn get(f: &mut Func, ops: &mut Vec<ValueId>, a: ValueId, at: ValueId) -> ValueId {
    op(
        f,
        ops,
        OpKind::ArrayGet {
            array: a,
            index: at,
            checked: true,
        },
        F64,
    )
}
fn declined(f: Func) {
    let name = f.name.clone();
    let nts_codegen_wasm::EmitError::Declined(ds) =
        nts_codegen_wasm::emit(&program(vec![f])).unwrap_err()
    else {
        panic!("expected named hole decline")
    };
    assert!(
        ds.iter().any(|d| d.code == "NTS5001"
            && d.message.contains(&name)
            && d.message.contains("typed array holes")),
        "{ds:?}"
    );
}

#[test]
fn an_in_range_hole_and_read_before_a_later_store_decline() {
    for initialized_other_slot in [false, true] {
        let (mut f, mut ops, a, at, n) = base("hole");
        if initialized_other_slot {
            let other = op(&mut f, &mut ops, OpKind::ConstInt(1), U32);
            set(&mut f, &mut ops, a, other, n);
        }
        let answer = get(&mut f, &mut ops, a, at);
        set(&mut f, &mut ops, a, at, n);
        f.blocks
            .push(block(&[], &ops, Terminator::Return(Some(answer))));
        declined(f);
    }
}

#[test]
fn aliasing_cannot_hide_an_uninitialized_slot() {
    let (mut f, mut ops, a, at, n) = base("aliasHole");
    set(&mut f, &mut ops, a, at, n);
    let erased = op(
        &mut f,
        &mut ops,
        OpKind::Erase {
            value: a,
            absent: nts_core::hir::Absent::Impossible,
            slots: nts_core::hir::Absent::Impossible,
        },
        HirType::Erased,
    );
    let restored = op(&mut f, &mut ops, OpKind::Unerase { value: erased }, array());
    let answer = get(&mut f, &mut ops, restored, at);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(answer))));
    declined(f);
}

#[test]
fn a_store_on_only_one_branch_is_not_a_definite_initialization() {
    let (mut f, mut ops, a, at, n) = base("branchHole");
    let cond = op(&mut f, &mut ops, OpKind::ConstBool(true), HirType::Bool);
    f.blocks.push(block(
        &[],
        &ops,
        Terminator::Branch {
            cond,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![],
        },
    ));
    let mut stores = vec![];
    set(&mut f, &mut stores, a, at, n);
    f.blocks.push(block(
        &[],
        &stores,
        Terminator::Jump {
            target: BlockId(2),
            args: vec![],
        },
    ));
    let mut reads = vec![];
    let answer = get(&mut f, &mut reads, a, at);
    f.blocks
        .push(block(&[], &reads, Terminator::Return(Some(answer))));
    declined(f);
}

fn branch(cond: ValueId, then: u32, otherwise: u32) -> Terminator {
    Terminator::Branch {
        cond,
        then_target: BlockId(then),
        then_args: vec![],
        else_target: BlockId(otherwise),
        else_args: vec![],
    }
}
fn jump(target: u32) -> Terminator {
    Terminator::Jump {
        target: BlockId(target),
        args: vec![],
    }
}
fn emits(f: Func) {
    nts_codegen_wasm::emit(&program(vec![f])).unwrap();
}

#[test]
fn stores_after_a_guard_that_throws_initialize_every_slot() {
    // `[2n ** 70n, x]`: each element's guard branches to a throw, so the
    // stores after it sit in a later block, which every path to the escape
    // passes through.
    let (mut f, mut ops, a, at, n) = base("guarded");
    let cond = op(&mut f, &mut ops, OpKind::ConstBool(false), HirType::Bool);
    f.blocks.push(block(&[], &ops, branch(cond, 1, 2)));
    f.blocks.push(block(&[], &[], Terminator::Unreachable));
    let mut stores = vec![];
    set(&mut f, &mut stores, a, at, n);
    let other = op(&mut f, &mut stores, OpKind::ConstInt(1), U32);
    set(&mut f, &mut stores, a, other, n);
    let erased = op(
        &mut f,
        &mut stores,
        OpKind::Erase {
            value: a,
            absent: nts_core::hir::Absent::Impossible,
            slots: nts_core::hir::Absent::Impossible,
        },
        HirType::Erased,
    );
    let restored = op(
        &mut f,
        &mut stores,
        OpKind::Unerase { value: erased },
        array(),
    );
    let answer = get(&mut f, &mut stores, restored, other);
    f.blocks
        .push(block(&[], &stores, Terminator::Return(Some(answer))));
    emits(f);
}

#[test]
fn a_store_on_both_arms_is_written_where_they_meet() {
    // `[c ? x : y, ...]` lowered as a store on each arm.
    let (mut f, mut ops, a, at, n) = base("bothArms");
    let cond = op(&mut f, &mut ops, OpKind::ConstBool(true), HirType::Bool);
    f.blocks.push(block(&[], &ops, branch(cond, 1, 2)));
    for _ in 0..2 {
        let mut stores = vec![];
        set(&mut f, &mut stores, a, at, n);
        f.blocks.push(block(&[], &stores, jump(3)));
    }
    let mut reads = vec![];
    let answer = get(&mut f, &mut reads, a, at);
    f.blocks
        .push(block(&[], &reads, Terminator::Return(Some(answer))));
    emits(f);
}

#[test]
fn a_store_in_a_loop_body_does_not_cover_the_path_that_skips_it() {
    let (mut f, mut ops, a, at, n) = base("loopHole");
    let cond = op(&mut f, &mut ops, OpKind::ConstBool(false), HirType::Bool);
    f.blocks.push(block(&[], &ops, jump(1)));
    f.blocks.push(block(&[], &[], branch(cond, 2, 3)));
    let mut stores = vec![];
    set(&mut f, &mut stores, a, at, n);
    f.blocks.push(block(&[], &stores, jump(1)));
    let mut reads = vec![];
    let answer = get(&mut f, &mut reads, a, at);
    f.blocks
        .push(block(&[], &reads, Terminator::Return(Some(answer))));
    declined(f);
}

#[test]
fn initialized_slot_reads_and_dense_escaped_arrays_agree() {
    let (mut partial, mut ops, a, at, n) = base("partial");
    set(&mut partial, &mut ops, a, at, n);
    let answer = get(&mut partial, &mut ops, a, at);
    partial
        .blocks
        .push(block(&[], &ops, Terminator::Return(Some(answer))));

    let (mut dense, mut ops, a, at, n) = base("dense");
    set(&mut dense, &mut ops, a, at, n);
    let other = op(&mut dense, &mut ops, OpKind::ConstInt(1), U32);
    set(&mut dense, &mut ops, a, other, n);
    let answer = op(
        &mut dense,
        &mut ops,
        OpKind::Call {
            callee: Callee::Direct("read".into()),
            args: vec![a],
            frame: None,
        },
        F64,
    );
    dense
        .blocks
        .push(block(&[], &ops, Terminator::Return(Some(answer))));
    let mut read = function("read", &[array()], F64);
    read.exported = false;
    let mut ops = vec![];
    let a = op(&mut read, &mut ops, OpKind::Param(0), array());
    let at = op(&mut read, &mut ops, OpKind::ConstInt(1), U32);
    let answer = get(&mut read, &mut ops, a, at);
    read.blocks
        .push(block(&[], &ops, Terminator::Return(Some(answer))));
    let mut p = program(vec![partial, dense, read]);
    p.public_api.retain(|(name, _)| name != "read");
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    let result = common::run(
        "array-holes",
        &emitted,
        "tooling/wasm/check-array-holes.mjs",
        &[],
    );
    assert_eq!(result["cases"], 2);
}

/// How a counted fill differs from `for (i = 0; i < 4; i++) a[i] = 17`, read
/// at `a[3]` after the loop.
#[derive(Clone, Copy)]
struct Fill {
    start: i64,
    step: i64,
    /// The test is `i <= 3`, not normalised to `i < 4`.
    inclusive: bool,
    /// The bound, where it is not the length 4.
    bound: Option<i64>,
    /// The store is under an `if`.
    guarded: bool,
    /// A `break` leaves the body before the store.
    breaks: bool,
}

const FILL: Fill = Fill {
    start: 0,
    step: 1,
    inclusive: false,
    bound: None,
    guarded: false,
    breaks: false,
};

fn constant(f: &mut Func, ops: &mut Vec<ValueId>, n: i64) -> ValueId {
    op(f, ops, OpKind::ConstInt(i128::from(n)), I32)
}

/// b0 allocates and enters b1(i); b1 tests `i` and enters the body b2 or
/// leaves for b5; b2 reaches the store b4 (or, by `fill`, branches around
/// it); b4 stores and passes `i` to the latch b3(j), which steps it back to
/// b1.
fn counted_fill(name: &str, fill: Fill) -> Func {
    let mut f = function(name, &[], F64);
    let mut ops = vec![];
    let length = constant(&mut f, &mut ops, 4);
    let filled = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length,
            fill: ArrayFill::Holes,
        },
        array(),
    );
    let stored = op(&mut f, &mut ops, OpKind::ConstFloat(17.0), F64);
    let start = constant(&mut f, &mut ops, fill.start);
    let jump_args = |target: u32, args: Vec<ValueId>| Terminator::Jump {
        target: BlockId(target),
        args,
    };
    f.blocks.push(block(&[], &ops, jump_args(1, vec![start])));

    let counter = value(&mut f, OpKind::BlockParam(0), I32);
    let mut header = vec![];
    let bound = match (fill.bound, fill.inclusive) {
        (Some(other), _) => constant(&mut f, &mut header, other),
        (None, true) => constant(&mut f, &mut header, 3),
        (None, false) => length,
    };
    let op_kind = if fill.inclusive { BinOp::Le } else { BinOp::Lt };
    let cond = op(
        &mut f,
        &mut header,
        OpKind::Binary {
            op: op_kind,
            lhs: counter,
            rhs: bound,
        },
        HirType::Bool,
    );
    f.blocks
        .push(block(&[counter], &header, branch(cond, 2, 5)));

    let mut body = vec![];
    let terminator = if fill.guarded || fill.breaks {
        let taken = op(&mut f, &mut body, OpKind::ConstBool(true), HirType::Bool);
        if fill.guarded {
            Terminator::Branch {
                cond: taken,
                then_target: BlockId(4),
                then_args: vec![],
                else_target: BlockId(3),
                else_args: vec![counter],
            }
        } else {
            branch(taken, 5, 4)
        }
    } else {
        jump(4)
    };
    f.blocks.push(block(&[], &body, terminator));

    let stepped = value(&mut f, OpKind::BlockParam(0), I32);
    let mut latch = vec![];
    let step = constant(&mut f, &mut latch, fill.step);
    let next = op(
        &mut f,
        &mut latch,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: stepped,
            rhs: step,
        },
        I32,
    );
    f.blocks
        .push(block(&[stepped], &latch, jump_args(1, vec![next])));

    let mut store = vec![];
    set(&mut f, &mut store, filled, counter, stored);
    f.blocks
        .push(block(&[], &store, jump_args(3, vec![counter])));

    let mut exit = vec![];
    let last = constant(&mut f, &mut exit, 3);
    let answer = get(&mut f, &mut exit, filled, last);
    f.blocks
        .push(block(&[], &exit, Terminator::Return(Some(answer))));
    f
}

#[test]
fn a_counted_fill_over_the_length_completes_on_its_exit_edge() {
    emits(counted_fill("countedFill", FILL));
}

#[test]
fn a_fill_that_may_not_write_every_index_declines() {
    let variants = [
        ("startsAtOne", Fill { start: 1, ..FILL }),
        ("stepsByTwo", Fill { step: 2, ..FILL }),
        (
            "inclusiveTest",
            Fill {
                inclusive: true,
                ..FILL
            },
        ),
        (
            "anotherBound",
            Fill {
                bound: Some(3),
                ..FILL
            },
        ),
        (
            "guardedStore",
            Fill {
                guarded: true,
                ..FILL
            },
        ),
        (
            "breakBeforeStore",
            Fill {
                breaks: true,
                ..FILL
            },
        ),
    ];
    for (name, fill) in variants {
        declined(counted_fill(name, fill));
    }
}

/// `a[x] = 17; a[x]`, or `a[y]` when `other`.
fn same_slot(name: &str, other: bool) -> Func {
    let mut f = function(name, &[I32, I32], F64);
    let mut ops = vec![];
    let slot = op(&mut f, &mut ops, OpKind::Param(0), I32);
    let other_slot = op(&mut f, &mut ops, OpKind::Param(1), I32);
    let length = constant(&mut f, &mut ops, 4);
    let filled = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length,
            fill: ArrayFill::Holes,
        },
        array(),
    );
    let stored = op(&mut f, &mut ops, OpKind::ConstFloat(17.0), F64);
    set(&mut f, &mut ops, filled, slot, stored);
    let answer = get(
        &mut f,
        &mut ops,
        filled,
        if other { other_slot } else { slot },
    );
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(answer))));
    f
}

#[test]
fn a_slot_reads_back_at_the_index_value_that_stored_it() {
    emits(same_slot("sameSlot", false));
    declined(same_slot("otherSlot", true));
}

/// `a[x] = 17; if (!(x + 1 < 4)) a[0]`: a store at the last index writes that
/// slot alone, so `x + 1 >= length` does not make the array complete.
#[test]
fn a_store_at_the_last_index_alone_does_not_fill_the_rest() {
    let mut f = function("lastAlone", &[I32], F64);
    let mut ops = vec![];
    let slot = op(&mut f, &mut ops, OpKind::Param(0), I32);
    let length = constant(&mut f, &mut ops, 4);
    let filled = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length,
            fill: ArrayFill::Holes,
        },
        array(),
    );
    let stored = op(&mut f, &mut ops, OpKind::ConstFloat(17.0), F64);
    set(&mut f, &mut ops, filled, slot, stored);
    let one = constant(&mut f, &mut ops, 1);
    let next = op(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: slot,
            rhs: one,
        },
        I32,
    );
    let below = op(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Lt,
            lhs: next,
            rhs: length,
        },
        HirType::Bool,
    );
    f.blocks.push(block(&[], &ops, branch(below, 1, 2)));
    let mut same = vec![];
    let answer = get(&mut f, &mut same, filled, slot);
    f.blocks
        .push(block(&[], &same, Terminator::Return(Some(answer))));
    let mut first = vec![];
    let zero = constant(&mut f, &mut first, 0);
    let answer = get(&mut f, &mut first, filled, zero);
    f.blocks
        .push(block(&[], &first, Terminator::Return(Some(answer))));
    declined(f);
}
