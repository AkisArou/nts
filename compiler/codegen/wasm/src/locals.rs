//! A function's locals, grouped by type.
//!
//! Locals are declared in runs of one type, so their order is part of a
//! function's size, and V8 inlines by size. `fib#whole` declared
//! `i32 i32 i32 f64 i32 i32 f64 f64 i32 f64` -- six runs, 52 bytes -- and V8
//! gave its recursion an inlining budget of 104 bytes, too little for one
//! level; grouped, in two runs and 44 bytes, it was given 220 and inlined
//! three levels deep, and `fib` counted 31.5% fewer instructions (12,401,792
//! -> 8,499,385 per op, 2026-10-20). Each type keeps the place of its first
//! local, so a function already in runs keeps its order. Every function the
//! module defines is grouped, a runtime helper or an outlined path as much as
//! a program function: each is a callee V8 sizes.

use crate::ir::{self, Inst};
use crate::module::Builder;
use wasm_encoder::{Instruction as I, ValType};

/// Group the locals of every function the module defines by type.
pub(crate) fn program(m: &mut Builder<'_>) {
    for func in m.defined_bodies() {
        let Some(body) = m.body(func) else {
            continue;
        };
        let params = u32::try_from(m.signature(func).0.len()).unwrap_or(u32::MAX);
        let mut body = body.clone();
        if group(&mut body, params) {
            m.replace_body(func, body);
        }
    }
}

/// Reorder `body`'s locals so each type's are one run, in the order each type
/// first appears, and renumber every use; the `params` before them stay. Says
/// whether anything moved.
fn group(body: &mut ir::Function, params: u32) -> bool {
    // A function has few distinct types and can have hundreds of locals: rank
    // each type once, by its first local, rather than search for it per local.
    let mut types: Vec<ValType> = Vec::new();
    let rank: Vec<usize> = body
        .locals
        .iter()
        .map(|ty| {
            types.iter().position(|seen| seen == ty).unwrap_or_else(|| {
                types.push(*ty);
                types.len() - 1
            })
        })
        .collect();
    let mut order: Vec<usize> = (0..body.locals.len()).collect();
    order.sort_by_key(|&at| (rank[at], at));
    if order.iter().enumerate().all(|(new, old)| new == *old) {
        return false;
    }
    let mut moved = vec![0u32; order.len()];
    for (new, &old) in order.iter().enumerate() {
        moved[old] = params + u32::try_from(new).unwrap_or(u32::MAX);
    }
    let renumber = |local: u32| {
        local
            .checked_sub(params)
            .and_then(|at| moved.get(at as usize).copied())
            .unwrap_or(local)
    };
    for inst in &mut body.code.insts {
        if let Inst::Op(op) = inst {
            *op = match *op {
                I::LocalGet(local) => I::LocalGet(renumber(local)),
                I::LocalSet(local) => I::LocalSet(renumber(local)),
                I::LocalTee(local) => I::LocalTee(renumber(local)),
                _ => continue,
            };
        }
    }
    body.locals = order.iter().map(|&at| body.locals[at]).collect();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types(body: &ir::Function) -> Vec<ValType> {
        body.locals.clone()
    }

    /// Interleaved locals become one run per type, in first-appearance order,
    /// and every use follows its local; a parameter keeps its index.
    #[test]
    fn locals_are_grouped_and_uses_follow() {
        let (i, f) = (ValType::I32, ValType::F64);
        let mut body = ir::Function::new([i, f, i, f]);
        body.code.instructions(&[
            I::LocalGet(0),
            I::LocalSet(3),
            I::LocalGet(2),
            I::LocalTee(4),
            I::LocalSet(1),
        ]);
        assert!(group(&mut body, 1));
        assert_eq!(types(&body), vec![i, i, f, f]);
        let uses: Vec<u32> = body
            .code
            .insts
            .iter()
            .filter_map(|inst| match inst {
                Inst::Op(I::LocalGet(n) | I::LocalSet(n) | I::LocalTee(n)) => Some(*n),
                _ => None,
            })
            .collect();
        // param 0 stays; locals 1 (i32), 2 (f64), 3 (i32), 4 (f64) become 1, 3, 2, 4.
        assert_eq!(uses, vec![0, 2, 3, 4, 1]);
    }

    /// Locals already in runs are left as they are.
    #[test]
    fn locals_in_runs_stay() {
        let (i, f) = (ValType::I32, ValType::F64);
        let mut body = ir::Function::new([i, i, f]);
        body.code.instructions(&[I::LocalGet(2), I::LocalSet(0)]);
        assert!(!group(&mut body, 0));
        assert_eq!(types(&body), vec![i, i, f]);
    }
}
