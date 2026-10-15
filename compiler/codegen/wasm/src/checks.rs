//! A null check a path has already made, dropped.
//!
//! Every field a method reads or writes of a value that may be null is a named
//! refusal of null, and most of them are of the same value: AWFY's bounce read
//! and wrote `this` twenty-one times in `Ball#bounce`, and checked it each
//! time, 210 of the method's 533 bytes -- the bytes V8 and the inliner decide
//! by. A check of a local that every path to it has already checked, with no
//! write to the local since, refuses nothing the first did not: the first one
//! stands, and with it the refusal's name and place.

use crate::{
    flow::{self, Flow},
    ir::{Code, Inst},
};
use std::collections::BTreeSet;
use wasm_encoder::{BlockType, Instruction as I};

/// Drop the null checks of `code` that repeat one already made on every path,
/// over its `locals`, parameters included.
pub(crate) fn drop_repeated(code: &mut Code, locals: usize) {
    let mut checks = Checks {
        insts: &code.insts,
        repeated: BTreeSet::new(),
    };
    flow::run(code, vec![false; locals], &mut checks);
    let repeated: BTreeSet<usize> = checks
        .repeated
        .iter()
        .flat_map(|at| *at..*at + CHECK)
        .collect();
    if !repeated.is_empty() {
        code.rewrite(|at, inst| (!repeated.contains(&at)).then_some(inst));
    }
}

/// The length of a null check: `local.get`, `ref.is_null`, and an `if` whose
/// only arm calls a refusal and never returns.
const CHECK: usize = 6;

/// Whether the instructions from `at` are a null check of the local read
/// there.
fn is_check(insts: &[Inst], at: usize) -> bool {
    matches!(
        insts.get(at + 1..at + CHECK),
        Some([
            Inst::Op(I::RefIsNull),
            Inst::Op(I::If(BlockType::Empty)),
            Inst::Call(_),
            Inst::Op(I::Unreachable),
            Inst::Op(I::End),
        ])
    )
}

/// Each local's flag: it holds a value a check has passed, unwritten since.
struct Checks<'a> {
    insts: &'a [Inst],
    repeated: BTreeSet<usize>,
}

impl Flow for Checks<'_> {
    fn step(&mut self, at: usize, inst: &Inst, holds: &mut [bool]) {
        match inst {
            Inst::Op(I::LocalGet(local)) if is_check(self.insts, at) => {
                let local = *local as usize;
                if holds[local] {
                    self.repeated.insert(at);
                }
                // The arm refuses and never returns, so every path past the
                // check holds the value non-null.
                holds[local] = true;
            }
            // A tee writes a new value, which a check right after it passes.
            Inst::Op(I::LocalTee(local)) => holds[*local as usize] = is_check(self.insts, at),
            Inst::Op(I::LocalSet(local)) => holds[*local as usize] = false,
            _ => {}
        }
    }

    /// A loop starts over: a check inside it is kept unless the same iteration
    /// has made it. Sound would be to forget only what the loop writes, but V8
    /// does not carry a check made before a loop into it, and the explicit one
    /// is what lets it drop its own null handling from the loop's accesses:
    /// AWFY's sieve ran 15-20% slower when its inner loop lost the check of
    /// the array the outer loop had already made.
    fn header(&mut self, _start: usize, _end: usize, holds: &mut [bool]) {
        holds.fill(false);
    }

    /// A catch arrives from a throw anywhere in its try, after any write the
    /// try makes, so it starts over too.
    fn caught(&mut self, _start: usize, _end: usize, holds: &mut [bool]) {
        holds.fill(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::module::{Func, Tag};

    /// A null check of `local`, refusing through a stand-in helper.
    fn check(code: &mut Code, local: u32) {
        code.instructions(&[I::LocalGet(local), I::RefIsNull, I::If(BlockType::Empty)]);
        code.call(Func::by_hand(0));
        code.instructions(&[I::Unreachable, I::End]);
    }

    /// The checks left, each a read or a tee of its local -- the IR fuses a
    /// write followed by a check's read into one tee.
    fn checks_of(code: &Code) -> usize {
        (0..code.insts.len())
            .filter(|at| {
                matches!(code.insts[*at], Inst::Op(I::LocalGet(_) | I::LocalTee(_)))
                    && is_check(&code.insts, *at)
            })
            .count()
    }

    #[test]
    fn a_second_check_on_the_same_path_goes() {
        let mut code = Code::default();
        check(&mut code, 0);
        code.instruction(&I::Nop);
        check(&mut code, 0);
        code.instruction(&I::End);
        drop_repeated(&mut code, 1);
        assert_eq!(checks_of(&code), 1);
    }

    /// A write and then a check: once as one `local.tee` the IR fuses them
    /// into, and once kept apart, a plain `local.set`.
    #[test]
    fn a_check_after_a_write_stays() {
        let mut code = Code::default();
        check(&mut code, 0);
        code.instructions(&[I::LocalGet(1), I::LocalSet(0)]);
        check(&mut code, 0);
        code.instructions(&[I::LocalGet(1), I::LocalSet(0), I::Nop]);
        check(&mut code, 0);
        code.instruction(&I::End);
        drop_repeated(&mut code, 2);
        assert_eq!(checks_of(&code), 3);
    }

    #[test]
    fn a_check_made_on_one_arm_does_not_cover_the_join() {
        let mut code = Code::default();
        code.instructions(&[I::LocalGet(1), I::If(BlockType::Empty)]);
        check(&mut code, 0);
        code.instruction(&I::End);
        check(&mut code, 0);
        code.instruction(&I::End);
        drop_repeated(&mut code, 2);
        assert_eq!(checks_of(&code), 2);
    }

    #[test]
    fn a_check_in_a_loop_that_writes_the_local_stays() {
        let mut code = Code::default();
        check(&mut code, 0);
        code.instruction(&I::Loop(BlockType::Empty));
        check(&mut code, 0);
        code.instructions(&[
            I::LocalGet(1),
            I::LocalSet(0),
            I::LocalGet(2),
            I::BrIf(0),
            I::End,
        ]);
        code.instruction(&I::End);
        drop_repeated(&mut code, 3);
        assert_eq!(checks_of(&code), 2);
    }

    /// A check in a loop is kept though one before the loop covers it (for
    /// V8's sake), and a second in the same iteration still goes.
    #[test]
    fn a_loop_keeps_its_own_first_check() {
        let mut code = Code::default();
        check(&mut code, 0);
        code.instruction(&I::Loop(BlockType::Empty));
        check(&mut code, 0);
        check(&mut code, 0);
        code.instructions(&[I::LocalGet(2), I::BrIf(0), I::End]);
        code.instruction(&I::End);
        drop_repeated(&mut code, 3);
        assert_eq!(checks_of(&code), 2);
    }

    /// A check before a try, and one where its catch arrives: the try wrote
    /// the local before it threw, so the second check stands.
    #[test]
    fn a_catch_does_not_inherit_the_tries_checks() {
        let mut code = Code::default();
        code.instruction(&I::Block(BlockType::Empty));
        check(&mut code, 0);
        code.instruction(&I::TryTable(
            BlockType::Empty,
            std::borrow::Cow::Owned(vec![wasm_encoder::Catch::All { label: 0 }]),
        ));
        code.instructions(&[
            I::LocalGet(2),
            I::If(BlockType::Empty),
            I::LocalGet(1),
            I::LocalSet(0),
        ]);
        code.throw(Tag::by_hand(0));
        code.instructions(&[I::End, I::End, I::End]);
        check(&mut code, 0);
        code.instruction(&I::End);
        drop_repeated(&mut code, 3);
        assert_eq!(checks_of(&code), 2);
    }
}
