//! A root's written parameters cross at their kinds' widths.
//!
//! A parameter written as a kind (`n: c_int`) is the kind's range inside its
//! function ([`super::Param::written`]), because every call in the program
//! was obliged to prove its argument fits (`docs/scalar-numbers.md`, D2). A
//! root's callers are outside the program and were obliged to nothing, and a
//! `double` slot lets them pass anything: a C host's `3e10`, which the body's
//! conversion to C's `int` makes undefined behaviour, or JavaScript's
//! `2 ** 31` through the addon.
//!
//! So the slot itself takes the kind, which is what the program wrote at its
//! boundary (Q4: a check the declaration wrote, as `AsNumber`'s is):
//!
//! - C's header says `int32_t`, and C converts at its own call, as it does
//!   for any function taking an `int`;
//! - the addon reads a number into an integer slot only where it is one
//!   exactly -- not a fraction, NaN, `-0` or out of range -- and throws a
//!   `RangeError` otherwise, and into a `float` slot only a `float`;
//! - the body widens the slot, exactly, to the `number` it computes with, at
//!   entry; and a call inside the program converts the argument it proved
//!   fits.
//!
//! [`super::guards`] opens with "the one thing an exported signature cannot
//! say": a written kind is how it says it.
//!
//! Unconditional, unlike the narrowing [`super::signatures`] does from facts:
//! the boundary has to hold whether or not numbers are specialized, so it
//! runs in `prepare` before anything reads a signature. The kinds
//! are the ones every target holds (`Scalar::on`), as the check's are. A
//! function a dispatch table names keeps its signature, which every
//! implementation of its slot shares.

use rustc_hash::{FxHashMap, FxHashSet};

use super::native::NativeAbi;
use super::reachable::Roots;
use super::simplify::{substitute, substitute_terminator};
use super::{Callee, Func, HirType, Op, OpKind, Param, Program, ValueId};

/// Each root's parameters at the widths they cross at, `None` where a
/// parameter crosses as it is.
type Widths = FxHashMap<String, Vec<Option<HirType>>>;

/// Narrow every root's written parameters to their kinds, returning how many
/// roots changed.
pub fn narrow(program: &mut Program, roots: Roots<'_>, targets: &[NativeAbi]) -> usize {
    let roots: FxHashSet<String> = super::reachable::root_names(program, roots).into_iter().map(str::to_owned).collect();
    let dispatched: FxHashSet<&str> = program
        .layouts
        .iter()
        .flat_map(|layout| layout.methods.iter().flatten())
        .map(String::as_str)
        .collect();
    let widths: Widths = program
        .funcs
        .iter()
        .filter(|func| roots.contains(&func.name) && !dispatched.contains(func.name.as_str()))
        .filter_map(|func| {
            let widths: Vec<Option<HirType>> = func.params.iter().map(|param| width(param, targets)).collect();
            widths.iter().any(Option::is_some).then(|| (func.name.clone(), widths))
        })
        .collect();
    if widths.is_empty() {
        return 0;
    }
    for func in &mut program.funcs {
        if let Some(mine) = widths.get(&func.name) {
            widen_at_entry(func, mine);
        }
        narrow_arguments(func, &widths);
    }
    widths.len()
}

/// The width a parameter crosses at: its written kind's, where that is
/// narrower than the `number` it holds.
fn width(param: &Param, targets: &[NativeAbi]) -> Option<HirType> {
    let width = param.written?.on(targets).representation();
    (param.ty == HirType::NUMBER && width != HirType::NUMBER).then_some(width)
}

/// Give each narrowed parameter its width, and the body a `number` widened
/// from it at entry, which every use reads instead.
fn widen_at_entry(func: &mut Func, widths: &[Option<HirType>]) {
    let Some(parameters) = func.parameter_values() else { return };
    for (slot, width) in widths.iter().enumerate() {
        let Some(width) = width else { continue };
        func.params[slot].ty = width.clone();
        // A parameter nothing reads has no value to widen.
        let Some(Some(parameter)) = parameters.get(slot).copied() else { continue };
        func.values[parameter.0 as usize].ty = width.clone();
        let origin = func.values[parameter.0 as usize].origin.clone();
        let widened = push(func, Op { kind: OpKind::Convert(parameter), ty: HirType::NUMBER, origin });
        let Func { blocks, values, .. } = func;
        let to_widened = |value: ValueId| if value == parameter { widened } else { value };
        for block in blocks.iter_mut() {
            for op in &block.ops {
                if *op != widened {
                    substitute(&mut values[op.0 as usize].kind, to_widened);
                }
            }
            substitute_terminator(&mut block.terminator, to_widened);
        }
        let entry = &mut blocks[0].ops;
        let after = entry
            .iter()
            .rposition(|op| matches!(values[op.0 as usize].kind, OpKind::Param(_)))
            .map_or(0, |last| last + 1);
        entry.insert(after, widened);
    }
}

/// Convert each argument a call passes a narrowed parameter, which the
/// strict check proved fits, to the parameter's width.
fn narrow_arguments(func: &mut Func, widths: &Widths) {
    for at in 0..func.blocks.len() {
        let mut ops = Vec::with_capacity(func.blocks[at].ops.len());
        for op in std::mem::take(&mut func.blocks[at].ops) {
            let narrowed = match &func.values[op.0 as usize].kind {
                OpKind::Call { callee: Callee::Direct(name), args, .. } => widths.get(name).map(|widths| (widths.clone(), args.clone())),
                _ => None,
            };
            if let Some((widths, mut args)) = narrowed {
                for (arg, width) in args.iter_mut().zip(&widths) {
                    let Some(width) = width else { continue };
                    let origin = func.values[op.0 as usize].origin.clone();
                    let converted = push(func, Op { kind: OpKind::Convert(*arg), ty: width.clone(), origin });
                    ops.push(converted);
                    *arg = converted;
                }
                if let OpKind::Call { args: call, .. } = &mut func.values[op.0 as usize].kind {
                    *call = args;
                }
            }
            ops.push(op);
        }
        func.blocks[at].ops = ops;
    }
}

fn push(func: &mut Func, op: Op) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(op);
    id
}
