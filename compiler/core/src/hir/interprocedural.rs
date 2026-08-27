//! Carrying facts across function boundaries.
//!
//! # What a per-function analysis cannot see
//!
//! Two things, and between them they account for most of what stays unprovable
//! in a program made of small functions:
//!
//! - **A parameter is written by callers.** Analyzed alone, every parameter is
//!   as wide as its declared type, which for `number` is everything.
//! - **A call's result is decided by the callee.** Analyzed alone, every call
//!   returns TOP, and a TOP poisons every value downstream of it.
//!
//! # Where it has to stop
//!
//! At the program's edge. An **exported** function's callers are outside the
//! compiled set, so nothing observed inside the program bounds its parameters —
//! it keeps whatever its declared type says and no more. Narrowing those from
//! the calls that happen to be visible would be exactly the unsoundness this
//! analysis exists to avoid: the next caller is a linker away.
//!
//! An external callee is the same wall from the other side. Its body is not
//! here, so its result is TOP.
//!
//! # Why a fixpoint rather than one pass
//!
//! Recursion. `fib` calls itself, so its parameter facts depend on its own
//! analysis, which depends on its parameter facts. Starting every non-exported
//! parameter at BOTTOM and joining upward is the least fixpoint, and it
//! terminates because the lattice has finite height under widening.
//!
//! # Why two fixpoints, one inside the other
//!
//! Counting a loop's iterations produces facts the value domain cannot reach on
//! its own: it knows what one round does, not how many rounds there are. So
//! [`super::loops`] runs over a settled analysis and hands back bounds — and
//! those bounds are what a *caller's* argument is made of, so the parameter
//! fixpoint has to be run again with them.
//!
//! Skipping that feedback is not a small loss. A closure called as `f(i)` from
//! `for (i = 0; i < 4096; i++)` had its parameter at the widened `[0, 2^31)`
//! rather than `[0, 4096]`, so `x * 2654435761` was not provably inside 2^53
//! and stayed floating point — three runtime helper calls per iteration for
//! arithmetic that fits in a register.

use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::{self, Analysis, Context};
use super::{Callee, Func, OpKind, Program, Terminator, ValueId};

/// A bound on the call-graph iteration, in case a lattice mistake keeps some
/// parameter growing. Convergence is normally a handful of rounds; reaching
/// this means a bug, and looping forever would hide it.
const ROUND_CAP: u32 = 32;

/// How many times loop bounds may feed back into parameter facts.
///
/// Each round is a full inner fixpoint, so this is a cost as much as a bound.
/// Two rounds is what carries a loop counter into a callee's parameter and back
/// out as that callee's return; more has never changed an answer here.
const FEEDBACK_CAP: u32 = 4;

/// What the whole program contributes to each function's analysis.
struct Crossing {
    /// Facts for each function's parameters, by function index.
    params: Vec<Vec<Facts>>,
    /// What each function returns, by name.
    returns: FxHashMap<String, Facts>,
    /// What a dispatch through each slot returns.
    slot_returns: FxHashMap<u32, Facts>,
    /// What each object field can hold, over every store in the program.
    fields: super::fields::FieldFacts,
}

/// Analyze every function, letting facts cross between them.
#[must_use]
pub fn analyze_program(program: &Program) -> Vec<Analysis> {
    let in_slot = program.slot_targets();
    let mut caps: Vec<FxHashMap<ValueId, Facts>> =
        program.funcs.iter().map(|_| FxHashMap::default()).collect();
    let mut analyses = settle(program, &in_slot, &caps);

    for _ in 0..FEEDBACK_CAP {
        let next: Vec<_> = program
            .funcs
            .iter()
            .zip(&analyses)
            .map(|(func, analysis)| super::loops::accumulator_caps(func, analysis))
            .collect();
        if next == caps {
            break;
        }
        caps = next;
        analyses = settle(program, &in_slot, &caps);
    }
    analyses
}

/// Run the parameter and return fixpoint to convergence, given loop bounds.
fn settle(
    program: &Program,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    caps: &[FxHashMap<ValueId, Facts>],
) -> Vec<Analysis> {
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    let mut crossing = Crossing {
        params: program.funcs.iter().map(declared_params).collect(),
        returns: FxHashMap::default(),
        slot_returns: FxHashMap::default(),
        fields: FxHashMap::default(),
    };
    let mut analyses = analyze_all(program, &crossing, caps);

    for _ in 0..ROUND_CAP {
        analyses = analyze_all(program, &crossing, caps);

        // Rebuilt from nothing each round rather than accumulated, so that this
        // is a Kleene iteration over the whole system and not a monotone drift
        // that can never take anything back.
        let mut params: Vec<Vec<Facts>> = program
            .funcs
            .iter()
            .map(|func| {
                if func.exported {
                    // The program's edge. Callers are outside it.
                    declared_params(func)
                } else {
                    vec![Facts::BOTTOM; func.params.len()]
                }
            })
            .collect();

        for (caller, func) in program.funcs.iter().enumerate() {
            for value in &func.values {
                let OpKind::Call { callee, args } = &value.kind else {
                    continue;
                };
                for callee in targets_of(callee, &by_name, in_slot) {
                    if program.funcs[callee].exported {
                        continue;
                    }
                    for (slot, arg) in args.iter().enumerate() {
                        if let Some(slot) = params[callee].get_mut(slot) {
                            *slot = slot.join(analyses[caller].get(*arg));
                        }
                    }
                }
            }
        }

        let returns = return_facts(program, &analyses);
        let slot_returns = slot_return_facts(program, in_slot, &returns);
        // In the same fixpoint as parameters and returns, because they feed
        // each other: a field is written with a value a call produced, and read
        // to make an argument for the next one.
        let fields = super::fields::analyze(program, &analyses);
        if params == crossing.params
            && returns == crossing.returns
            && slot_returns == crossing.slot_returns
            && fields == crossing.fields
        {
            break;
        }
        crossing = Crossing {
            params,
            returns,
            slot_returns,
            fields,
        };
    }
    analyses
}

/// Which functions a call can reach.
///
/// A dispatch reaches every implementation of its slot, and each of them is
/// called with these arguments. Missing that is not imprecision: a function
/// with no *visible* caller has parameters at BOTTOM, which folds its body to a
/// constant — so a closure reached only through its slot compiled to
/// `return 0`.
fn targets_of(
    callee: &Callee,
    by_name: &FxHashMap<&str, usize>,
    in_slot: &FxHashMap<u32, Vec<usize>>,
) -> Vec<usize> {
    match callee {
        Callee::Direct(name) => by_name.get(name.as_str()).copied().into_iter().collect(),
        Callee::External(_) => Vec::new(),
        Callee::Virtual { slot, .. } | Callee::Closure { slot } => {
            in_slot.get(slot).cloned().unwrap_or_default()
        }
    }
}

/// Analyze every function once, given what crosses into it.
fn analyze_all(
    program: &Program,
    crossing: &Crossing,
    caps: &[FxHashMap<ValueId, Facts>],
) -> Vec<Analysis> {
    program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| {
            flow::analyze_with(
                func,
                &Context {
                    params: crossing.params[index].clone(),
                    returns: crossing.returns.clone(),
                    slot_returns: crossing.slot_returns.clone(),
                    field_facts: crossing.fields.clone(),
                    caps: caps.get(index).cloned().unwrap_or_default(),
                },
            )
        })
        .collect()
}

/// What each parameter's declared type admits, before any caller is seen.
fn declared_params(func: &Func) -> Vec<Facts> {
    func.params.iter().map(|param| param.known).collect()
}

/// What a call through each dispatch slot can return.
///
/// The join over every implementation the slot holds. A slot with no
/// implementations is absent rather than BOTTOM: it means the tables are not
/// built yet, which is TOP at the use.
fn slot_return_facts(
    program: &Program,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    returns: &FxHashMap<String, Facts>,
) -> FxHashMap<u32, Facts> {
    let mut found = FxHashMap::default();
    for (slot, targets) in in_slot {
        let mut joined = Facts::BOTTOM;
        for target in targets {
            joined = joined.join(
                returns
                    .get(&program.funcs[*target].name)
                    .copied()
                    .unwrap_or(Facts::TOP),
            );
        }
        found.insert(*slot, joined);
    }
    found
}

/// What each function was proven to return, by name.
fn return_facts(program: &Program, analyses: &[Analysis]) -> FxHashMap<String, Facts> {
    let mut returns = FxHashMap::default();
    for (index, func) in program.funcs.iter().enumerate() {
        let mut result = Facts::BOTTOM;
        for block in &func.blocks {
            // A `return` with no value is not a number, and a function that
            // never returns one has nothing to say here.
            if let Terminator::Return(Some(value)) = block.terminator {
                result = result.join(analyses[index].get(value));
            }
        }
        returns.insert(func.name.clone(), result);
    }
    returns
}
