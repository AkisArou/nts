//! The `tag.of` values a function asks only whether a value is a number, so
//! each asking is two `ref.test`s rather than the whole tag.
//!
//! A closure called through an erased signature admits each argument with
//! `tag.of(argument) == number` before unerasing it (`Closure#erased_call`).
//! `value.tag` answers with the whole tag: a `wasm:js-string` `test` crossing
//! first, to rule out a string, then an i31 test, then the object's
//! descriptor. Whether a value is a number is the test its unerase already
//! makes -- an i31 or the number box (`erased::number_test`) -- and asked that
//! way `uniform-callback-arguments` cost 19.5% less (175,770 -> 141,469
//! instructions/op, 2026-10-20), V8 then merging the unerase's own test into
//! it.
//!
//! A `tag.of` qualifies when it is compared, `==` or `!=`, with the number
//! tag, and that is its every use. One with any other use -- compared with
//! another tag or with a value, stored, passed on an edge -- or with none is
//! the whole tag, as before.

use nts_core::hir::{
    BinOp, Func, HirType, OpKind, ValueId, operands_of, operands_of_terminator, tags,
};
use std::collections::BTreeSet;

/// The function's `tag.of` values asked only whether they are the number tag.
pub(crate) fn number_tests(func: &Func) -> BTreeSet<ValueId> {
    let number = |id: ValueId| matches!(func.value(id).kind, OpKind::ConstInt(tag) if tag == i128::from(tags::NUMBER));
    let mut tests: BTreeSet<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .filter(|&id| {
            matches!(func.value(id).kind,
                OpKind::TagOf { value } if func.value(value).ty == HirType::Erased)
        })
        .collect();
    let mut asked = BTreeSet::new();
    for block in &func.blocks {
        for &at in &block.ops {
            let kind = &func.value(at).kind;
            let compared = match *kind {
                OpKind::Binary {
                    op: BinOp::Eq | BinOp::Ne,
                    lhs,
                    rhs,
                } if number(rhs) => Some(lhs),
                OpKind::Binary {
                    op: BinOp::Eq | BinOp::Ne,
                    lhs,
                    rhs,
                } if number(lhs) => Some(rhs),
                _ => None,
            };
            asked.extend(compared);
            for operand in operands_of(kind) {
                if Some(operand) != compared {
                    tests.remove(&operand);
                }
            }
        }
        for operand in operands_of_terminator(&block.terminator) {
            tests.remove(&operand);
        }
    }
    tests.retain(|tag| asked.contains(tag));
    tests
}
