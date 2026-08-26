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

use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::{self, Analysis, Context};
use super::{Callee, Func, OpKind, Program, Terminator};

/// A bound on the call-graph iteration, in case a lattice mistake keeps some
/// parameter growing. Convergence is normally a handful of rounds; reaching
/// this means a bug, and looping forever would hide it.
const ROUND_CAP: u32 = 32;

/// Analyze every function, letting facts cross between them.
#[must_use]
pub fn analyze_program(program: &Program) -> Vec<Analysis> {
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    let mut params: Vec<Vec<Facts>> = program.funcs.iter().map(declared_params).collect();
    let mut returns: FxHashMap<String, Facts> = FxHashMap::default();
    let mut analyses: Vec<Analysis> = Vec::new();

    for _ in 0..ROUND_CAP {
        analyses = program
            .funcs
            .iter()
            .enumerate()
            .map(|(index, func)| {
                flow::analyze_with(
                    func,
                    &Context {
                        params: params[index].clone(),
                        returns: returns.clone(),
                        caps: FxHashMap::default(),
                    },
                )
            })
            .collect();

        // Rebuilt from nothing each round rather than accumulated, so that this
        // is a Kleene iteration over the whole system and not a monotone drift
        // that can never take anything back.
        let mut next: Vec<Vec<Facts>> = program
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
                let OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                } = &value.kind
                else {
                    continue;
                };
                let Some(&callee) = by_name.get(name.as_str()) else {
                    continue;
                };
                if program.funcs[callee].exported {
                    continue;
                }
                for (slot, arg) in args.iter().enumerate() {
                    if let Some(slot) = next[callee].get_mut(slot) {
                        *slot = slot.join(analyses[caller].get(*arg));
                    }
                }
            }
        }

        let next_returns = return_facts(program, &analyses);
        if next == params && next_returns == returns {
            break;
        }
        params = next;
        returns = next_returns;
    }

    // Counting iterations needs facts, and produces facts the value domain
    // cannot reach on its own — so it runs once the ordinary fixpoint has
    // settled, and the whole thing settles again with what it found.
    //
    // Repeated, because the two feed each other. The first round bounds a
    // counter using an increment that widening had already sent to the int32
    // threshold; with the counter now tight, the *next* round bounds the
    // accumulator by the real increment. `for (i = 0; i < 1000; i++) total += i`
    // goes from `[0, 2147483647000]` to `[0, 999000]` this way, which is the
    // difference between an i64 and an i32.
    let mut caps: Vec<FxHashMap<super::ValueId, Facts>> = Vec::new();
    for _ in 0..ROUND_CAP {
        let next_caps: Vec<_> = program
            .funcs
            .iter()
            .zip(&analyses)
            .map(|(func, analysis)| super::loops::accumulator_caps(func, analysis))
            .collect();
        if next_caps == caps || next_caps.iter().all(FxHashMap::is_empty) {
            break;
        }
        caps = next_caps;

        analyses = program
            .funcs
            .iter()
            .enumerate()
            .map(|(index, func)| {
                flow::analyze_with(
                    func,
                    &Context {
                        params: params[index].clone(),
                        returns: returns.clone(),
                        caps: caps[index].clone(),
                    },
                )
            })
            .collect();
    }

    analyses
}

/// What each parameter's declared type admits, before any caller is seen.
fn declared_params(func: &Func) -> Vec<Facts> {
    func.params.iter().map(|param| param.known).collect()
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
