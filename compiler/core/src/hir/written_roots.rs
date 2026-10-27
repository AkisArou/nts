//! A root's written parameters, and its written return, cross at their
//! kinds' widths.
//!
//! A parameter written as a kind (`n: c_int`) is the kind's range inside its
//! function ([`super::Param::written`]), because every call in the program
//! was obliged to prove its argument fits (`docs/records/notebooks/scalar-numbers.md`, D2). A
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
//! **A written return the same way** (`answer(): Uint32`): every `return` was
//! obliged to prove its value fits, so the root answers the kind's width -- a
//! C host reads `uint32_t`, not a `double` it must convert and trust -- and a
//! call inside the program widens the answer back to the `number` it computes
//! with. Only a return the program holds as a `number`: a bigint kind's needs
//! its host to know it was a bigint, which the width alone does not say. An
//! `async` function's written kind is its promise's payload, which does not
//! cross here (`Func::call_kind`).
//!
//! Unconditional, unlike the narrowing [`super::signatures`] does from facts:
//! the boundary has to hold whether or not numbers are specialized, so it
//! runs in `prepare` before anything reads a signature. The kinds
//! are the ones every target holds (`Scalar::on`), as the check's are. A
//! function a dispatch table names keeps its signature, which every
//! implementation of its slot shares.

use rustc_hash::{FxHashMap, FxHashSet};

use super::native::Targets;
use super::reachable::Roots;
use super::simplify::{substitute, substitute_terminator};
use super::{Callee, Func, HirType, Op, OpKind, Param, Program, Terminator, ValueId};

/// Each root's parameters at the widths they cross at, `None` where a
/// parameter crosses as it is.
type Widths = FxHashMap<String, Vec<Option<HirType>>>;

/// Each root whose return crosses narrowed, at the width it crosses at.
type Returns = FxHashMap<String, HirType>;

/// Narrow every root's written parameters and return to their kinds on every
/// target the program is built for, returning how many roots changed.
pub fn narrow(program: &mut Program, roots: Roots<'_>) -> usize {
    let targets = program.targets;
    let roots: FxHashSet<String> = super::reachable::root_names(program, roots)
        .into_iter()
        .map(str::to_owned)
        .collect();
    let dispatched: FxHashSet<&str> = program.dispatch_targets().collect();
    let crossing =
        |func: &&Func| roots.contains(&func.name) && !dispatched.contains(func.name.as_str());
    let returns: Returns = program
        .funcs
        .iter()
        .filter(crossing)
        .filter_map(|func| Some((func.name.clone(), return_width(func, targets)?)))
        .collect();
    let widths: Widths = program
        .funcs
        .iter()
        .filter(crossing)
        .filter_map(|func| {
            let widths: Vec<Option<HirType>> = func
                .params
                .iter()
                .map(|param| width(param, targets))
                .collect();
            widths
                .iter()
                .any(Option::is_some)
                .then(|| (func.name.clone(), widths))
        })
        .collect();
    if widths.is_empty() && returns.is_empty() {
        return 0;
    }
    for func in &mut program.funcs {
        if let Some(mine) = widths.get(&func.name) {
            widen_at_entry(func, mine);
        }
        if let Some(width) = returns.get(&func.name) {
            narrow_returns(func, width);
        }
        narrow_arguments(func, &widths);
        widen_results(func, &returns);
    }
    widths
        .keys()
        .chain(returns.keys())
        .collect::<FxHashSet<_>>()
        .len()
}

/// The width a root's return crosses at: its written kind's, where that is
/// narrower than the `number` it answers.
fn return_width(func: &Func, targets: Targets) -> Option<HirType> {
    let width = func.call_kind()?.width_on(targets);
    (func.return_type == HirType::NUMBER && width != HirType::NUMBER).then_some(width)
}

/// Answer the width: each value returned, which the strict check proved
/// fits, converted to it where it is returned.
fn narrow_returns(func: &mut Func, width: &HirType) {
    func.return_type = width.clone();
    for at in 0..func.blocks.len() {
        let mut ops = Vec::with_capacity(func.blocks[at].ops.len() + 1);
        for op in std::mem::take(&mut func.blocks[at].ops) {
            if let OpKind::Return(Some(value)) = func.values[op.0 as usize].kind {
                let converted = convert(func, value, width, op);
                ops.push(converted);
                func.values[op.0 as usize].kind = OpKind::Return(Some(converted));
            }
            ops.push(op);
        }
        if let Terminator::Return(Some(value)) = func.blocks[at].terminator {
            let converted = convert(func, value, width, value);
            ops.push(converted);
            func.blocks[at].terminator = Terminator::Return(Some(converted));
        }
        func.blocks[at].ops = ops;
    }
}

/// Each call to a root whose return is narrowed answers its width; every use
/// reads a `number` widened from it, exactly, right after the call.
fn widen_results(func: &mut Func, returns: &Returns) {
    let mut widened: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for at in 0..func.blocks.len() {
        let mut ops = Vec::with_capacity(func.blocks[at].ops.len());
        for op in std::mem::take(&mut func.blocks[at].ops) {
            ops.push(op);
            let width = match &func.values[op.0 as usize].kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } => returns.get(name).cloned(),
                _ => None,
            };
            let Some(width) = width else { continue };
            func.values[op.0 as usize].ty = width;
            let number = convert(func, op, &HirType::NUMBER, op);
            ops.push(number);
            widened.insert(op, number);
        }
        func.blocks[at].ops = ops;
    }
    if widened.is_empty() {
        return;
    }
    let read = |value: ValueId| widened.get(&value).copied().unwrap_or(value);
    // Each widening reads the call itself.
    let widenings: FxHashSet<ValueId> = widened.values().copied().collect();
    let Func { blocks, values, .. } = func;
    for block in blocks.iter_mut() {
        for op in &block.ops {
            if !widenings.contains(op) {
                substitute(&mut values[op.0 as usize].kind, read);
            }
        }
        substitute_terminator(&mut block.terminator, read);
    }
}

/// `value` converted to `ty`, at `at`'s origin; the caller places it.
fn convert(func: &mut Func, value: ValueId, ty: &HirType, at: ValueId) -> ValueId {
    let origin = func.values[at.0 as usize].origin.clone();
    push(
        func,
        Op {
            kind: OpKind::Convert(value),
            ty: ty.clone(),
            origin,
        },
    )
}

/// The width a parameter crosses at: its written kind's, where that is
/// narrower than the `number` it holds.
fn width(param: &Param, targets: Targets) -> Option<HirType> {
    let width = param.written?.width_on(targets);
    (param.ty == HirType::NUMBER && width != HirType::NUMBER).then_some(width)
}

/// Give each narrowed parameter its width, and the body a `number` widened
/// from it at entry, which every use reads instead.
fn widen_at_entry(func: &mut Func, widths: &[Option<HirType>]) {
    let Some(parameters) = func.parameter_values() else {
        return;
    };
    for (slot, width) in widths.iter().enumerate() {
        let Some(width) = width else { continue };
        func.params[slot].ty = width.clone();
        // A parameter nothing reads has no value to widen.
        let Some(Some(parameter)) = parameters.get(slot).copied() else {
            continue;
        };
        func.values[parameter.0 as usize].ty = width.clone();
        let origin = func.values[parameter.0 as usize].origin.clone();
        let widened = push(
            func,
            Op {
                kind: OpKind::Convert(parameter),
                ty: HirType::NUMBER,
                origin,
            },
        );
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
                OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    ..
                } => widths
                    .get(name)
                    .map(|widths| (widths.clone(), args.clone())),
                _ => None,
            };
            if let Some((widths, mut args)) = narrowed {
                for (arg, width) in args.iter_mut().zip(&widths) {
                    let Some(width) = width else { continue };
                    let origin = func.values[op.0 as usize].origin.clone();
                    let converted = push(
                        func,
                        Op {
                            kind: OpKind::Convert(*arg),
                            ty: width.clone(),
                            origin,
                        },
                    );
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
