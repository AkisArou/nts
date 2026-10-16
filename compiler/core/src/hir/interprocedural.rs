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

use super::facts::{self, Facts};
use super::flow::{self, Analysis, Context};
use super::{Callee, Func, HirType, OpKind, Program, Terminator, TypeId, ValueId};

/// A bound on the call-graph iteration, in case a lattice mistake keeps some
/// parameter growing. Convergence is normally a handful of rounds; reaching
/// this means a bug, and looping forever would hide it. What the iteration
/// holds then is not a fixpoint -- a bound still climbing from the bottom is
/// true of the rounds so far and of nothing after -- so it is not handed on:
/// [`settle`] answers as though nothing crossed between functions.
const ROUND_CAP: u32 = 32;

/// Rounds a whole-program fact may change before it is widened.
///
/// [`flow`] widens a loop header after three visits, because a counter's bound
/// grows by one per round and a million-trip loop cannot take a million rounds.
/// The same holds one level up, and nothing did it there: a fact that feeds
/// itself across a call or a field -- a counter field written with its own
/// value plus a step, a position handed to a callee that returns it one
/// further -- grew by one step per round and never settled. The iteration ran
/// into [`ROUND_CAP`] and handed on what it had then: a field bounded by 32
/// steps, laid out as an `i32`, that wrapped
/// (`tests/programs/a-value-fed-back-across-calls-past-int32`), and every one
/// of `runtime/node/fs`'s six whole-program analyses paid all 32 rounds. 56 of
/// the 570 programs and 8 of the 63 benchmarks never settled.
///
/// Three, as for a loop header, and measured rather than borrowed: with three,
/// every program and benchmark whose fixpoint settled without widening emits
/// the same C as it did, and every one that did not now settles. A fact can
/// take more changes than that to settle -- five in `user-iterable`, nineteen
/// for a counter that climbs to its guard -- and widening such a fact early
/// jumps it to the next of [`facts::widen`]'s thresholds, which are where a
/// representation changes. A count of eight let a fact that changes once per
/// three-function cycle spend 24 rounds before widening, and one program then
/// reached the cap anyway.
const WIDEN_AFTER: u32 = 3;

/// How many times loop bounds may feed back into parameter facts.
///
/// Each round is a full inner fixpoint, so this is a cost as much as a bound.
/// Two rounds is what carries a loop counter into a callee's parameter and back
/// out as that callee's return; more has never changed an answer here.
const FEEDBACK_CAP: u32 = 4;

/// What the whole program contributes to each function's analysis.
///
/// The whole-program maps -- returns, slot returns, fields, elements, globals
/// -- live in one [`flow::Whole`] that every function *borrows*. They were
/// seven separate fields cloned into each function's `Context`, which is a copy
/// of a map with one entry per function, per function, per round: quadratic in
/// the size of the module, and on `runtime/node/stream` three quarters of the
/// compile.
struct Crossing {
    /// Facts for each function's parameters, by function index.
    params: Vec<Vec<Facts>>,
    /// How long the array each parameter points at can be, per function and
    /// slot. In this fixpoint rather than beside it because it is read from the
    /// arguments at every call, which is what this loop already walks.
    param_lengths: Vec<Vec<Facts>>,
    /// Everything every function reads: returns, dispatch returns, and what
    /// fields, elements and globals hold across the program. Fields, elements
    /// and globals are in this fixpoint for the same reason returns are -- a
    /// field is written with what a call produced and read to make the next
    /// call's argument, so outside the loop each would be one round stale.
    whole: flow::Whole,
}

/// Analyze every function, letting facts cross between them.
#[must_use]
pub fn analyze_program(program: &Program, roots: super::reachable::Roots<'_>) -> Vec<Analysis> {
    analyze_assuming(program, roots, super::arrays_can_grow(program))
}

/// [`analyze_program`], told whether any array in the program can change
/// length rather than asking.
///
/// The one caller that tells it otherwise is
/// [`super::bounds::prove_stores_cannot_grow`]: it analyses a program whose
/// only possible growth is its own checked stores as though none of them grew,
/// and keeps the answer only if every one of those stores is then proven in
/// range. A property of the whole program rather than of a round.
#[must_use]
pub fn analyze_assuming(
    program: &Program,
    roots: super::reachable::Roots<'_>,
    growable: bool,
) -> Vec<Analysis> {
    let in_slot = program.slot_targets();
    // The exports, **and every closure the runtime can call**. Both are the
    // same wall: a function whose callers are not in the compiled set has no
    // join to take, and the difference between them is only that one is
    // declared and the other is handed over as an argument.
    //
    // Without the second, such a function's parameters join to BOTTOM -- the
    // empty interval -- and BOTTOM is the identity for join, so a global
    // assigned only from a callback keeps its initial value and every read of
    // it folds to that. See `reachable::callback_names`.
    let outward: rustc_hash::FxHashSet<&str> = super::reachable::root_names(program, roots)
        .into_iter()
        .chain(super::reachable::callback_names(program))
        .collect();
    let mut caps: Vec<FxHashMap<ValueId, Facts>> =
        program.funcs.iter().map(|_| FxHashMap::default()).collect();
    let written = flow::Written::of(program);
    let mut analyses = settle(program, &in_slot, &outward, &written, &caps, growable);

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
        analyses = settle(program, &in_slot, &outward, &written, &caps, growable);
    }
    analyses
}

/// Run the parameter and return fixpoint to convergence, given loop bounds.
fn settle(
    program: &Program,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    outward: &rustc_hash::FxHashSet<&str>,
    written: &flow::Written,
    caps: &[FxHashMap<ValueId, Facts>],
    growable: bool,
) -> Vec<Analysis> {
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();

    let exposed = super::exposure::analyze(program, outward);
    let mut crossing = Crossing {
        params: seed(program, outward),
        param_lengths: no_lengths(program),
        whole: flow::Whole {
            // BOTTOM rather than absent, for the same reason parameters start
            // there: an absent entry reads as TOP at the use, and a function
            // whose result depends on its own result then converges to TOP.
            // `fib` returns `fib(n - 1) + fib(n - 2)`.
            returns: program
                .funcs
                .iter()
                .map(|func| (func.name.clone(), Facts::BOTTOM))
                .collect(),
            slot_returns: FxHashMap::default(),
            // Not empty: an absent entry reads as TOP at the use, and a field
            // whose value depends on its own then settles at TOP in round one
            // and never moves. See `fields::initial`.
            field_facts: super::fields::initial(program, &exposed.fields),
            element_facts: FxHashMap::default(),
            global_facts: FxHashMap::default(),
            growable,
        },
    };
    let mut changes = Changes::default();

    for _ in 0..ROUND_CAP {
        let analyses = analyze_all(program, &crossing, written, caps);

        let params = widened_slots(
            &mut changes.params,
            &crossing.params,
            arguments(program, &analyses, &by_name, in_slot, outward),
        );
        let returns = widened(
            &mut changes.returns,
            &crossing.whole.returns,
            return_facts(program, &analyses),
        );
        // From the widened returns, so that it settles when they do.
        let slot_returns = slot_return_facts(program, in_slot, &returns);
        // In the same fixpoint as parameters and returns, because they feed
        // each other: a field is written with a value a call produced, and read
        // to make an argument for the next one.
        let fields = widened(
            &mut changes.fields,
            &crossing.whole.field_facts,
            super::fields::analyze(program, &analyses, &exposed.fields),
        );
        let elements = widened(
            &mut changes.elements,
            &crossing.whole.element_facts,
            super::elements::analyze(program, &analyses, &exposed.elements),
        );
        let globals = widened(
            &mut changes.globals,
            &crossing.whole.global_facts,
            super::globals::analyze(program, &analyses),
        );
        let param_lengths = if growable {
            no_lengths(program)
        } else {
            widened_slots(
                &mut changes.lengths,
                &crossing.param_lengths,
                super::fields::parameter_lengths(program, &analyses, outward),
            )
        };
        let whole = flow::Whole {
            returns,
            slot_returns,
            field_facts: fields,
            element_facts: elements,
            global_facts: globals,
            growable,
        };
        if params == crossing.params
            && param_lengths == crossing.param_lengths
            && whole == crossing.whole
        {
            return analyses;
        }
        crossing = Crossing {
            params,
            param_lengths,
            whole,
        };
    }
    analyze_all(
        program,
        &Crossing::nothing(program, growable),
        written,
        caps,
    )
}

impl Crossing {
    /// What crosses between functions when nothing is known to: every
    /// parameter what its declaration admits, and every return, field, element
    /// and global absent, which reads as TOP at the use. Sound without a
    /// fixpoint, which is why it is the answer when the fixpoint fails.
    fn nothing(program: &Program, growable: bool) -> Self {
        Self {
            params: program.funcs.iter().map(declared_params).collect(),
            param_lengths: no_lengths(program),
            whole: flow::Whole {
                returns: FxHashMap::default(),
                slot_returns: FxHashMap::default(),
                field_facts: FxHashMap::default(),
                element_facts: FxHashMap::default(),
                global_facts: FxHashMap::default(),
                growable,
            },
        }
    }
}

/// How many rounds each whole-program fact has changed in. See [`WIDEN_AFTER`].
#[derive(Default)]
struct Changes {
    /// By function and parameter slot.
    params: FxHashMap<(usize, usize), u32>,
    /// By function and parameter slot.
    lengths: FxHashMap<(usize, usize), u32>,
    returns: FxHashMap<String, u32>,
    fields: FxHashMap<(TypeId, u32), u32>,
    elements: FxHashMap<HirType, u32>,
    globals: FxHashMap<u32, u32>,
}

/// One fact's next round: what this round computed while the fact is still
/// settling, and once it has changed more than [`WIDEN_AFTER`] times, the
/// widened join of this round and the last. That can only grow, and grows by
/// jumps to the thresholds [`facts::widen`] knows, so it stops. `None` is an
/// absent entry, TOP at the use, and a widened fact that reaches it stays.
fn widen_one(changes: &mut u32, previous: Option<Facts>, next: Option<Facts>) -> Option<Facts> {
    if previous == next {
        return next;
    }
    *changes += 1;
    if *changes <= WIDEN_AFTER {
        return next;
    }
    Some(facts::widen(previous?, previous?.join(next?)))
}

/// [`widen_one`] over a map of facts, an absent entry being TOP.
fn widened<K: Clone + Eq + std::hash::Hash>(
    changes: &mut FxHashMap<K, u32>,
    previous: &FxHashMap<K, Facts>,
    next: FxHashMap<K, Facts>,
) -> FxHashMap<K, Facts> {
    for gone in previous.keys().filter(|key| !next.contains_key(*key)) {
        *changes.entry(gone.clone()).or_default() += 1;
    }
    next.into_iter()
        .filter_map(|(key, facts)| {
            let count = changes.entry(key.clone()).or_default();
            widen_one(count, previous.get(&key).copied(), Some(facts)).map(|facts| (key, facts))
        })
        .collect()
}

/// [`widen_one`] over facts by function and parameter slot.
fn widened_slots(
    changes: &mut FxHashMap<(usize, usize), u32>,
    previous: &[Vec<Facts>],
    mut next: Vec<Vec<Facts>>,
) -> Vec<Vec<Facts>> {
    for (func, (next, previous)) in next.iter_mut().zip(previous).enumerate() {
        for (slot, (next, previous)) in next.iter_mut().zip(previous).enumerate() {
            let count = changes.entry((func, slot)).or_default();
            *next = widen_one(count, Some(*previous), Some(*next)).unwrap_or(Facts::TOP);
        }
    }
    next
}

/// What every caller hands each parameter this round: the join over every call
/// that can reach it, from what the caller knew at the call.
///
/// Rebuilt from nothing each round rather than accumulated, so that this is a
/// Kleene iteration over the whole system and not a monotone drift that can
/// never take anything back. What keeps it from climbing forever is
/// [`widened_slots`], not this.
fn arguments(
    program: &Program,
    analyses: &[Analysis],
    by_name: &FxHashMap<&str, usize>,
    in_slot: &FxHashMap<u32, Vec<usize>>,
    outward: &rustc_hash::FxHashSet<&str>,
) -> Vec<Vec<Facts>> {
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
                let OpKind::Call { callee, args, .. } = &func.values[value.0 as usize].kind else {
                    continue;
                };
                for callee in targets_of(callee, by_name, in_slot) {
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
    params
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
        Callee::External(_) | Callee::Native(_) => Vec::new(),
        Callee::Virtual { slot, .. } | Callee::Closure { slot } => {
            in_slot.get(slot).cloned().unwrap_or_default()
        }
    }
}

/// Analyze every function once, given what crosses into it.
fn analyze_all(
    program: &Program,
    crossing: &Crossing,
    written: &flow::Written,
    caps: &[FxHashMap<ValueId, Facts>],
) -> Vec<Analysis> {
    // A function with no loop bounds of its own borrows this rather than
    // making an empty map, which is the same allocation `Context` used to make
    // for every function in the program on every round.
    let nothing = FxHashMap::default();
    program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| {
            flow::analyze_with(
                func,
                &Context {
                    params: &crossing.params[index],
                    param_lengths: &crossing.param_lengths[index],
                    caps: caps.get(index).unwrap_or(&nothing),
                    whole: &crossing.whole,
                    written,
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn upto(hi: f64) -> Facts {
        Facts::new(0.0, hi, true, false, false)
    }

    /// Rounds of `next = step(previous)` through [`widen_one`] until nothing
    /// changes, as [`settle`] runs them: the fact it stops at, and how many
    /// rounds that took.
    fn run(step: impl Fn(Facts) -> Facts) -> (Facts, u32) {
        let (mut changes, mut fact) = (0, upto(0.0));
        for round in 1..=ROUND_CAP {
            let next = widen_one(&mut changes, Some(fact), Some(step(fact))).unwrap();
            if next == fact {
                return (fact, round);
            }
            fact = next;
        }
        panic!("still changing after {ROUND_CAP} rounds: {fact:?}");
    }

    #[test]
    fn a_fact_that_feeds_itself_a_step_is_widened_and_stops() {
        // A counter field written with its own value plus one: without
        // widening, one step per round and the round cap.
        let (fact, rounds) = run(|fact| upto(fact.hi + 1.0));
        assert_eq!(fact, upto(f64::INFINITY), "nothing bounds it");
        assert!(rounds < 12, "{rounds} rounds");
    }

    #[test]
    fn a_fact_that_settles_is_what_the_round_computed() {
        let settles = |fact: Facts| upto((fact.hi + 2.0).min(5.0));
        assert_eq!(
            run(settles).0,
            upto(5.0),
            "no threshold jump before it settles"
        );
    }

    #[test]
    fn a_fact_still_settling_may_narrow() {
        let mut changes = 0;
        let back = widen_one(&mut changes, Some(upto(10.0)), Some(upto(4.0)));
        assert_eq!(
            back,
            Some(upto(4.0)),
            "taken back while under WIDEN_AFTER changes"
        );
    }

    #[test]
    fn a_widened_fact_only_grows() {
        let mut changes = WIDEN_AFTER;
        let held = widen_one(&mut changes, Some(upto(10.0)), Some(upto(4.0)));
        assert_eq!(held, Some(upto(10.0)), "the join keeps what it had");
        let grown = widen_one(&mut changes, Some(upto(10.0)), Some(upto(11.0)));
        assert_eq!(
            grown,
            Some(upto(2_147_483_647.0)),
            "and grows by a threshold jump"
        );
    }

    #[test]
    fn an_absent_entry_is_top_and_a_widened_one_stays_there() {
        let previous: FxHashMap<u32, Facts> =
            [(1, upto(3.0)), (2, upto(3.0))].into_iter().collect();
        let mut changes: FxHashMap<u32, u32> =
            [(1, WIDEN_AFTER), (2, WIDEN_AFTER)].into_iter().collect();
        // Entry 1 went to TOP this round; entry 2 grew.
        let next = widened(
            &mut changes,
            &previous,
            [(2, upto(4.0))].into_iter().collect(),
        );
        assert_eq!(next.get(&1), None);
        assert_eq!(next.get(&2), Some(&upto(2_147_483_647.0)));
        // And once widened, a TOP entry does not come back narrower.
        let again = widened(&mut changes, &next, [(1, upto(3.0))].into_iter().collect());
        assert_eq!(again.get(&1), None);
    }
}
