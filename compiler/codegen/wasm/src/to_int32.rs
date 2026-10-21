//! `ToInt32` of a double inside a loop, in line.
//!
//! Lowering converts every double with a call to the exact helper,
//! `nts.toInt32`, which reads the exponent and shifts the significand. Inside
//! a loop that call is the conversion's whole cost, and whether V8 inlines it
//! hangs on the caller's budget, which the module's share of small functions
//! sets (lessons/backends.md). This pass rewrites each such call where it
//! sits in a loop -- after this backend's own inlining, so a conversion an
//! inlined callee brought into its caller's loop counts -- as a test and a
//! truncation: below 2^63 in magnitude, truncating to 64 bits and keeping the
//! low 32 is `ToInt32` exactly, and NaN, the infinities and anything larger
//! fail the test and call the helper. C's `nts_to_int32` takes its hardware
//! path in line for the int32 range; this one also covers a product of two
//! int32s, which `x | 0` after a multiplication usually is.
//!
//! A call outside every loop stays a call: it runs once a call of its
//! function, and in line it only changed how V8 allocated registers for the
//! loop after it. With every conversion in line (2026-10-21), the rows whose
//! conversions all sit outside their loops lost and none gained: substrings,
//! whose two sit in its entry check and before its loop, spilled more inside
//! that loop's byte-identical code and took 1.86% more cycles (26,820 ->
//! 27,320 per op, quiet cores); checksum's took 2.06% more instructions and
//! the same cycles (32,802 -> 32,847), its loop bound by latency. Writing 2^63
//! as a global rather than a constant changed neither: it was the code's
//! shape, not its size. In loops the same conversion counted symbol-keyed-map
//! 12.06% fewer instructions, map-and-set 3.54%, record-word-counts 1.78%.

use crate::helpers::Helper;
use crate::ir::{self, Inst};
use crate::module::{Builder, Func, FuncKey};
use wasm_encoder::{BlockType, Instruction as I, ValType};

/// Each call to the `ToInt32` helper inside a loop, in every function the
/// module defines, made the in-line test and truncation.
pub(crate) fn program(m: &mut Builder<'_>) {
    let Some(helper) = m.requested_func(&FuncKey::Numeric(Helper::ToInt32)) else {
        return;
    };
    for func in m.defined_bodies() {
        if func == helper {
            continue;
        }
        let Some(body) = m.body(func) else {
            continue;
        };
        let params = m.signature(func).0.len();
        let mut body = body.clone();
        if in_line(&mut body, params, helper) {
            m.replace_body(func, body);
        }
    }
}

/// Rewrite `body`'s calls to `helper` that sit inside a loop, and say
/// whether there were any.
fn in_line(body: &mut ir::Function, params: usize, helper: Func) -> bool {
    let sites = in_loops(&body.code.insts, helper);
    if sites.is_empty() {
        return false;
    }
    let held = u32::try_from(params + body.locals.len()).unwrap_or(u32::MAX);
    body.locals.push(ValType::F64);
    body.code.rewrite(|at, inst| {
        if sites.binary_search(&at).is_ok() {
            conversion(held, helper)
        } else {
            vec![inst]
        }
    });
    true
}

/// The positions of the calls to `helper` inside a `loop`, in order.
fn in_loops(insts: &[Inst], helper: Func) -> Vec<usize> {
    // One entry per open structure: whether it is a loop.
    let mut open: Vec<bool> = Vec::new();
    let mut sites = Vec::new();
    for (at, inst) in insts.iter().enumerate() {
        match inst {
            Inst::Op(I::Loop(_)) => open.push(true),
            Inst::Op(I::Block(_) | I::If(_) | I::Try(_) | I::TryTable(..)) => open.push(false),
            Inst::Op(I::End | I::Delegate(_)) => {
                open.pop();
            }
            Inst::Call(callee) if *callee == helper && open.contains(&true) => sites.push(at),
            _ => {}
        }
    }
    sites
}

/// The double on the stack converted: truncated and wrapped where its
/// magnitude is below 2^63, through `helper` otherwise, `held` keeping it.
fn conversion(held: u32, helper: Func) -> Vec<Inst> {
    let op = |i: I<'static>| Inst::Op(i);
    vec![
        op(I::LocalTee(held)),
        op(I::F64Abs),
        op(I::F64Const(9_223_372_036_854_775_808.0.into())),
        op(I::F64Lt),
        op(I::If(BlockType::Result(ValType::I32))),
        op(I::LocalGet(held)),
        op(I::I64TruncSatF64S),
        op(I::I32WrapI64),
        op(I::Else),
        op(I::LocalGet(held)),
        Inst::Call(helper),
        op(I::End),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELPER: Func = Func::by_hand(7);
    const OTHER: Func = Func::by_hand(8);

    /// A call in a loop, in a block nested in a loop, and in a loop nested
    /// in a block are sites; one before, after or beside every loop is not,
    /// and neither is a call to anything else.
    #[test]
    fn only_a_call_inside_a_loop_is_a_site() {
        let op = Inst::Op;
        let insts = vec![
            Inst::Call(HELPER), // 0: before any loop
            op(I::Loop(BlockType::Empty)),
            Inst::Call(HELPER), // 2: in the loop
            op(I::Block(BlockType::Empty)),
            Inst::Call(HELPER), // 4: in a block in the loop
            Inst::Call(OTHER),  // 5: another callee
            op(I::End),
            op(I::End),
            Inst::Call(HELPER), // 8: after the loop
            op(I::Block(BlockType::Empty)),
            op(I::Loop(BlockType::Empty)),
            Inst::Call(HELPER), // 11: in a loop in a block
            op(I::End),
            Inst::Call(HELPER), // 13: in the block, after its loop
            op(I::End),
            op(I::End),
        ];
        assert_eq!(in_loops(&insts, HELPER), vec![2, 4, 11]);
    }

    /// Each site becomes the test and truncation over one new f64 local,
    /// with the helper on the slow arm; the call outside the loop stays,
    /// and an origin mark on a site moves to the first instruction of its
    /// replacement.
    #[test]
    fn a_site_is_rewritten_over_one_new_local() {
        let mut body = ir::Function::new([ValType::I32]);
        body.code.insts = vec![
            Inst::Call(HELPER),
            Inst::Op(I::Loop(BlockType::Empty)),
            Inst::Call(HELPER),
            Inst::Op(I::Drop),
            Inst::Op(I::End),
            Inst::Op(I::End),
        ];
        let site = nts_semantic_schema::Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 1),
        });
        body.code.marks = vec![(2, site)];
        assert!(in_line(&mut body, 1, HELPER));
        assert_eq!(body.locals, vec![ValType::I32, ValType::F64]);
        let held = 2;
        assert!(matches!(body.code.insts[0], Inst::Call(f) if f == HELPER));
        assert!(matches!(body.code.insts[2], Inst::Op(I::LocalTee(n)) if n == held));
        assert!(matches!(body.code.insts[8], Inst::Op(I::I64TruncSatF64S)));
        assert!(matches!(body.code.insts[12], Inst::Call(f) if f == HELPER));
        assert_eq!(body.code.insts.len(), 6 - 1 + 12);
        assert_eq!(body.code.marks[0].0, 2);
        assert!(!in_line(&mut ir::Function::new([]), 0, HELPER));
    }
}
