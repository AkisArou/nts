//! Calls in tail position become `return_call`, after the inliner and the
//! outliner have done with the bodies.
//!
//! A JavaScript function that returns another's call, in strict code, does
//! not grow the stack: test262's `tco-*` recurse 100,000 deep that way. C
//! passes them because clang turns such a call into a jump. V8 does it for a
//! `return_call` and never for a `call`, which ran out of stack. Done last,
//! so the inliner still sees, and may inline, every call: a `return_call`
//! is for the calls that stay calls.
//!
//! A call is in tail position when what follows it only returns its result:
//! `return` at once, or its result set into a local and control carried --
//! by `br` to a block's end, `else` past its `if`, or `end` -- to a
//! `local.get` of that local and `return`, the way an HIR jump into a block
//! that returns its parameter is structured. It becomes `return_call` when
//! the callee is a defined function whose result is the caller's own, and no
//! `try_table` encloses it: a tail call would leave the handler behind. What
//! follows a `return_call` stays, unreachable and valid on the polymorphic
//! stack, so no instruction moves under the source marks.

use crate::ir::Inst;
use crate::module::{Builder, Func};
use wasm_encoder::Instruction as I;

pub(crate) fn program(m: &mut Builder<'_>) {
    for func in m.program_bodies() {
        let Some(body) = m.body(func) else {
            continue;
        };
        let own = m.signature(func).1;
        let mut body = body.clone();
        let eligible = |callee: Func| m.body(callee).is_some() && m.signature(callee).1 == own;
        if rewrite(&mut body.code.insts, eligible) {
            m.replace_body(func, body);
        }
    }
}

/// Make each eligible call in tail position a `return_call`, and say whether
/// any was.
fn rewrite(insts: &mut [Inst], eligible: impl Fn(Func) -> bool) -> bool {
    let ends = ends(insts);
    // The constructs open at each instruction: where each starts.
    let mut open: Vec<usize> = Vec::new();
    let mut changed = false;
    for at in 0..insts.len() {
        match &insts[at] {
            Inst::Op(I::Block(_) | I::Loop(_) | I::If(_) | I::TryTable(..)) => open.push(at),
            Inst::Op(I::End) => {
                open.pop();
            }
            &Inst::Call(callee)
                if !open
                    .iter()
                    .any(|&start| matches!(insts[start], Inst::Op(I::TryTable(..))))
                    && eligible(callee)
                    && returns(insts, &ends, at, &open) =>
            {
                insts[at] = Inst::ReturnCall(callee);
                changed = true;
            }
            _ => {}
        }
    }
    changed
}

/// Each construct's matching `end`, by where it starts; an `else` maps to its
/// `if`'s end too.
fn ends(insts: &[Inst]) -> Vec<Option<usize>> {
    let mut ends = vec![None; insts.len()];
    let mut open: Vec<usize> = Vec::new();
    for (at, inst) in insts.iter().enumerate() {
        match inst {
            Inst::Op(I::Block(_) | I::Loop(_) | I::If(_) | I::TryTable(..)) => open.push(at),
            Inst::Op(I::End) => {
                if let Some(start) = open.pop() {
                    ends[start] = Some(at);
                }
            }
            _ => {}
        }
    }
    ends
}

/// Whether what follows the call at `at`, inside the constructs `open`
/// starts, only returns its result.
fn returns(insts: &[Inst], ends: &[Option<usize>], at: usize, open: &[usize]) -> bool {
    match insts.get(at + 1..) {
        Some([Inst::Op(I::Return), ..] | [Inst::Op(I::LocalTee(_)), Inst::Op(I::Return), ..]) => {
            true
        }
        Some([Inst::Op(I::LocalSet(local)), ..]) => {
            let local = *local;
            let mut open = open.to_vec();
            let mut p = at + 2;
            // Each step leaves a construct, so the walk ends.
            loop {
                match insts.get(p..) {
                    Some([Inst::Op(I::LocalGet(read)), Inst::Op(I::Return), ..]) => {
                        return *read == local;
                    }
                    Some([Inst::Op(I::Br(depth)), ..]) => {
                        let Some(at) = open.len().checked_sub(1 + *depth as usize) else {
                            return false;
                        };
                        let target = open[at];
                        if matches!(insts[target], Inst::Op(I::Loop(_))) {
                            return false;
                        }
                        let Some(end) = ends[target] else {
                            return false;
                        };
                        open.truncate(at);
                        p = end + 1;
                    }
                    Some([Inst::Op(I::Else), ..]) => {
                        let Some(end) = open.pop().and_then(|start| ends[start]) else {
                            return false;
                        };
                        p = end + 1;
                    }
                    Some([Inst::Op(I::End), ..]) => {
                        if open.pop().is_none() {
                            return false;
                        }
                        p += 1;
                    }
                    _ => return false,
                }
            }
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_encoder::{BlockType, Catch};

    fn tail(mut insts: Vec<Inst>) -> Vec<Inst> {
        rewrite(&mut insts, |_| true);
        insts
    }

    fn is_tail(inst: &Inst) -> bool {
        matches!(inst, Inst::ReturnCall(_))
    }

    #[test]
    fn a_call_returned_at_once_is_a_tail_call() {
        let insts = tail(vec![Inst::Call(Func::by_hand(1)), Inst::Op(I::Return)]);
        assert!(is_tail(&insts[0]));
    }

    /// `call; local.set; br` out of a block whose end reads the local back
    /// and returns it: an HIR jump into a block that returns its parameter.
    #[test]
    fn a_call_carried_to_a_return_through_a_block_is_a_tail_call() {
        let insts = tail(vec![
            Inst::Op(I::Block(BlockType::Empty)),
            Inst::Call(Func::by_hand(1)),
            Inst::Op(I::LocalSet(3)),
            Inst::Op(I::Br(0)),
            Inst::Op(I::End),
            Inst::Op(I::LocalGet(3)),
            Inst::Op(I::Return),
        ]);
        assert!(is_tail(&insts[1]));
    }

    /// A handler around the call is the caller's, which a tail call leaves.
    #[test]
    fn a_call_inside_a_try_table_keeps_its_frame() {
        let insts = tail(vec![
            Inst::Op(I::TryTable(
                BlockType::Empty,
                std::borrow::Cow::Owned(vec![Catch::All { label: 0 }]),
            )),
            Inst::Call(Func::by_hand(1)),
            Inst::Op(I::Return),
            Inst::Op(I::End),
        ]);
        assert!(!is_tail(&insts[1]));
    }

    /// A branch to a loop goes around again: the call is not the last thing.
    #[test]
    fn a_call_carried_back_to_a_loop_is_not_in_tail_position() {
        let insts = tail(vec![
            Inst::Op(I::Loop(BlockType::Empty)),
            Inst::Call(Func::by_hand(1)),
            Inst::Op(I::LocalSet(3)),
            Inst::Op(I::Br(0)),
            Inst::Op(I::End),
            Inst::Op(I::LocalGet(3)),
            Inst::Op(I::Return),
        ]);
        assert!(!is_tail(&insts[1]));
    }

    #[test]
    fn a_call_whose_result_is_used_is_not_in_tail_position() {
        let insts = tail(vec![
            Inst::Call(Func::by_hand(1)),
            Inst::Op(I::I32Const(1)),
            Inst::Op(I::I32Add),
            Inst::Op(I::Return),
        ]);
        assert!(!is_tail(&insts[0]));
    }
}
