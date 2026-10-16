//! Keep a nonescaping web of boxed numbers in fresh `f64` locals.
//!
//! Inlining exposes numeric erasure, copies, tag tests and numeric projections
//! in one body. Both an i31 and a heap number box came from the same `f64`;
//! carrying that value removes the boxes without changing its bits. Every
//! reference consumer must be understood, and every read must follow a write:
//! an unwritten anyref is null, whereas an unwritten `f64` is zero.
//!
//! Copy edges make a whole component succeed or fail together. Instructions
//! are replaced in place so source marks retain their positions.

use crate::{
    erased::{self, Helper},
    flow::{self, Flow},
    ir::{Function, Inst},
    module::{Builder, Func, FuncKey, index},
};
use std::collections::{BTreeMap, BTreeSet};
use wasm_encoder::{HeapType, Instruction as I, RefType, ValType};

pub(crate) fn program(m: &mut Builder<'_>) {
    let Some(box_number) = m.requested_func(&FuncKey::Erased(Helper::BoxNumber)) else {
        return;
    };
    let Some(types) = m.types.erased else {
        return;
    };
    let helpers = Helpers {
        box_number,
        number: m.requested_func(&FuncKey::Erased(Helper::Number)),
        tag: m.requested_func(&FuncKey::Erased(Helper::Tag)),
        number_type: types.number,
    };
    for func in m.program_bodies() {
        let Some(body) = m.body(func) else { continue };
        let params = m.signature(func).0.len();
        let mut body = body.clone();
        if webs(&mut body, params, helpers) {
            m.replace_body(func, body);
        }
    }
}

#[derive(Clone, Copy)]
struct Helpers {
    box_number: Func,
    number: Option<Func>,
    tag: Option<Func>,
    number_type: u32,
}

fn op(inst: &Inst) -> Option<&I<'static>> {
    match inst {
        Inst::Op(i) => Some(i),
        _ => None,
    }
}

fn load(inst: &Inst) -> Option<u32> {
    match op(inst) {
        Some(I::LocalGet(local) | I::LocalTee(local)) => Some(*local),
        _ => None,
    }
}

fn calls(inst: Option<&Inst>, helper: Option<Func>) -> bool {
    matches!((inst, helper), (Some(Inst::Call(actual)), Some(expected)) if *actual == expected)
}

/// Test the numeric union, never just one representation's membership.
fn numeric_test(insts: &[Inst], at: usize, local: u32, ty: u32) -> bool {
    matches!(insts.get(at + 1..at + 5), Some([
        Inst::Op(I::RefTestNonNull(HeapType::I31)),
        Inst::Op(I::LocalGet(other)),
        Inst::Op(I::RefTestNonNull(HeapType::Concrete(number))),
        Inst::Op(I::I32Or),
    ]) if *other == local && *number == ty)
}

enum Projection {
    Number,
    Tag,
    NumericTest,
}

fn webs(body: &mut Function, params: usize, helpers: Helpers) -> bool {
    let insts = &body.code.insts;
    let mut writes: BTreeMap<u32, Vec<usize>> = body
        .locals
        .iter()
        .enumerate()
        .filter(|(_, ty)| **ty == ValType::Ref(RefType::ANYREF))
        .map(|(at, _)| (index(params + at), Vec::new()))
        .collect();
    for (at, inst) in insts.iter().enumerate() {
        if let Some(I::LocalSet(local) | I::LocalTee(local)) = op(inst)
            && let Some(sites) = writes.get_mut(local)
        {
            sites.push(at);
        }
    }
    let mut invalid = BTreeSet::new();
    let mut roots = BTreeSet::new();
    let mut edges: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for (&local, sites) in &writes {
        if sites.len() != 1 {
            invalid.insert(local);
        }
        // Retain edges even for a bad destination: its source must not move
        // to f64 while a reference copy of it remains.
        for &at in sites {
            let producer = at.checked_sub(1).and_then(|at| insts.get(at));
            if calls(producer, Some(helpers.box_number)) {
                roots.insert(local);
            } else if let Some(source) = producer.and_then(load)
                && writes.contains_key(&source)
            {
                edges.entry(local).or_default().push(source);
                edges.entry(source).or_default().push(local);
            } else {
                invalid.insert(local);
            }
        }
    }
    if roots.is_empty() {
        return false;
    }
    let projections = numeric_consumers(insts, helpers, &writes, &mut invalid);
    let components = eligible_components(&writes, &edges, &roots, &invalid);
    let web = initialized_web(&body.code, components);
    if web.is_empty() {
        return false;
    }
    let first = params + body.locals.len();
    let moved: BTreeMap<u32, u32> = web
        .iter()
        .enumerate()
        .map(|(at, &local)| (local, index(first + at)))
        .collect();
    body.locals
        .extend(std::iter::repeat_n(ValType::F64, moved.len()));
    for inst in &mut body.code.insts {
        if let Inst::Op(I::LocalGet(local) | I::LocalSet(local) | I::LocalTee(local)) = inst
            && let Some(to) = moved.get(local)
        {
            *local = *to;
        }
    }
    let insts = &mut body.code.insts;
    for local in web.intersection(&roots) {
        insts[writes[local][0] - 1] = Inst::Op(I::Nop);
    }
    for (at, local, projection) in projections {
        if !web.contains(&local) {
            continue;
        }
        match projection {
            Projection::Number => insts[at + 1] = Inst::Op(I::Nop),
            Projection::Tag => {
                consume_load(&mut insts[at]);
                insts[at + 1] = Inst::Op(I::I32Const(erased::NUMBER));
            }
            Projection::NumericTest => {
                consume_load(&mut insts[at]);
                insts[at + 1..at + 4].fill(Inst::Op(I::Nop));
                insts[at + 4] = Inst::Op(I::I32Const(1));
            }
        }
    }
    true
}

fn numeric_consumers(
    insts: &[Inst],
    helpers: Helpers,
    writes: &BTreeMap<u32, Vec<usize>>,
    invalid: &mut BTreeSet<u32>,
) -> Vec<(usize, u32, Projection)> {
    let mut projections = Vec::new();
    let mut covered = BTreeSet::new();
    for (at, inst) in insts.iter().enumerate() {
        let Some(local) = load(inst) else { continue };
        if !writes.contains_key(&local) || covered.contains(&at) {
            continue;
        }
        let next = insts.get(at + 1);
        if numeric_test(insts, at, local, helpers.number_type) {
            projections.push((at, local, Projection::NumericTest));
            covered.insert(at + 2);
        } else if calls(next, helpers.number) {
            projections.push((at, local, Projection::Number));
        } else if calls(next, helpers.tag) {
            projections.push((at, local, Projection::Tag));
        } else if !matches!(next.and_then(op), Some(I::Drop))
            && !matches!(next.and_then(op), Some(I::LocalSet(to) | I::LocalTee(to)) if writes.contains_key(to))
        {
            invalid.insert(local);
        }
    }
    projections
}

fn eligible_components(
    writes: &BTreeMap<u32, Vec<usize>>,
    edges: &BTreeMap<u32, Vec<u32>>,
    roots: &BTreeSet<u32>,
    invalid: &BTreeSet<u32>,
) -> Vec<BTreeSet<u32>> {
    // Connected components replace iterative pruning: one escaping/mixed
    // member rejects its upstream copies too, in a single graph walk.
    let mut seen = BTreeSet::new();
    let mut components = Vec::new();
    for &local in writes.keys() {
        if seen.contains(&local) {
            continue;
        }
        let mut pending = vec![local];
        let mut component = BTreeSet::new();
        while let Some(local) = pending.pop() {
            if !seen.insert(local) {
                continue;
            }
            component.insert(local);
            pending.extend(edges.get(&local).into_iter().flatten().copied());
        }
        if component.iter().any(|local| roots.contains(local))
            && component.iter().all(|local| !invalid.contains(local))
        {
            components.push(component);
        }
    }
    components
}

fn initialized_web(code: &crate::ir::Code, components: Vec<BTreeSet<u32>>) -> BTreeSet<u32> {
    let slots: BTreeMap<u32, usize> = components
        .iter()
        .flatten()
        .copied()
        .enumerate()
        .map(|(slot, local)| (local, slot))
        .collect();
    if slots.is_empty() {
        return BTreeSet::new();
    }
    // Track only potentially folded locals, not every local in the body.
    // Initialization only gains facts, so loop backedges cannot invalidate
    // entry facts, and a catch conservatively starts with its try's entry.
    let mut initialized = Initialized {
        slots: &slots,
        missing: BTreeSet::new(),
    };
    flow::run(code, vec![false; slots.len()], &mut initialized);
    components
        .into_iter()
        .filter(|component| {
            component
                .iter()
                .all(|local| !initialized.missing.contains(local))
        })
        .flatten()
        .collect()
}

/// A tee must still write its value when its stack result becomes a constant.
fn consume_load(inst: &mut Inst) {
    *inst = match inst {
        Inst::Op(I::LocalTee(local)) => Inst::Op(I::LocalSet(*local)),
        _ => Inst::Op(I::Nop),
    };
}

struct Initialized<'a> {
    slots: &'a BTreeMap<u32, usize>,
    missing: BTreeSet<u32>,
}

impl Flow for Initialized<'_> {
    fn step(&mut self, _at: usize, inst: &Inst, holds: &mut [bool]) {
        match op(inst) {
            Some(I::LocalGet(local)) => {
                if let Some(&slot) = self.slots.get(local)
                    && !holds[slot]
                {
                    self.missing.insert(*local);
                }
            }
            Some(I::LocalSet(local) | I::LocalTee(local)) => {
                if let Some(&slot) = self.slots.get(local) {
                    holds[slot] = true;
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use wasm_encoder::{BlockType, Catch};

    fn op(i: I<'static>) -> Inst {
        Inst::Op(i)
    }
    fn helpers() -> Helpers {
        Helpers {
            box_number: Func::by_hand(0),
            number: Some(Func::by_hand(1)),
            tag: Some(Func::by_hand(2)),
            number_type: 7,
        }
    }
    fn body(insts: Vec<Inst>, locals: usize) -> Function {
        let mut body = Function::new(std::iter::repeat_n(ValType::Ref(RefType::ANYREF), locals));
        body.code.insts = insts;
        body
    }
    fn root(local: u32) -> Vec<Inst> {
        vec![
            op(I::LocalGet(0)),
            Inst::Call(helpers().box_number),
            op(I::LocalSet(local)),
        ]
    }
    fn read(local: u32) -> Vec<Inst> {
        vec![
            op(I::LocalGet(local)),
            Inst::Call(Func::by_hand(1)),
            op(I::Drop),
        ]
    }
    fn rejected(mut body: Function) {
        let before = format!("{body:?}");
        assert!(!webs(&mut body, 1, helpers()));
        assert_eq!(format!("{body:?}"), before, "rejection changes nothing");
    }

    #[test]
    fn emitted_numeric_box_tag_and_projection_forms_match_the_fold() {
        use crate::test_common::{F64, U32, block, function, program, value};
        use nts_core::hir::{Absent, HirType, OpKind, Terminator};

        let mut f = function("emittedWeb", &[F64], F64);
        let input = value(&mut f, OpKind::Param(0), F64);
        let boxed = value(
            &mut f,
            OpKind::Erase {
                value: input,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
        );
        let tag = value(&mut f, OpKind::TagOf { value: boxed }, U32);
        let number = value(&mut f, OpKind::Unerase { value: boxed }, F64);
        f.blocks.push(block(
            &[],
            &[input, boxed, tag, number],
            Terminator::Return(Some(number)),
        ));
        let p = program(vec![f]);
        let types = crate::gc::Plan::build(&p).unwrap();
        let results = BTreeMap::new();
        let mut m = Builder::new(&p, &types, &results, false);
        // Use the actual lowering path, including unerase_to/projection_guard,
        // rather than another handwritten spelling of the expected pattern.
        let (mut emitted, _) = crate::body::lower(&p.funcs[0], &mut m).unwrap();
        let helpers = Helpers {
            box_number: m
                .requested_func(&FuncKey::Erased(Helper::BoxNumber))
                .unwrap(),
            number: Some(m.requested_func(&FuncKey::Erased(Helper::Number)).unwrap()),
            tag: Some(m.requested_func(&FuncKey::Erased(Helper::Tag)).unwrap()),
            number_type: types.erased.unwrap().number,
        };
        assert!(
            emitted.code.insts.iter().enumerate().any(|(at, inst)| {
                load(inst).is_some_and(|local| {
                    numeric_test(&emitted.code.insts, at, local, helpers.number_type)
                })
            }),
            "the numeric-union emitter and matcher have drifted apart"
        );
        let marks = emitted.code.marks.clone();
        assert!(webs(&mut emitted, 1, helpers));
        assert_eq!(emitted.code.marks, marks);
        for helper in [Some(helpers.box_number), helpers.number, helpers.tag] {
            assert!(
                !emitted
                    .code
                    .insts
                    .iter()
                    .any(|inst| calls(Some(inst), helper))
            );
        }
    }

    #[test]
    fn copies_tees_tags_and_both_numeric_representations_fold_in_place() {
        let mut insts = vec![
            op(I::LocalGet(0)),
            Inst::Call(helpers().box_number),
            op(I::LocalTee(1)),
            op(I::LocalSet(2)),
            op(I::LocalGet(2)),
            op(I::LocalTee(3)),
            Inst::Call(Func::by_hand(2)),
            op(I::Drop),
            op(I::LocalGet(3)),
            op(I::RefTestNonNull(HeapType::I31)),
            op(I::LocalGet(3)),
            op(I::RefTestNonNull(HeapType::Concrete(7))),
            op(I::I32Or),
            op(I::Drop),
        ];
        insts.extend(read(3));
        let mut b = body(insts, 3);
        let len = b.code.insts.len();
        assert!(webs(&mut b, 1, helpers()));
        assert_eq!(b.code.insts.len(), len);
        assert_eq!(b.locals.len(), 6);
        assert_eq!(&b.locals[3..], &[ValType::F64; 3]);
        assert!(!b.code.insts.iter().any(|i| matches!(i, Inst::Call(_))));
        assert!(matches!(b.code.insts[2], Inst::Op(I::LocalTee(4))));
        assert!(
            matches!(b.code.insts[5], Inst::Op(I::LocalSet(6))),
            "tag still writes the tee"
        );
        assert!(matches!(
            b.code.insts[6],
            Inst::Op(I::I32Const(erased::NUMBER))
        ));
        assert!(matches!(b.code.insts[12], Inst::Op(I::I32Const(1))));
    }

    #[test]
    fn a_guard_on_a_tee_keeps_its_assignment() {
        let mut insts = vec![
            op(I::LocalGet(0)),
            Inst::Call(helpers().box_number),
            op(I::LocalTee(1)),
            op(I::RefTestNonNull(HeapType::I31)),
            op(I::LocalGet(1)),
            op(I::RefTestNonNull(HeapType::Concrete(7))),
            op(I::I32Or),
            op(I::Drop),
        ];
        insts.extend(read(1));
        let mut b = body(insts, 1);
        assert!(webs(&mut b, 1, helpers()));
        assert!(matches!(b.code.insts[2], Inst::Op(I::LocalSet(2))));
        assert!(matches!(b.code.insts[6], Inst::Op(I::I32Const(1))));
    }

    #[test]
    fn a_default_reference_must_not_become_a_default_number() {
        let mut insts = read(1);
        insts.extend(root(1));
        insts.extend(read(1));
        rejected(body(insts, 1));
    }

    #[test]
    fn a_branch_write_must_reach_every_read() {
        let mut insts = vec![op(I::I32Const(1)), op(I::If(BlockType::Empty))];
        insts.extend(root(1));
        insts.push(op(I::End));
        insts.extend(read(1));
        rejected(body(insts, 1));
    }

    #[test]
    fn a_loop_does_not_initialize_its_first_iteration_from_a_backedge() {
        let mut insts = vec![op(I::Loop(BlockType::Empty))];
        insts.extend(read(1));
        insts.extend(root(1));
        insts.extend([op(I::I32Const(0)), op(I::BrIf(0)), op(I::End)]);
        rejected(body(insts, 1));
    }

    #[test]
    fn a_write_in_a_try_does_not_initialize_its_catch() {
        let mut insts = vec![
            op(I::Block(BlockType::Empty)),
            op(I::TryTable(
                BlockType::Empty,
                vec![Catch::All { label: 0 }].into(),
            )),
        ];
        insts.extend(root(1));
        insts.extend([op(I::End), op(I::End)]);
        insts.extend(read(1));
        rejected(body(insts, 1));
    }

    #[test]
    fn an_unreachable_default_read_does_not_reject_a_safe_web() {
        let mut insts = vec![op(I::Block(BlockType::Empty)), op(I::Br(0))];
        insts.extend(read(1));
        insts.push(op(I::End));
        insts.extend(root(1));
        insts.extend(read(1));
        let mut b = body(insts, 1);
        assert!(webs(&mut b, 1, helpers()));
    }

    #[test]
    fn an_array_store_or_unknown_call_rejects_every_connected_copy() {
        for escape in [op(I::ArraySet(7)), Inst::Call(Func::by_hand(9))] {
            let mut insts = root(1);
            insts.extend([op(I::LocalGet(1)), op(I::LocalSet(2))]);
            insts.extend(read(1));
            insts.extend([op(I::LocalGet(2)), escape]);
            rejected(body(insts, 2));
        }
    }

    #[test]
    fn a_tag_branch_with_a_non_number_consumer_keeps_its_box() {
        let mut insts = root(1);
        insts.extend([
            op(I::LocalGet(1)),
            Inst::Call(Func::by_hand(2)),
            op(I::I32Const(erased::NUMBER)),
            op(I::I32Eq),
            op(I::If(BlockType::Empty)),
        ]);
        insts.extend(read(1));
        insts.extend([
            op(I::Else),
            op(I::LocalGet(1)),
            op(I::ExternConvertAny),
            op(I::Drop),
            op(I::End),
        ]);
        rejected(body(insts, 1));
    }

    #[test]
    fn an_individual_i31_test_cannot_be_folded_as_the_numeric_union() {
        let mut insts = root(1);
        insts.extend([
            op(I::LocalGet(1)),
            op(I::RefTestNonNull(HeapType::I31)),
            op(I::Drop),
        ]);
        rejected(body(insts, 1));
    }

    #[test]
    fn mixed_producers_repeated_writes_and_outside_copies_stay_references() {
        let mut twice = root(1);
        twice.extend(root(1));
        twice.extend(read(1));
        rejected(body(twice, 1));
        let mut outside = root(1);
        outside.extend([
            op(I::LocalGet(1)),
            op(I::LocalSet(2)),
            op(I::RefNull(HeapType::ANY)),
            op(I::LocalSet(2)),
        ]);
        outside.extend(read(2));
        rejected(body(outside, 2));
        let mut cycle = vec![
            op(I::LocalGet(2)),
            op(I::LocalSet(1)),
            op(I::LocalGet(1)),
            op(I::LocalSet(2)),
        ];
        cycle.extend(read(1));
        rejected(body(cycle, 2));
    }

    #[test]
    fn independent_safe_components_still_fold_beside_an_escape() {
        let mut insts = root(1);
        insts.extend(read(1));
        insts.extend(root(2));
        insts.extend([op(I::LocalGet(2)), Inst::Call(Func::by_hand(9))]);
        let mut b = body(insts, 2);
        assert!(webs(&mut b, 1, helpers()));
        assert_eq!(b.locals.len(), 3);
        assert!(matches!(b.code.insts[1], Inst::Op(I::Nop)));
        assert!(matches!(b.code.insts[7], Inst::Call(_)));
    }
}
