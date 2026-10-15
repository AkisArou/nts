//! Giving a function the parameter types its callers actually pass.
//!
//! # The cost of not doing it
//!
//! `specialize` proves values into integers inside a function and stops at its
//! boundary, because a parameter's representation is the function's ABI. So a
//! *number* crosses every call as a double: the caller converts on the way in
//! and the callee works in doubles on the way out, however tightly both sides
//! are proven.
//!
//! For a program made of small functions that is most of the arithmetic.
//!
//! # Why it is sound
//!
//! The interprocedural analysis already computes what a parameter can be over
//! *every* call site in the program — that is what it is for. A parameter
//! proved to be a whole number inside `int32` at every one of them can be an
//! `int32`, and the conversion at each call is a cast that cannot be out of
//! range because the same analysis said so.
//!
//! The facts are taken at the *call*, not at the argument's definition, which
//! is what makes a recursive function work: `fib(n - 1)` sits under
//! `if (n < 2) return n`, so `n` is at least two there and `n - 1` is at least
//! one. Without that refinement the fixpoint widens downward forever and
//! nothing is provable.
//!
//! # Where it stops
//!
//! - **A root.** Its callers are outside the compiled set, so nothing is known
//!   about its arguments and its signature is its published ABI. [`super::guards`]
//!   is how a root gets an integer body anyway.
//! - **Anything a dispatch table names.** Every implementation of a slot is
//!   called through one spelled signature, because the call site spells it
//!   without knowing which body runs.

use rustc_hash::{FxHashMap, FxHashSet};

use super::facts;
use super::flow::Analysis;
use super::{HirType, OpKind, Program};

/// The smallest and largest `int32`.
const I32_MIN: f64 = -2_147_483_648.0;
const I32_MAX: f64 = 2_147_483_647.0;

/// What each function expects, for the pass that inserts the conversions.
///
/// By name, because that is what a `Callee` carries -- and, for a call through
/// a typed signature, which carries no name, by the receiver's type and the
/// slot: what that signature's entry takes once [`narrow_typed_signatures`]
/// has narrowed it.
#[derive(Debug, Default)]
pub struct Expected {
    by_name: FxHashMap<String, Vec<HirType>>,
    by_slot: FxHashMap<(super::TypeId, u32), Vec<HirType>>,
}

impl Expected {
    /// What the function of this name takes.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&Vec<HirType>> {
        self.by_name.get(name)
    }

    /// What a call through `slot` on a receiver of this type takes, where the
    /// receiver's type is a typed signature.
    #[must_use]
    pub fn of_slot(&self, receiver: super::TypeId, slot: u32) -> Option<&Vec<HirType>> {
        self.by_slot.get(&(receiver, slot))
    }
}

/// Narrow what can be narrowed, and report how many parameters changed.
pub fn specialize(
    program: &mut Program,
    analyses: &[Analysis],
    roots: &super::reachable::RootNames,
) -> usize {
    let fixed = pinned(program, roots);
    let mut changed = 0;

    for (index, func) in program.funcs.iter_mut().enumerate() {
        if fixed.contains(&func.name) {
            continue;
        }
        let Some(parameters) = func.parameter_values() else {
            continue;
        };
        for (slot, value) in parameters.into_iter().enumerate() {
            let Some(value) = value else { continue };
            if !matches!(func.params[slot].ty, HirType::Float { .. }) {
                continue;
            }
            // The strict form: a parameter that might be a negative zero cannot
            // be an integer, and unlike a local there is no single place
            // downstream to ask whether anything can tell the two apart.
            let bits = if analyses[index].is_integral_within(value, I32_MIN, I32_MAX) {
                32
            } else if analyses[index].is_integral_within(value, facts::SAFE_MIN, facts::SAFE_MAX) {
                // Past 2^53 an `f64` cannot tell adjacent integers apart, so
                // there is nothing to prove and nothing to represent.
                64
            } else {
                continue;
            };
            let ty = HirType::Int { bits, signed: true };
            func.params[slot].known = analyses[index].get(value);
            func.params[slot].ty = ty.clone();
            func.values[value.0 as usize].ty = ty;
            changed += 1;
        }
    }

    changed
        + narrow_results(program, analyses, &fixed)
        + narrow_typed_signatures(program, analyses, roots)
}

/// Narrow a typed signature's ABI, its entry and every closure under it
/// together.
///
/// Every implementation of a slot is pinned ([`pinned`]), because a dispatch
/// spells one signature without knowing which body runs. A typed signature
/// ([`Program::typed_signatures`]) is the exception that rule is waiting for:
/// the bodies a call through it can reach are exactly the closures under it,
/// so the slot's one spelled signature can change if all of them change with
/// it. The analysis already joins a slot call's arguments into every body of
/// the slot, so each body's parameter facts cover every call through the
/// signature.
///
/// Without it a closure over integers takes and returns `f64` at the
/// signature, whatever its callers pass: `closure-merge`'s typed call kept a
/// double loop counter alive across the call, which clang spilled and reloaded
/// every iteration, and the row was slower than the uniform entry it replaced
/// on the P-cores despite running 2.7x fewer instructions.
///
/// Nothing narrows where a member is a root -- called from outside the
/// compiled set, whose arguments nothing knows.
fn narrow_typed_signatures(
    program: &mut Program,
    analyses: &[Analysis],
    roots: &super::reachable::RootNames,
) -> usize {
    let Some(slot) = program.closure_slot else {
        return 0;
    };
    let mut changed = 0;
    let signatures: Vec<String> = program.typed_signatures.iter().cloned().collect();
    for name in signatures {
        let Some(group) = members(program, &name, slot) else {
            continue;
        };
        if group
            .iter()
            .any(|&member| roots.contains(&program.funcs[member].name))
        {
            continue;
        }
        changed += narrow_group_params(program, analyses, &group);
        changed += narrow_group_result(program, analyses, &group, &name, slot);
    }
    changed
}

/// A typed signature's entry declaration, then each closure body under it.
fn members(program: &Program, signature: &str, slot: u32) -> Option<Vec<usize>> {
    let at = program
        .layouts
        .iter()
        .position(|layout| layout.name == signature)?;
    let entry = |layout: usize| -> Option<usize> {
        let name = program.layouts[layout]
            .methods
            .get(slot as usize)
            .cloned()
            .flatten()?;
        program.funcs.iter().position(|func| func.name == name)
    };
    let mut group = vec![entry(at)?];
    for layout in 0..program.layouts.len() {
        if layout != at && super::typed_signatures::descends(program, layout, at) {
            // A closure whose `#call` was refused has none to narrow: its
            // entry is the stub each backend writes, which takes nothing.
            if let Some(body) = entry(layout) {
                group.push(body);
            }
        }
    }
    Some(group)
}

/// Narrow each parameter every body proves whole, in the declaration and in
/// every body at once.
fn narrow_group_params(program: &mut Program, analyses: &[Analysis], group: &[usize]) -> usize {
    let (entry, bodies) = (group[0], &group[1..]);
    if bodies.is_empty() {
        return 0;
    }
    let arity = program.funcs[entry].params.len();
    let mut changed = 0;
    // From 1: the receiver is the signature's object, never a number.
    for slot in 1..arity {
        let mut bits = 0u8;
        let mut values = Vec::with_capacity(bodies.len());
        for &body in bodies {
            let func = &program.funcs[body];
            let value = func
                .parameter_values()
                .and_then(|values| values.get(slot).copied().flatten());
            let Some(value) = value else {
                bits = 0;
                break;
            };
            if !matches!(
                func.params.get(slot).map(|param| &param.ty),
                Some(HirType::Float { .. })
            ) {
                bits = 0;
                break;
            }
            let width = if analyses[body].is_integral_within(value, I32_MIN, I32_MAX) {
                32
            } else if analyses[body].is_integral_within(value, facts::SAFE_MIN, facts::SAFE_MAX) {
                64
            } else {
                bits = 0;
                break;
            };
            bits = bits.max(width);
            values.push((body, value));
        }
        if bits == 0 || !matches!(program.funcs[entry].params[slot].ty, HirType::Float { .. }) {
            continue;
        }
        let ty = HirType::Int { bits, signed: true };
        program.funcs[entry].params[slot].ty = ty.clone();
        for (body, value) in values {
            let func = &mut program.funcs[body];
            func.params[slot].known = analyses[body].get(value);
            func.params[slot].ty = ty.clone();
            func.values[value.0 as usize].ty = ty.clone();
        }
        changed += 1;
    }
    changed
}

/// Narrow the result where every body returns a whole number, and retype each
/// call through the signature with it, as [`narrow_results`] does a direct
/// call's.
fn narrow_group_result(
    program: &mut Program,
    analyses: &[Analysis],
    group: &[usize],
    signature: &str,
    slot: u32,
) -> usize {
    let (entry, bodies) = (group[0], &group[1..]);
    if bodies.is_empty() || !matches!(program.funcs[entry].return_type, HirType::Float { .. }) {
        return 0;
    }
    let mut bits = 0u8;
    for &body in bodies {
        let func = &program.funcs[body];
        if !matches!(func.return_type, HirType::Float { .. }) {
            return 0;
        }
        let Some(width) = width_of(returns_of(func, &analyses[body])) else {
            return 0;
        };
        bits = bits.max(width);
    }
    let ty = HirType::Int { bits, signed: true };
    let names: FxHashSet<String> = group
        .iter()
        .map(|&member| program.funcs[member].name.clone())
        .collect();
    for &member in group {
        program.funcs[member].return_type = ty.clone();
    }
    // Every call that reaches a member: through the slot on a receiver of any
    // layout in the group -- the signature, or a closure's own class where a
    // specialized clone knows which closure it holds -- and directly by name.
    let types: FxHashSet<super::TypeId> =
        super::typed_signatures::group_layouts(program, signature)
            .into_iter()
            .flat_map(|layout| program.layouts[layout].types.clone())
            .collect();
    for func in &mut program.funcs {
        let retyped: Vec<usize> = func
            .values
            .iter()
            .enumerate()
            .filter_map(|(at, op)| match &op.kind {
                OpKind::Call {
                    callee: super::Callee::Closure { slot: called },
                    args,
                    ..
                } if *called == slot => {
                    let receiver = args.first()?;
                    let super::HirType::Managed(super::ManagedType::Object(receiver)) =
                        &func.values[receiver.0 as usize].ty
                    else {
                        return None;
                    };
                    types.contains(receiver).then_some(at)
                }
                OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } => names.contains(name).then_some(at),
                _ => None,
            })
            .collect();
        for at in retyped {
            func.values[at].ty = ty.clone();
        }
    }
    1
}

/// Give a function the machine type of what it actually returns.
///
/// The mirror of narrowing a parameter, and needed for the same reason: `fib`
/// with an `int32` parameter still adds two doubles, because the recursive
/// calls hand back the declared `number`. What the analysis proved about the
/// returns is exactly the fact required.
///
/// Every call site is retyped with it. Leaving the call's type alone would
/// merely move the conversion: C would convert the integer result back to a
/// double at the assignment, which is where it started.
fn narrow_results(
    program: &mut Program,
    analyses: &[Analysis],
    fixed: &FxHashSet<String>,
) -> usize {
    let mut narrowed: FxHashMap<String, HirType> = FxHashMap::default();
    for (index, func) in program.funcs.iter().enumerate() {
        if fixed.contains(&func.name) || !matches!(func.return_type, HirType::Float { .. }) {
            continue;
        }
        let returned = returns_of(func, &analyses[index]);
        let Some(bits) = width_of(returned) else {
            continue;
        };
        narrowed.insert(func.name.clone(), HirType::Int { bits, signed: true });
    }
    if narrowed.is_empty() {
        return 0;
    }

    for func in &mut program.funcs {
        if let Some(ty) = narrowed.get(&func.name) {
            func.return_type = ty.clone();
        }
        for op in &mut func.values {
            let OpKind::Call {
                callee: super::Callee::Direct(name),
                ..
            } = &op.kind
            else {
                continue;
            };
            if let Some(ty) = narrowed.get(name) {
                op.ty = ty.clone();
            }
        }
    }
    narrowed.len()
}

/// What a function's `return`s are worth together.
fn returns_of(func: &super::Func, analysis: &Analysis) -> super::facts::Facts {
    let mut result = super::facts::Facts::BOTTOM;
    for block in &func.blocks {
        if let super::Terminator::Return(Some(value)) = block.terminator {
            result = result.join(analysis.get(value));
        }
    }
    result
}

/// The width a set of values fits in, if any.
fn width_of(known: super::facts::Facts) -> Option<u8> {
    if known.is_bottom() || !known.integral() || known.maybe_nan || known.maybe_negative_zero {
        return None;
    }
    if known.lo >= I32_MIN && known.hi <= I32_MAX {
        Some(32)
    } else if known.lo >= facts::SAFE_MIN && known.hi <= facts::SAFE_MAX {
        Some(64)
    } else {
        None
    }
}

/// What every function expects, once the narrowing has settled.
#[must_use]
pub fn expected(program: &Program) -> Expected {
    let by_name: FxHashMap<String, Vec<HirType>> = program
        .funcs
        .iter()
        .map(|func| {
            (
                func.name.clone(),
                func.params.iter().map(|param| param.ty.clone()).collect(),
            )
        })
        .collect();
    // Each layout a typed signature's calls reach -- the signature and every
    // closure class under it, since a specialized clone can hold the closure's
    // own class -- takes what its own entry in the slot takes.
    let mut by_slot = FxHashMap::default();
    if let Some(slot) = program.closure_slot {
        for signature in &program.typed_signatures {
            for layout in super::typed_signatures::group_layouts(program, signature) {
                let layout = &program.layouts[layout];
                let Some(params) = layout
                    .methods
                    .get(slot as usize)
                    .cloned()
                    .flatten()
                    .and_then(|entry| by_name.get(&entry).cloned())
                else {
                    continue;
                };
                for ty in &layout.types {
                    by_slot.insert((*ty, slot), params.clone());
                }
            }
        }
    }
    Expected { by_name, by_slot }
}

/// Every function whose signature is not this pass's to change.
fn pinned(program: &Program, roots: &super::reachable::RootNames) -> FxHashSet<String> {
    let mut fixed: FxHashSet<String> = roots.clone();
    // Anything a dispatch table names: the implementations of one slot are
    // called through one spelled signature, so they have to agree.
    fixed.extend(program.dispatch_targets().map(str::to_owned));
    fixed
}
