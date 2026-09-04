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
    /// What the elements of each array type can hold, over every store in the
    /// program. Keyed on the element type rather than on the array, for the
    /// aliasing reason [`super::elements`] gives.
    elements: super::elements::ElementFacts,
    /// What each module-scope variable can hold, over every store in the
    /// program. In this fixpoint for the same reason fields are: a global is
    /// written with what a call produced and read to make the next call's
    /// argument, and outside the loop it would be one round stale.
    globals: super::globals::GlobalFacts,
    /// How long the array each parameter points at can be, per function and
    /// slot. In this fixpoint rather than beside it because it is read from the
    /// arguments at every call, which is what this loop already walks.
    param_lengths: Vec<Vec<Facts>>,
}

/// Analyze every function, letting facts cross between them.
#[must_use]
pub fn analyze_program(program: &Program, roots: super::reachable::Roots<'_>) -> Vec<Analysis> {
    let in_slot = program.slot_targets();
    let outward: rustc_hash::FxHashSet<&str> = super::reachable::root_names(program, roots)
        .into_iter()
        .collect();
    let mut caps: Vec<FxHashMap<ValueId, Facts>> =
        program.funcs.iter().map(|_| FxHashMap::default()).collect();
    let mut analyses = settle(program, &in_slot, &outward, &caps);

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
        analyses = settle(program, &in_slot, &outward, &caps);
    }
    analyses
}

/// Run the parameter and return fixpoint to convergence, given loop bounds.
fn settle(
    program: &Program,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    outward: &rustc_hash::FxHashSet<&str>,
    caps: &[FxHashMap<ValueId, Facts>],
) -> Vec<Analysis> {
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    let mut crossing = Crossing {
        params: seed(program, outward),
        // BOTTOM rather than absent, for the same reason parameters start
        // there: an absent entry reads as TOP at the use, and a function whose
        // result depends on its own result then converges to TOP. `fib`
        // returns `fib(n - 1) + fib(n - 2)`.
        returns: program
            .funcs
            .iter()
            .map(|func| (func.name.clone(), Facts::BOTTOM))
            .collect(),
        slot_returns: FxHashMap::default(),
        // Not empty: an absent entry reads as TOP at the use, and a field
        // whose value depends on its own then settles at TOP in round one and
        // never moves. See `fields::initial`.
        fields: super::fields::initial(program),
        elements: FxHashMap::default(),
        globals: FxHashMap::default(),
        param_lengths: no_lengths(program),
    };
    // A property of the whole program rather than of a round: whether anything
    // in it can change an array's length.
    let growable = super::arrays_can_grow(program);
    let mut analyses = analyze_all(program, &crossing, caps, growable);

    for _ in 0..ROUND_CAP {
        analyses = analyze_all(program, &crossing, caps, growable);

        // Rebuilt from nothing each round rather than accumulated, so that this
        // is a Kleene iteration over the whole system and not a monotone drift
        // that can never take anything back.
        let mut params: Vec<Vec<Facts>> = seed(program, outward);

        for (caller, func) in program.funcs.iter().enumerate() {
            // By block, because what an argument is worth is what is known
            // *where the call happens* rather than where the value was defined.
            // A loop counter is `[0, 8]` at its definition -- the exit value is
            // one of the things it can be -- and `[0, 7]` inside the body,
            // which is the only place the call is. Joining the definition's
            // fact hands the callee a bound one past the end, and an index one
            // past the end is exactly the one a bounds check cannot remove.
            for (at, block) in func.blocks.iter().enumerate() {
                let at = super::BlockId(u32::try_from(at).unwrap_or(0));
                for value in &block.ops {
                    let OpKind::Call { callee, args, .. } = &func.values[value.0 as usize].kind
                    else {
                        continue;
                    };
                    for callee in targets_of(callee, &by_name, in_slot) {
                        if outward.contains(program.funcs[callee].name.as_str()) {
                            continue;
                        }
                        for (slot, arg) in args.iter().enumerate() {
                            if let Some(slot) = params[callee].get_mut(slot) {
                                *slot = slot.join(analyses[caller].get_at(at, *arg));
                            }
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
        let elements = super::elements::analyze(program, &analyses, outward);
        let globals = super::globals::analyze(program, &analyses);
        let param_lengths = if growable {
            no_lengths(program)
        } else {
            super::fields::parameter_lengths(program, &analyses, outward)
        };
        if params == crossing.params
            && returns == crossing.returns
            && slot_returns == crossing.slot_returns
            && fields == crossing.fields
            && elements == crossing.elements
            && globals == crossing.globals
            && param_lengths == crossing.param_lengths
        {
            break;
        }
        crossing = Crossing {
            params,
            returns,
            slot_returns,
            fields,
            elements,
            globals,
            param_lengths,
        };
    }
    analyses
}

/// Where the parameter fixpoint starts.
///
/// BOTTOM for everything the program calls itself, because this is a *least*
/// fixpoint and a least fixpoint has to start at the bottom. Starting at the
/// declared type instead is what a *greatest* fixpoint does, and it converges
/// to the declared type: a recursive function analyzed with TOP parameters
/// passes TOP to itself, joins TOP, and stays there forever. `fib` was
/// unprovable for exactly that reason, and so was every other function that
/// calls itself.
///
/// A root keeps its declared type, since its callers are outside the program
/// and there is nothing to join.
fn seed(program: &Program, outward: &rustc_hash::FxHashSet<&str>) -> Vec<Vec<Facts>> {
    program
        .funcs
        .iter()
        .map(|func| {
            if outward.contains(func.name.as_str()) {
                declared_params(func)
            } else {
                vec![Facts::BOTTOM; func.params.len()]
            }
        })
        .collect()
}

/// Which functions a call can reach.
///
/// A dispatch reaches every implementation of its slot, and each of them is
/// called with these arguments. Missing that is not imprecision: a function
/// with no *visible* caller has parameters at BOTTOM, which folds its body to a
/// constant — so a closure reached only through its slot compiled to
/// `return 0`.
pub(super) fn targets_of(
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
    growable: bool,
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
                    growable,
                    param_lengths: crossing.param_lengths[index].clone(),
                    slot_returns: crossing.slot_returns.clone(),
                    field_facts: crossing.fields.clone(),
                    global_facts: crossing.globals.clone(),
                    element_facts: crossing.elements.clone(),
                    caps: caps.get(index).cloned().unwrap_or_default(),
                },
            )
        })
        .collect()
}

/// No parameter's array length is known: the shape the fixpoint starts from,
/// and the answer for a program whose arrays can grow.
fn no_lengths(program: &Program) -> Vec<Vec<Facts>> {
    program
        .funcs
        .iter()
        .map(|func| vec![Facts::TOP; func.params.len()])
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
