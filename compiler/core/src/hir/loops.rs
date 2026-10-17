//! Bounding what a loop accumulates.
//!
//! # The one thing interval analysis cannot do alone
//!
//! `for (let i = 0; i < 1000; i++) total += i` leaves `total` unbounded. Each
//! round of the fixpoint adds one more `i` to it, the bound keeps growing,
//! widening gives up and sends it to infinity — and an infinite bound is not a
//! whole number, so the accumulator stays a double.
//!
//! The missing fact is not about values, it is about *iterations*: the loop runs
//! at most a thousand times, and each time adds at most a thousand, so `total`
//! never exceeds a million. Nothing in the value domain can express that,
//! because the domain has no notion of "how many times".
//!
//! # Why it is worth the trouble
//!
//! Measured, on identical results: an integer accumulator is **4.4x** faster
//! than a double one on a dependent chain, and around **1000x** on a plain sum
//! — because with integers the C compiler can replace the loop with the closed
//! form, and floating-point addition is not associative so it may not.
//!
//! # What is claimed
//!
//! Only the shape that is actually provable, and nothing near it:
//!
//! - one entry edge, and back edges -- edges from blocks the header dominates
//!   -- so "the loop" is unambiguous however many ways round it has;
//! - a counter parameter guarded by `counter < bound` at the header, the
//!   test's true edge in the loop and its false edge out, whose step on every
//!   back edge is at least some positive amount;
//! - accumulators whose step is a bounded range.
//!
//! A step is a range rather than a constant: how far what a back edge carries
//! is from the parameter, followed through additions and merges. Then
//! `trips <= ceil((bound - start) / least step)`, and an accumulator's total
//! movement is at most `trips` of its largest step. Every quantity comes from
//! facts that are already over-approximations, so the bound is one too.

use rustc_hash::{FxHashMap, FxHashSet};

use super::facts::{self, Facts};
use super::flow::Analysis;
use super::{BinOp, BlockId, Func, OpKind, Terminator, ValueId};

/// Loops longer than this are treated as unbounded.
///
/// The count has to be exact, so it is a safe integer. Whether what it
/// multiplies stays exact is a question about the product, and is asked of
/// the bound itself below. It was 1e9, standing in for that question, and a
/// loop guarded by a 32-bit count -- `i < n` with `n` an `i32`, which every
/// `#whole` clone of an exported function has -- runs up to 2^31 times. So
/// such a loop's accumulators were all unbounded and stayed doubles:
/// `optional-chain`'s `total`, awfy-sieve's `primeCount`.
const MAX_TRIPS: f64 = facts::SAFE_MAX;

/// How many block parameters deep [`copies_counter`] follows a copy.
///
/// A step is not limited this way any more -- see [`loop_step`] -- but a *copy*
/// is a question about identity, and three joins is as far as a counter is
/// carried between its header and the store an initialization proof reads.
const MERGE_DEPTH: u32 = 3;

/// Interval bounds for loop-carried values that iteration counting can prove.
///
/// Only the interval is constrained. Wholeness, NaN and negative zero are left
/// to the ordinary transfer functions, which know more about them than this
/// does.
#[must_use]
pub fn accumulator_caps(func: &Func, analysis: &Analysis) -> FxHashMap<ValueId, Facts> {
    let mut caps = FxHashMap::default();
    let predecessors = predecessors(func);
    let owners = owners(func);
    let edges = Edges {
        predecessors: &predecessors,
        owners: &owners,
    };
    let dominates = dominance(func);

    for header in headers(func, &dominates) {
        let Some(loop_shape) = shape(&predecessors, &dominates, header) else {
            continue;
        };
        // The counter is bounded by its own guard, whatever the trip count
        // turns out to be. Those are two different facts and they were coupled:
        // a loop over `xs.length` has up to 4294967295 trips, `MAX_TRIPS` was
        // 1e9, so `trip_count` gave up -- and the counter lost its bound along
        // with the accumulators, though `i < xs.length` bounds it exactly.
        //
        // A counter left unbounded is not a small loss. Unbounded is not a
        // whole number, so it stays a `double`, every index becomes an
        // `fptoui` of a floating-point induction variable, and LLVM's scalar
        // evolution cannot model one -- so the loop never vectorizes. See
        // `benchmarks/cases/elementwise`.
        if let Some((counter, bound)) = counter_bound(func, analysis, &edges, header, &loop_shape) {
            caps.insert(counter, bound);
        }

        let Some(trips) = trip_count(func, analysis, &edges, header, &loop_shape) else {
            continue;
        };

        let params = &func.blocks[header.0 as usize].params;
        for (slot, param) in params.iter().enumerate() {
            let Some(increment) = loop_step(func, analysis, &edges, &loop_shape, slot, *param)
            else {
                continue;
            };
            let Some(start) = loop_shape.entry_args.get(slot) else {
                continue;
            };
            let start = analysis.get(*start);
            if !start.lo.is_finite() || !increment.lo.is_finite() || !increment.hi.is_finite() {
                continue;
            }

            // Over `trips` iterations the accumulator moves by at most `trips`
            // increments in whichever direction the increment can go. The
            // `min`/`max` against zero is because an increment that is never
            // negative cannot lower the accumulator below where it started.
            let downward = (trips * increment.lo).min(0.0);
            let upward = (trips * increment.hi).max(0.0);
            let lo = start.lo + downward;
            let hi = start.hi + upward;
            // Inside the safe-integer range whole numbers add and multiply
            // exactly, so this is the true bound. Past it a rounded product
            // can fall short of what the loop reaches, and a bound that large
            // proves no integer representation anyway.
            let safe = facts::SAFE_MIN..=facts::SAFE_MAX;
            if !safe.contains(&lo) || !safe.contains(&hi) {
                continue;
            }
            // Both bounds are true, so a counter -- which is a header parameter
            // too, and is counted here like any other -- keeps the tighter of
            // its guard's and its trips'.
            let counted = Facts::new(lo, hi, false, true, true);
            caps.entry(*param)
                .and_modify(|bound| *bound = bound.narrow(counted))
                .or_insert(counted);
        }
    }
    caps
}

/// Which blocks jump to each block, and with what arguments.
pub(super) fn predecessors(func: &Func) -> Vec<Vec<(BlockId, Vec<ValueId>)>> {
    let mut incoming = vec![Vec::new(); func.blocks.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(index).unwrap_or(0));
        match &block.terminator {
            Terminator::Jump { target, args } => {
                incoming[target.0 as usize].push((from, args.clone()));
            }
            Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                incoming[then_target.0 as usize].push((from, then_args.clone()));
                incoming[else_target.0 as usize].push((from, else_args.clone()));
            }
            Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {}
        }
    }
    incoming
}

/// The block each block parameter belongs to.
///
/// Built once per function. A step is followed backwards through merges, and
/// finding a parameter's block by scanning for it was a walk over every block
/// at every merge of every step asked.
fn owners(func: &Func) -> FxHashMap<ValueId, usize> {
    func.blocks
        .iter()
        .enumerate()
        .flat_map(|(index, block)| block.params.iter().map(move |param| (*param, index)))
        .collect()
}

/// A function's edges as a step is followed through them: who jumps to each
/// block with what, and which block each parameter is a parameter of.
struct Edges<'a> {
    predecessors: &'a [Vec<(BlockId, Vec<ValueId>)>],
    owners: &'a FxHashMap<ValueId, usize>,
}

/// Blocks a back edge returns to.
///
/// A back edge is one whose target dominates its source: every way to the
/// source went through the target, so arriving there again is going round.
/// "The target can reach the source" is not the same question, and inside an
/// outer loop every edge answers it yes -- so every inner loop's entry edge
/// counted as a second back edge, and no inner loop had a trip count.
fn headers(func: &Func, dominates: &impl Fn(BlockId, BlockId) -> bool) -> Vec<BlockId> {
    let mut found = Vec::new();
    for (index, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(index).unwrap_or(0));
        for successor in block.terminator.successors() {
            if dominates(successor, from) && !found.contains(&successor) {
                found.push(successor);
            }
        }
    }
    found
}

/// Whether one block dominates another, from the verifier's immediate
/// dominators. An unreachable block is dominated by nothing but itself.
pub(super) fn dominance(func: &Func) -> impl Fn(BlockId, BlockId) -> bool {
    let idom = immediate_dominators(func);
    move |over: BlockId, under: BlockId| dominated(&idom, over, under)
}

fn immediate_dominators(func: &Func) -> Vec<Option<BlockId>> {
    let reachable = super::verify::reachable_blocks(func);
    super::verify::dominators(func, &reachable)
}

/// Whether `over` dominates `under`, by walking `under`'s immediate dominators.
fn dominated(idom: &[Option<BlockId>], over: BlockId, under: BlockId) -> bool {
    let mut at = Some(under);
    while let Some(block) = at {
        if block == over {
            return true;
        }
        at = idom[block.0 as usize];
    }
    false
}

/// Whether a block is inside a cycle: control leaves it and can come back.
///
/// The same question [`headers`] asks of a back edge, from the other end -- and
/// spelled through [`reaches`] rather than beside it, because `reaches(b, b)` is
/// trivially true and a second walk written for this would answer that instead.
pub(super) fn in_a_cycle(func: &Func, block: BlockId) -> bool {
    func.blocks[block.0 as usize]
        .terminator
        .successors()
        .into_iter()
        .any(|successor| reaches(func, successor, block))
}

/// Whether control can get from one block to another.
fn reaches(func: &Func, from: BlockId, to: BlockId) -> bool {
    let mut seen = FxHashSet::default();
    let mut stack = vec![from];
    while let Some(block) = stack.pop() {
        if block == to {
            return true;
        }
        if !seen.insert(block) {
            continue;
        }
        stack.extend(func.blocks[block.0 as usize].terminator.successors());
    }
    false
}

/// The arguments a loop's single entry and its back edges carry.
struct Shape {
    entry: BlockId,
    entry_args: Vec<ValueId>,
    /// Every back edge, with what it carries. More than one where the body
    /// goes straight back to the header from several places, which is what a
    /// `while` loop's `continue` does: `utf8Decode` returns from four.
    latches: Vec<(BlockId, Vec<ValueId>)>,
}

fn shape(
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    dominates: &impl Fn(BlockId, BlockId) -> bool,
    header: BlockId,
) -> Option<Shape> {
    let mut entry = None;
    let mut latches = Vec::new();
    for (from, args) in &predecessors[header.0 as usize] {
        // A predecessor the header dominates is inside the loop.
        if dominates(header, *from) {
            latches.push((*from, args.clone()));
        } else {
            if entry.is_some() {
                return None;
            }
            entry = Some((*from, args.clone()));
        }
    }
    let (entry, entry_args) = entry?;
    (!latches.is_empty()).then_some(Shape {
        entry,
        entry_args,
        latches,
    })
}

/// A complete traversal of a fixed prefix, on the header's false edge.
///
/// This is stronger than an upper bound on trips: initialization needs every
/// index, so the counter starts at zero, advances by exactly one, and the
/// only edge leaving the loop is its `counter < length` guard. Consumers must
/// still prove that their store executes on every back edge.
pub(super) struct PrefixLoop {
    pub header: BlockId,
    pub latch: BlockId,
    pub exit: BlockId,
    pub counter: ValueId,
    pub length: f64,
}

pub(super) fn prefix_loops(
    func: &Func,
    analysis: &Analysis,
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    dominates: impl Fn(BlockId, BlockId) -> bool,
) -> Vec<PrefixLoop> {
    let mut found = Vec::new();
    let owners = owners(func);
    let edges = Edges {
        predecessors,
        owners: &owners,
    };
    for header in headers(func, &dominates) {
        let Some(shape) = shape(predecessors, &dominates, header) else {
            continue;
        };
        // One way round: the store this proves is the one on that edge.
        let [(latch, _)] = shape.latches.as_slice() else {
            continue;
        };
        let latch = *latch;
        let Terminator::Branch {
            cond,
            then_target,
            else_target,
            ..
        } = func.blocks[header.0 as usize].terminator
        else {
            continue;
        };
        let OpKind::Binary {
            op: BinOp::Lt,
            lhs: counter,
            rhs: limit,
        } = func.value(cond).kind
        else {
            continue;
        };
        let Some(slot) = func.blocks[header.0 as usize]
            .params
            .iter()
            .position(|param| *param == counter)
        else {
            continue;
        };
        let start = analysis.get(shape.entry_args[slot]);
        let length = analysis.get(limit);
        let Some(step) = loop_step(func, analysis, &edges, &shape, slot, counter) else {
            continue;
        };
        if !start.is_singleton()
            || start.lo != 0.0
            || !step.is_singleton()
            || step.lo.to_bits() != 1.0_f64.to_bits()
            || !length.is_singleton()
            || !length.integral()
            || length.maybe_nan
            || !(0.0..=f64::from(u32::MAX)).contains(&length.lo)
            || !dominates(header, latch)
            || reaches(func, header, shape.entry)
        {
            continue;
        }
        // The natural loop, using the same incoming edges as the trip proof.
        let mut members = FxHashSet::from_iter([header]);
        let mut stack = vec![latch];
        while let Some(block) = stack.pop() {
            if members.insert(block) {
                stack.extend(predecessors[block.0 as usize].iter().map(|(from, _)| *from));
            }
        }
        if !members.contains(&then_target) || members.contains(&else_target)
            || members.iter().any(|member| !dominates(header, *member))
            || members.iter().any(|member| {
                func.blocks[member.0 as usize].terminator.successors().iter()
                    .any(|next| !(members.contains(next) || (*member == header && *next == else_target)))
            })
            // The exit is evidence that this loop completed only if no other
            // path can enter that block.
            || predecessors[else_target.0 as usize].iter().any(|(from, _)| *from != header)
        {
            continue;
        }
        found.push(PrefixLoop {
            header,
            latch,
            exit: else_target,
            counter,
            length: length.lo,
        });
    }
    found
}

pub(super) fn copies_counter(
    func: &Func,
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    value: ValueId,
    counter: ValueId,
) -> bool {
    copies(func, predecessors, value, counter, MERGE_DEPTH)
}

/// Whether `value` is `param`, or a copy of it carried through block
/// parameters.
///
/// `i++` does not reach the latch as `i + 1`. The body jumps to a join block
/// first, so the counter arrives there as *that* block's parameter and the
/// increment reads the copy: `b3(%3)` fed `%2`, and the latch is `%3 + 1`.
/// Comparing identity says that is not an induction variable, so the loop got
/// no trip count and its counter no bound -- and an unbounded counter is not a
/// whole number, so it stays a `double` and the loop never vectorizes.
///
/// Only where *every* predecessor passes something that resolves to `param`. A
/// join whose paths disagree is a merge, which the arm below handles by joining
/// the steps rather than by pretending it is a copy.
fn copies(
    func: &Func,
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    value: ValueId,
    param: ValueId,
    depth: u32,
) -> bool {
    if value == param {
        return true;
    }
    if depth == 0 {
        return false;
    }
    let OpKind::BlockParam(slot) = func.values[value.0 as usize].kind else {
        return false;
    };
    let Some(block) = func
        .blocks
        .iter()
        .position(|block| block.params.contains(&value))
    else {
        return false;
    };
    let incoming = &predecessors[block];
    !incoming.is_empty()
        && incoming.iter().all(|(_, args)| {
            args.get(slot as usize)
                .is_some_and(|arg| copies(func, predecessors, *arg, param, depth - 1))
        })
}

/// What a header parameter gains each time round, over every back edge.
///
/// Returned as facts rather than a value, because `i--` gains `-1` and there is
/// no value in the function holding that -- and as a range, because a step
/// need not be one amount. `index++; continue` on one path and the loop's own
/// `index++` on every path is a step of one to two; `length += 1` through
/// `length += 4` down an `else if` chain is one to four. Both still bound the
/// loop, and a loop over a string is written exactly so: `utf8Length` was
/// both, so its count had no bound and stayed a double, and so did every index
/// derived from it in `utf8Write` and `utf8Decode`.
fn loop_step(
    func: &Func,
    analysis: &Analysis,
    edges: &Edges<'_>,
    shape: &Shape,
    slot: usize,
    param: ValueId,
) -> Option<Facts> {
    let mut walk = StepWalk {
        func,
        analysis,
        edges,
        param,
        known: FxHashMap::default(),
    };
    let mut joined = Facts::BOTTOM;
    for (_, args) in &shape.latches {
        joined = joined.join(walk.offset(*args.get(slot)?)?);
    }
    (!joined.is_bottom()).then_some(joined)
}

/// How far each value is from one header parameter, on every path to it.
///
/// Walked backwards from what a back edge carries, through additions,
/// subtractions and merges, to the parameter. It replaced a walk that followed
/// one addition and three merges: one more `else if` arm was past it, so the
/// most common loop real code writes had no step at all.
///
/// Memoized, so a chain of n merges is n steps rather than 2^n paths. A value
/// that reaches itself without passing the parameter -- an inner loop's
/// counter, another header parameter -- is marked unknown while it is being
/// asked, so the cycle answers "not a step" instead of looping.
struct StepWalk<'a> {
    func: &'a Func,
    analysis: &'a Analysis,
    edges: &'a Edges<'a>,
    param: ValueId,
    known: FxHashMap<ValueId, Option<Facts>>,
}

impl StepWalk<'_> {
    fn offset(&mut self, value: ValueId) -> Option<Facts> {
        // Unchanged on this path, which is a step of zero. A latch carrying the
        // parameter itself is a loop that never moves, and `trip_count`
        // rejects it for that reason.
        if value == self.param {
            return Some(Facts::constant(0.0));
        }
        if let Some(known) = self.known.get(&value) {
            return *known;
        }
        self.known.insert(value, None);
        let found = self.derive(value);
        self.known.insert(value, found);
        found
    }

    fn derive(&mut self, value: ValueId) -> Option<Facts> {
        match self.func.values[value.0 as usize].kind {
            // `v + x` or `x + v`, `v` being so far from the parameter: the sum
            // is that far plus `x`.
            OpKind::Binary {
                op: BinOp::Add,
                lhs,
                rhs,
            } => match self.offset(lhs) {
                Some(step) => Some(facts::add(step, self.analysis.get(rhs))),
                None => self
                    .offset(rhs)
                    .map(|step| facts::add(self.analysis.get(lhs), step)),
            },
            // `v - x` is `v`'s distance less `x`. `x - v` is not a step: it
            // reflects around `x` rather than advancing.
            OpKind::Binary {
                op: BinOp::Sub,
                lhs,
                rhs,
            } => self
                .offset(lhs)
                .map(|step| facts::sub(step, self.analysis.get(rhs))),

            // A merge. `if (found) { total += 1 }` inside a loop reaches the
            // latch through a block parameter whose incoming values are the
            // accumulator itself on one path and `accumulator + 1` on the
            // other -- so the step is *either* zero or one, and the join says
            // so. Every incoming value has to be a step, or the merge is not
            // one.
            //
            // Without this a conditional accumulator has no bound at all, which
            // is most of the counters real programs write: `primeCount`,
            // `bounces`, `movesDone`.
            OpKind::BlockParam(slot) => {
                let block = *self.edges.owners.get(&value)?;
                let incoming = &self.edges.predecessors[block];
                let mut joined = Facts::BOTTOM;
                for (_, args) in incoming {
                    joined = joined.join(self.offset(*args.get(slot as usize)?)?);
                }
                (!joined.is_bottom()).then_some(joined)
            }
            _ => None,
        }
    }
}

/// The header's test, if it is the loop's own: `counter <op> limit` on a
/// header parameter, staying in the loop when it holds and leaving when it
/// does not.
///
/// Both halves of the last part are needed for anything below to be true.
/// Every iteration passes through the header, so a test whose true edge stays
/// in the loop and whose false edge leaves it holds of every value that goes
/// round. A test whose false edge also comes back holds of none of them.
///
/// "In the loop" is the natural loop -- what reaches a back edge without
/// passing the header -- and not "can get back to the header". An inner loop's
/// exit gets back to its header through the outer loop, by the inner loop's
/// entry edge, and every value that arrives that way is a new start rather
/// than one that went round.
fn exit_test(
    func: &Func,
    edges: &Edges<'_>,
    header: BlockId,
    shape: &Shape,
) -> Option<(BinOp, ValueId, ValueId, usize)> {
    let Terminator::Branch {
        cond,
        then_target,
        else_target,
        ..
    } = func.blocks[header.0 as usize].terminator
    else {
        return None;
    };
    let OpKind::Binary {
        op: comparison,
        lhs: counter,
        rhs: limit,
    } = func.values[cond.0 as usize].kind
    else {
        return None;
    };
    if !matches!(comparison, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge) {
        return None;
    }
    let members = natural_loop(edges, header, shape);
    if !members.contains(&then_target) || members.contains(&else_target) {
        return None;
    }
    let params = &func.blocks[header.0 as usize].params;
    let slot = params.iter().position(|param| *param == counter)?;
    Some((comparison, counter, limit, slot))
}

/// The header and every block that reaches one of its back edges without
/// passing through it.
fn natural_loop(edges: &Edges<'_>, header: BlockId, shape: &Shape) -> FxHashSet<BlockId> {
    let mut members = FxHashSet::from_iter([header]);
    let mut stack: Vec<BlockId> = shape.latches.iter().map(|(latch, _)| *latch).collect();
    while let Some(block) = stack.pop() {
        if members.insert(block) {
            stack.extend(
                edges.predecessors[block.0 as usize]
                    .iter()
                    .map(|(from, _)| *from),
            );
        }
    }
    members
}

/// What the header's own guard says about the counter.
///
/// `i < limit` means `i` never exceeds `limit`'s largest value -- and the value
/// that flows back to the header is one step past whatever passed the guard, so
/// the bound carries one step of slack. Monotonic in the step's direction, so
/// the other end is where it started.
///
/// Independent of the trip count on purpose. Iteration counting answers "how
/// far can an accumulator have moved", which needs to know how many times; this
/// answers "how large can the counter be", which the guard already said.
fn counter_bound(
    func: &Func,
    analysis: &Analysis,
    edges: &Edges<'_>,
    header: BlockId,
    shape: &Shape,
) -> Option<(ValueId, Facts)> {
    let (comparison, counter, limit, slot) = exit_test(func, edges, header, shape)?;
    let ascending = matches!(comparison, BinOp::Lt | BinOp::Le);
    let start = analysis.get(*shape.entry_args.get(slot)?);
    let bound = analysis.get(limit);

    // The step has to move one way only, toward the bound or not at all, or the
    // counter is not one and the guard says nothing about how far it goes.
    // Standing still on some paths is allowed: `utf8Decode` reprocesses a
    // rejected byte without advancing, and the index is still below `end`
    // whenever it goes round.
    let step = loop_step(func, analysis, edges, shape, slot, counter)?;
    if !step.lo.is_finite() || !step.hi.is_finite() {
        return None;
    }
    if (ascending && step.lo < 0.0) || (!ascending && step.hi > 0.0) {
        return None;
    }

    // Where it started, too: a loop whose guard fails at once keeps a start
    // beyond the bound, and a cap that left it out would be no value at all.
    let (lo, hi) = if ascending {
        (start.lo, start.hi.max(bound.hi + step.hi))
    } else {
        (start.lo.min(bound.lo + step.lo), start.hi)
    };
    if !lo.is_finite() || !hi.is_finite() {
        return None;
    }
    Some((counter, Facts::new(lo, hi, false, true, true)))
}

/// How many times the loop can run.
fn trip_count(
    func: &Func,
    analysis: &Analysis,
    edges: &Edges<'_>,
    header: BlockId,
    shape: &Shape,
) -> Option<f64> {
    let (comparison, counter, limit, slot) = exit_test(func, edges, header, shape)?;
    let ascending = matches!(comparison, BinOp::Lt | BinOp::Le);
    let step = loop_step(func, analysis, edges, shape, slot, counter)?;
    // A step that does not always move toward the bound gives no trip count:
    // the counter might stand still, or move away and never arrive. One that
    // always moves, by varying amounts, arrives no later than its smallest
    // step would take it. A bound is never NaN -- the domain guarantees it --
    // so the plain comparisons are exhaustive.
    let least = if ascending { step.lo } else { -step.hi };
    if least <= 0.0 {
        return None;
    }

    let start = analysis.get(*shape.entry_args.get(slot)?);
    let bound = analysis.get(limit);

    // Measured from the far end of the start toward the far end of the bound,
    // so an imprecise start gives more iterations rather than fewer. `<=` and
    // `>=` admit one more than their strict forms.
    let inclusive = matches!(comparison, BinOp::Le | BinOp::Ge);
    let span = if ascending {
        if !start.lo.is_finite() || !bound.hi.is_finite() {
            return None;
        }
        bound.hi - start.lo + if inclusive { 1.0 } else { 0.0 }
    } else {
        if !start.hi.is_finite() || !bound.lo.is_finite() {
            return None;
        }
        start.hi - bound.lo + if inclusive { 1.0 } else { 0.0 }
    };
    let trips = (span / least).ceil();
    if !(trips.is_finite() && trips <= MAX_TRIPS) {
        return None;
    }
    Some(trips.max(0.0))
}

/// The fewest times a loop has gone round when control leaves it through its
/// header's test.
///
/// The other end of [`trip_count`]. That one bounds an accumulator, so it asks
/// how many times a loop *can* run; this bounds what a loop must have done by
/// the time it is over, so it asks how few. The test lets control out only once
/// the counter has reached the bound, and every trip moves the counter by at
/// most its largest step: so `trips >= (bound.lo - start.hi) / step.hi`, and
/// the mirror of that for a descending counter. A step that sometimes stands
/// still or goes back only means more trips, so it takes nothing away.
///
/// NaN is the one way out that reaches no bound -- `NaN < n` is false at once
/// -- so a start, bound or counter that may be NaN proves nothing.
fn least_trips(
    func: &Func,
    analysis: &Analysis,
    edges: &Edges<'_>,
    header: BlockId,
    shape: &Shape,
) -> Option<f64> {
    let (comparison, counter, limit, slot) = exit_test(func, edges, header, shape)?;
    let ascending = matches!(comparison, BinOp::Lt | BinOp::Le);
    let step = loop_step(func, analysis, edges, shape, slot, counter)?;
    let start = analysis.get(*shape.entry_args.get(slot)?);
    let bound = analysis.get(limit);
    if [start, bound, analysis.get(counter)]
        .iter()
        .any(|facts| facts.is_bottom() || facts.maybe_nan)
    {
        return None;
    }
    let (distance, stride) = if ascending {
        (bound.lo - start.hi, step.hi)
    } else {
        (start.lo - bound.hi, -step.lo)
    };
    if !(distance.is_finite() && stride.is_finite() && stride > 0.0) {
        return None;
    }
    let trips = (distance / stride).ceil();
    (trips.is_finite() && trips <= MAX_TRIPS).then_some(trips.max(0.0))
}

/// The fewest elements each array this function fills by `push` holds, block by
/// block.
///
/// # Why a lower bound is the whole question
///
/// `bounds` removes a check when the index is below the array's *smallest*
/// possible length -- a longer array only helps -- and in a program that can
/// `push` anywhere, an allocation's length is no longer exact
/// ([`super::allocated_length_is_exact`]), so the commonest array of all, one
/// built empty and pushed in a loop, had no length to compare against. Every
/// read of it kept its check. That is not the cost of a compare: a checked
/// read is an exit from its loop, and LLVM forwards a value stored in one trip
/// to the next trip's load only in a loop with one exit. `growth-grown` reads
/// `xs[i - 1]` that the trip before had just stored; checked, it reloads it,
/// pairs the load with its neighbour's, and stalls on a store that cannot
/// forward into the wider load -- 4.0x its C++, where `growth-fixed`, the same
/// loop over an array that cannot grow, is 1.04x.
///
/// # What is claimed
///
/// Only for an array allocated here whose every use is one that cannot shrink
/// it or hand it on: a read, a store into it, its length, its count, or a
/// `push` onto it (the `push` family, with the array as the receiver and
/// nowhere else). A block argument carrying it disqualifies it, since a `pop`
/// through the parameter would be a use of a different value. Then nothing but
/// this function's own operations changes its length, and none of them shortens
/// it, so the length only grows -- and three things say by how much at least:
///
/// - what it was allocated with;
/// - one for each `push` in a block that strictly dominates the read, which
///   every way to the read went through;
/// - for a loop whose exit is reached from its header's test and from nowhere
///   else, [`least_trips`] for each `push` in a block that dominates every back
///   edge -- every completed trip went through it -- at every block the exit
///   dominates.
///
/// None of them counts a `push` twice: one inside such a loop cannot dominate
/// anything after it, because the way round the loop zero times skips it.
pub(super) struct LeastLengths {
    arrays: FxHashMap<ValueId, Grown>,
    /// Immediate dominators, as [`dominance`] walks them.
    idom: Vec<Option<BlockId>>,
}

/// One array [`LeastLengths`] knows about.
struct Grown {
    /// The length it was allocated with, at least.
    allocated: f64,
    pushed: Vec<Pushed>,
}

/// From the top of `from` on -- or, where `after`, from its end, for a `push`
/// that may come after a read in its own block -- at least `count` more.
struct Pushed {
    from: BlockId,
    count: f64,
    after: bool,
}

impl LeastLengths {
    /// The fewest elements `array` holds at the top of `at`, where this knows.
    pub(super) fn at_least(&self, array: ValueId, at: BlockId) -> Option<f64> {
        let grown = self.arrays.get(&array)?;
        let pushed: f64 = grown
            .pushed
            .iter()
            .filter(|pushed| {
                dominated(&self.idom, pushed.from, at) && !(pushed.after && pushed.from == at)
            })
            .map(|pushed| pushed.count)
            .sum();
        Some(grown.allocated + pushed)
    }
}

/// Build [`LeastLengths`] for one function.
pub(super) fn least_lengths(func: &Func, analysis: &Analysis) -> LeastLengths {
    let idom = immediate_dominators(func);
    let dominates = |over: BlockId, under: BlockId| dominated(&idom, over, under);
    let mut arrays: FxHashMap<ValueId, Grown> = FxHashMap::default();
    for (index, op) in func.values.iter().enumerate() {
        let OpKind::ArrayNew { length, .. } = op.kind else {
            continue;
        };
        let array = ValueId(u32::try_from(index).unwrap_or(u32::MAX));
        let allocated = analysis.get(length);
        if allocated.is_bottom() || !allocated.lo.is_finite() || allocated.lo < 0.0 {
            continue;
        }
        if only_grows_here(func, array) {
            arrays.insert(
                array,
                Grown {
                    allocated: allocated.lo,
                    pushed: Vec::new(),
                },
            );
        }
    }
    if arrays.is_empty() {
        return LeastLengths { arrays, idom };
    }

    // Where each candidate is pushed.
    let mut pushes: FxHashMap<ValueId, Vec<BlockId>> = FxHashMap::default();
    for (index, block) in func.blocks.iter().enumerate() {
        let at = BlockId(u32::try_from(index).unwrap_or(0));
        for op in &block.ops {
            if let Some(array) = pushed_array(&func.values[op.0 as usize].kind)
                && arrays.contains_key(&array)
            {
                pushes.entry(array).or_default().push(at);
            }
        }
    }
    for (array, blocks) in &pushes {
        if let Some(grown) = arrays.get_mut(array) {
            grown.pushed.extend(blocks.iter().map(|at| Pushed {
                from: *at,
                count: 1.0,
                after: true,
            }));
        }
    }

    let predecessors = predecessors(func);
    let owners = owners(func);
    let edges = Edges {
        predecessors: &predecessors,
        owners: &owners,
    };
    for header in headers(func, &dominates) {
        let Some(loop_shape) = shape(&predecessors, &dominates, header) else {
            continue;
        };
        let Terminator::Branch { else_target, .. } = func.blocks[header.0 as usize].terminator
        else {
            continue;
        };
        // Arriving at the exit has to mean the test failed: a `break` that
        // lands on the same block would arrive with fewer trips behind it.
        if !predecessors[else_target.0 as usize]
            .iter()
            .all(|(from, _)| *from == header)
        {
            continue;
        }
        let Some(trips) = least_trips(func, analysis, &edges, header, &loop_shape) else {
            continue;
        };
        if trips < 1.0 {
            continue;
        }
        let members = natural_loop(&edges, header, &loop_shape);
        for (array, blocks) in &pushes {
            let every_trip = blocks.iter().any(|at| {
                members.contains(at)
                    && loop_shape
                        .latches
                        .iter()
                        .all(|(latch, _)| dominates(*at, *latch))
            });
            if every_trip && let Some(grown) = arrays.get_mut(array) {
                grown.pushed.push(Pushed {
                    from: else_target,
                    count: trips,
                    after: false,
                });
            }
        }
    }
    LeastLengths { arrays, idom }
}

/// The array a `push` adds to, when the op is one: the `push` family, with
/// the array as its receiver and in no other argument.
fn pushed_array(kind: &OpKind) -> Option<ValueId> {
    let OpKind::Call {
        callee: super::Callee::External(name),
        args,
        ..
    } = kind
    else {
        return None;
    };
    let (receiver, rest) = args.split_first()?;
    (name.starts_with("nts_array_push") && !rest.contains(receiver)).then_some(*receiver)
}

/// Whether every use of `array` leaves its length to this function, and none
/// shortens it. See [`LeastLengths`].
fn only_grows_here(func: &Func, array: ValueId) -> bool {
    !super::carried_by_an_edge(func, array)
        && func.values.iter().all(|op| {
            pushed_array(&op.kind) == Some(array)
                || super::use_keeps_the_array_here(array, &op.kind)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, Param};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    /// A function written as its HIR: each block lists the values it defines,
    /// numbered in the order they are given.
    struct Build {
        values: Vec<Op>,
        blocks: Vec<Block>,
        open: Vec<ValueId>,
    }

    impl Build {
        fn new() -> Self {
            Self {
                values: Vec::new(),
                blocks: Vec::new(),
                open: Vec::new(),
            }
        }

        fn value(&mut self, kind: OpKind) -> ValueId {
            let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
            self.values.push(Op {
                kind,
                ty: HirType::Float { bits: 64 },
                origin: origin(),
            });
            id
        }

        fn op(&mut self, kind: OpKind) -> ValueId {
            let id = self.value(kind);
            self.open.push(id);
            id
        }

        fn number(&mut self, n: f64) -> ValueId {
            self.op(OpKind::ConstFloat(n))
        }

        fn binary(&mut self, op: BinOp, lhs: ValueId, rhs: ValueId) -> ValueId {
            self.op(OpKind::Binary { op, lhs, rhs })
        }

        /// Block parameters are defined by the block, not listed in its ops.
        fn params(&mut self, count: u32) -> Vec<ValueId> {
            (0..count)
                .map(|slot| self.value(OpKind::BlockParam(slot)))
                .collect()
        }

        fn end(&mut self, params: Vec<ValueId>, terminator: Terminator) {
            self.blocks.push(Block {
                params,
                ops: std::mem::take(&mut self.open),
                terminator,
            });
        }

        fn jump(&mut self, params: Vec<ValueId>, target: u32, args: Vec<ValueId>) {
            self.end(
                params,
                Terminator::Jump {
                    target: BlockId(target),
                    args,
                },
            );
        }

        fn branch(&mut self, params: Vec<ValueId>, cond: ValueId, then: u32, otherwise: u32) {
            self.end(
                params,
                Terminator::Branch {
                    cond,
                    then_target: BlockId(then),
                    then_args: Vec::new(),
                    else_target: BlockId(otherwise),
                    else_args: Vec::new(),
                },
            );
        }

        fn finish(self, known: &[Facts]) -> Func {
            Func {
                name: "f".to_owned(),
                params: known
                    .iter()
                    .map(|known| Param {
                        name: "n".to_owned(),
                        ty: HirType::Float { bits: 64 },
                        origin: origin(),
                        known: *known,
                        written: None,
                        shape: crate::hir::ParamShape::Ordinary,
                    })
                    .collect(),
                return_type: HirType::Float { bits: 64 },
                values: self.values,
                blocks: self.blocks,
                origin: origin(),
                exported: true,
                initializes_receiver: false,
                async_result: None,
                frame: None,
                abstract_declaration: false,
                obligations: Vec::new(),
                written_return: None,
                result_absent: crate::hir::Absent::Impossible,
                written_return_elements: Vec::new(),
            }
        }
    }

    fn caps_of(func: &Func) -> FxHashMap<ValueId, Facts> {
        accumulator_caps(func, &super::super::flow::analyze(func))
    }

    /// `for (i = start; i < 10; i++)` where `start` is anywhere in `[0, 100]`.
    /// Started at 100 the loop never runs and `i` is 100, so a cap of "the
    /// guard plus one step" -- which is what the counter's bound was -- says
    /// 11 about a value that is 100.
    #[test]
    fn a_counter_that_starts_past_its_bound_keeps_its_start() {
        let mut f = Build::new();
        let start = f.op(OpKind::Param(0));
        f.jump(Vec::new(), 1, vec![start]);
        let header = f.params(1);
        let i = header[0];
        let ten = f.number(10.0);
        let test = f.binary(BinOp::Lt, i, ten);
        f.branch(header, test, 2, 3);
        let one = f.number(1.0);
        let next = f.binary(BinOp::Add, i, one);
        f.jump(Vec::new(), 1, vec![next]);
        f.end(Vec::new(), Terminator::Return(Some(i)));
        let func = f.finish(&[Facts::new(0.0, 100.0, true, false, false)]);

        let cap = caps_of(&func)[&i];
        assert!(cap.hi >= 100.0, "the counter can be its start: {cap:?}");
    }

    /// The same loop with its test the other way round: it goes round while
    /// `i < 10` is *false*, so the guard bounds nothing that goes round.
    #[test]
    fn a_test_whose_true_edge_leaves_the_loop_bounds_nothing() {
        let mut f = Build::new();
        let start = f.op(OpKind::Param(0));
        f.jump(Vec::new(), 1, vec![start]);
        let header = f.params(1);
        let i = header[0];
        let ten = f.number(10.0);
        let test = f.binary(BinOp::Lt, i, ten);
        f.branch(header, test, 3, 2);
        let one = f.number(1.0);
        let next = f.binary(BinOp::Add, i, one);
        f.jump(Vec::new(), 1, vec![next]);
        f.end(Vec::new(), Terminator::Return(Some(i)));
        let func = f.finish(&[Facts::new(50.0, 60.0, true, false, false)]);

        assert_eq!(caps_of(&func).get(&i), None);
    }

    /// `i` steps by one on one path and two on the other, and `total` by one
    /// each time round: still at most 100 trips, so `total <= 100`.
    #[test]
    fn a_step_of_one_or_two_still_counts_the_trips() {
        let mut f = Build::new();
        let zero = f.number(0.0);
        f.jump(Vec::new(), 1, vec![zero, zero]);
        let header = f.params(2);
        let (i, total) = (header[0], header[1]);
        let hundred = f.number(100.0);
        let test = f.binary(BinOp::Lt, i, hundred);
        f.branch(header, test, 2, 5);
        let fifty = f.number(50.0);
        let low = f.binary(BinOp::Lt, i, fifty);
        f.branch(Vec::new(), low, 3, 4);
        let one = f.number(1.0);
        let by_one = f.binary(BinOp::Add, i, one);
        f.jump(Vec::new(), 6, vec![by_one]);
        let two = f.number(2.0);
        let by_two = f.binary(BinOp::Add, i, two);
        f.jump(Vec::new(), 6, vec![by_two]);
        f.end(Vec::new(), Terminator::Return(Some(total)));
        let joined = f.params(1);
        let step = f.number(1.0);
        let counted = f.binary(BinOp::Add, total, step);
        f.jump(joined.clone(), 1, vec![joined[0], counted]);
        let func = f.finish(&[]);

        let caps = caps_of(&func);
        assert_eq!((caps[&i].lo, caps[&i].hi), (0.0, 102.0));
        assert_eq!((caps[&total].lo, caps[&total].hi), (0.0, 100.0));
    }

    /// A `continue` straight back to the header is a second back edge, and
    /// the loop still has a trip count: `total` moves by zero or one.
    #[test]
    fn a_continue_to_the_header_is_one_more_back_edge() {
        let mut f = Build::new();
        let zero = f.number(0.0);
        f.jump(Vec::new(), 1, vec![zero, zero]);
        let header = f.params(2);
        let (i, total) = (header[0], header[1]);
        let hundred = f.number(100.0);
        let test = f.binary(BinOp::Lt, i, hundred);
        f.branch(header, test, 2, 4);
        let fifty = f.number(50.0);
        let low = f.binary(BinOp::Lt, i, fifty);
        f.branch(Vec::new(), low, 3, 5);
        let one = f.number(1.0);
        let skipped = f.binary(BinOp::Add, i, one);
        f.jump(Vec::new(), 1, vec![skipped, total]);
        f.end(Vec::new(), Terminator::Return(Some(total)));
        let another = f.number(1.0);
        let advanced = f.binary(BinOp::Add, i, another);
        let counted = f.binary(BinOp::Add, total, another);
        f.jump(Vec::new(), 1, vec![advanced, counted]);
        let func = f.finish(&[]);

        let caps = caps_of(&func);
        assert_eq!((caps[&total].lo, caps[&total].hi), (0.0, 100.0));
    }

    /// An inner loop is entered from inside the outer one, so its header can
    /// reach its own entry edge -- which is not a back edge, because the header
    /// does not dominate where it comes from.
    #[test]
    fn an_inner_loop_has_a_trip_count() {
        let mut f = Build::new();
        let zero = f.number(0.0);
        f.jump(Vec::new(), 1, vec![zero]);
        let outer = f.params(1);
        let i = outer[0];
        let ten = f.number(10.0);
        let more = f.binary(BinOp::Lt, i, ten);
        f.branch(outer, more, 2, 6);
        let start = f.number(0.0);
        f.jump(Vec::new(), 3, vec![start, start]);
        let inner = f.params(2);
        let (j, total) = (inner[0], inner[1]);
        let limit = f.number(10.0);
        let again = f.binary(BinOp::Lt, j, limit);
        f.branch(inner, again, 4, 5);
        let one = f.number(1.0);
        let next_j = f.binary(BinOp::Add, j, one);
        let three = f.number(3.0);
        let counted = f.binary(BinOp::Add, total, three);
        f.jump(Vec::new(), 3, vec![next_j, counted]);
        let step = f.number(1.0);
        let next_i = f.binary(BinOp::Add, i, step);
        f.jump(Vec::new(), 1, vec![next_i]);
        f.end(Vec::new(), Terminator::Return(Some(i)));
        let func = f.finish(&[]);

        let caps = caps_of(&func);
        assert_eq!((caps[&total].lo, caps[&total].hi), (0.0, 30.0));
    }

    /// `xs = []; for (i = start; i < 10; i += 1) xs.push(..)`, and what is
    /// certain about `xs.length` in the block after the loop.
    fn pushed_in_a_loop(start: Facts, exit_from_body: bool) -> (Func, ValueId, BlockId) {
        let mut f = Build::new();
        let zero = f.number(0.0);
        let xs = f.op(OpKind::ArrayNew {
            length: zero,
            fill: crate::hir::ArrayFill::Holes,
        });
        let first = f.op(OpKind::Param(0));
        f.jump(Vec::new(), 1, vec![first]);
        // b1: the header.
        let header = f.params(1);
        let i = header[0];
        let ten = f.number(10.0);
        let test = f.binary(BinOp::Lt, i, ten);
        f.branch(header, test, 2, 3);
        // b2: the body, which may leave for the exit before it pushes.
        let five = f.number(5.0);
        let stop = f.binary(BinOp::Eq, i, five);
        if exit_from_body {
            f.branch(Vec::new(), stop, 3, 4);
        } else {
            f.branch(Vec::new(), stop, 4, 4);
        }
        // b3: after the loop.
        let length = f.op(OpKind::Length(xs));
        f.end(Vec::new(), Terminator::Return(Some(length)));
        // b4: push, step, go round.
        f.op(OpKind::Call {
            callee: crate::hir::Callee::External("nts_array_push".to_owned()),
            args: vec![xs, i],
            frame: None,
        });
        let one = f.number(1.0);
        let next = f.binary(BinOp::Add, i, one);
        f.jump(Vec::new(), 1, vec![next]);
        (f.finish(&[start]), xs, BlockId(3))
    }

    fn least_after(func: &Func, xs: ValueId, at: BlockId) -> Option<f64> {
        least_lengths(func, &super::super::flow::analyze(func)).at_least(xs, at)
    }

    /// Ten trips from zero, a push on each: ten at least once the test fails.
    /// From anywhere in `[0, 4]`, six -- the latest start is the one that
    /// counts.
    #[test]
    fn a_loop_that_pushes_every_trip_leaves_at_least_its_trips() {
        let exact = Facts::new(0.0, 0.0, true, false, false);
        let (func, xs, after) = pushed_in_a_loop(exact, false);
        assert_eq!(least_after(&func, xs, after), Some(10.0));
        let ranged = Facts::new(0.0, 4.0, true, false, false);
        let (func, xs, after) = pushed_in_a_loop(ranged, false);
        assert_eq!(least_after(&func, xs, after), Some(6.0));
    }

    /// A `break` that lands where the test exits arrives with five trips
    /// behind it, not ten: the exit no longer says the test failed, so the
    /// loop says nothing.
    #[test]
    fn an_exit_the_body_can_also_reach_proves_no_trips() {
        let exact = Facts::new(0.0, 0.0, true, false, false);
        let (func, xs, after) = pushed_in_a_loop(exact, true);
        assert_eq!(least_after(&func, xs, after), Some(0.0));
    }

    /// A start that may be NaN fails `NaN < 10` at once and leaves with no
    /// trips at all.
    #[test]
    fn a_start_that_may_be_nan_proves_no_trips() {
        let nan = Facts::new(0.0, 0.0, true, true, false);
        let (func, xs, after) = pushed_in_a_loop(nan, false);
        assert_eq!(least_after(&func, xs, after), Some(0.0));
    }
}
