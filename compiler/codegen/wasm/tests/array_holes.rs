//! Definite slot initialization, source-shaped holes and alias/branch controls.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId};

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
            zeroed: true,
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
