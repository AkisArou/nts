//! A program function's cold regions, moved out of line.
//!
//! An `if` arm that control never leaves by its end never returns to the
//! function: it refuses, or throws past every caller. Its code is still the
//! function's bytes, and V8 inlines by bytes: AWFY's towers spent its time in
//! `moveTopDisk`, 525 bytes once its two callees were inlined into it, over
//! V8's 500 because of the two `throw new Error(...)` arms they brought. An arm
//! large enough to matter becomes a helper of its own, given the locals it
//! reads before writing, and the arm a call to it.
//!
//! Whether an arm falls out is its structure's answer, not its last
//! instruction's (`diverges`). A `!` assertion's arm builds its `TypeError`'s
//! message in an inner `if`/`else` and raises from both, so it ends in that
//! `end`: read as falling out, queens' `getRowColumn` and `setRowColumn` kept
//! three such arms each, 698 and 896 bytes that V8 declined to inline at every
//! call, and moved out they cost the row 15.4% less (889,731 -> 752,535
//! instructions/op, 2026-10-20).
//!
//! Only an arm that is a region of its own: no `return`, no branch or catch
//! label out of it, and not inside a `try_table`, where a throw could come back
//! to this function after the arm's writes, which the helper would have made
//! to its own locals.

use crate::{
    flow,
    ir::{self, Inst},
    module::{Builder, FuncKey, encoded_size},
    types::Physical,
};
use nts_semantic_schema::Origin;
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, Instruction as I, ValType};

/// The smallest arm moved out, in bytes: a one-call refusal stays.
const COLD_BYTES: usize = 24;

/// Move every program function's cold regions out of line.
pub(crate) fn program(m: &mut Builder<'_>) {
    for func in m.program_bodies() {
        let Some(body) = m.body(func) else {
            continue;
        };
        let regions = regions(body);
        if regions.is_empty() {
            continue;
        }
        let body = body.clone();
        let name = m.func_name(func).to_owned();
        let mut types: Vec<ValType> = m.signature(func).0.iter().map(|p| p.wasm()).collect();
        types.extend(&body.locals);
        let mut sites = BTreeMap::new();
        for (start, end) in regions {
            let arm = &body.code.insts[start..end];
            let (inputs, inner) = locals(arm, types.len());
            let renumbered: BTreeMap<u32, u32> = inputs
                .iter()
                .chain(&inner)
                .enumerate()
                .map(|(at, local)| (*local, u32::try_from(at).unwrap_or(u32::MAX)))
                .collect();
            let mut helper = ir::Function::new(inner.iter().map(|local| types[*local as usize]));
            for (k, inst) in arm.iter().enumerate() {
                for (_, origin) in body.code.marks.iter().filter(|(at, _)| *at == start + k) {
                    helper
                        .code
                        .marks
                        .push((helper.code.insts.len(), origin.clone()));
                }
                helper.code.insts.push(relocal(inst, &renumbered));
            }
            helper.code.insts.push(Inst::Op(I::End));
            let params = inputs
                .iter()
                .map(|local| Physical::of(types[*local as usize]))
                .collect();
            let Ok(cold) = m.helper(
                FuncKey::Cold(name.clone(), start),
                format!("cold<{name}>@{start}"),
                params,
                None,
                |_| Ok(helper),
            ) else {
                continue;
            };
            let mut site: Vec<Inst> = inputs
                .iter()
                .map(|local| Inst::Op(I::LocalGet(*local)))
                .collect();
            site.push(Inst::Call(cold));
            site.push(Inst::Op(I::Unreachable));
            sites.insert(start, (end, site));
        }
        if !sites.is_empty() {
            m.replace_body(func, splice(&body, &sites));
        }
    }
}

/// `body` with each region `start..end` replaced by its call site; a mark
/// inside a region went with it to the helper.
fn splice(body: &ir::Function, sites: &BTreeMap<usize, (usize, Vec<Inst>)>) -> ir::Function {
    let mut out = ir::Function::new(body.locals.clone());
    let mut moved: Vec<Option<usize>> = Vec::with_capacity(body.code.insts.len() + 1);
    let mut at = 0;
    while at < body.code.insts.len() {
        if let Some((end, site)) = sites.get(&at) {
            moved.push(Some(out.code.insts.len()));
            moved.extend(std::iter::repeat_n(None, end - at - 1));
            out.code.insts.extend(site.iter().cloned());
            at = *end;
            continue;
        }
        moved.push(Some(out.code.insts.len()));
        out.code.insts.push(body.code.insts[at].clone());
        at += 1;
    }
    moved.push(Some(out.code.insts.len()));
    out.code.marks = body
        .code
        .marks
        .iter()
        .filter_map(|(at, origin): &(usize, Origin)| moved[*at].map(|to| (to, origin.clone())))
        .collect();
    out
}

/// The then-arms of the body's `if`s that are cold regions, outermost first
/// and never one inside another, as instruction ranges.
fn regions(body: &ir::Function) -> Vec<(usize, usize)> {
    let insts = &body.code.insts;
    let ends = flow::matching_ends(&body.code);
    let mut found = Vec::new();
    // Each open structure: whether it is a `try_table`.
    let mut open: Vec<bool> = Vec::new();
    let mut covered = 0;
    for (at, inst) in insts.iter().enumerate() {
        match inst {
            Inst::Op(I::If(BlockType::Empty)) => {
                if at >= covered && !open.iter().any(|tried| *tried) {
                    let end = ends[at];
                    let arm_end = else_of(insts, at + 1, end).unwrap_or(end);
                    let arm = &insts[at + 1..arm_end];
                    if contained(arm) && diverges(arm) && bytes(arm) >= COLD_BYTES {
                        found.push((at + 1, arm_end));
                        covered = arm_end;
                    }
                }
                open.push(false);
            }
            Inst::Op(I::Block(_) | I::Loop(_)) => open.push(false),
            Inst::Op(I::TryTable(..)) => open.push(true),
            Inst::Op(I::End) => {
                open.pop();
            }
            _ => {}
        }
    }
    found
}

/// The `else` of the `if` whose arm starts at `from` and whose `end` is at
/// `end`, if it has one.
fn else_of(insts: &[Inst], from: usize, end: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (at, inst) in insts.iter().enumerate().take(end).skip(from) {
        match inst {
            Inst::Op(I::Block(_) | I::Loop(_) | I::If(_) | I::TryTable(..)) => depth += 1,
            Inst::Op(I::End) => depth = depth.saturating_sub(1),
            Inst::Op(I::Else) if depth == 0 => return Some(at),
            _ => {}
        }
    }
    None
}

/// Whether control never reaches the end of `arm`, which `contained` keeps to
/// itself: it ends in `unreachable` or a throw, or in a structure it opened
/// that nothing leaves by its end -- an `if` neither of whose arms falls out
/// and after which no branch lands.
fn diverges(arm: &[Inst]) -> bool {
    /// What an open structure is: a branch to a loop lands at its start, and
    /// an `if` with no `else` falls out whenever it is entered.
    #[derive(PartialEq)]
    enum Shape {
        Block,
        Loop,
        If,
        IfElse,
    }
    /// An open structure: whether control reaches its end by a branch or by
    /// falling out of an arm, and whether control reached the structure.
    struct Open {
        shape: Shape,
        reached: bool,
        entered: bool,
    }
    fn land(open: &mut [Open], label: u32) {
        if let Some(at) = open.len().checked_sub(1 + label as usize)
            && open[at].shape != Shape::Loop
        {
            open[at].reached = true;
        }
    }
    let mut open: Vec<Open> = Vec::new();
    let mut live = true;
    for inst in arm {
        let op = match inst {
            Inst::Throw(_) => {
                live = false;
                continue;
            }
            Inst::Op(op) => op,
            _ => continue,
        };
        match op {
            I::Block(_) | I::Loop(_) | I::If(_) | I::TryTable(..) => {
                if let I::TryTable(_, catches) = op
                    && live
                {
                    for catch in catches.iter() {
                        let (wasm_encoder::Catch::One { label, .. }
                        | wasm_encoder::Catch::OneRef { label, .. }
                        | wasm_encoder::Catch::All { label }
                        | wasm_encoder::Catch::AllRef { label }) = catch;
                        land(&mut open, *label);
                    }
                }
                open.push(Open {
                    shape: match op {
                        I::Loop(_) => Shape::Loop,
                        I::If(_) => Shape::If,
                        _ => Shape::Block,
                    },
                    reached: false,
                    entered: live,
                });
            }
            I::Else => {
                if let Some(top) = open.last_mut() {
                    top.reached |= live;
                    top.shape = Shape::IfElse;
                    live = top.entered;
                }
            }
            I::End => {
                if let Some(top) = open.pop() {
                    live = live || top.reached || (top.shape == Shape::If && top.entered);
                }
            }
            I::Br(label) => {
                if live {
                    land(&mut open, *label);
                }
                live = false;
            }
            I::BrIf(label)
            | I::BrOnNull(label)
            | I::BrOnNonNull(label)
            | I::BrOnCast {
                relative_depth: label,
                ..
            }
            | I::BrOnCastFail {
                relative_depth: label,
                ..
            } => {
                if live {
                    land(&mut open, *label);
                }
            }
            I::BrTable(targets, default) => {
                if live {
                    for label in targets.iter().chain(std::iter::once(default)) {
                        land(&mut open, *label);
                    }
                }
                live = false;
            }
            I::Unreachable | I::Return | I::ThrowRef => live = false,
            _ => {}
        }
    }
    !live
}

/// Whether control leaves `arm` only by its end: no `return`, and every branch
/// and catch label lands on a structure the arm opened.
fn contained(arm: &[Inst]) -> bool {
    let mut depth = 0u32;
    let inside = |label: u32, depth: u32| label < depth;
    for inst in arm {
        let Inst::Op(i) = inst else {
            continue;
        };
        let ok = match i {
            I::Block(_) | I::Loop(_) | I::If(_) => {
                depth += 1;
                true
            }
            I::TryTable(_, catches) => {
                let caught = catches.iter().all(|catch| {
                    let (wasm_encoder::Catch::One { label, .. }
                    | wasm_encoder::Catch::OneRef { label, .. }
                    | wasm_encoder::Catch::All { label }
                    | wasm_encoder::Catch::AllRef { label }) = catch;
                    inside(*label, depth)
                });
                depth += 1;
                caught
            }
            I::End => {
                depth = depth.saturating_sub(1);
                true
            }
            I::Br(label)
            | I::BrIf(label)
            | I::BrOnNull(label)
            | I::BrOnNonNull(label)
            | I::BrOnCast {
                relative_depth: label,
                ..
            }
            | I::BrOnCastFail {
                relative_depth: label,
                ..
            } => inside(*label, depth),
            I::BrTable(targets, default) => targets
                .iter()
                .chain(std::iter::once(default))
                .all(|label| inside(*label, depth)),
            I::Return => false,
            _ => true,
        };
        if !ok {
            return false;
        }
    }
    true
}

/// An arm's size as code, near enough for a threshold.
fn bytes(arm: &[Inst]) -> usize {
    let mut probe = ir::Function::default();
    probe.code.insts = arm.to_vec();
    encoded_size(&probe)
}

/// The arm's inputs -- every local some path through `arm` reads before it is
/// written there, which is `inline::unwritten_reads` over the arm with nothing
/// written at its entry -- and the rest of the locals it uses, each in the
/// order the arm first meets it, among the function's `count` locals.
///
/// Not textual order: a local an inner `if` writes on one branch and the arm
/// reads after the join is written first in the text, and on the other path
/// is the caller's value, which only a parameter carries.
fn locals(arm: &[Inst], count: usize) -> (Vec<u32>, Vec<u32>) {
    let mut probe = ir::Function::new(std::iter::repeat_n(ValType::I32, count));
    probe.code.insts = arm.to_vec();
    probe.code.insts.push(Inst::Op(I::End));
    let unwritten = crate::inline::unwritten_reads(&probe, 0);
    let mut inputs = Vec::new();
    let mut inner = Vec::new();
    for inst in arm {
        let Inst::Op(I::LocalGet(local) | I::LocalSet(local) | I::LocalTee(local)) = inst else {
            continue;
        };
        if inputs.contains(local) || inner.contains(local) {
            continue;
        }
        if unwritten.contains(local) {
            inputs.push(*local);
        } else {
            inner.push(*local);
        }
    }
    (inputs, inner)
}

/// An instruction of the arm, its locals renumbered for the helper.
fn relocal(inst: &Inst, renumbered: &BTreeMap<u32, u32>) -> Inst {
    let to = |local: &u32| renumbered[local];
    match inst {
        Inst::Op(I::LocalGet(local)) => Inst::Op(I::LocalGet(to(local))),
        Inst::Op(I::LocalSet(local)) => Inst::Op(I::LocalSet(to(local))),
        Inst::Op(I::LocalTee(local)) => Inst::Op(I::LocalTee(to(local))),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::module::Func;

    /// `if (local 0) { <arm> }` in a body, with `end` after it.
    fn body_with(arm: &[I<'static>]) -> ir::Function {
        let mut body = ir::Function::new([ValType::I32, ValType::I32]);
        body.code
            .instructions(&[I::LocalGet(0), I::If(BlockType::Empty)]);
        for inst in arm {
            if let I::Call(_) = inst {
                body.code.call(Func::by_hand(7));
            } else {
                body.code.instruction(inst);
            }
        }
        body.code.instructions(&[I::End, I::End]);
        body
    }

    /// An arm that builds something from two locals and never returns, 28
    /// bytes: the write and the read of local 2 kept apart, so the IR does not
    /// fuse them into a tee.
    fn throwing() -> Vec<I<'static>> {
        vec![
            I::LocalGet(1),
            I::I32Const(1000),
            I::I32Add,
            I::LocalSet(2),
            I::Nop,
            I::LocalGet(2),
            I::LocalGet(0),
            I::I32Mul,
            I::I32Const(100_000),
            I::I32Add,
            I::I32Const(100_000),
            I::I32Add,
            I::Drop,
            I::Call(0),
            I::Unreachable,
        ]
    }

    #[test]
    fn an_arm_that_never_returns_is_a_region() {
        let body = body_with(&throwing());
        assert_eq!(regions(&body), vec![(2, 17)]);
        let (inputs, inner) = locals(&body.code.insts[2..17], 3);
        assert_eq!(inputs, vec![1, 0], "read first, in the order met");
        assert_eq!(inner, vec![2], "written first");
    }

    #[test]
    fn an_arm_that_branches_out_is_not() {
        let mut arm = throwing();
        arm.insert(0, I::Br(0));
        assert_eq!(regions(&body_with(&arm)), [] as [(usize, usize); 0]);
    }

    #[test]
    fn an_arm_inside_a_try_table_is_not() {
        let mut body = ir::Function::new([ValType::I32]);
        body.code.instruction(&I::TryTable(
            BlockType::Empty,
            std::borrow::Cow::Owned(vec![wasm_encoder::Catch::All { label: 0 }]),
        ));
        let inner = body_with(&throwing());
        body.code.insts.extend(inner.code.insts);
        body.code.instructions(&[I::End]);
        assert_eq!(regions(&body), [] as [(usize, usize); 0]);
    }

    /// `throwing`'s work, then an `if`/`else` on local 0 whose arms are `then`
    /// and `otherwise`: the shape of a `!` assertion's `TypeError` arm.
    fn ending_in_if(then: &[I<'static>], otherwise: &[I<'static>]) -> Vec<I<'static>> {
        let mut arm = throwing();
        arm.truncate(arm.len() - 2);
        arm.extend([I::LocalGet(0), I::If(BlockType::Empty)]);
        arm.extend_from_slice(then);
        arm.push(I::Else);
        arm.extend_from_slice(otherwise);
        arm.push(I::End);
        arm
    }

    #[test]
    fn an_arm_whose_last_if_raises_on_both_arms_is_a_region() {
        let arm = ending_in_if(&[I::Call(0), I::Unreachable], &[I::Call(0), I::Unreachable]);
        let end = 2 + arm.len();
        assert_eq!(regions(&body_with(&arm)), vec![(2, end)]);
    }

    #[test]
    fn an_arm_whose_last_if_can_fall_out_is_not() {
        let arm = ending_in_if(&[I::Call(0), I::Unreachable], &[I::Nop]);
        assert_eq!(regions(&body_with(&arm)), [] as [(usize, usize); 0]);
    }

    /// Both arms raise, but a branch leaves the inner `if` before either does,
    /// so control can reach its end and fall out of the arm.
    #[test]
    fn an_arm_a_branch_leaves_an_inner_if_of_is_not() {
        let arm = ending_in_if(
            &[I::LocalGet(1), I::BrIf(0), I::Call(0), I::Unreachable],
            &[I::Call(0), I::Unreachable],
        );
        assert_eq!(regions(&body_with(&arm)), [] as [(usize, usize); 0]);
    }

    #[test]
    fn a_small_arm_is_not() {
        assert_eq!(
            regions(&body_with(&[I::Call(0), I::Unreachable])),
            [] as [(usize, usize); 0]
        );
    }

    #[test]
    fn the_region_becomes_its_inputs_and_a_call() {
        let body = body_with(&throwing());
        let site = vec![
            Inst::Op(I::LocalGet(1)),
            Inst::Op(I::LocalGet(0)),
            Inst::Call(Func::by_hand(9)),
            Inst::Op(I::Unreachable),
        ];
        let spliced = splice(&body, &BTreeMap::from([(2, (17, site.clone()))]));
        assert_eq!(spliced.code.insts.len(), 2 + site.len() + 2);
        assert!(matches!(spliced.code.insts[4], Inst::Call(_)));
    }

    /// A local an inner `if` writes on one branch and the arm reads after the
    /// join: written first in the text, and on the other path the caller's,
    /// so an input.
    #[test]
    fn a_local_written_on_one_inner_branch_is_an_input() {
        let arm = [
            I::LocalGet(0),
            I::If(BlockType::Empty),
            I::I32Const(5),
            I::LocalSet(1),
            I::End,
            I::Nop,
            I::LocalGet(1),
            I::Drop,
            I::Unreachable,
        ];
        let mut code = ir::Function::new([ValType::I32, ValType::I32]);
        code.code.instructions(&arm);
        let (inputs, inner) = locals(&code.code.insts, 2);
        assert_eq!(inputs, vec![0, 1]);
        assert_eq!(inner, [] as [u32; 0]);
    }
}
