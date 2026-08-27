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
use super::{HirType, OpKind, Program, ValueId};

/// The smallest and largest `int32`.
const I32_MIN: f64 = -2_147_483_648.0;
const I32_MAX: f64 = 2_147_483_647.0;

/// What each function expects, for the pass that inserts the conversions.
///
/// By name, because that is what a `Callee` carries.
pub type Expected = FxHashMap<String, Vec<HirType>>;

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
        for slot in 0..func.params.len() {
            if !matches!(func.params[slot].ty, HirType::Float { .. }) {
                continue;
            }
            // Parameter `i` is value `i`, the convention the whole backend
            // shares.
            let value = ValueId(u32::try_from(slot).unwrap_or(u32::MAX));
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

    changed + narrow_results(program, analyses, &fixed)
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
    if known.is_bottom() || !known.whole || known.maybe_nan || known.maybe_negative_zero {
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
    program
        .funcs
        .iter()
        .map(|func| {
            (
                func.name.clone(),
                func.params.iter().map(|param| param.ty.clone()).collect(),
            )
        })
        .collect()
}

/// Every function whose signature is not this pass's to change.
fn pinned(program: &Program, roots: &super::reachable::RootNames) -> FxHashSet<String> {
    let mut fixed: FxHashSet<String> = roots.clone();
    // Anything a dispatch table names: the implementations of one slot are
    // called through one spelled signature, so they have to agree.
    for layout in &program.layouts {
        for method in layout.methods.iter().flatten() {
            fixed.insert(method.clone());
        }
    }
    fixed
}
