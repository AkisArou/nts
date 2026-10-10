//! A written field or global is held at its kind's width
//! (`docs/scalar-numbers.md`, step 2f).
//!
//! `r: Uint8` is a byte in its object, `count: Int32` four, `big: Uint32` an
//! unsigned four: what the program wrote, on every backend. Every store into
//! one was obliged to prove its value fits (the strict check's `Into::Field`
//! and `Into::Global`), so the store converts exactly -- [`super::specialize`]
//! converts each `FieldSet` and `GlobalSet` to its slot's type -- and every
//! read widens, exactly, to the `number` the program computes with, as a
//! written parameter does at entry ([`super::written_roots`]).
//!
//! Unconditional, unlike the narrowing [`super::fields`] and
//! [`super::globals`] do from facts: the width is what the program says, not
//! what the analysis found, and it holds whether or not numbers are
//! specialized. Those passes leave a written slot alone. And it holds for a
//! slot the outside can reach, which the fact-driven narrowing skips: there
//! the width is a contract the outside is held to, as a written parameter's
//! is, not a guess its writes could falsify.
//!
//! A slot already other than a `number` keeps what it has: an optional field,
//! which is erased, and a kind a `bigint` carries.

use rustc_hash::{FxHashMap, FxHashSet};

use super::fields::FieldWidths;
use super::globals::GlobalWidths;
use super::simplify::{substitute, substitute_terminator};
use super::{Func, HirType, Op, OpKind, Program, ValueId};

/// Hold every written field and global at its kind's width on every target the
/// program is built for, returning how many reads were widened.
pub fn narrow(program: &mut Program) -> usize {
    let targets = program.targets;
    let width = |written: Option<super::native::Scalar>, ty: &HirType| {
        let width = written?.width_on(targets);
        (*ty == HirType::NUMBER && width != HirType::NUMBER).then_some(width)
    };
    let mut fields: FieldWidths = program
        .layouts
        .iter()
        .enumerate()
        .flat_map(|(at, layout)| {
            layout
                .fields
                .iter()
                .enumerate()
                .filter_map(move |(index, field)| {
                    let index = u32::try_from(index).ok()?;
                    Some(((at, index), width(field.written, &field.ty)?))
                })
        })
        .collect();
    let globals: GlobalWidths = program
        .globals
        .iter()
        .enumerate()
        .filter_map(|(at, global)| {
            Some((u32::try_from(at).ok()?, width(global.written, &global.ty)?))
        })
        .collect();
    // A field is one width wherever its storage is shared, or a store through
    // one layout writes a width another reads differently: a class and the
    // interface it is read through put the field at one place, and so do the
    // arms of one read or store. A written kind is an optional label, so one
    // class can write `r: Uint8` behind an interface another implements as
    // `r: number`. Such a field keeps the `number` they share, which the
    // fact-driven narrowing then decides for them all together.
    keep_storage_together(program, &mut fields);
    super::fields::keep_arms_together(
        program,
        &super::fields::LayoutIndex::build(program),
        &mut fields,
    );
    if fields.is_empty() && globals.is_empty() {
        return 0;
    }
    // Which reads are a `number` now, so that the ones the narrowing retypes
    // can be told from the ones it leaves.
    let reads: Vec<Vec<ValueId>> = program
        .funcs
        .iter()
        .map(|func| {
            func.values
                .iter()
                .enumerate()
                .filter(|(_, op)| op.ty == HirType::NUMBER && is_a_read(&op.kind))
                .filter_map(|(at, _)| u32::try_from(at).ok().map(ValueId))
                .collect()
        })
        .collect();
    super::fields::narrow(program, &fields);
    super::globals::narrow(program, &globals);
    program
        .funcs
        .iter_mut()
        .zip(reads)
        .map(|(func, reads)| {
            let narrowed: Vec<ValueId> = reads
                .into_iter()
                .filter(|read| func.values[read.0 as usize].ty != HirType::NUMBER)
                .collect();
            widen_after(func, &narrowed)
        })
        .sum()
}

/// Drop a written width from a field unless every layout sharing its storage
/// ([`super::fields::shares_storage`]) is narrowed to the same width; to a
/// fixpoint, since dropping one can break another's group.
fn keep_storage_together(program: &Program, fields: &mut FieldWidths) {
    loop {
        let broken: Vec<(usize, u32)> = fields
            .iter()
            .filter(|((at, field), ty)| {
                let layout = &program.layouts[*at];
                program
                    .layouts
                    .iter()
                    .enumerate()
                    .any(|(other, candidate)| {
                        other != *at
                            && super::fields::shares_storage(layout, candidate, *field)
                            && fields.get(&(other, *field)) != Some(*ty)
                    })
            })
            .map(|(place, _)| *place)
            .collect();
        if broken.is_empty() {
            return;
        }
        for place in broken {
            fields.remove(&place);
        }
    }
}

/// A read of a field or a global, which [`super::fields::narrow`] or
/// [`super::globals::narrow`] retypes to the slot's width.
const fn is_a_read(kind: &OpKind) -> bool {
    matches!(
        kind,
        OpKind::FieldGet { .. }
            | OpKind::SharedFieldGet { .. }
            | OpKind::OpenFieldGet { .. }
            | OpKind::GlobalGet(_)
    )
}

/// Give each of these reads a `number` widened from it, right after it, and
/// every use the widened one. Returns how many.
fn widen_after(func: &mut Func, reads: &[ValueId]) -> usize {
    if reads.is_empty() {
        return 0;
    }
    let mut widened: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for read in reads {
        let origin = func.values[read.0 as usize].origin.clone();
        let at = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
        func.values.push(Op {
            kind: OpKind::Convert(*read),
            ty: HirType::NUMBER,
            origin,
        });
        widened.insert(*read, at);
    }
    let made: FxHashSet<ValueId> = widened.values().copied().collect();
    let to_widened = |value: ValueId| widened.get(&value).copied().unwrap_or(value);
    let Func { blocks, values, .. } = func;
    for block in blocks.iter_mut() {
        let mut ops = Vec::with_capacity(block.ops.len() + reads.len());
        for op in std::mem::take(&mut block.ops) {
            ops.push(op);
            if let Some(after) = widened.get(&op) {
                ops.push(*after);
            }
        }
        for op in &ops {
            if !made.contains(op) {
                substitute(&mut values[op.0 as usize].kind, to_widened);
            }
        }
        substitute_terminator(&mut block.terminator, to_widened);
        block.ops = ops;
    }
    reads.len()
}
