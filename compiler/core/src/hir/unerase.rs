//! Removing erasure from a site that never needed it.
//!
//! # The measurement this exists for
//!
//! An erased array costs about 11% against a typed one, and the cost is the
//! per-element tag test — NaN-boxing the value to half its size was built,
//! measured, and moved the number by 0.1%, which is what proved it. The only
//! thing that removes a tag test is not having a tag.
//!
//! `docs/records/0019` counts what real code does with `unknown`: 41% of
//! parameters are *carried* and never read, 14% are *tested* and read only
//! through the test. Both of those want a representation smaller than the
//! general one, and this is the first pass that gives one.
//!
//! # What it does, and the one thing it must not get wrong
//!
//! An array whose element type is erased, allocated here and never escaping,
//! every store of which erases a value of the same representation `R`: the
//! element becomes `R`, the erasures before the stores go, and the reads come
//! back as `R` rather than as a tag and a payload.
//!
//! The thing it must not get wrong is *aliasing*. If the array escapes, some
//! other function may store a string into it, and an element typed `f64` would
//! then be read as a double that was never written — silently. So escape
//! analysis decides, and a value it cannot prove frame-local is left alone.
//!
//! Conservative twice over: every use of a read must be an unerase or a tag
//! read. A read that flows anywhere else is a use that expects the general
//! representation, and one of those sinks the whole array.

use rustc_hash::{FxHashMap, FxHashSet};

use super::escape::Escapes;
use super::{Callee, Func, HirType, ManagedType, OpKind, Program, ValueId};

/// Specialize the erased arrays a function allocates and keeps. Reports how
/// many.
pub fn narrow_arrays(func: &mut Func, escapes: &Escapes) -> usize {
    let candidates: Vec<ValueId> = (0..func.values.len())
        .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
        .filter(|value| {
            matches!(func.value(*value).kind, OpKind::ArrayNew { .. })
                && func.value(*value).ty
                    == HirType::Managed(ManagedType::Array(Box::new(HirType::Erased)))
                && escapes.is_frame_local(*value)
        })
        .collect();
    if candidates.is_empty() {
        return 0;
    }

    let mut narrowed = 0;
    for array in candidates {
        if let Some(element) = single_representation(func, array) {
            rewrite(func, array, &element);
            narrowed += 1;
        }
    }
    narrowed
}

/// The one representation every store puts into an array, if there is one.
///
/// `None` the moment two disagree, or a store is of something other than a
/// fresh erasure, or a read is used as anything but an unerase or a tag. Each
/// of those is a use that wants the general representation, and wanting it once
/// is wanting it.
fn single_representation(func: &Func, array: ValueId) -> Option<HirType> {
    let mut found: Option<HirType> = None;
    let mut reads: FxHashSet<ValueId> = FxHashSet::default();

    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match &func.value(id).kind {
            OpKind::ArraySet {
                array: target,
                value,
                ..
            } if *target == array => {
                // Only a *fresh* erasure. A value that was already erased
                // elsewhere has a tag this pass did not choose, and unwrapping
                // it would be asserting something about the other site.
                let OpKind::Erase { value: source } = func.value(*value).kind else {
                    return None;
                };
                let representation = func.value(source).ty.clone();
                match &found {
                    Some(seen) if *seen != representation => return None,
                    Some(_) => {}
                    None => found = Some(representation),
                }
            }
            OpKind::ArrayGet { array: target, .. } if *target == array => {
                reads.insert(id);
            }
            _ => {}
        }
    }

    // Every read has to be consumed by something that would have unwrapped it
    // anyway.
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        let uses_a_read = |value: &ValueId| reads.contains(value);
        match &func.value(id).kind {
            OpKind::Unerase { value } | OpKind::TagOf { value } if uses_a_read(value) => {}
            other => {
                if super::verify::operands(other).iter().any(uses_a_read) {
                    return None;
                }
            }
        }
    }
    // A read whose value leaves through a terminator is the same problem.
    for block in &func.blocks {
        if super::verify::terminator_operands(&block.terminator)
            .iter()
            .any(|value| reads.contains(value))
        {
            return None;
        }
    }

    found
}

/// Retype the array and unwrap every erasure around it.
fn rewrite(func: &mut Func, array: ValueId, element: &HirType) {
    let tag = super::tags::of_representation(element);
    func.values[array.0 as usize].ty =
        HirType::Managed(ManagedType::Array(Box::new(element.clone())));

    // The stores lose their erasure, the reads come back concrete.
    let mut reads: FxHashSet<ValueId> = FxHashSet::default();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match func.values[index].kind.clone() {
            OpKind::ArraySet {
                array: target,
                index: at,
                value,
                checked,
            } if target == array => {
                let OpKind::Erase { value: source } = func.value(value).kind else {
                    continue;
                };
                func.values[index].kind = OpKind::ArraySet {
                    array,
                    index: at,
                    value: source,
                    checked,
                };
            }
            OpKind::ArrayGet { array: target, .. } if target == array => {
                func.values[index].ty = element.clone();
                reads.insert(id);
            }
            _ => {}
        }
    }

    // An unerase of a concrete read is the identity; a tag read is a constant.
    // Both are left as operations rather than deleted, because `simplify` and
    // `fold` remove those and this pass should not also be a peephole.
    let mut replacements: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match func.values[index].kind {
            OpKind::Unerase { value } if reads.contains(&value) => {
                replacements.insert(id, value);
            }
            OpKind::TagOf { value } if reads.contains(&value) => {
                func.values[index].kind = OpKind::ConstInt(i128::from(tag));
            }
            _ => {}
        }
    }
    if replacements.is_empty() {
        return;
    }
    let of = |value: ValueId| replacements.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        super::simplify::substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        super::simplify::substitute_terminator(&mut block.terminator, of);
    }
}

/// Specialize erased *parameters* whose every caller passes the same kind.
///
/// The other half of the same idea, across functions rather than within one.
/// `docs/records/0019` counts 41% of `unknown` parameters as carried and 14%
/// as tested; both pay the general representation today, and both are
/// unnecessary when every reachable caller hands over the same thing.
///
/// This is monomorphization with a different driver. `generics.rs` copies a
/// function per set of type arguments; this retypes one per reaching
/// representation, and the reason it can retype rather than copy is that it
/// only fires when *every* caller agrees -- so there is one copy to make.
///
/// # What has to be true, and why each one is a wrong answer rather than a
/// missed one
///
/// - The function is **not exported**. An external caller is one this pass
///   cannot see, and it may hand over anything.
/// - Every call to it is **direct**. A dispatched call reaches it through a
///   method table, where the signature belongs to the class that declared the
///   method and not to this implementation.
/// - Every call passes a **fresh erasure of the same representation**. A value
///   erased somewhere else carries a tag this pass did not choose.
/// - Inside, every use of the parameter is an **unerase or a tag read**.
///   Anything else is a use that wants the general representation.
pub fn narrow_parameters(program: &mut Program) -> usize {
    let dispatched: FxHashSet<&str> = program
        .layouts
        .iter()
        .flat_map(|layout| layout.methods.iter().flatten())
        .map(String::as_str)
        .collect();

    // What each candidate's callers agree on, by function index and parameter.
    let mut agreed: FxHashMap<(usize, usize), HirType> = FxHashMap::default();
    let mut sunk: FxHashSet<usize> = FxHashSet::default();
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    let candidates: Vec<usize> = program
        .funcs
        .iter()
        .enumerate()
        .filter(|(_, func)| {
            !func.exported
                && !dispatched.contains(func.name.as_str())
                && func.params.iter().any(|p| p.ty == HirType::Erased)
        })
        .map(|(index, _)| index)
        .collect();
    if candidates.is_empty() {
        return 0;
    }
    let candidate_set: FxHashSet<usize> = candidates.iter().copied().collect();

    survey_callers(program, &by_name, &candidate_set, &mut agreed, &mut sunk);

    // And the callee's own uses have to be ones that would unwrap it anyway.
    for &at in &candidates {
        if sunk.contains(&at) {
            continue;
        }
        for position in 0..program.funcs[at].params.len() {
            if agreed.contains_key(&(at, position)) && !only_unwrapped(&program.funcs[at], position)
            {
                sunk.insert(at);
            }
        }
    }

    let chosen: Vec<((usize, usize), HirType)> = agreed
        .into_iter()
        .filter(|((at, _), _)| !sunk.contains(at))
        .collect();
    if chosen.is_empty() {
        return 0;
    }

    for ((at, position), representation) in &chosen {
        retype_parameter(&mut program.funcs[*at], *position, representation);
    }
    let targets: FxHashMap<(&str, usize), HirType> = chosen
        .iter()
        .map(|((at, position), representation)| {
            (
                (program.funcs[*at].name.as_str(), *position),
                representation.clone(),
            )
        })
        .collect();
    let targets: Vec<(String, usize)> =
        targets.keys().map(|(n, p)| ((*n).to_owned(), *p)).collect();
    for caller in &mut program.funcs {
        unwrap_arguments(caller, &targets);
    }
    chosen.len()
}

/// Specialize an erased *return* whose every `return` produces the same kind.
///
/// The third face of one idea. [`narrow_arrays`] fires when every store into a
/// slot agrees; [`narrow_parameters`] when every caller agrees about what goes
/// in; this when the function agrees with itself about what comes out.
///
/// The two conditions swap ends. For a parameter the producers are the callers
/// and the consumer is the body; for a return the producer is the body and the
/// consumers are the callers. So this asks the same two questions of the
/// opposite sides:
///
/// - every `return` gives a **fresh erasure of one representation**, and
/// - every use of the result, at every call site, is an **unerase or a tag
///   read**.
///
/// And the same three things make it a wrong answer rather than a missed one:
/// an exported function has callers this pass cannot see, a dispatched one is
/// reached through a table whose signature belongs to the class that declared
/// the method, and a call that is not direct is not one this pass can rewrite.
///
/// `docs/records/0019` measures why it is worth having: a returned `unknown`
/// in the node profile is almost always a value the caller immediately tests
/// and unwraps, which is the shape where the tag is written and read and never
/// otherwise looked at.
pub fn narrow_returns(program: &mut Program) -> usize {
    let dispatched: FxHashSet<&str> = program
        .layouts
        .iter()
        .flat_map(|layout| layout.methods.iter().flatten())
        .map(String::as_str)
        .collect();

    // What each candidate returns, where that is one thing.
    let mut agreed: FxHashMap<usize, HirType> = FxHashMap::default();
    for (at, func) in program.funcs.iter().enumerate() {
        if func.exported
            || dispatched.contains(func.name.as_str())
            || func.return_type != HirType::Erased
        {
            continue;
        }
        if let Some(representation) = returned_representation(func) {
            agreed.insert(at, representation);
        }
    }
    if agreed.is_empty() {
        return 0;
    }

    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    // And every call site has to be one that would unwrap the result anyway.
    let mut sunk: FxHashSet<usize> = FxHashSet::default();
    for caller in &program.funcs {
        for index in 0..caller.values.len() {
            let OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } = &caller.values[index].kind
            else {
                continue;
            };
            let Some(&at) = by_name.get(name.as_str()) else {
                continue;
            };
            if agreed.contains_key(&at)
                && !only_unwrapped_value(caller, ValueId(u32::try_from(index).unwrap_or(0)))
            {
                sunk.insert(at);
            }
        }
    }

    let chosen: Vec<(usize, HirType)> = agreed
        .into_iter()
        .filter(|(at, _)| !sunk.contains(at))
        .collect();
    if chosen.is_empty() {
        return 0;
    }

    for (at, representation) in &chosen {
        retype_return(&mut program.funcs[*at], representation);
    }
    let targets: FxHashMap<String, HirType> = chosen
        .iter()
        .map(|(at, representation)| (program.funcs[*at].name.clone(), representation.clone()))
        .collect();
    for caller in &mut program.funcs {
        unwrap_results(caller, &targets);
    }
    chosen.len()
}

/// The one representation a function returns, where there is one.
///
/// Every `return` has to be returning something it erased *here*: a value
/// erased somewhere else carries a tag this pass did not choose, and dropping
/// the erasure would hand the caller a payload under the wrong one.
///
/// A function with no `return` of a value is not a candidate. It cannot be
/// wrong, but there is nothing to narrow and saying so keeps the caller-side
/// rewrite from having to ask.
fn returned_representation(func: &Func) -> Option<HirType> {
    let mut found: Option<HirType> = None;
    for block in &func.blocks {
        let super::Terminator::Return(Some(returned)) = block.terminator else {
            continue;
        };
        let OpKind::Erase { value } = func.value(returned).kind else {
            return None;
        };
        let representation = func.value(value).ty.clone();
        if representation == HirType::Erased {
            return None;
        }
        match &found {
            None => found = Some(representation),
            Some(seen) if *seen == representation => {}
            Some(_) => return None,
        }
    }
    found
}

/// Return the value that was about to be erased, rather than the erasure.
fn retype_return(func: &mut Func, representation: &HirType) {
    func.return_type = representation.clone();
    for block in &mut func.blocks {
        let super::Terminator::Return(Some(returned)) = block.terminator else {
            continue;
        };
        if let OpKind::Erase { value } = func.values[returned.0 as usize].kind {
            block.terminator = super::Terminator::Return(Some(value));
        }
    }
}

/// Take the result of a narrowed call as what it now is.
fn unwrap_results(caller: &mut Func, targets: &FxHashMap<String, HirType>) {
    let mut narrowed: FxHashMap<ValueId, HirType> = FxHashMap::default();
    for index in 0..caller.values.len() {
        let OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } = &caller.values[index].kind
        else {
            continue;
        };
        if let Some(representation) = targets.get(name.as_str()) {
            narrowed.insert(
                ValueId(u32::try_from(index).unwrap_or(0)),
                representation.clone(),
            );
        }
    }
    if narrowed.is_empty() {
        return;
    }
    for (id, representation) in &narrowed {
        caller.values[id.0 as usize].ty = representation.clone();
    }
    unwrap_uses(caller, &narrowed);
}

/// What every direct caller passes to each candidate's erased parameters.
///
/// Fills `agreed` with the one representation a position sees, and `sunk` with
/// every candidate where that is not one thing: two callers disagreeing, a
/// caller passing a value erased somewhere else, or a call that is not direct
/// and therefore not the whole set of callers.
fn survey_callers(
    program: &Program,
    by_name: &FxHashMap<&str, usize>,
    candidates: &FxHashSet<usize>,
    agreed: &mut FxHashMap<(usize, usize), HirType>,
    sunk: &mut FxHashSet<usize>,
) {
    for caller in &program.funcs {
        for op in &caller.values {
            let OpKind::Call { callee, args, .. } = &op.kind else {
                continue;
            };
            let Callee::Direct(name) = callee else {
                // A dispatched or external call naming a candidate means the
                // set of callers is not the set this loop can see.
                if let Callee::External(name) | Callee::Direct(name) = callee
                    && let Some(at) = by_name.get(name.as_str())
                {
                    sunk.insert(*at);
                }
                continue;
            };
            let Some(&at) = by_name.get(name.as_str()) else {
                continue;
            };
            if !candidates.contains(&at) {
                continue;
            }
            for (position, argument) in args.iter().enumerate() {
                if program.funcs[at].params.get(position).map(|p| &p.ty) != Some(&HirType::Erased) {
                    continue;
                }
                let OpKind::Erase { value } = caller.value(*argument).kind else {
                    sunk.insert(at);
                    continue;
                };
                let representation = caller.value(value).ty.clone();
                match agreed.get(&(at, position)) {
                    Some(seen) if *seen != representation => {
                        sunk.insert(at);
                    }
                    Some(_) => {}
                    None => {
                        agreed.insert((at, position), representation);
                    }
                }
            }
        }
    }
}

/// Whether a parameter is only ever unerased or asked for its tag.
fn only_unwrapped(func: &Func, position: usize) -> bool {
    let Some(parameter) = func
        .values
        .iter()
        .position(|op| matches!(op.kind, OpKind::Param(at) if at as usize == position))
    else {
        return false;
    };
    only_unwrapped_value(func, ValueId(u32::try_from(parameter).unwrap_or(0)))
}

/// Whether every use of one value would unwrap it anyway.
///
/// Keyed on the value rather than on where it came from, because the question
/// is asked at both ends: of a *parameter* inside the callee, and of a *call's
/// result* inside each caller. It is the same question either way -- does
/// anything here want the general representation -- and having it in one place
/// is what makes the return pass the parameter pass read backwards rather than
/// a second implementation of it.
fn only_unwrapped_value(func: &Func, value: ValueId) -> bool {
    for op in &func.values {
        match &op.kind {
            OpKind::Unerase { value: used } | OpKind::TagOf { value: used } if *used == value => {}
            other => {
                if super::verify::operands(other).contains(&value) {
                    return false;
                }
            }
        }
    }
    !func
        .blocks
        .iter()
        .any(|block| super::verify::terminator_operands(&block.terminator).contains(&value))
}

/// Give a parameter its concrete representation and unwrap its uses.
fn retype_parameter(func: &mut Func, position: usize, representation: &HirType) {
    func.params[position].ty = representation.clone();

    let mut parameter = None;
    for index in 0..func.values.len() {
        if matches!(func.values[index].kind, OpKind::Param(at) if at as usize == position) {
            func.values[index].ty = representation.clone();
            parameter = Some(ValueId(u32::try_from(index).unwrap_or(0)));
        }
    }
    let Some(parameter) = parameter else { return };
    unwrap_uses(func, &FxHashMap::from_iter([(parameter, representation.clone())]));
}

/// Rewrite the uses of values that have stopped being erased.
///
/// An unerase of one is now the identity and a tag read of one is now a
/// constant. Neither is removed here: that is `simplify`'s job and `fold`'s,
/// and a pass that swept up after itself would be two passes wearing one name.
///
/// Batched over every narrowed value at once, because the substitution walks
/// the whole function and doing it per value made the pass quadratic in the
/// number of calls a function makes.
fn unwrap_uses(func: &mut Func, narrowed: &FxHashMap<ValueId, HirType>) {
    let mut replacements: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match func.values[index].kind {
            OpKind::Unerase { value } if narrowed.contains_key(&value) => {
                replacements.insert(id, value);
            }
            OpKind::TagOf { value } => {
                if let Some(representation) = narrowed.get(&value) {
                    let tag = super::tags::of_representation(representation);
                    func.values[index].kind = OpKind::ConstInt(i128::from(tag));
                }
            }
            _ => {}
        }
    }
    if replacements.is_empty() {
        return;
    }
    let of = |value: ValueId| replacements.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        super::simplify::substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        super::simplify::substitute_terminator(&mut block.terminator, of);
    }
}

/// Pass the value that was about to be erased, rather than the erasure.
fn unwrap_arguments(caller: &mut Func, targets: &[(String, usize)]) {
    for index in 0..caller.values.len() {
        let OpKind::Call {
            callee,
            args,
            frame,
        } = caller.values[index].kind.clone()
        else {
            continue;
        };
        let Callee::Direct(name) = &callee else {
            continue;
        };
        let mut args = args;
        let mut changed = false;
        for (position, argument) in args.iter_mut().enumerate() {
            if !targets
                .iter()
                .any(|(target, at)| target == name && *at == position)
            {
                continue;
            }
            if let OpKind::Erase { value } = caller.values[argument.0 as usize].kind {
                *argument = value;
                changed = true;
            }
        }
        if changed {
            caller.values[index].kind = OpKind::Call {
                callee,
                args,
                frame,
            };
        }
    }
}
