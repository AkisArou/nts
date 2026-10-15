//! An integer widened to `f64` and truncated back is the integer, after the
//! inliner has put the widening and the truncation in one body.
//!
//! A function of `(x: number) => number` takes and answers an `f64`, and a
//! caller holding an integer converts it to call one; the body's integer
//! arithmetic truncates it straight back, and the caller truncates the answer.
//! Inlined, that is `f64.convert_i32_s` then `i32.trunc_sat_f64_s` of the same
//! value, through a local or across the inlined body's block. V8 does not fold
//! the pair: `module-closures` ran its three loops in 118 us against node's 5.4,
//! and the same loop written without the closure in 2.8. Folded by hand, the
//! closure's loop ran in 2.8 too. clang folds it for C, which is why C's row
//! matched C++.
//!
//! Two shapes, each folded only where every value involved is such a
//! widening:
//! - **A web of locals.** An `f64` local written once, from
//!   `f64.convert_i32_s` or from a copy of another such local, and read only
//!   by `i32.trunc_sat_f64_s` or by copying into another, holds an integer: it
//!   is moved to a fresh `i32` local, the widening and the truncations
//!   become `nop`. A local read before its write reads its default, `0.0`,
//!   where the `i32` reads `0`: the same integer.
//! - **A block's result.** A `block (result f64)` every exit of which carries
//!   `f64.convert_i32_s`, followed at once by `i32.trunc_sat_f64_s`, answers
//!   the integer: its type becomes `i32`, the widenings and the truncation
//!   `nop`.
//!
//! Nothing moves: an instruction is replaced by another or by `nop`, so the
//! source marks keep their positions.

use crate::ir::{Function, Inst};
use crate::module::{Builder, index};
use std::collections::{BTreeMap, BTreeSet};
use wasm_encoder::{BlockType, Instruction as I, ValType};

pub(crate) fn program(m: &mut Builder<'_>) {
    for func in m.program_bodies() {
        let Some(body) = m.body(func) else {
            continue;
        };
        let params = m.signature(func).0.len();
        let mut body = body.clone();
        let blocks = results(&mut body.code.insts);
        let locals = webs(&mut body, params);
        if blocks || locals {
            m.replace_body(func, body);
        }
    }
}

fn op(inst: &Inst) -> Option<&I<'static>> {
    match inst {
        Inst::Op(i) => Some(i),
        _ => None,
    }
}

fn truncates(inst: Option<&Inst>) -> bool {
    matches!(
        inst.and_then(op),
        Some(I::I32TruncSatF64S | I::I32TruncF64S)
    )
}

fn widens(inst: Option<&Inst>) -> bool {
    matches!(inst.and_then(op), Some(I::F64ConvertI32S))
}

/// Fold each `block (result f64)` that answers a widened integer and is
/// truncated at once; say whether any was.
fn results(insts: &mut [Inst]) -> bool {
    let mut changed = false;
    for start in 0..insts.len() {
        if !matches!(
            op(&insts[start]),
            Some(I::Block(BlockType::Result(ValType::F64)))
        ) {
            continue;
        }
        let Some(exits) = exits(insts, start) else {
            continue;
        };
        for at in exits.widenings {
            insts[at] = Inst::Op(I::Nop);
        }
        insts[start] = Inst::Op(I::Block(BlockType::Result(ValType::I32)));
        insts[exits.end + 1] = Inst::Op(I::Nop);
        changed = true;
    }
    changed
}

/// The widenings carried out of the block at `start`, and its `end`: none
/// unless every exit carries one and a truncation follows the `end`.
struct Exits {
    widenings: Vec<usize>,
    end: usize,
}

fn exits(insts: &[Inst], start: usize) -> Option<Exits> {
    let mut depth = 0_u32;
    let mut widenings = Vec::new();
    for at in start + 1..insts.len() {
        match &insts[at] {
            Inst::Op(I::Block(_) | I::Loop(_) | I::If(_)) => depth += 1,
            // A handler may land on this block's label with what it caught.
            Inst::Op(I::TryTable(..)) => return None,
            Inst::Op(I::End) if depth == 0 => {
                let falls = !matches!(
                    insts.get(at - 1).and_then(op),
                    Some(I::Unreachable | I::Br(_) | I::Return)
                );
                if falls {
                    if !widens(insts.get(at - 1)) {
                        return None;
                    }
                    widenings.push(at - 1);
                }
                return truncates(insts.get(at + 1)).then_some(Exits { widenings, end: at });
            }
            Inst::Op(I::End) => depth -= 1,
            Inst::Op(I::Br(label)) if *label == depth => {
                if !widens(insts.get(at - 1)) {
                    return None;
                }
                widenings.push(at - 1);
            }
            // A conditional or computed branch to this block carries its value
            // under the condition or beside other targets: not folded.
            Inst::Op(
                I::BrIf(label)
                | I::BrTable(.., label)
                | I::BrOnNull(label)
                | I::BrOnNonNull(label)
                | I::BrOnCast {
                    relative_depth: label,
                    ..
                },
            ) if *label == depth => return None,
            Inst::Op(I::BrTable(labels, _)) if labels.contains(&depth) => {
                return None;
            }
            _ => {}
        }
    }
    None
}

/// Move each web of widened-integer `f64` locals to `i32` locals; say whether
/// any was.
fn webs(body: &mut Function, params: usize) -> bool {
    let insts = &body.code.insts;
    // Where each local is written, and how.
    let mut writes: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    let mut reads: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    for (at, inst) in insts.iter().enumerate() {
        match op(inst) {
            Some(I::LocalSet(local) | I::LocalTee(local)) => {
                writes.entry(*local).or_default().push(at);
            }
            Some(I::LocalGet(local)) => reads.entry(*local).or_default().push(at),
            _ => {}
        }
    }
    let local_type = |local: u32| -> Option<ValType> {
        let at = (local as usize).checked_sub(params)?;
        body.locals.get(at).copied()
    };
    // Candidates: declared `f64` locals written once, by a `local.set` of a
    // widening or of another local's read.
    let mut web: BTreeSet<u32> = writes
        .iter()
        .filter(|(local, sets)| {
            local_type(**local) == Some(ValType::F64)
                && sets.len() == 1
                && matches!(op(&insts[sets[0]]), Some(I::LocalSet(_)))
                && sets[0] > 0
                && (widens(insts.get(sets[0] - 1))
                    || matches!(op(&insts[sets[0] - 1]), Some(I::LocalGet(_))))
        })
        .map(|(local, _)| *local)
        .collect();
    // Strike, until none is struck, a local copied from outside the web, or
    // read other than by a truncation or a copy into the web.
    loop {
        let struck: Vec<u32> = web
            .iter()
            .copied()
            .filter(|local| {
                let set = writes[local][0];
                let from_outside = matches!(
                    op(&insts[set - 1]),
                    Some(I::LocalGet(source)) if !web.contains(source)
                );
                let read_otherwise = reads.get(local).into_iter().flatten().any(|&at| {
                    !truncates(insts.get(at + 1))
                        && !matches!(
                            insts.get(at + 1).and_then(op),
                            Some(I::LocalSet(target)) if web.contains(target)
                        )
                });
                from_outside || read_otherwise
            })
            .collect();
        if struck.is_empty() {
            break;
        }
        for local in struck {
            web.remove(&local);
        }
    }
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
        .extend(std::iter::repeat_n(ValType::I32, moved.len()));
    let insts = &mut body.code.insts;
    for (&local, &to) in &moved {
        let set = writes[&local][0];
        if widens(insts.get(set - 1)) {
            insts[set - 1] = Inst::Op(I::Nop);
        }
        insts[set] = Inst::Op(I::LocalSet(to));
        for &at in reads.get(&local).into_iter().flatten() {
            insts[at] = Inst::Op(I::LocalGet(to));
            if truncates(insts.get(at + 1)) {
                insts[at + 1] = Inst::Op(I::Nop);
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(i: I<'static>) -> Inst {
        Inst::Op(i)
    }

    /// `x` (param 0, `i32`) widened into local 1, copied into local 2 as an
    /// inlined argument, and truncated twice: the web moves to `i32` locals.
    #[test]
    fn a_widened_argument_truncated_in_the_inlined_body_is_the_integer() {
        let mut body = Function::new([ValType::F64, ValType::F64]);
        body.code.insts = vec![
            op(I::LocalGet(0)),
            op(I::F64ConvertI32S),
            op(I::LocalSet(1)),
            op(I::LocalGet(1)),
            op(I::LocalSet(2)),
            op(I::LocalGet(2)),
            op(I::I32TruncSatF64S),
            op(I::LocalGet(2)),
            op(I::I32TruncSatF64S),
            op(I::I32Add),
            op(I::Drop),
        ];
        let before = body.code.insts.len();
        assert!(webs(&mut body, 1));
        assert_eq!(
            body.code.insts.len(),
            before,
            "nothing moves under the marks"
        );
        assert_eq!(
            body.locals,
            [ValType::F64, ValType::F64, ValType::I32, ValType::I32]
        );
        let ops: Vec<_> = body
            .code
            .insts
            .iter()
            .filter_map(super::op)
            .cloned()
            .collect();
        assert!(
            !ops.iter()
                .any(|i| matches!(i, I::F64ConvertI32S | I::I32TruncSatF64S))
        );
        assert!(
            ops.iter().any(|i| matches!(i, I::LocalSet(3)))
                && ops.iter().any(|i| matches!(i, I::LocalSet(4)))
        );
    }

    /// The widened value also feeds an `f64` addition: it stays a float.
    #[test]
    fn a_widened_local_read_as_a_float_is_kept() {
        let mut body = Function::new([ValType::F64]);
        body.code.insts = vec![
            op(I::LocalGet(0)),
            op(I::F64ConvertI32S),
            op(I::LocalSet(1)),
            op(I::LocalGet(1)),
            op(I::I32TruncSatF64S),
            op(I::Drop),
            op(I::LocalGet(1)),
            op(I::LocalGet(1)),
            op(I::F64Add),
            op(I::Drop),
        ];
        let kept = body.code.insts.clone();
        assert!(!webs(&mut body, 1));
        assert_eq!(body.code.insts.len(), kept.len());
        assert_eq!(body.locals, [ValType::F64]);
    }

    /// A local written twice, as a loop's carried value is, is not a web.
    #[test]
    fn a_local_written_twice_is_kept() {
        let mut body = Function::new([ValType::F64]);
        body.code.insts = vec![
            op(I::LocalGet(0)),
            op(I::F64ConvertI32S),
            op(I::LocalSet(1)),
            op(I::F64Const(1.5.into())),
            op(I::LocalSet(1)),
            op(I::LocalGet(1)),
            op(I::I32TruncSatF64S),
            op(I::Drop),
        ];
        assert!(!webs(&mut body, 1));
    }

    /// An inlined body's block answers a widened integer at its `br` and is
    /// truncated after its `end`: it answers the integer.
    #[test]
    fn a_block_answering_a_widened_integer_answers_the_integer() {
        let mut insts = vec![
            op(I::Block(BlockType::Result(ValType::F64))),
            op(I::LocalGet(0)),
            op(I::F64ConvertI32S),
            op(I::Br(0)),
            op(I::Unreachable),
            op(I::End),
            op(I::I32TruncSatF64S),
            op(I::Drop),
        ];
        assert!(results(&mut insts));
        assert!(matches!(
            insts[0],
            Inst::Op(I::Block(BlockType::Result(ValType::I32)))
        ));
        assert!(matches!(insts[2], Inst::Op(I::Nop)));
        assert!(matches!(insts[6], Inst::Op(I::Nop)));
    }

    /// One exit answers a float that is not a widening: the block is kept.
    #[test]
    fn a_block_with_a_float_exit_is_kept() {
        let mut insts = vec![
            op(I::Block(BlockType::Result(ValType::F64))),
            op(I::LocalGet(0)),
            op(I::If(BlockType::Empty)),
            op(I::LocalGet(1)),
            op(I::F64ConvertI32S),
            op(I::Br(1)),
            op(I::End),
            op(I::F64Const(0.5.into())),
            op(I::End),
            op(I::I32TruncSatF64S),
            op(I::Drop),
        ];
        assert!(!results(&mut insts));
        assert!(matches!(
            insts[0],
            Inst::Op(I::Block(BlockType::Result(ValType::F64)))
        ));
    }

    /// A conditional branch to the block carries its value under the condition.
    #[test]
    fn a_block_left_by_br_if_is_kept() {
        let mut insts = vec![
            op(I::Block(BlockType::Result(ValType::F64))),
            op(I::LocalGet(0)),
            op(I::F64ConvertI32S),
            op(I::LocalGet(1)),
            op(I::BrIf(0)),
            op(I::Drop),
            op(I::LocalGet(0)),
            op(I::F64ConvertI32S),
            op(I::End),
            op(I::I32TruncSatF64S),
            op(I::Drop),
        ];
        assert!(!results(&mut insts));
    }
}
