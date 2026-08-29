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
//! - one entry edge and one back edge, so "the loop" is unambiguous;
//! - a counter parameter whose back edge is `counter + step` for a positive
//!   constant `step`, guarded by `counter < bound` at the header;
//! - accumulators whose back edge is `accumulator + increment`, where the
//!   increment's own range is already bounded.
//!
//! Then `trips <= ceil((bound - start) / step)`, and an accumulator's total
//! movement is at most `trips` increments. Every quantity comes from facts that
//! are already over-approximations, so the bound is one too.

use rustc_hash::{FxHashMap, FxHashSet};

use super::facts::Facts;
use super::flow::Analysis;
use super::{BinOp, BlockId, Func, OpKind, Terminator, ValueId};

/// Loops longer than this are treated as unbounded.
///
/// Not a correctness bound — a `trips` of 10^15 is still sound — but a bound
/// that large multiplied by an increment leaves nothing provable anyway, and
/// keeping the arithmetic well inside the safe-integer range means the product
/// below cannot itself lose precision.
const MAX_TRIPS: f64 = 1e9;

/// How many merges deep a step may be followed.
///
/// One covers `if (c) { total += 1 }`; two covers a nested `if`. Past that the
/// bound is a sum of several conditional increments and this analysis is not
/// the right one to be asking.
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

    for header in headers(func) {
        let Some(loop_shape) = shape(func, &predecessors, header) else {
            continue;
        };
        let Some(trips) = trip_count(func, analysis, &predecessors, header, &loop_shape) else {
            continue;
        };

        let params = &func.blocks[header.0 as usize].params;
        for (slot, param) in params.iter().enumerate() {
            let Some(increment) = step_of(
                func,
                analysis,
                &predecessors,
                *param,
                loop_shape.latch_args.get(slot).copied(),
                MERGE_DEPTH,
            ) else {
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
            if !lo.is_finite() || !hi.is_finite() {
                continue;
            }
            caps.insert(*param, Facts::new(lo, hi, false, true, true));
        }
    }
    caps
}

/// Which blocks jump to each block, and with what arguments.
fn predecessors(func: &Func) -> Vec<Vec<(BlockId, Vec<ValueId>)>> {
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

/// Blocks a back edge returns to.
fn headers(func: &Func) -> Vec<BlockId> {
    let mut found = Vec::new();
    for (index, block) in func.blocks.iter().enumerate() {
        for successor in block.terminator.successors() {
            // A back edge is one whose target can reach its source: control
            // leaves the target, comes round, and arrives again.
            if reaches(func, successor, BlockId(u32::try_from(index).unwrap_or(0)))
                && !found.contains(&successor)
            {
                found.push(successor);
            }
        }
    }
    found
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

/// The arguments a loop's single entry and single back edge carry.
struct Shape {
    entry_args: Vec<ValueId>,
    latch_args: Vec<ValueId>,
}

fn shape(
    func: &Func,
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    header: BlockId,
) -> Option<Shape> {
    let mut entry = None;
    let mut latch = None;
    for (from, args) in &predecessors[header.0 as usize] {
        // A predecessor the header can reach is inside the loop.
        if reaches(func, header, *from) {
            if latch.is_some() {
                // More than one way round. Nothing here is wrong about such a
                // loop, but the reasoning below assumes one back edge.
                return None;
            }
            latch = Some(args.clone());
        } else {
            if entry.is_some() {
                return None;
            }
            entry = Some(args.clone());
        }
    }
    Some(Shape {
        entry_args: entry?,
        latch_args: latch?,
    })
}

/// What a header parameter gains each time round, if it gains a fixed amount.
///
/// Returned as facts rather than a value, because `i--` gains `-1` and there is
/// no value in the function holding that.
fn step_of(
    func: &Func,
    analysis: &Analysis,
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    param: ValueId,
    latch_arg: Option<ValueId>,
    depth: u32,
) -> Option<Facts> {
    let latch = latch_arg?;
    // Unchanged on this path, which is a step of zero. Only reachable through a
    // merge below -- a latch argument that *is* the parameter is a loop that
    // never moves, and `trip_count` rejects it for that reason.
    if latch == param {
        return Some(Facts::constant(0.0));
    }
    match func.values[latch.0 as usize].kind {
        // `param + x` or `x + param`; either way the step is the other operand.
        OpKind::Binary {
            op: BinOp::Add,
            lhs,
            rhs,
        } if lhs == param => Some(analysis.get(rhs)),
        OpKind::Binary {
            op: BinOp::Add,
            lhs,
            rhs,
        } if rhs == param => Some(analysis.get(lhs)),
        // `param - x` steps by `-x`. `x - param` is not an induction variable:
        // it reflects around `x` rather than advancing.
        OpKind::Binary {
            op: BinOp::Sub,
            lhs,
            rhs,
        } if lhs == param => Some(super::facts::neg(analysis.get(rhs))),

        // A merge. `if (found) { total += 1 }` inside a loop reaches the latch
        // through a block parameter whose incoming values are the accumulator
        // itself on one path and `accumulator + 1` on the other -- so the step
        // is *either* zero or one, and the join says so.
        //
        // Without this a conditional accumulator has no bound at all, which is
        // most of the counters real programs write: `primeCount`, `bounces`,
        // `movesDone`.
        OpKind::BlockParam(slot) => {
            if depth == 0 {
                return None;
            }
            let block = func
                .blocks
                .iter()
                .position(|block| block.params.contains(&latch))?;
            let mut joined = Facts::BOTTOM;
            for (_, args) in &predecessors[block] {
                let incoming = args.get(slot as usize).copied();
                joined = joined.join(step_of(
                    func,
                    analysis,
                    predecessors,
                    param,
                    incoming,
                    depth - 1,
                )?);
            }
            (!joined.is_bottom()).then_some(joined)
        }
        _ => None,
    }
}

/// How many times the loop can run.
fn trip_count(
    func: &Func,
    analysis: &Analysis,
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    header: BlockId,
    shape: &Shape,
) -> Option<f64> {
    let Terminator::Branch { cond, .. } = func.blocks[header.0 as usize].terminator else {
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
    let ascending = match comparison {
        BinOp::Lt | BinOp::Le => true,
        BinOp::Gt | BinOp::Ge => false,
        _ => return None,
    };

    let params = &func.blocks[header.0 as usize].params;
    let slot = params.iter().position(|param| *param == counter)?;
    let step = step_of(
        func,
        analysis,
        predecessors,
        counter,
        shape.latch_args.get(slot).copied(),
        MERGE_DEPTH,
    )?;
    // A step that is not a fixed amount moving toward the bound gives no trip
    // count: the counter might stand still, or move away and never arrive. A
    // bound is never NaN — the domain guarantees it — so the plain comparisons
    // are exhaustive.
    if !step.is_singleton() {
        return None;
    }
    if ascending && step.lo <= 0.0 {
        return None;
    }
    if !ascending && step.lo >= 0.0 {
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
    let trips = (span / step.lo.abs()).ceil();
    if !(trips.is_finite() && trips <= MAX_TRIPS) {
        return None;
    }
    Some(trips.max(0.0))
}
