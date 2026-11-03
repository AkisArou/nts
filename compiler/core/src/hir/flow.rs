//! Propagating [`Facts`] through a function.
//!
//! # Why this is short
//!
//! Classic range analysis threads an environment keyed by *variable* through
//! the program, because in a tree-shaped IR a variable's value depends on where
//! you are standing. In SSA it does not: a value is assigned once, so the set of
//! numbers it may hold is decided at its definition and is the same everywhere
//! it is readable.
//!
//! What is left is the part SSA does not solve. Two of them:
//!
//! - **Block parameters** genuinely differ by edge, and their facts are the join
//!   of the arguments each predecessor passes.
//! - **Guards** tell you more than a definition does. `i` defined as `0` and
//!   incremented in a loop is unbounded from its definitions alone; it is the
//!   `i < n` on the loop header that bounds it. That information belongs to an
//!   *edge*, not to a value, which is the one thing SSA does not already carry.
//!
//! So the environment here exists only to hold what an edge refined, and
//! everything else is read from the value's own fact.

// Exact float comparison, for the same reason as in `facts`: these are questions
// about which IEEE value a bound *is*, not about whether two measurements are
// close. See the note there.
#![allow(clippy::float_cmp)]

use rustc_hash::FxHashMap;
use std::collections::BTreeSet;

use super::facts::{self, Facts};
use super::{BinOp, BlockId, Callee, Func, OpKind, Terminator, UnOp, ValueId};

/// Rounds before a loop header stops trying for precision and widens.
///
/// A counter's bound grows by one per round, so a loop that runs a million
/// times would need a million rounds. Three is enough to see that a bound is
/// still moving without giving up on one that was going to settle.
const WIDEN_AFTER: u32 = 3;

/// A hard bound on worklist epochs. Forward edges propagate in one epoch in
/// reverse-postorder; backedges and invalidated dependents advance the epoch.
/// Exhaustion discards every unfinished fact.
const ROUND_CAP: u32 = 64;

/// Blocks a back edge returns to.
///
/// The only places a value can grow without bound, and therefore the only
/// places widening belongs. Applying it anywhere else destroys information
/// rather than forcing convergence: a loop *body* holds values a guard just
/// narrowed, and widening those throws the guard away.
fn loop_headers(func: &Func) -> rustc_hash::FxHashSet<BlockId> {
    const UNVISITED: u8 = 0;
    const ON_STACK: u8 = 1;
    const DONE: u8 = 2;

    let mut headers = rustc_hash::FxHashSet::default();
    let mut state = vec![UNVISITED; func.blocks.len()];
    let mut stack = vec![(BlockId(0), 0_usize)];
    state[0] = ON_STACK;

    // An edge to a block already on the search stack is a back edge, and its
    // target is a loop header. Iterative rather than recursive: a deeply nested
    // function should not decide how much stack the compiler needs.
    while let Some(&mut (block, ref mut next)) = stack.last_mut() {
        let successors = func.blocks[block.0 as usize].terminator.successors();
        let Some(successor) = successors.get(*next).copied() else {
            state[block.0 as usize] = DONE;
            stack.pop();
            continue;
        };
        *next += 1;
        match state[successor.0 as usize] {
            UNVISITED => {
                state[successor.0 as usize] = ON_STACK;
                stack.push((successor, 0));
            }
            ON_STACK => {
                headers.insert(successor);
            }
            _ => {}
        }
    }
    headers
}

/// A deterministic reverse-postorder of the function CFG. Unreachable blocks
/// follow the entry component and are never queued by the analysis.
fn reverse_postorder(func: &Func) -> Vec<BlockId> {
    let mut visited = vec![false; func.blocks.len()];
    let mut postorder = Vec::with_capacity(func.blocks.len());
    let mut stack = vec![(BlockId(0), 0_usize)];
    visited[0] = true;
    while let Some(&mut (block, ref mut next)) = stack.last_mut() {
        let successors = func.blocks[block.0 as usize].terminator.successors();
        let Some(successor) = successors.get(*next).copied() else {
            postorder.push(block);
            stack.pop();
            continue;
        };
        *next += 1;
        if !visited[successor.0 as usize] {
            visited[successor.0 as usize] = true;
            stack.push((successor, 0));
        }
    }
    postorder.reverse();
    postorder.extend(
        visited
            .iter()
            .enumerate()
            .filter(|(_, seen)| !**seen)
            .map(|(index, _)| {
                BlockId(u32::try_from(index).expect("function block count fits BlockId"))
            }),
    );
    postorder
}

/// What was proven about each value in one function.
#[derive(Debug, Clone)]
pub struct Analysis {
    /// Indexed by [`ValueId`]. The set of numbers the value may hold, anywhere
    /// it can be read.
    values: Vec<Facts>,
    /// Per block, pairs `(a, b)` where `a < b` is known to hold throughout.
    ///
    /// A deliberately thin slice of relational information on top of an
    /// interval domain, and it exists for one question intervals cannot answer:
    /// whether an index is inside an array whose length is unknown.
    /// `for (i = 0; i < xs.length; i++)` bounds `i` by a number the analysis has
    /// no value for — so no interval proves it, and the *identity* of the value
    /// that guards the loop is the whole of the proof.
    ///
    /// Only strict `<` is recorded, because that is what a bounds check needs.
    less_than: Vec<Vec<(ValueId, ValueId)>>,
    /// Per block, what a guard on the way in narrowed a value to.
    ///
    /// A value's own fact is the join over every path that reaches it, which is
    /// necessarily wider than what holds at any one of them. Inside
    /// `if (i < 5)`, `i` is `[0, 4]`; its definition only promises `[0, 5]`,
    /// because the value that leaves the loop is the one that failed the test.
    /// One is enough to prove an index in bounds and the other is not.
    refined: Vec<Refinements>,
    /// Whether any array in the program can change length. Carried here because
    /// every consumer of an analysis already holds one, and threading a
    /// whole-program flag beside it would mean two things to keep in step.
    growable: bool,
    /// How long the array each parameter points at can be, per slot.
    param_lengths: Vec<Facts>,
    /// What each field this function touches held where another function, or
    /// another read through a different reference, could see it.
    observed: Observed,
}

impl Analysis {
    /// What each field held where something else could see it. A value stored
    /// and overwritten through the same reference before then is not here --
    /// which is the difference between a field's contents and its stores.
    #[must_use]
    pub fn observed(&self) -> &Observed {
        &self.observed
    }

    /// Whether any array in the program can change length.
    #[must_use]
    pub fn growable(&self) -> bool {
        self.growable
    }

    /// How long the array a parameter points at can be. `TOP` where unknown,
    /// which proves nothing and is what an absent answer has to be.
    #[must_use]
    pub fn param_length(&self, slot: u32) -> Facts {
        self.param_lengths
            .get(slot as usize)
            .copied()
            .unwrap_or(Facts::TOP)
    }

    /// How many values were analyzed.
    #[must_use]
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Whether the function had no values at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Whether a value is known to be less than some value the predicate
    /// accepts, everywhere in a block.
    ///
    /// Taking a predicate rather than a value because the caller is asking
    /// "less than *this array's* length", and which value that is depends on
    /// what the guard happened to compare against.
    #[must_use]
    pub fn guarded_by(
        &self,
        block: BlockId,
        value: ValueId,
        accept: impl Fn(ValueId) -> bool,
    ) -> bool {
        self.less_than
            .get(block.0 as usize)
            .is_some_and(|relations| {
                relations
                    .iter()
                    .any(|(lesser, greater)| *lesser == value && accept(*greater))
            })
    }

    /// What is known about a value *at a particular block*.
    ///
    /// Narrower than [`Self::get`] wherever a guard on the way in said more.
    #[must_use]
    pub fn get_at(&self, block: BlockId, value: ValueId) -> Facts {
        self.refined
            .get(block.0 as usize)
            .and_then(|refinements| refinements.get(&value).copied())
            .unwrap_or_else(|| self.get(value))
    }

    /// What is known about a value.
    #[must_use]
    pub fn get(&self, value: ValueId) -> Facts {
        self.values[value.0 as usize]
    }

    /// Whether a value is provably inside a range, whole or not.
    ///
    /// Weaker than [`Self::is_integral_within`] on purpose. Truncating `3.7` to
    /// `3` is exactly what `ToInt32` does, so a coercion only needs its operand
    /// to be *in range* — being an integer already is not required, and
    /// demanding it would refuse the ordinary case.
    #[must_use]
    pub fn is_within(&self, value: ValueId, lo: f64, hi: f64) -> bool {
        let facts = self.get(value);
        !facts.is_bottom() && !facts.maybe_nan && facts.lo >= lo && facts.hi <= hi
    }

    /// Whether a value is provably a whole number within a range, and therefore
    /// representable exactly as an integer.
    ///
    /// The three obligations together: not NaN, integral on every path, and
    /// inside the given bounds. `-0` refuses too — an integer slot cannot hold
    /// it, and `1 / -0` can tell that it was lost.
    #[must_use]
    pub fn is_integral_within(&self, value: ValueId, lo: f64, hi: f64) -> bool {
        self.integral_within(value, lo, hi, false)
    }

    /// The same, for a value whose zero's sign nothing can distinguish.
    ///
    /// `-0` and `0` are different doubles and the same integer, so a value that
    /// might be `-0` normally cannot be one. Where nothing downstream can tell
    /// the two apart — see [`super::zero_sign`] — the difference is not a
    /// difference, and refusing to represent it costs a great deal for nothing.
    #[must_use]
    pub fn is_integral_within_ignoring_zero_sign(&self, value: ValueId, lo: f64, hi: f64) -> bool {
        self.integral_within(value, lo, hi, true)
    }

    fn integral_within(&self, value: ValueId, lo: f64, hi: f64, any_zero: bool) -> bool {
        let facts = self.get(value);
        !facts.is_bottom()
            && facts.integral()
            && !facts.maybe_nan
            && (any_zero || !facts.maybe_negative_zero)
            && facts.lo >= lo
            && facts.hi <= hi
    }
}

/// Values whose facts an edge refined, relative to their own definitions.
type Refinements = FxHashMap<ValueId, Facts>;

/// Path facts can equal the current SSA-global fact. Keep those facts on CFG
/// edges: the global may broaden later while the path-specific fact remains
/// valid. Published `Analysis::refined` maps are normalized sparse overrides.
type PathFacts = FxHashMap<ValueId, Facts>;

/// One predecessor's current contribution to its successor. Parameter facts
/// are edge arguments, kept independently of the sparse non-parameter map.
#[derive(Debug, Clone, PartialEq)]
struct EdgeState {
    path_facts: PathFacts,
    params: Vec<Facts>,
}

#[derive(Debug, Clone, Copy)]
struct ChangedValue {
    value: ValueId,
    read_before_change: bool,
}

#[derive(Debug, Default)]
struct TransferResult {
    changed_values: Vec<ChangedValue>,
    changed_positions: FxHashMap<ValueId, usize>,
    global_reads: rustc_hash::FxHashSet<ValueId>,
    changed_blocks: rustc_hash::FxHashSet<BlockId>,
}

impl TransferResult {
    fn note_global_read(&mut self, value: ValueId) {
        self.global_reads.insert(value);
    }

    fn note_changed(&mut self, value: ValueId) {
        if let Some(index) = self.changed_positions.get(&value).copied() {
            self.changed_values[index].read_before_change |= self.global_reads.contains(&value);
        } else {
            self.changed_positions
                .insert(value, self.changed_values.len());
            self.changed_values.push(ChangedValue {
                value,
                read_before_change: self.global_reads.contains(&value),
            });
        }
    }
}

/// The only read authority for SSA-global facts during a transfer. Keeping the
/// slice private means an analysis helper cannot read a fallback without
/// registering the block dependency that makes sparse requeue sound.
struct FactView<'a> {
    values: &'a [Facts],
    dependencies: &'a mut TransferResult,
}

impl FactView<'_> {
    fn get(&mut self, refinements: &PathFacts, value: ValueId) -> Facts {
        lookup_recorded(refinements, self, value)
    }

    #[cfg(any(test, debug_assertions))]
    fn global(&mut self, value: ValueId) -> Facts {
        self.dependencies.note_global_read(value);
        self.values[value.0 as usize]
    }
}

impl<'a> FactView<'a> {
    fn new(values: &'a [Facts], dependencies: &'a mut TransferResult) -> Self {
        Self {
            values,
            dependencies,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct HeaderFact {
    raw: Facts,
    effective: Facts,
    changes: u32,
}

/// Test-only counters for work that used to grow quadratically in joins and
/// edge construction. The production type is zero-sized and all increments
/// compile away.
#[derive(Default)]
struct WorkCounts {
    #[cfg(any(test, flow_measure))]
    parameter_index_entries: usize,
    #[cfg(any(test, flow_measure))]
    entry_keys_visited: usize,
    #[cfg(any(test, flow_measure))]
    parameter_position_queries: usize,
    #[cfg(any(test, flow_measure))]
    sparse_refinement_visits: usize,
    #[cfg(any(test, flow_measure))]
    live_in_membership_probes: usize,
    #[cfg(any(test, flow_measure))]
    query_length_entries: usize,
    #[cfg(flow_measure)]
    path_fact_entries_built: usize,
}

fn parameter_positions(func: &Func, work: &mut WorkCounts) -> Vec<FxHashMap<ValueId, usize>> {
    #[cfg(not(any(test, flow_measure)))]
    let _ = work;
    func.blocks
        .iter()
        .map(|block| {
            block
                .params
                .iter()
                .enumerate()
                .map(|(slot, value)| {
                    #[cfg(any(test, flow_measure))]
                    {
                        work.parameter_index_entries += 1;
                    }
                    (*value, slot)
                })
                .collect()
        })
        .collect()
}

fn value_readers(
    func: &Func,
    live_in: &[rustc_hash::FxHashSet<ValueId>],
) -> Vec<rustc_hash::FxHashSet<BlockId>> {
    let mut readers = vec![rustc_hash::FxHashSet::default(); func.values.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        let block_id = BlockId(u32::try_from(index).expect("function block count fits BlockId"));
        for value in &live_in[index] {
            readers[value.0 as usize].insert(block_id);
        }
        // This block also republishes the facts its successors need. A value
        // can be absent from this block's own live-in/uses, yet its edge
        // snapshot must be refreshed when the SSA-global fact broadens.
        for successor in block.terminator.successors() {
            for value in &live_in[successor.0 as usize] {
                readers[value.0 as usize].insert(block_id);
            }
        }
        // A defining block is also a reader of its result: if the global fact
        // changes during this transfer, rerun it at the same epoch to publish
        // the path-specific edge state against that broader global.
        for value in block
            .ops
            .iter()
            .flat_map(|value| {
                std::iter::once(*value)
                    .chain(super::operands_of(&func.values[value.0 as usize].kind))
            })
            .chain(super::operands_of_terminator(&block.terminator))
        {
            readers[value.0 as usize].insert(block_id);
        }
    }
    readers
}

/// Values whose path facts a downstream analysis queries at a block even
/// though no placed operation in that block reads them. Query uses are
/// collected while walking the dominator tree, so only definitions that
/// actually dominate the query become live there.
#[allow(clippy::too_many_lines)] // One dominator walk owns all query-use rules.
fn analysis_query_inputs(
    func: &Func,
    growable: bool,
    work: &mut WorkCounts,
) -> Vec<rustc_hash::FxHashSet<ValueId>> {
    #[cfg(not(any(test, flow_measure)))]
    let _ = work;
    if func.blocks.is_empty() {
        return Vec::new();
    }

    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    let mut children = vec![Vec::new(); func.blocks.len()];
    for (index, parent) in idom.iter().enumerate() {
        if let Some(parent) = parent
            && parent.0 as usize != index
        {
            children[parent.0 as usize].push(BlockId(
                u32::try_from(index).expect("function block count fits BlockId"),
            ));
        }
    }

    let mut queried = vec![rustc_hash::FxHashSet::default(); func.blocks.len()];
    let mut active_lengths = FxHashMap::<ValueId, Vec<ValueId>>::default();
    let mut expanded_lengths =
        vec![FxHashMap::<ValueId, rustc_hash::FxHashSet<ValueId>>::default(); func.blocks.len()];
    let mut exact_allocations = FxHashMap::<ValueId, bool>::default();
    // Exit events undo only the length definitions added by their block.
    // This iterative dominator-tree walk avoids copying a growing map down
    // every arm of a large switch.
    let mut events = vec![(BlockId(0), false, Vec::<ValueId>::new())];
    while let Some((block_id, exiting, added)) = events.pop() {
        let index = block_id.0 as usize;
        if exiting {
            for array in added.into_iter().rev() {
                let stack = active_lengths
                    .get_mut(&array)
                    .expect("entered length definition has an active source");
                stack.pop();
                if stack.is_empty() {
                    active_lengths.remove(&array);
                }
            }
            continue;
        }

        let block = &func.blocks[index];
        let mut added_here = Vec::new();
        for &operation in &block.ops {
            let op = &func.values[operation.0 as usize];
            if let OpKind::Length(array) = op.kind {
                active_lengths.entry(array).or_default().push(operation);
                added_here.push(array);
                continue;
            }

            let queried_array = match op.kind {
                OpKind::StringUnitAt {
                    string,
                    checked: true,
                    ..
                } if matches!(
                    func.values[string.0 as usize].ty,
                    super::HirType::Managed(super::ManagedType::String)
                ) =>
                {
                    if let Some(lengths) = active_lengths.get(&string) {
                        for length in lengths {
                            if !expanded_lengths[index]
                                .entry(string)
                                .or_default()
                                .insert(*length)
                            {
                                continue;
                            }
                            #[cfg(any(test, flow_measure))]
                            {
                                work.query_length_entries += 1;
                            }
                            queried[index].insert(*length);
                        }
                    }
                    None
                }
                OpKind::ArrayGet {
                    array,
                    checked: true,
                    ..
                }
                | OpKind::ArraySet {
                    array,
                    checked: true,
                    ..
                } => Some(array),
                _ => None,
            };

            let Some(array) = queried_array else {
                continue;
            };
            match &func.values[array.0 as usize].kind {
                OpKind::ArrayNew { length, .. }
                    if *exact_allocations.entry(array).or_insert_with(|| {
                        super::allocated_length_is_exact(func, array, growable)
                    }) =>
                {
                    if queried[index].insert(*length) {
                        #[cfg(any(test, flow_measure))]
                        {
                            work.query_length_entries += 1;
                        }
                    }
                }
                OpKind::Call {
                    callee: Callee::External(name),
                    args,
                    ..
                } if name == "nts_view_new" => {
                    if let [_, _, length, _, tracking] = args[..]
                        && matches!(
                            func.values[tracking.0 as usize].kind,
                            OpKind::ConstBool(false)
                        )
                        && queried[index].insert(length)
                    {
                        #[cfg(any(test, flow_measure))]
                        {
                            work.query_length_entries += 1;
                        }
                    }
                }
                _ => {}
            }
        }

        events.push((block_id, true, added_here));
        for child in children[index].iter().rev() {
            events.push((*child, false, Vec::new()));
        }
    }
    queried
}

fn enqueue(
    block: BlockId,
    source: BlockId,
    epoch: u32,
    rank: &[usize],
    work: &mut BTreeSet<(u32, usize)>,
    scheduled: &mut [Option<u32>],
) {
    let index = block.0 as usize;
    // Following the CFG's reverse-postorder: a fact sent to a later block can
    // be consumed in this epoch; a backward edge and a changed value read by
    // its defining block wait for the next epoch. The latter reruns a transfer
    // after its global output changed, so equal-to-global edge facts can be
    // derived again against the broader global. The worklist skips unchanged
    // blocks.
    let next = epoch.saturating_add(u32::from(rank[index] <= rank[source.0 as usize]));
    if scheduled[index].is_some_and(|current| current <= next) {
        return;
    }
    if let Some(current) = scheduled[index] {
        work.remove(&(current, rank[index]));
    }
    scheduled[index] = Some(next);
    work.insert((next, rank[index]));
}

#[allow(
    clippy::too_many_arguments,
    reason = "the join consumes one coherent snapshot of solver state and records work"
)]
fn recompute_entry_recorded(
    func: &Func,
    block: BlockId,
    incoming: &[Vec<(BlockId, usize)>],
    edges: &[Vec<Option<EdgeState>>],
    caps: &FxHashMap<ValueId, Facts>,
    parameter_positions: &FxHashMap<ValueId, usize>,
    work: &mut WorkCounts,
    facts: &mut FactView<'_>,
) -> Option<PathFacts> {
    #[cfg(not(test))]
    let _ = work;
    let index = block.0 as usize;
    let states: Vec<_> = incoming[index]
        .iter()
        .filter_map(|(source, slot)| {
            edges[source.0 as usize][*slot]
                .as_ref()
                .map(|state| (*source, state))
        })
        .collect();
    let _ = states.first()?;

    let mut keys: rustc_hash::FxHashSet<_> = states
        .iter()
        .flat_map(|(_, state)| state.path_facts.keys().copied())
        .collect();
    let params = &func.blocks[index].params;
    // Every incoming edge has a positional argument fact, even when it equals
    // the parameter's global fact. Keeping it here is what lets a later global
    // widening re-derive a narrow preheader contribution such as constant 0.
    keys.extend(params.iter().copied());

    let mut refinements = PathFacts::default();
    for value in keys {
        #[cfg(any(test, flow_measure))]
        {
            work.entry_keys_visited += 1;
            work.parameter_position_queries += 1;
        }
        let param_slot = parameter_positions.get(&value).copied();
        let mut joined = None;
        for (_, state) in &states {
            let contribution = param_slot
                .and_then(|slot| state.params.get(slot).copied())
                .unwrap_or_else(|| lookup_recorded(&state.path_facts, facts, value));
            joined = Some(joined.map_or(contribution, |now: Facts| now.join(contribution)));
        }
        set_path_fact(
            &mut refinements,
            value,
            capped(
                caps,
                value,
                joined.expect("an incoming edge contributes every entry key"),
            ),
        );
    }
    #[cfg(flow_measure)]
    {
        work.path_fact_entries_built += refinements.len();
    }
    Some(refinements)
}

#[cfg(test)]
#[allow(
    clippy::too_many_arguments,
    reason = "test helper mirrors the solver join inputs"
)]
fn recompute_entry(
    func: &Func,
    block: BlockId,
    incoming: &[Vec<(BlockId, usize)>],
    edges: &[Vec<Option<EdgeState>>],
    values: &[Facts],
    caps: &FxHashMap<ValueId, Facts>,
    parameter_positions: &FxHashMap<ValueId, usize>,
    work: &mut WorkCounts,
) -> Option<PathFacts> {
    recompute_entry_recorded(
        func,
        block,
        incoming,
        edges,
        caps,
        parameter_positions,
        work,
        &mut FactView::new(values, &mut TransferResult::default()),
    )
}

fn apply_header_widening_recorded(
    func: &Func,
    block: BlockId,
    refinements: &mut PathFacts,
    caps: &FxHashMap<ValueId, Facts>,
    widen_after: u32,
    history: &mut Option<Vec<HeaderFact>>,
    facts: &mut FactView<'_>,
) {
    let params = &func.blocks[block.0 as usize].params;
    let previous = history.get_or_insert_with(|| {
        params
            .iter()
            .map(|param| {
                let fact = lookup_recorded(refinements, facts, *param);
                HeaderFact {
                    raw: fact,
                    effective: fact,
                    changes: 0,
                }
            })
            .collect()
    });
    for (slot, param) in params.iter().enumerate() {
        let now = lookup_recorded(refinements, facts, *param);
        let before = previous[slot];
        let mut next = before;
        if now != before.raw {
            next.changes = next.changes.saturating_add(1);
            next.raw = now;
            next.effective = if next.changes >= widen_after {
                before.effective.join(facts::widen(before.effective, now))
            } else {
                before.effective.join(now)
            };
        }
        next.effective = capped(caps, *param, next.effective);
        previous[slot] = next;
        // Preserve the header's recomputed path fact even when it currently
        // equals the SSA-global value. A later global broadening must not erase
        // the loop's incoming contribution from the outgoing edge snapshot.
        set_path_fact(refinements, *param, next.effective);
    }
}

#[cfg(test)]
fn apply_header_widening(
    func: &Func,
    block: BlockId,
    refinements: &mut PathFacts,
    values: &[Facts],
    caps: &FxHashMap<ValueId, Facts>,
    widen_after: u32,
    history: &mut Option<Vec<HeaderFact>>,
) {
    apply_header_widening_recorded(
        func,
        block,
        refinements,
        caps,
        widen_after,
        history,
        &mut FactView::new(values, &mut TransferResult::default()),
    );
}

/// What a field holds now, on one path through a function: what it is worth,
/// and the value that last stored or read it, so that a guard on that value
/// narrows the field too. No value when paths that disagree on it merged.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Held {
    by: Option<ValueId>,
    facts: Facts,
}

/// The fields a path knows the current value of, by object and field.
type Fields = FxHashMap<(ValueId, u32), Held>;

/// What each field held wherever something other than the path could see it,
/// by the object's type and the field. One function's part of a field's fact:
/// see [`super::fields::analyze`].
pub type Observed = FxHashMap<(super::HirType, u32), Facts>;

/// Pairs `(a, b)` for which `a < b` is known.
type Relations = Vec<(ValueId, ValueId)>;

/// What the whole program contributes to every function's analysis.
///
/// One interprocedural round builds these once and every function reads them,
/// which is why a [`Context`] borrows them rather than holding a copy: the
/// copy was a clone of a map with one `String` per function, made once per
/// function per round, and on a 3,000-function module that quadratic was
/// three quarters of the compile.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Whole {
    /// What each function returns, by name.
    pub returns: FxHashMap<String, Facts>,
    /// What a dispatch through each slot returns: the join over every
    /// implementation in it.
    ///
    /// Keyed by slot rather than by name because a dispatch has no single
    /// callee. Without it every virtual call and every closure call is a wall,
    /// and a wall in a loop is the difference between integer arithmetic and a
    /// double round trip per iteration.
    pub slot_returns: FxHashMap<u32, Facts>,
    /// What each `(layout, field)` can hold, from every store in the program.
    ///
    /// A field read is otherwise TOP, and a TOP in a loop that touches an
    /// object is a double round trip per iteration.
    pub field_facts: super::fields::FieldFacts,
    /// What each module-scope variable can hold, from every store in the
    /// program.
    ///
    /// A global read is otherwise TOP, and that TOP is worth more than it
    /// looks: `benchmarks/cases/module-closures` reads one `let step` inside a
    /// loop body, and without this every operation after the read is floating
    /// point however narrow the slot is. Narrowing the storage alone moved that
    /// case 17.84us to 16.05us against C++'s 2.30us; the arithmetic was never
    /// waiting on the width.
    pub global_facts: super::globals::GlobalFacts,
    /// What each array type's elements can hold, from every store in the
    /// program. The same idea as [`Self::field_facts`] for the other kind of
    /// container. See [`super::elements`].
    pub element_facts: super::elements::ElementFacts,
    /// Whether any array in the program can change length.
    ///
    /// A whole-program answer, because the question is about what could happen
    /// to an array between its allocation and a read of its length -- and that
    /// is not a local question. See [`super::arrays_can_grow`].
    pub growable: bool,
}

/// What the rest of the program contributes to one function's analysis.
///
/// The scalar kinds slots were **written** as (`docs/records/notebooks/scalar-numbers.md`,
/// step 1), as facts: every store into one was proven to fit
/// (`super::obligations`), so a read is the kind's range whoever stored.
///
/// Declared rather than inferred, unlike [`Whole`]: the same in every round of
/// the whole-program fixpoint, and the only one of the two the strict check
/// may rely on (decision Q2). A parameter's is on the parameter
/// ([`super::Param::written`]), which every analysis already reads.
#[derive(Debug, Default)]
pub struct Written {
    /// What a call to each function returns, by name.
    pub returns: FxHashMap<String, Facts>,
    /// What an `await` of a call to each `async` function reads, by name:
    /// its payload's written kind.
    pub awaited: FxHashMap<String, Facts>,
    /// Each position of the tuple a function returns, by name, where the
    /// return type is a tuple written with scalar kinds.
    pub return_elements: FxHashMap<String, Vec<Facts>>,
    /// By `(object type, field)`, as [`Whole::field_facts`] is keyed.
    pub fields: super::fields::FieldFacts,
    /// By global, as [`Whole::global_facts`] is keyed.
    pub globals: super::globals::GlobalFacts,
    /// The C ABIs the program is built for: a read of a written kind is what
    /// C may hand in on any of them. Every row where nothing names them.
    pub targets: super::native::Targets,
    /// For each function answering a `bool`, the parameter slots whose `true`
    /// answer proves them not NaN ([`nan_excluding_predicates`]).
    pub predicates: FxHashMap<String, Vec<bool>>,
}

impl Written {
    #[must_use]
    pub fn of(program: &super::Program) -> Self {
        let targets = program.targets;
        let predicates = nan_excluding_predicates(program);
        let returns = program
            .funcs
            .iter()
            .filter_map(|func| Some((func.name.clone(), func.call_kind()?.facts_on(targets))))
            .collect();
        let awaited = program
            .funcs
            .iter()
            .filter(|func| func.async_result.is_some())
            .filter_map(|func| Some((func.name.clone(), func.written_return?.facts_on(targets))))
            .collect();
        let return_elements = program
            .funcs
            .iter()
            .filter(|func| func.written_return_elements.iter().any(Option::is_some))
            .map(|func| {
                let facts = func
                    .written_return_elements
                    .iter()
                    .map(|kind| kind.map_or(Facts::TOP, |kind| kind.facts_on(targets)));
                (func.name.clone(), facts.collect())
            })
            .collect();
        let mut fields = super::fields::FieldFacts::default();
        for layout in &program.layouts {
            for (index, field) in layout.fields.iter().enumerate() {
                let (Some(kind), Ok(index)) = (field.written, u32::try_from(index)) else {
                    continue;
                };
                fields.extend(
                    layout
                        .types
                        .iter()
                        .map(|ty| ((*ty, index), kind.facts_on(targets))),
                );
            }
        }
        // A `const` set before anything runs is its initial value, whatever
        // was written; anything else, its written kind.
        let globals = program
            .globals
            .iter()
            .enumerate()
            .filter_map(|(index, global)| {
                let facts = if global.constant && !global.deferred && global.ty.is_scalar() {
                    Facts::constant(global.initial)
                } else {
                    global.written?.facts_on(targets)
                };
                Some((u32::try_from(index).ok()?, facts))
            })
            .collect();
        Self {
            returns,
            awaited,
            return_elements,
            fields,
            globals,
            targets,
            predicates,
        }
    }
}

/// Empty means "assume nothing", which is what a function analyzed on its own
/// must do. Neither part can be inferred from inside the function: a parameter
/// is written by callers and a call's result by the callee.
#[derive(Debug, Clone, Copy)]
pub struct Context<'a> {
    /// Facts proved about arriving values. An absent entry is unknown; a
    /// declaration is not a proof about an unchecked caller.
    pub params: &'a [Facts],
    /// Interval bounds for loop-carried values, from counting iterations.
    ///
    /// The value domain cannot derive these: it knows what one round does, not
    /// how many rounds there are. See [`super::loops`].
    pub caps: &'a FxHashMap<ValueId, Facts>,
    /// How long the array each parameter points at can be, per slot.
    ///
    /// The other way a reference arrives. A method reading `this.flags` has no
    /// allocation in front of it, and neither does one taking `flags` as an
    /// argument -- and the second is the shape of every function that is handed
    /// a buffer to work on.
    pub param_lengths: &'a [Facts],
    /// What every function reads this round.
    pub whole: &'a Whole,
    /// What the program wrote, which narrows every read of `whole`.
    pub written: &'a Written,
}

/// Compute what is provable about every value in a function, alone.
#[must_use]
pub fn analyze(func: &Func) -> Analysis {
    let whole = Whole::default();
    let caps = FxHashMap::default();
    analyze_with(
        func,
        &Context {
            params: &[],
            caps: &caps,
            param_lengths: &[],
            whole: &whole,
            written: &Written::default(),
        },
    )
}

/// Compute what is provable, given what the rest of the program contributes.
#[must_use]
pub fn analyze_with(func: &Func, context: &Context) -> Analysis {
    solve(func, context).0
}

/// The epoch count is retained for solver controls; consumers receive only the
/// completed analysis (or the conservative exhaustion result).
fn solve(func: &Func, context: &Context) -> (Analysis, u32) {
    solve_with_limits(func, context, ROUND_CAP, WIDEN_AFTER)
}

#[cfg(flow_measure)]
fn report_work_stats(
    func: &Func,
    work: &WorkCounts,
    live_in: &[rustc_hash::FxHashSet<ValueId>],
    entry: &[Option<PathFacts>],
    edges: &[Vec<Option<EdgeState>>],
    rounds: u32,
    converged: bool,
) {
    if std::env::var_os("NTS_FLOW_WORK_STATS").is_none() || func.values.len() < 512 {
        return;
    }
    let live_value_spans: usize = live_in.iter().map(std::collections::HashSet::len).sum();
    let retained_entry_path_facts: usize = entry.iter().flatten().map(FxHashMap::len).sum();
    let retained_edge_path_facts: usize = edges
        .iter()
        .flatten()
        .flatten()
        .map(|state| state.path_facts.len())
        .sum();
    eprintln!(
        "NTS_FLOW_WORK_STATS {{\"function\":{:?},\"blocks\":{},\"values\":{},\"live_value_spans\":{},\"parameter_index_entries\":{},\"entry_keys_visited\":{},\"parameter_position_queries\":{},\"sparse_refinement_visits\":{},\"live_in_membership_probes\":{},\"query_length_entries\":{},\"path_fact_entries_built\":{},\"retained_entry_path_facts\":{},\"retained_edge_path_facts\":{},\"rounds\":{},\"converged\":{}}}",
        func.name,
        func.blocks.len(),
        func.values.len(),
        live_value_spans,
        work.parameter_index_entries,
        work.entry_keys_visited,
        work.parameter_position_queries,
        work.sparse_refinement_visits,
        work.live_in_membership_probes,
        work.query_length_entries,
        work.path_fact_entries_built,
        retained_entry_path_facts,
        retained_edge_path_facts,
        rounds,
        converged,
    );
}

#[allow(
    clippy::too_many_lines,
    reason = "the epoch scheduler and its convergence fallback form one solver invariant"
)]
fn solve_with_limits(
    func: &Func,
    context: &Context,
    round_cap: u32,
    widen_after: u32,
) -> (Analysis, u32) {
    let tuples = local_tuples(func);
    let mut work_counts = WorkCounts::default();
    let parameter_positions = parameter_positions(func, &mut work_counts);
    let query_uses = analysis_query_inputs(func, context.whole.growable, &mut work_counts);
    let liveness = super::liveness::analyze_with_additional_uses(func, &query_uses)
        .expect("complete flow liveness");
    let live_in: Vec<_> = func
        .blocks
        .iter()
        .enumerate()
        .map(|(index, block)| {
            let mut live = liveness
                .live_in(BlockId(u32::try_from(index).unwrap_or(0)))
                .clone();
            live.extend(block.params.iter().copied());
            live
        })
        .collect();

    // Requeue blocks whose live input or local operations read a changed
    // global fact. The liveness edge cases and operation operands are both
    // included: a value may be passed through several blocks before its next
    // operation use.
    let mut readers = value_readers(func, &live_in);
    // Transfer-time global fallbacks are dependencies even when they are
    // reached indirectly through a value's definition (for example, the
    // operands of a comparison used by a later branch). Remember each once.
    let mut block_global_reads = vec![rustc_hash::FxHashSet::default(); func.blocks.len()];

    let edge_targets: Vec<Vec<BlockId>> = func
        .blocks
        .iter()
        .map(|block| block.terminator.successors())
        .collect();
    let order = reverse_postorder(func);
    let mut rank = vec![0; func.blocks.len()];
    for (at, block) in order.iter().enumerate() {
        rank[block.0 as usize] = at;
    }
    let mut incoming = vec![Vec::<(BlockId, usize)>::new(); func.blocks.len()];
    for (source, targets) in edge_targets.iter().enumerate() {
        for (slot, target) in targets.iter().copied().enumerate() {
            incoming[target.0 as usize].push((
                BlockId(u32::try_from(source).expect("function block count fits BlockId")),
                slot,
            ));
        }
    }

    // Start at BOTTOM and grow. A value's fact only ever widens as more paths
    // are discovered, so the fixpoint is the least one.
    let mut values = vec![Facts::BOTTOM; func.values.len()];

    // A parameter is an input, so nothing inside the function constrains it.
    // Only proved callers, a checked store contract or the actual machine
    // representation constrains it. A literal annotation is not such a proof:
    // an export, callback or indirect call may receive another value.
    for (index, op) in func.values.iter().enumerate() {
        if let OpKind::Param(slot) = op.kind {
            values[index] = parameter_facts(func, context, slot);
        }
    }

    // Entries are derived from the current incoming edge states every time a
    // block is dequeued. They are never the sole record of a path fact.
    let mut entry: Vec<Option<PathFacts>> = vec![None; func.blocks.len()];
    let mut edges: Vec<Vec<Option<EdgeState>>> = edge_targets
        .iter()
        .map(|targets| vec![None; targets.len()])
        .collect();
    entry[0] = Some(Refinements::default());

    // Widening history belongs to loop parameters, not to incoming edges.
    // Keep both the last raw join and the effective widened fact so replacing
    // an edge can never erase the loop's convergence state.
    let mut header_previous: Vec<Option<Vec<HeaderFact>>> = vec![None; func.blocks.len()];
    let headers = loop_headers(func);
    // The fields each block is entered knowing, and what was observed of them.
    let mut fields: Vec<Option<Fields>> = vec![None; func.blocks.len()];
    fields[0] = Some(Fields::default());
    let mut observed = Observed::default();

    let mut scheduled = vec![None; func.blocks.len()];
    let mut work = BTreeSet::new();
    work.insert((0_u32, rank[0]));
    scheduled[0] = Some(0);
    let mut converged = true;
    let mut rounds = 0_u32;
    while let Some((epoch, at)) = work.pop_first() {
        let index = order[at].0 as usize;
        scheduled[index] = None;
        if epoch >= round_cap {
            converged = false;
            rounds = round_cap;
            break;
        }
        rounds = rounds.max(epoch.saturating_add(1));
        let block = BlockId(u32::try_from(index).expect("function block count fits BlockId"));

        let mut result = TransferResult::default();
        let mut refinements = if index == 0 {
            Some(Refinements::default())
        } else {
            recompute_entry_recorded(
                func,
                block,
                &incoming,
                &edges,
                context.caps,
                &parameter_positions[index],
                &mut work_counts,
                &mut FactView::new(&values, &mut result),
            )
        };
        let Some(mut refinements_now) = refinements.take() else {
            // Every current incoming edge was withdrawn; the block is no
            // longer reachable in the current graph state.
            entry[index] = None;
            continue;
        };

        if headers.contains(&block) {
            apply_header_widening_recorded(
                func,
                block,
                &mut refinements_now,
                context.caps,
                widen_after,
                &mut header_previous[index],
                &mut FactView::new(&values, &mut result),
            );
        }
        entry[index] = Some(refinements_now.clone());

        // New block entry facts affect its operations even if neither an edge
        // nor a global value changed.
        transfer_block(
            func,
            (context, &tuples),
            block,
            &refinements_now,
            &mut values,
            &mut edges,
            &live_in,
            &parameter_positions,
            &mut work_counts,
            (&mut fields, &mut observed, &headers),
            &mut result,
        );

        for value in result.global_reads.iter().copied() {
            if block_global_reads[index].insert(value) {
                readers[value.0 as usize].insert(block);
            }
        }
        for change in result.changed_values {
            let value = change.value;
            for reader in &readers[value.0 as usize] {
                if *reader != block || change.read_before_change {
                    enqueue(*reader, block, epoch, &rank, &mut work, &mut scheduled);
                }
            }
        }
        for target in result.changed_blocks {
            enqueue(target, block, epoch, &rank, &mut work, &mut scheduled);
        }
    }

    // This is an ascending analysis: an unfinished iteration contains only
    // the paths seen so far. None of those partial facts may license a fold,
    // a bounds-check removal or a storage width in any consumer.
    if !converged {
        #[cfg(flow_measure)]
        report_work_stats(func, &work_counts, &live_in, &entry, &edges, rounds, false);
        return (unknown(func, context, observed), rounds);
    }

    #[cfg(any(test, debug_assertions))]
    assert_one_full_sweep_is_stable(
        func,
        context,
        &tuples,
        widen_after,
        &order,
        &incoming,
        &live_in,
        &parameter_positions,
        &headers,
        &values,
        &entry,
        &edges,
        &header_previous,
        &fields,
        &observed,
    );

    // A transfer can grow a phi's global fact after its entry was derived.
    // Drop any now-redundant published override before exposing the fixpoint.
    for refinements in entry.iter_mut().flatten() {
        refinements.retain(|value, facts| *facts != values[value.0 as usize]);
        #[cfg(any(test, debug_assertions))]
        debug_assert_sparse(
            refinements,
            &mut FactView::new(&values, &mut TransferResult::default()),
        );
    }

    #[cfg(flow_measure)]
    report_work_stats(func, &work_counts, &live_in, &entry, &edges, rounds, true);

    let less_than = relations(func, &entry);
    (
        Analysis {
            values,
            less_than,
            refined: entry.into_iter().map(Option::unwrap_or_default).collect(),
            growable: context.whole.growable,
            param_lengths: context.param_lengths.to_vec(),
            observed,
        },
        rounds,
    )
}

/// A final full RPO sweep is an expensive diagnostic assertion, not part of
/// the release solver. It catches missing sparse-reader dependencies: if a
/// transfer still changes any global, edge, entry, or field fact, the worklist
/// stopped before reaching the dense solver's fixpoint.
#[cfg(any(test, debug_assertions))]
#[allow(
    clippy::too_many_arguments,
    reason = "the assertion compares one coherent solver snapshot"
)]
fn assert_one_full_sweep_is_stable(
    func: &Func,
    context: &Context,
    tuples: &LocalTuples,
    widen_after: u32,
    order: &[BlockId],
    incoming: &[Vec<(BlockId, usize)>],
    live_in: &[rustc_hash::FxHashSet<ValueId>],
    parameter_positions: &[FxHashMap<ValueId, usize>],
    headers: &rustc_hash::FxHashSet<BlockId>,
    values: &[Facts],
    entry: &[Option<PathFacts>],
    edges: &[Vec<Option<EdgeState>>],
    header_previous: &[Option<Vec<HeaderFact>>],
    fields: &[Option<Fields>],
    observed: &Observed,
) {
    let mut checked_values = values.to_vec();
    let mut checked_entry = entry.to_vec();
    let mut checked_edges = edges.to_vec();
    let mut checked_headers = header_previous.to_vec();
    let mut checked_fields = fields.to_vec();
    let mut checked_observed = observed.clone();
    let mut work = WorkCounts::default();

    for block in order {
        let index = block.0 as usize;
        if checked_entry[index].is_none() {
            continue;
        }
        let mut dependencies = TransferResult::default();
        let mut refinements = if index == 0 {
            Some(PathFacts::default())
        } else {
            recompute_entry_recorded(
                func,
                *block,
                incoming,
                &checked_edges,
                context.caps,
                &parameter_positions[index],
                &mut work,
                &mut FactView::new(&checked_values, &mut dependencies),
            )
        };
        let Some(mut refinements) = refinements.take() else {
            checked_entry[index] = None;
            continue;
        };
        if headers.contains(block) {
            apply_header_widening_recorded(
                func,
                *block,
                &mut refinements,
                context.caps,
                widen_after,
                &mut checked_headers[index],
                &mut FactView::new(&checked_values, &mut dependencies),
            );
        }
        checked_entry[index] = Some(refinements.clone());
        transfer_block(
            func,
            (context, tuples),
            *block,
            &refinements,
            &mut checked_values,
            &mut checked_edges,
            live_in,
            parameter_positions,
            &mut work,
            (&mut checked_fields, &mut checked_observed, headers),
            &mut dependencies,
        );
    }

    assert_eq!(
        checked_values, values,
        "flow fixpoint changed on a full sweep"
    );
    assert_eq!(checked_entry, entry, "flow entries changed on a full sweep");
    assert_eq!(checked_edges, edges, "flow edges changed on a full sweep");
    assert_eq!(
        checked_headers, header_previous,
        "flow widening changed on a full sweep"
    );
    assert_eq!(
        checked_fields, fields,
        "flow fields changed on a full sweep"
    );
    assert_eq!(
        checked_observed,
        observed.clone(),
        "flow observations changed on a full sweep"
    );
}

/// Exhaustion discards every authority, including field observations whose
/// absence would otherwise mean that a declaration's initial zero suffices.
fn unknown(func: &Func, context: &Context, mut observed: Observed) -> Analysis {
    for fact in observed.values_mut() {
        *fact = Facts::TOP;
    }
    let object = |ty| super::HirType::Managed(super::ManagedType::Object(ty));
    for &(ty, field) in context
        .whole
        .field_facts
        .keys()
        .chain(context.written.fields.keys())
    {
        observed.insert((object(ty), field), Facts::TOP);
    }
    // Standalone analyses can have no whole-program field map. Include every
    // represented access too, even when its block had not been visited yet.
    for op in &func.values {
        match &op.kind {
            OpKind::FieldGet { object, field } | OpKind::FieldSet { object, field, .. } => {
                observe(func, &mut observed, *object, *field, Facts::TOP);
            }
            OpKind::SharedFieldGet { arms, field, .. } => {
                for ty in arms {
                    observed.insert((object(*ty), *field), Facts::TOP);
                }
            }
            OpKind::OpenFieldGet { arms, .. } | OpKind::OpenFieldSet { arms, .. } => {
                for arm in arms {
                    observed.insert((object(arm.ty), arm.field), Facts::TOP);
                }
            }
            _ => {}
        }
    }
    Analysis {
        values: vec![Facts::TOP; func.values.len()],
        less_than: vec![Vec::new(); func.blocks.len()],
        // Empty maps for every block: all are conservatively reachable, with
        // no guard refinement. There is no consumer-specific completion flag.
        refined: vec![Refinements::default(); func.blocks.len()],
        growable: true,
        param_lengths: vec![Facts::TOP; func.params.len()],
        observed,
    }
}

/// The `a < b` facts that hold at the top of each block.
///
/// Derived once the intervals have settled, by asking each branch what taking
/// it proves. A block reached from more than one edge keeps only what every
/// edge agrees on.
fn relations(func: &Func, entry: &[Option<Refinements>]) -> Vec<Relations> {
    let mut incoming: Vec<Option<Relations>> = vec![None; func.blocks.len()];

    for (index, block) in func.blocks.iter().enumerate() {
        if entry[index].is_none() {
            // Unreached, so it proves nothing to anyone.
            continue;
        }
        let Terminator::Branch {
            cond,
            then_target,
            else_target,
            ..
        } = &block.terminator
        else {
            for successor in block.terminator.successors() {
                merge(&mut incoming[successor.0 as usize], Vec::new());
            }
            continue;
        };

        let (taken, not_taken) = match &func.values[cond.0 as usize].kind {
            OpKind::Binary {
                op: BinOp::Lt,
                lhs,
                rhs,
            } => (vec![(*lhs, *rhs)], Vec::new()),
            // `!(a >= b)` is `a < b`, so the *false* edge of a `>=` proves it.
            OpKind::Binary {
                op: BinOp::Ge,
                lhs,
                rhs,
            } => (Vec::new(), vec![(*lhs, *rhs)]),
            OpKind::Binary {
                op: BinOp::Gt,
                lhs,
                rhs,
            } => (vec![(*rhs, *lhs)], Vec::new()),
            OpKind::Binary {
                op: BinOp::Le,
                lhs,
                rhs,
            } => (Vec::new(), vec![(*rhs, *lhs)]),
            _ => (Vec::new(), Vec::new()),
        };
        merge(&mut incoming[then_target.0 as usize], taken);
        merge(&mut incoming[else_target.0 as usize], not_taken);
    }

    incoming
        .into_iter()
        .map(Option::unwrap_or_default)
        .collect()
}

/// Intersect what a block already knew with what one more edge proves.
fn merge(slot: &mut Option<Relations>, arriving: Relations) {
    match slot {
        Some(existing) => existing.retain(|pair| arriving.contains(pair)),
        None => *slot = Some(arriving),
    }
}

/// Run one block, then hand its successors what it proved.
/// What a parameter holds: what callers were proven to pass, if anything
/// determined that, and otherwise only its representation and checked scalar
/// contract. A written scalar kind's range is justified by store obligations
/// and boundary guards; `Param::known` alone carries no arrival proof.
fn parameter_facts(func: &Func, context: &Context, slot: u32) -> Facts {
    let represented = func.params.get(slot as usize).map_or(Facts::TOP, |param| {
        param.written.map_or_else(
            || held_by(&param.ty).unwrap_or(Facts::TOP),
            |kind| kind.facts_on(context.written.targets),
        )
    });
    context
        .params
        .get(slot as usize)
        .map_or(represented, |from_callers| from_callers.narrow(represented))
}

/// What a call is worth, whoever it is calling.
///
/// A function this program defines has its returns in the interprocedural
/// fixpoint. A dispatch has the join over every body its slot can reach -- the
/// tables are the complete list, so the join is sound. One of the runtime's own
/// has a known result. Anything else is a wall.
fn call_result(context: &Context, callee: &Callee) -> Facts {
    // A method's override can't write its result wider than the declaration
    // it overrides (Q1), so the declaration's kind holds for the dispatch.
    let written = |name: &String| {
        context
            .written
            .returns
            .get(name)
            .copied()
            .unwrap_or(Facts::TOP)
    };
    match callee {
        Callee::Direct(name) => context
            .whole
            .returns
            .get(name)
            .copied()
            .unwrap_or(Facts::TOP)
            .narrow(written(name)),
        Callee::Virtual { slot, declared } => context
            .whole
            .slot_returns
            .get(slot)
            .copied()
            .unwrap_or(Facts::TOP)
            .narrow(written(declared)),
        Callee::Closure { slot } => context
            .whole
            .slot_returns
            .get(slot)
            .copied()
            .unwrap_or(Facts::TOP),
        Callee::External(name) => runtime_result(name)
            .or_else(|| foreign_result(name))
            .unwrap_or(Facts::TOP),
        // What C returns is its declared type's: an `unsigned int` result is
        // 0..2^32-1, whole, as `foreign_result` reads a JVM descriptor.
        Callee::Native(target) => match target.result {
            super::native::Type::Scalar(kind) => kind.facts_on(context.written.targets),
            _ => Facts::TOP,
        },
    }
}

/// What an `await` of `promise` reads: the payload an `async` function was
/// written to settle with, where `promise` is a call to one.
fn awaited(func: &Func, context: &Context, promise: ValueId) -> Facts {
    match &func.values[promise.0 as usize].kind {
        OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } => context
            .written
            .awaited
            .get(name)
            .copied()
            .unwrap_or(Facts::TOP),
        _ => Facts::TOP,
    }
}

/// What one of the runtime's own functions returns given its operand:
/// `Math.sign`'s answer follows its argument's.
fn operand_result(
    callee: &Callee,
    args: &[ValueId],
    refinements: &PathFacts,
    facts: &mut FactView<'_>,
) -> Option<Facts> {
    match (callee, args) {
        (Callee::External(name), [argument]) if name == "nts_math_sign" => {
            Some(facts::sign(facts.get(refinements, *argument)))
        }
        // ToIndex, which the lowering calls only once it has refused what is
        // out of range: a whole number at or above zero is itself. Without it
        // `new Uint32Array(buffer, 16, 8)` made a view whose length was a
        // call's result, `[0, 2^53)`, and no read of it could be proven in
        // bounds against the 8 its source says.
        (Callee::External(name), [argument]) if name == "nts_to_index" => {
            let index = facts.get(refinements, *argument);
            (index.integral() && !index.maybe_nan && index.lo >= 0.0).then_some(index)
        }
        _ => None,
    }
}

/// What one of the runtime's own functions returns.
///
/// Only the ones whose result is certainly a whole number in a known range. A
/// helper that can return `NaN` -- `pop` and `at` on an empty array, which is
/// what `undefined` is for a number -- is absent, because absent means TOP and
/// TOP is the truth about those.
///
/// An index is `-1` or a position, and a position is bounded by a length, which
/// is a `uint32`. So the range is exactly `[-1, 2^32 - 1]`.
/// How long a string can be, from the operation that produced it.
///
/// # Why a string needs this and an array does not
///
/// An array's length is its allocation's, and the allocation is usually right
/// in front of the read. A string's is not: the whole point of a tokenizer is
/// that it makes strings whose length is never written down anywhere, and
/// without a bound every one of them is `[0, 2^32)`.
///
/// That is not a bounds-check question -- string reads are already checked
/// against a length the object carries. It is an *arithmetic* question.
/// `total + word.length * step` with an unbounded length is a product that can
/// leave the exactly-representable integers, so it has to be computed in
/// doubles and truncated back with the full wrapping `ToInt32`. With a bound it
/// is an `int64` multiply and a cast, and on `benchmarks/cases/substrings` that
/// difference is 27% of the benchmark.
///
/// # The rule
///
/// Every string-producing operation this compiler emits either says its length
/// outright or bounds it by its input's, so the bound follows the chain back to
/// a literal. Where the chain reaches something else -- a parameter, a field, a
/// phi -- there is no bound and the caller keeps `[0, 2^32)`.
///
/// Only the *upper* bound is claimed. A slice can be empty whatever it was cut
/// from, which is why every case here starts at zero.
/// What a machine type says about every value in it.
///
/// An `i8` holds -128 to 127, and no fraction and no NaN. That is stronger than
/// anything a flow analysis can derive, it costs nothing to know, and for a
/// declared typed array it is the *only* fact there is — no pass narrowed the
/// storage, so no pass recorded what it holds.
fn held_by(ty: &super::HirType) -> Option<Facts> {
    let super::HirType::Int { bits, signed } = ty else {
        return None;
    };
    let (lo, hi) = match (bits, signed) {
        (8, true) => (-128.0, 127.0),
        (8, false) => (0.0, 255.0),
        (16, true) => (-32768.0, 32767.0),
        (16, false) => (0.0, 65535.0),
        (32, true) => (facts::I32_MIN, facts::I32_MAX),
        (32, false) => (0.0, facts::U32_MAX),
        // A 64-bit slot holds more than a `double` can tell apart. Every one
        // this compiler makes holds a value already proved inside the safe
        // range -- that proof is what `specialize` requires before it uses the
        // width at all -- but *this* function is about what the type says on its
        // own, and a 64-bit integer type says nothing a double can act on.
        _ => return None,
    };
    Some(Facts::new(lo, hi, true, false, false))
}

pub(super) fn string_span(func: &Func, value: ValueId, depth: u32) -> Option<Facts> {
    /// A slice of a slice of a slice is worth following; an unbounded chain is
    /// not, and a cheap cap means this needs no reasoning about cycles.
    const MAX_DEPTH: u32 = 8;

    if depth > MAX_DEPTH {
        return None;
    }
    let span = |of: ValueId| Some(string_span(func, of, depth + 1)?.hi);
    Some(match &func.values[value.0 as usize].kind {
        // A literal's length is written down in the literal. It is the count of
        // UTF-16 code units and not of characters, which is what
        // `String::length` means -- an emoji is two.
        OpKind::ConstString(text) => {
            let units = text.encode_utf16().count();
            Facts::constant(f64::from(u32::try_from(units).unwrap_or(u32::MAX)))
        }
        OpKind::Binary {
            op: super::BinOp::Concat,
            lhs,
            rhs,
        } => upto(span(*lhs)? + span(*rhs)?),
        OpKind::Call {
            callee: super::Callee::External(name),
            args,
            ..
        } => match (name.as_str(), args.first()) {
            // Both clamp into the receiver, so neither can be longer than it.
            ("nts_str_substring" | "nts_str_slice", Some(&source)) => upto(span(source)?),
            // At most one code unit, for two different reasons: `charAt` clamps
            // into the receiver and yields none where the index is out of
            // range, while `fromCharCode` truncates its argument to sixteen
            // bits and always yields exactly one.
            //
            // `hir::frame_capacity` has known the second since it was written.
            // Saying it *here* too is what lets a **concatenation** of two of
            // them be bounded -- and `String.fromCharCode(hi, lo)`, the
            // surrogate pair every astral character goes through, was three of
            // the eight allocations `node-utf8` made per decoded string.
            ("nts_str_at" | "nts_str_char_at" | "nts_string_from_char_code", _) => upto(1.0),
            // One or two: a code point above the basic plane is a surrogate
            // pair, which is what makes this a different function.
            ("nts_string_from_code_point", _) => upto(2.0),
            // `a.concat(b)`. The `a + b` spelling is a `BinOp::Concat` and is
            // handled above.
            ("nts_concat", _) => match (args.first(), args.get(1)) {
                (Some(&a), Some(&b)) => upto(span(a)? + span(b)?),
                _ => return None,
            },
            _ => return None,
        },
        _ => return None,
    })
}

/// `[0, hi]`, saturating at the largest length a string can have.
fn upto(hi: f64) -> Facts {
    Facts::new(0.0, hi.min(facts::U32_MAX), true, false, false)
}

/// What a **bound Java member** returns, from the descriptor in its own name.
///
/// `from_jvm_descriptor` has existed and been tested since the day the binding
/// table was designed, and had **no caller outside its own tests** -- correct,
/// documented, and dead. This is its first use.
///
/// The descriptor is already in the key: `owner.member:(params)ret`, so this
/// needs no table lookup and no plumbing. An `I` is a 32-bit signed integer by
/// the JVM's own guarantee, enforced by the verifier at class load, so the
/// facts are a platform invariant rather than an inference.
///
/// **What it costs not to have.** Without it a value arriving from Java is
/// `TOP`: unbounded, possibly NaN, possibly `-0`. So `rect.right - rect.left`
/// cannot be proved integral, the arithmetic after it stays `f64`, and every
/// operation downstream carries NaN and `-0` handling that the descriptor had
/// already ruled out.
fn foreign_result(key: &str) -> Option<Facts> {
    if !super::runtime::is_foreign_key(key) {
        return None;
    }
    let descriptor = key.split_once(':')?.1;
    let returns = descriptor.rsplit_once(')')?.1;
    super::facts::from_jvm_descriptor(returns)
}

/// A position a search answers, or -1.
const INDEX: &[&str] = &[
    "nts_str_index_of",
    "nts_str_index_of_from",
    "nts_str_last_index_of",
    "nts_str_last_index_of_from",
    "nts_array_index_of",
    "nts_array_last_index_of",
];
/// A table's cursor: the next live entry's index, or -1. Declared an `int32_t`,
/// and bounded by the table, which never holds more than `NTS_MAX_LENGTH`
/// entries (`nts_map_rehash`): so the walk's `at + 1` is an `int32` too, where
/// the declared type alone would let it reach 2^31 and widen.
const CURSOR: &[&str] = &["nts_map_next"];
/// The length after one element was added: one at least. A number's array,
/// a reference's, an erased value's.
const LENGTH: &[&str] = &[
    "nts_array_push",
    "nts_array_push_ref",
    "nts_array_push_value",
];
/// A view's, a buffer's or a `DataView`'s length counts what was allocated,
/// which no machine holds 2^53 of.
const STORAGE: &[&str] = &[
    "nts_view_length",
    "nts_view_byte_length",
    "nts_buffer_byte_length",
    "nts_buffer_max_byte_length",
    "nts_dataview_byte_length",
];

/// What a runtime helper's result is known to be.
///
/// Each helper here needs its result declared in `runtime::SIGNATURES` as
/// well: a fact narrows the call's value to an integer, and only a declared
/// result tells `specialize` the call itself still answers a `double`, which
/// it converts. Without one the call was retyped -- C converted at the
/// assignment, and the JVM refused a `double` stored as a `long`.
fn runtime_result(name: &str) -> Option<Facts> {
    if INDEX.contains(&name) {
        return Some(Facts::new(-1.0, facts::U32_MAX, true, false, false));
    }
    if CURSOR.contains(&name) {
        return Some(Facts::new(
            -1.0,
            facts::MAX_LENGTH - 1.0,
            true,
            false,
            false,
        ));
    }
    if LENGTH.contains(&name) {
        return Some(Facts::new(1.0, facts::U32_MAX, true, false, false));
    }
    if STORAGE.contains(&name) {
        return Some(Facts::new(0.0, facts::SAFE_MAX, true, false, false));
    }
    None
}

/// What each position of each **local tuple** in a function holds: an array
/// the function builds and only ever stores into and reads at constant
/// positions, every position stored in the block that builds it before
/// anything there reads it. A tuple made and taken apart in one function --
/// a chain-up answering its out values, taken apart by `const [a, b] = ...`
/// -- whose round trip through the array otherwise loses every fact. Nothing
/// else can write one, since nothing else holds it, so a read is the join of
/// what was stored at its position.
type LocalTuples = FxHashMap<ValueId, Vec<Vec<ValueId>>>;

fn local_tuples(func: &Func) -> LocalTuples {
    let position = |value: ValueId| -> Option<usize> {
        match func.values[value.0 as usize].kind {
            OpKind::ConstInt(at) => usize::try_from(at).ok(),
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            OpKind::ConstFloat(at) if at >= 0.0 && at.fract() == 0.0 && at < 65_536.0 => {
                Some(at as usize)
            }
            _ => None,
        }
    };
    let mut tuples: LocalTuples = FxHashMap::default();
    for (index, op) in func.values.iter().enumerate() {
        if let OpKind::ArrayNew { length, .. } = op.kind
            && let Some(length) = position(length)
        {
            tuples.insert(
                ValueId(u32::try_from(index).unwrap_or(u32::MAX)),
                vec![Vec::new(); length],
            );
        }
    }
    if tuples.is_empty() {
        return tuples;
    }
    // Any other use is an escape: it stops being a local tuple.
    let mut escaped: rustc_hash::FxHashSet<ValueId> = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        for &op in &block.ops {
            match &func.values[op.0 as usize].kind {
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    ..
                } if tuples.contains_key(array) => {
                    match (position(*index), tuples.get_mut(array)) {
                        (Some(at), Some(slots)) if at < slots.len() => slots[at].push(*value),
                        _ => {
                            escaped.insert(*array);
                        }
                    }
                    escaped.extend(std::iter::once(*value).filter(|v| tuples.contains_key(v)));
                }
                OpKind::ArrayGet { array, index, .. }
                    if tuples.contains_key(array) && position(*index).is_some() => {}
                kind => escaped.extend(
                    super::operands_of(kind)
                        .into_iter()
                        .filter(|v| tuples.contains_key(v)),
                ),
            }
        }
        escaped.extend(
            super::operands_of_terminator(&block.terminator)
                .into_iter()
                .filter(|v| tuples.contains_key(v)),
        );
    }
    // Every position stored where the tuple is built, before any read there.
    for block in &func.blocks {
        for (at, &op) in block.ops.iter().enumerate() {
            if !tuples.contains_key(&op) || escaped.contains(&op) {
                continue;
            }
            let length = tuples[&op].len();
            let mut stored = vec![false; length];
            for &later in &block.ops[at + 1..] {
                match &func.values[later.0 as usize].kind {
                    OpKind::ArraySet { array, index, .. } if *array == op => {
                        if let Some(slot) = position(*index).and_then(|at| stored.get_mut(at)) {
                            *slot = true;
                        }
                    }
                    OpKind::ArrayGet { array, .. } if *array == op => break,
                    _ => {}
                }
            }
            if stored.contains(&false) {
                escaped.insert(op);
            }
        }
    }
    tuples.retain(|array, _| !escaped.contains(array));
    tuples
}

/// A read of a local tuple's position ([`LocalTuples`]): the join of what was
/// stored there.
fn local_tuple_read(
    tuples: &LocalTuples,
    kind: &OpKind,
    refinements: &Refinements,
    facts: &mut FactView<'_>,
) -> Option<Facts> {
    let OpKind::ArrayGet { array, index, .. } = kind else {
        return None;
    };
    let slots = tuples.get(array)?;
    let at = facts.get(refinements, *index);
    if !(at.is_singleton() && at.integral()) {
        return None;
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let stored = slots.get(at.lo as usize)?;
    Some(stored.iter().fold(Facts::BOTTOM, |joined, value| {
        joined.join(facts.get(refinements, *value))
    }))
}

/// What native memory of a scalar type holds: that type's values. C wrote
/// them as its type, and a store of the program's was proven to fit
/// (`super::obligations`). A bit-field holds its width's.
fn native_load_facts(func: &Func, kind: &OpKind, targets: super::native::Targets) -> Facts {
    use super::native::Pointee;
    let (OpKind::NativeLoad { pointer, .. } | OpKind::NativeBitLoad { pointer, .. }) = kind else {
        return Facts::TOP;
    };
    let super::HirType::NativePointer(pointee) = &func.values[pointer.0 as usize].ty else {
        return Facts::TOP;
    };
    match (kind, pointee.viewed()) {
        (OpKind::NativeLoad { .. }, Pointee::Scalar(scalar)) => scalar.facts_on(targets),
        (OpKind::NativeBitLoad { field, .. }, Pointee::Record(record)) => {
            match record
                .fields
                .get(*field as usize)
                .map(|member| member.ty.viewed())
            {
                Some(Pointee::Bits { unit, width }) => bit_field_facts(*unit, *width, targets),
                _ => Facts::TOP,
            }
        }
        _ => Facts::TOP,
    }
}

/// What a bit-field of `width` bits of a `unit` holds on some one of
/// `targets`: signed where the unit is signed on a row, unsigned where it is
/// not on one -- a `char` unit is both, for x86-64 and arm64 Linux.
fn bit_field_facts(
    unit: super::native::Scalar,
    width: u32,
    targets: super::native::Targets,
) -> Facts {
    if width == 0 || width > 52 {
        return unit.facts_on(targets);
    }
    let span = f64::from(1u32 << width.min(31)) * f64::from(1u32 << width.saturating_sub(31));
    let signed = |abi| matches!(unit.abi(abi), super::HirType::Int { signed: true, .. });
    let least = if targets.rows().any(signed) {
        -span / 2.0
    } else {
        0.0
    };
    let greatest = if targets.rows().any(|abi| !signed(abi)) {
        span - 1.0
    } else {
        span / 2.0 - 1.0
    };
    Facts::new(least, greatest, true, false, false)
}

/// What a field of an object of this type can hold.
fn field_facts(context: &Context, object: &super::HirType, field: u32) -> Facts {
    let super::HirType::Managed(super::ManagedType::Object(ty)) = object else {
        return Facts::TOP;
    };
    context
        .whole
        .field_facts
        .get(&(*ty, field))
        .copied()
        .unwrap_or(Facts::TOP)
        .narrow(written_field(context, object, field))
}

/// What the program's own types say a field of an object of this type holds:
/// a written `c_int` field is in `int`'s range on every target, whatever a
/// store's value was proven to be. Every read is narrowed by it, a read this
/// path already knows the value of included -- that one lost it once, and a
/// `c_int` property handed to C stopped being provably an `int`.
fn written_field(context: &Context, object: &super::HirType, field: u32) -> Facts {
    let super::HirType::Managed(super::ManagedType::Object(ty)) = object else {
        return Facts::TOP;
    };
    context
        .written
        .fields
        .get(&(*ty, field))
        .copied()
        .unwrap_or(Facts::TOP)
}

/// What one operation says about its result.
///
/// An operation with no arm here does not fail -- it returns `TOP`, which is
/// indistinguishable from an honest unknown at every use downstream. That
/// degrades silently and at a distance: a missing `Convert` arm cost the
/// `bytes` benchmark 2.4x, in a specializer that was working correctly. Adding
/// a producer of values to the HIR means adding an arm here. See record 0016.
#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
fn transfer_op(
    func: &Func,
    context: &Context,
    op: &super::Op,
    refinements: &Refinements,
    facts: &mut FactView<'_>,
) -> Facts {
    // Every fact in this lattice is a fact about a *double*: a range, whether the
    // value is whole, whether it could be `-0`. A `bigint` is none of those. It
    // is exact to 128 bits, its shift count is not masked to five, and its
    // operands are not truncated to int32 -- so folding `1n << 100n` here
    // answered 16, because 100 & 31 is 4. Nothing true of a double is true of it,
    // so nothing is claimed.
    if matches!(op.ty, super::HirType::BigInt) {
        return Facts::TOP;
    }
    let result = match &op.kind {
        OpKind::ConstFloat(v) => Facts::constant(*v),
        #[allow(clippy::cast_precision_loss)]
        OpKind::ConstInt(v) => Facts::constant(*v as f64),
        OpKind::Binary { op: bin, lhs, rhs } => facts::transfer_binary(
            *bin,
            facts.get(refinements, *lhs),
            facts.get(refinements, *rhs),
        )
        .unwrap_or(Facts::TOP),
        OpKind::Unary {
            op: UnOp::Neg,
            operand,
        } => facts::neg(facts.get(refinements, *operand)),
        // The coercions are where an unconstrained value becomes a known
        // integer. Everything about `x | 0` depends on this arm.
        OpKind::Unary {
            op: UnOp::ToInt32,
            operand,
        } => facts::to_int32(facts.get(refinements, *operand)),
        OpKind::Unary {
            op: UnOp::ToUint32,
            operand,
        } => facts::to_uint32(facts.get(refinements, *operand)),
        OpKind::Unary {
            op: rounding @ (UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round),
            operand,
        } => facts::round_to_integer(*rounding, facts.get(refinements, *operand)),
        OpKind::Unary {
            op: UnOp::Abs,
            operand,
        } => facts::abs(facts.get(refinements, *operand)),
        // A length is a `uint32`, always. Where the array was allocated
        // here with a known size, it is that size exactly — which is what
        // lets an index into an array literal be proven in bounds by the
        // interval domain alone, with no reasoning about the array at all.
        // A code unit is a `uint16`. Out of range is NaN rather than a
        // trap, so an unproven index is the same set plus NaN -- and once
        // the index is proven inside the string it is just the range, which
        // is what lets a scan by code unit stay in integers.
        OpKind::StringUnitAt { checked, .. } => Facts::new(0.0, 65535.0, true, *checked, false),
        OpKind::Length(array) => {
            // `I32_MAX`, and the runtime enforces it: `nts_array_allocate`
            // refuses a length past 2^31 - 1 with a message and an abort, the
            // same shape as the bigint upper endpoint. So this is a
            // consequence of a refusal rather than a claim about an array that
            // could exist.
            //
            // What it buys is the loop counter. A length bounded by `U32_MAX`
            // is not provably an `int32`, so the counter comparing against it
            // is an `i64` -- and an `i64` induction variable is a shape neither
            // optimiser treats as a counted loop. No range-check elimination,
            // no unrolling, no vectorisation. Measured on the JVM lane at
            // **13.1x** on `elementwise`, writing the same loop over the same
            // `double[]` with an `int` counter against a `long` one, and 32% on
            // `array-predicates`. `elementwise`'s own comment predicted it in
            // the LLVM vocabulary: an index left wider than an `int32` "makes
            // every index an `fptoui` of a floating-point induction variable --
            // which LLVM's scalar evolution cannot model".
            let bound = Facts::new(0.0, facts::MAX_LENGTH, true, false, false);
            match &func.values[array.0 as usize].kind {
                // Only while nothing can have grown it: an array handed to a
                // call may come back longer, and the object does not move so
                // every reference sees the new length.
                OpKind::ArrayNew { length, .. }
                    if super::allocated_length_is_exact(func, *array, context.whole.growable) =>
                {
                    facts.get(refinements, *length).narrow(bound)
                }
                // A string's length is bounded by the string it was made
                // from, however many slices back that is.
                _ => string_span(func, *array, 0).unwrap_or(bound).narrow(bound),
            }
        }
        // A parameter keeps what its declared type said. It is an operation
        // in the entry block like any other, so without this arm the
        // transfer recomputes it as TOP and joins that over the seed —
        // silently discarding the one thing that makes a parameter provable.
        OpKind::Param(slot) => parameter_facts(func, context, *slot),
        // What the callee was proven to return. Without this every call is
        // a wall: an unanalyzed result poisons everything downstream of it,
        // which for a program made of small functions is everything.
        OpKind::Call { callee, args, .. } => operand_result(callee, args, refinements, facts)
            .unwrap_or_else(|| call_result(context, callee)),
        // What was stored into this field, anywhere in the program.
        OpKind::FieldGet { object, field } => {
            field_facts(context, &func.values[object.0 as usize].ty, *field)
        }
        // The same idea for the third kind of storage. Absent is TOP, which is
        // what an exported global gets: a writer outside the compiled set is
        // not in any join this program can take.
        OpKind::GlobalGet(global) => context
            .whole
            .global_facts
            .get(global)
            .copied()
            .unwrap_or(Facts::TOP)
            .narrow(
                context
                    .written
                    .globals
                    .get(global)
                    .copied()
                    .unwrap_or(Facts::TOP),
            ),
        // What anything in the program stored into an array of this type,
        // but *only once the storage agrees*.
        //
        // The fact is true either way -- an array of `number` holding 0 to
        // 100 holds them whether it is `double[]` or `int32_t[]`. Acting on
        // it is what needs the storage: from a `double[]`, proving the
        // element whole makes the arithmetic after it integer, and every
        // one of those results is converted back at the first floating
        // point use. Measured on `arrays`, that is four conversions per
        // iteration and 18% slower.
        //
        // So `hir::elements` decides the storage, and the fact follows it.
        // A position of a tuple a function was written to return: that
        // position's kind, which each of its `return`s was proven to fit.
        OpKind::ArrayGet { array, index, .. }
            if let OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } = &func.values[array.0 as usize].kind
                && let Some(elements) = context.written.return_elements.get(name)
                && let position = facts.get(refinements, *index)
                && position.is_singleton()
                && position.integral() =>
        {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            elements
                .get(position.lo as usize)
                .copied()
                .unwrap_or(Facts::TOP)
        }
        OpKind::ArrayGet { array, .. } => match &func.values[array.0 as usize].ty {
            // A view's element carries the same fact for the same reason: the
            // width *is* the range. Missing this left a `Uint8Array` read with
            // no bound, so the arithmetic around it could not specialize and
            // the byte went `u8 -> f64 -> i32` after all -- which the
            // optimisation test asserts against, and which is the only place
            // that would have said so.
            super::HirType::Managed(super::ManagedType::Array(element))
                if matches!(**element, super::HirType::Int { .. }) =>
            {
                let stored = context
                    .whole
                    .element_facts
                    .get(element.as_ref())
                    .copied()
                    .unwrap_or(Facts::TOP);
                match held_by(element) {
                    Some(width) => stored.narrow(width),
                    None => stored,
                }
            }
            // **A view's element knows its width and nothing else.** The
            // width *is* a range: a `Uint8Array`'s element is 0 to 255 by
            // construction. What was stored is not a fact about a view at
            // all. `element_facts` joins stores into *arrays* by element
            // type, and a view's bytes are written by other views over the
            // same buffer, `DataView`, `set` and native code, none of which
            // an `ArraySet` on this type records. Read from that table, an
            // `Int32Array` borrowed the range of every `number[]` stored as
            // `int32_t` -- `[1, 2]` anywhere in the program made its
            // elements non-negative, and `x % 4093` of a negative element
            // was computed unsigned
            // (`tests/outcomes/a-negative-int32-element-read-as-unsigned`).
            super::HirType::Managed(super::ManagedType::View(element))
                if matches!(**element, super::HirType::Int { .. }) =>
            {
                match held_by(element) {
                    Some(width) => Facts::TOP.narrow(width),
                    None => Facts::TOP,
                }
            }
            _ => Facts::TOP,
        },
        OpKind::NativeLoad { .. } | OpKind::NativeBitLoad { .. } => {
            native_load_facts(func, &op.kind, context.written.targets)
        }
        OpKind::Await { promise, .. } => awaited(func, context, *promise),
        // What an erased value holds, as the type the checker narrowed it to.
        // Its facts are about the number it is when it is one -- a written
        // parameter's kind, through a uniform closure entry -- and this is
        // emitted only where a test proved it is one.
        OpKind::Unerase { value, .. }
            if matches!(
                op.ty,
                super::HirType::Int { .. } | super::HirType::Float { .. }
            ) =>
        {
            facts.get(refinements, *value)
        }
        // A conversion keeps the value it was given, as far as it fits.
        //
        // Without this every typed array read was TOP: the read is narrow
        // and the expression around it is `number`, so lowering converts —
        // and an operand with no facts is an operand nothing can specialize.
        // `bytes` compiled its two `% 65521` to `fmod`, a library call, two
        // per byte, and ran at 2.36x the C++ reference.
        OpKind::Convert(operand) => {
            let incoming = facts.get(refinements, *operand);
            match held_by(&op.ty) {
                Some(width) => incoming.narrow(width),
                None => incoming,
            }
        }
        OpKind::FieldView { value, .. } => facts.get(refinements, *value),
        // A bool is not a number, and a call's result needs the callee
        // analyzed — neither is a claim this pass can make.
        // DispatchSlot belongs here: its native value is decided after analysis.
        _ => Facts::TOP,
    };
    // A checked read's value is an element: out of range it stops the program
    // instead of answering `undefined` (`super::may_stop`), and dead-code
    // removal and folding keep it for that.
    //
    // **An integer result wraps.** `(a + b) | 0` narrowed to `i32` is computed
    // modulo 2^32, and the `| 0` that said so is gone once the operands are
    // `i32`. So where the arithmetic's range leaves the type, the value is
    // somewhere in the type and nowhere that range says -- and a reader that
    // trusted the range would prove things about a value it does not have
    // (`super::exact` would promise `nsw` on a sum of one).
    if matches!(
        op.kind,
        OpKind::Binary { .. } | OpKind::Unary { op: UnOp::Neg, .. }
    ) && let Some(width) = held_by(&op.ty)
        && !(result.lo >= width.lo && result.hi <= width.hi)
    {
        return width;
    }
    result
}

/// Run one block, then hand its successors what it proved.
///
/// Operation results are kept as sparse block-local facts when they differ
/// from the global SSA fact. An edge may need that result after a later global
/// broadening; the defining block is rerun when its global output changes.
#[allow(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    reason = "one block transfer updates coupled abstract domains and emits edge deltas"
)]
fn transfer_block(
    func: &Func,
    (context, tuples): (&Context, &LocalTuples),
    block: BlockId,
    refinements: &Refinements,
    values: &mut [Facts],
    edges: &mut [Vec<Option<EdgeState>>],
    live_in: &[rustc_hash::FxHashSet<ValueId>],
    parameter_positions: &[FxHashMap<ValueId, usize>],
    work: &mut WorkCounts,
    (fields, observed, headers): (
        &mut [Option<Fields>],
        &mut Observed,
        &rustc_hash::FxHashSet<BlockId>,
    ),
    result: &mut TransferResult,
) {
    let record = &func.blocks[block.0 as usize];
    // Keep the path's SSA results alongside its incoming edge refinements.
    // A result can be narrower than the global fact after another path has
    // widened that SSA value; outgoing edges must retain that local result.
    let mut local = refinements.clone();
    let mut held = fields[block.0 as usize].clone().unwrap_or_default();

    // A block parameter's fact is whatever its predecessors passed, which the
    // edges recorded here.
    for param in &record.params {
        let passed = FactView::new(values, result).get(refinements, *param);
        if widen_into(&mut values[param.0 as usize], passed) {
            result.note_changed(*param);
        }
    }

    for &value in &record.ops {
        let op = &func.values[value.0 as usize];
        // A field this path stored or read is what it stored or read, not
        // everything the field can hold.
        let known = match &op.kind {
            OpKind::FieldGet { object, field } => held.get(&(*object, *field)).map(|now| {
                now.facts.narrow(written_field(
                    context,
                    &func.values[object.0 as usize].ty,
                    *field,
                ))
            }),
            _ => None,
        };
        let computed = if let Some(facts) = known {
            facts
        } else {
            let mut facts = FactView::new(values, result);
            match local_tuple_read(tuples, &op.kind, &local, &mut facts) {
                Some(stored) => stored,
                None => transfer_op(func, context, op, &local, &mut facts),
            }
        };
        // Monotone: a value's fact only grows as more paths reach it, so joining
        // rather than assigning keeps the iteration from oscillating.
        let slot = &mut values[value.0 as usize];
        let joined = slot.join(computed);
        if joined != *slot {
            *slot = joined;
            result.note_changed(value);
        }
        set_override(&mut local, value, computed, values[value.0 as usize]);
        if track(
            func,
            value,
            &mut held,
            observed,
            &local,
            &mut FactView::new(values, result),
        ) {
            // Observed field changes affect later interprocedural rounds, but
            // do not alter this function's block queue.
        }
    }

    match &record.terminator {
        Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {
            observe_all(func, &held, observed);
        }
        Terminator::Jump { target, args } => {
            if record_edge_recorded(
                func,
                block,
                0,
                *target,
                args,
                &local,
                &mut FactView::new(values, result),
                edges,
                live_in,
                parameter_positions,
                context.caps,
                work,
            ) {
                result.changed_blocks.insert(*target);
            }
            if send_fields(func, *target, held, fields, observed, headers) {
                result.changed_blocks.insert(*target);
            }
        }
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => {
            // Each edge carries what taking it proves. This is the only place
            // a value learns something its definition did not say.
            let predicates = &context.written.predicates;
            let on_then = refine_edge(
                func,
                predicates,
                &local,
                *cond,
                true,
                &mut FactView::new(values, result),
            );
            let on_else = refine_edge(
                func,
                predicates,
                &local,
                *cond,
                false,
                &mut FactView::new(values, result),
            );
            if record_edge_recorded(
                func,
                block,
                0,
                *then_target,
                then_args,
                &on_then,
                &mut FactView::new(values, result),
                edges,
                live_in,
                parameter_positions,
                context.caps,
                work,
            ) {
                result.changed_blocks.insert(*then_target);
            }
            if record_edge_recorded(
                func,
                block,
                1,
                *else_target,
                else_args,
                &on_else,
                &mut FactView::new(values, result),
                edges,
                live_in,
                parameter_positions,
                context.caps,
                work,
            ) {
                result.changed_blocks.insert(*else_target);
            }
            let then_held = narrowed_by(&held, &on_then);
            let else_held = narrowed_by(&held, &on_else);
            if send_fields(func, *then_target, then_held, fields, observed, headers) {
                result.changed_blocks.insert(*then_target);
            }
            if send_fields(func, *else_target, else_held, fields, observed, headers) {
                result.changed_blocks.insert(*else_target);
            }
        }
    }
}

/// What one operation does to the fields a path knows.
///
/// A store makes its value the field's; a read makes the field what it read.
/// Either first observes the same field of every *other* reference the path
/// knows it for, because the two may be one object -- and a store takes those
/// out, since it may have overwritten them. Anything that can run other code
/// observes everything known and forgets it: what the other code wrote, this
/// path cannot see.
fn track(
    func: &Func,
    value: ValueId,
    held: &mut Fields,
    observed: &mut Observed,
    refinements: &Refinements,
    facts: &mut FactView<'_>,
) -> bool {
    match &func.values[value.0 as usize].kind {
        OpKind::FieldSet {
            object,
            field,
            value: stored,
        } => {
            let changed = observe_others(func, held, observed, *object, *field, true);
            held.insert(
                (*object, *field),
                Held {
                    by: Some(*stored),
                    facts: facts.get(refinements, *stored),
                },
            );
            changed
        }
        OpKind::FieldGet { object, field } => {
            let changed = observe_others(func, held, observed, *object, *field, false);
            held.insert(
                (*object, *field),
                Held {
                    by: Some(value),
                    facts: facts.get(refinements, value),
                },
            );
            changed
        }
        kind if runs_elsewhere(kind) => {
            let changed = observe_all(func, held, observed);
            held.clear();
            changed
        }
        _ => false,
    }
}

/// Whether an operation can run code this path does not see, or reach a field
/// by a route this analysis does not track.
///
/// Listed by what cannot, so that an operation added later is an observation
/// until someone says otherwise -- the cost of a wrong answer here is a field
/// narrowed below what it holds.
fn runs_elsewhere(kind: &OpKind) -> bool {
    !matches!(
        kind,
        OpKind::Param(_)
            | OpKind::BlockParam(_)
            | OpKind::ConstInt(_)
            | OpKind::ConstHandle(_)
            | OpKind::ConstFloat(_)
            | OpKind::ConstBool(_)
            | OpKind::ConstString(_)
            | OpKind::ConstNull
            | OpKind::ConstUndefined
            | OpKind::Erase { .. }
            | OpKind::TagOf { .. }
            | OpKind::Unerase { .. }
            | OpKind::Binary { .. }
            | OpKind::Unary { .. }
            | OpKind::Convert(_)
            | OpKind::NativePointerBits { .. }
            | OpKind::NativeStringView { .. }
            | OpKind::ArrayNew { .. }
            | OpKind::Length(_)
            | OpKind::ArrayGet { .. }
            | OpKind::ArraySet { .. }
            | OpKind::StringUnitAt { .. }
            | OpKind::GlobalGet(_)
            | OpKind::GlobalSet { .. }
            | OpKind::ObjectNew { .. }
            | OpKind::InstanceOf { .. }
    )
}

/// The same field, known through a reference other than `object`: observed,
/// and with `forget`, no longer known.
fn observe_others(
    func: &Func,
    held: &mut Fields,
    observed: &mut Observed,
    object: ValueId,
    field: u32,
    forget: bool,
) -> bool {
    let mut changed = false;
    held.retain(|&(other, at), now| {
        if at != field || other == object {
            return true;
        }
        changed |= observe(func, observed, other, at, now.facts);
        !forget
    });
    changed
}

fn observe_all(func: &Func, held: &Fields, observed: &mut Observed) -> bool {
    let mut changed = false;
    for (&(object, field), now) in held {
        changed |= observe(func, observed, object, field, now.facts);
    }
    changed
}

fn observe(
    func: &Func,
    observed: &mut Observed,
    object: ValueId,
    field: u32,
    facts: Facts,
) -> bool {
    use std::collections::hash_map::Entry;
    let key = (func.values[object.0 as usize].ty.clone(), field);
    match observed.entry(key) {
        Entry::Vacant(slot) => {
            slot.insert(facts);
            true
        }
        Entry::Occupied(mut slot) => {
            let joined = slot.get().join(facts);
            if joined == *slot.get() {
                false
            } else {
                slot.insert(joined);
                true
            }
        }
    }
}

/// The fields an edge carries, narrowed by what taking it proved about the
/// value each was last stored or read as.
fn narrowed_by(held: &Fields, edge: &Refinements) -> Fields {
    held.iter()
        .map(|(key, now)| {
            let facts = match now.by.and_then(|by| edge.get(&by)) {
                Some(proved) => now.facts.narrow(*proved),
                None => now.facts,
            };
            (*key, Held { by: now.by, facts })
        })
        .collect()
}

/// Hand an edge's known fields to its target, reporting whether the target's
/// entry state moved.
///
/// A field the paths into a block do not all know becomes unknown there, and
/// what the paths that knew it held is observed: it is in the field now, and
/// nothing later on this path will say so. A loop's header knows nothing --
/// everything arriving is observed -- so a field written every iteration
/// cannot climb here unwidened: its growth is the whole-program fixpoint's to
/// widen.
fn send_fields(
    func: &Func,
    target: BlockId,
    incoming: Fields,
    fields: &mut [Option<Fields>],
    observed: &mut Observed,
    headers: &rustc_hash::FxHashSet<BlockId>,
) -> bool {
    let slot = &mut fields[target.0 as usize];
    if headers.contains(&target) {
        let changed = observe_all(func, &incoming, observed);
        if slot.is_none() {
            *slot = Some(Fields::default());
            return true;
        }
        return changed;
    }
    let Some(existing) = slot else {
        *slot = Some(incoming);
        return true;
    };
    let mut changed = false;
    existing.retain(|&(object, field), now| {
        let Some(other) = incoming.get(&(object, field)) else {
            observe(func, observed, object, field, now.facts);
            changed = true;
            return false;
        };
        let merged = Held {
            by: if now.by == other.by { now.by } else { None },
            facts: now.facts.join(other.facts),
        };
        if merged != *now {
            *now = merged;
            changed = true;
        }
        true
    });
    for (&(object, field), other) in &incoming {
        if !existing.contains_key(&(object, field)) {
            changed |= observe(func, observed, object, field, other.facts);
        }
    }
    changed
}

/// Hand an edge's facts to its target, binding the target's parameters to the
/// arguments this edge passes.
#[allow(
    clippy::too_many_arguments,
    reason = "edge recording updates one target from a single solver snapshot"
)]
fn record_edge_recorded(
    func: &Func,
    source: BlockId,
    edge_slot: usize,
    target: BlockId,
    args: &[ValueId],
    refinements: &Refinements,
    facts: &mut FactView<'_>,
    edges: &mut [Vec<Option<EdgeState>>],
    live_in: &[rustc_hash::FxHashSet<ValueId>],
    parameter_positions: &[FxHashMap<ValueId, usize>],
    caps: &FxHashMap<ValueId, Facts>,
    work: &mut WorkCounts,
) -> bool {
    #[cfg(not(test))]
    let _ = work;
    let target_params = &func.blocks[target.0 as usize].params;
    let target_positions = &parameter_positions[target.0 as usize];
    let mut path_facts = PathFacts::default();
    for (&value, &facts) in refinements {
        #[cfg(any(test, flow_measure))]
        {
            work.sparse_refinement_visits += 1;
        }
        if target_positions.contains_key(&value) {
            continue;
        }
        #[cfg(any(test, flow_measure))]
        {
            work.live_in_membership_probes += 1;
        }
        if live_in[target.0 as usize].contains(&value) {
            path_facts.insert(value, facts);
        }
    }
    let params = target_params
        .iter()
        .zip(args)
        .map(|(param, arg)| capped(caps, *param, facts.get(refinements, *arg)))
        .collect();
    #[cfg(flow_measure)]
    {
        work.path_fact_entries_built += path_facts.len();
    }
    let next = EdgeState { path_facts, params };
    debug_assert_eq!(
        func.blocks[source.0 as usize].terminator.successors()[edge_slot],
        target
    );
    let slot = &mut edges[source.0 as usize][edge_slot];
    if slot.as_ref() == Some(&next) {
        return false;
    }
    *slot = Some(next);
    true
}

#[cfg(test)]
#[allow(
    clippy::too_many_arguments,
    reason = "test helper mirrors one edge transfer"
)]
fn record_edge(
    func: &Func,
    source: BlockId,
    edge_slot: usize,
    target: BlockId,
    args: &[ValueId],
    refinements: &Refinements,
    values: &[Facts],
    edges: &mut [Vec<Option<EdgeState>>],
    live_in: &[rustc_hash::FxHashSet<ValueId>],
    parameter_positions: &[FxHashMap<ValueId, usize>],
    caps: &FxHashMap<ValueId, Facts>,
    work: &mut WorkCounts,
) -> bool {
    let mut dependencies = TransferResult::default();
    record_edge_recorded(
        func,
        source,
        edge_slot,
        target,
        args,
        refinements,
        &mut FactView::new(values, &mut dependencies),
        edges,
        live_in,
        parameter_positions,
        caps,
        work,
    )
}

/// A cap belongs to the destination SSA key. In particular, the source
/// argument of a back edge may be one increment wider than its target phi.
fn capped(caps: &FxHashMap<ValueId, Facts>, key: ValueId, facts: Facts) -> Facts {
    caps.get(&key).map_or(facts, |cap| facts.narrow(*cap))
}

/// Read a path fact while recording any SSA-global fallback dependency.
///
/// The raw slice is private to this type. Analysis helpers receive only a
/// `FactView`, so an indirect read cannot silently bypass sparse requeue.
fn lookup_recorded(refinements: &PathFacts, facts: &mut FactView<'_>, value: ValueId) -> Facts {
    if let Some(facts) = refinements.get(&value).copied() {
        facts
    } else {
        facts.dependencies.note_global_read(value);
        facts.values[value.0 as usize]
    }
}

/// Store only a fact that differs from the value's SSA-global fact.
fn set_override(refinements: &mut Refinements, value: ValueId, facts: Facts, global: Facts) {
    if facts == global {
        refinements.remove(&value);
    } else {
        refinements.insert(value, facts);
    }
    debug_assert!(
        refinements
            .get(&value)
            .is_none_or(|stored| *stored != global)
    );
}

fn set_path_fact(path: &mut PathFacts, value: ValueId, facts: Facts) {
    path.insert(value, facts);
}

#[cfg(any(test, debug_assertions))]
fn debug_assert_sparse(refinements: &Refinements, facts: &mut FactView<'_>) {
    debug_assert!(
        refinements
            .iter()
            .all(|(value, refined)| *refined != facts.global(*value))
    );
}

fn widen_into(slot: &mut Facts, incoming: Facts) -> bool {
    let joined = slot.join(incoming);
    if joined == *slot {
        return false;
    }
    *slot = joined;
    true
}

/// The comparison with its operands swapped.
const fn flip(op: BinOp) -> BinOp {
    match op {
        BinOp::Lt => BinOp::Gt,
        BinOp::Le => BinOp::Ge,
        BinOp::Gt => BinOp::Lt,
        BinOp::Ge => BinOp::Le,
        other => other,
    }
}

/// The comparison that holds when this one does not.
const fn negate(op: BinOp) -> BinOp {
    match op {
        BinOp::Lt => BinOp::Ge,
        BinOp::Le => BinOp::Gt,
        BinOp::Gt => BinOp::Le,
        BinOp::Ge => BinOp::Lt,
        BinOp::Eq => BinOp::Ne,
        BinOp::Ne => BinOp::Eq,
        other => other,
    }
}

/// Facts that hold on one side of a branch.
fn refine_edge(
    func: &Func,
    predicates: &FxHashMap<String, Vec<bool>>,
    refinements: &PathFacts,
    cond: ValueId,
    taken: bool,
    facts: &mut FactView<'_>,
) -> PathFacts {
    // `!c` taken is `c` not taken, and the other way round. Without this a
    // negated comparison narrowed nothing: `while (!(at > top))` let `at`
    // count up with no upper bound, so it widened to infinity and stayed a
    // double. A hand-written iterator's `!done` is the same once its
    // `{ value, done }` is a value rather than an object, `done` a
    // comparison. `tests/programs/a-negated-guard-bounds-what-it-compares`.
    if let OpKind::Unary {
        op: UnOp::Not,
        operand,
    } = func.values[cond.0 as usize].kind
    {
        return refine_edge(func, predicates, refinements, operand, !taken, facts);
    }
    let mut refined = refinements.clone();
    // A predicate of the program's whose `true` proves an argument not NaN
    // (`isDigit(code)`, `code >= 48 && code <= 57`): taken, that argument is
    // not NaN, and where it is a checked read, the read was in range. The
    // shape json-parse's scanners branch on, through a call this compiler
    // does not inline (`inline`'s record 0027).
    if taken
        && let OpKind::Call {
            callee: Callee::Direct(name),
            args,
            ..
        } = &func.values[cond.0 as usize].kind
        && let Some(slots) = predicates.get(name)
    {
        for (arg, _) in args.iter().zip(slots).filter(|(_, proves)| **proves) {
            let current = facts.get(&refined, *arg);
            set_path_fact(
                &mut refined,
                *arg,
                Facts {
                    maybe_nan: false,
                    ..current
                },
            );
            answered_in_range(func, &mut refined, *arg, facts);
        }
        return refined;
    }
    // `Number.isInteger(x)` taken: `x` is a finite integer -- whole and not
    // NaN, which a guard on its bounds then makes integral. `-0` passes it.
    if let OpKind::Call {
        callee: Callee::External(name),
        args,
        ..
    } = &func.values[cond.0 as usize].kind
        && name == "nts_is_integer"
        && let [tested] = args[..]
    {
        if taken {
            let current = facts.get(refinements, tested);
            set_path_fact(
                &mut refined,
                tested,
                current.narrow(Facts::new(
                    f64::NEG_INFINITY,
                    f64::INFINITY,
                    true,
                    false,
                    true,
                )),
            );
        }
        return refined;
    }
    let OpKind::Binary {
        op: comparison,
        lhs,
        rhs,
    } = &func.values[cond.0 as usize].kind
    else {
        return refined;
    };
    if !matches!(
        comparison,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne
    ) {
        return refined;
    }

    let holds = if taken {
        *comparison
    } else {
        negate(*comparison)
    };

    // An ordered comparison is false whenever either side is NaN, so only the
    // *true* edge proves NaN absent. Taking the false edge proves nothing about
    // it — which is why this cannot simply be the negated comparison.
    let excludes_nan = taken
        && matches!(
            comparison,
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq
        );

    let a = facts.get(refinements, *lhs);
    let b = facts.get(refinements, *rhs);
    set_path_fact(&mut refined, *lhs, refine(holds, a, b, excludes_nan));
    set_path_fact(&mut refined, *rhs, refine(flip(holds), b, a, excludes_nan));
    // **A checked read that answered was in range.** `charCodeAt` answers NaN
    // past either end, so on the edge where its result passed a comparison
    // that rules NaN out, the index it read at is a position of the string --
    // though nothing compared the index with the length. `while
    // (isDigit(s.charCodeAt(at))) at++` is the shape: `at` had no upper bound,
    // widened past the safe integers where `at + 1` stops being exact, and
    // the field it was stored into (json-parse's `Scanner.at`) became a double
    // for every one of its stores. Only a whole index: `charCodeAt(1.5)` reads
    // position 1, so a fractional one that answered proves less.
    if excludes_nan {
        for side in [*lhs, *rhs] {
            answered_in_range(func, &mut refined, side, facts);
        }
    }
    refined
}

/// Where `value` is a checked string read that answered -- proven not NaN on
/// this edge -- its index is a position of the string: below the longest a
/// string can be. Only a whole index; see [`refine_edge`].
fn answered_in_range(
    func: &Func,
    refined: &mut PathFacts,
    value: ValueId,
    facts: &mut FactView<'_>,
) {
    let Some(index) = unit_read_index(func, value) else {
        return;
    };
    let facts = facts.get(refined, index);
    if facts.whole {
        set_path_fact(
            refined,
            index,
            facts.narrow(Facts::new(
                0.0,
                super::facts::MAX_LENGTH - 1.0,
                true,
                false,
                true,
            )),
        );
    }
}

/// For each function answering a `bool`, the parameter slots whose `true`
/// answer proves them not NaN: every value it can return that may be `true`
/// is a comparison of the parameter that NaN fails (`<`, `<=`, `>`, `>=`,
/// `===`). Read from each body alone, once, before any fixpoint: it is a fact
/// about the code, not about what callers pass.
fn nan_excluding_predicates(program: &super::Program) -> FxHashMap<String, Vec<bool>> {
    let mut found = FxHashMap::default();
    for func in program
        .funcs
        .iter()
        .filter(|func| func.return_type == super::HirType::Bool)
    {
        let returned: Vec<ValueId> = func
            .blocks
            .iter()
            .filter_map(|block| match block.terminator {
                Terminator::Return(Some(value)) => Some(value),
                _ => None,
            })
            .collect();
        if returned.is_empty() {
            continue;
        }
        let incoming = super::loops::predecessors(func);
        let slots: Vec<bool> = (0..func.params.len())
            .map(|slot| {
                let slot = u32::try_from(slot).unwrap_or(u32::MAX);
                let mut seen = rustc_hash::FxHashSet::default();
                returned
                    .iter()
                    .all(|value| true_only_if_not_nan(func, &incoming, *value, slot, &mut seen))
            })
            .collect();
        if slots.iter().any(|proves| *proves) {
            found.insert(func.name.clone(), slots);
        }
    }
    found
}

/// Whether `value` can be `true` only where parameter `slot` is not NaN.
fn true_only_if_not_nan(
    func: &Func,
    incoming: &[Vec<(BlockId, Vec<ValueId>)>],
    value: ValueId,
    slot: u32,
    seen: &mut rustc_hash::FxHashSet<ValueId>,
) -> bool {
    // Around a cycle, the value is only ever one of the others.
    if !seen.insert(value) {
        return true;
    }
    match &func.values[value.0 as usize].kind {
        OpKind::ConstBool(false) => true,
        OpKind::Binary {
            op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq,
            lhs,
            rhs,
        } => is_param(func, *lhs, slot) || is_param(func, *rhs, slot),
        OpKind::BlockParam(_) => {
            let Some((block, at)) = func.blocks.iter().enumerate().find_map(|(index, block)| {
                block
                    .params
                    .iter()
                    .position(|param| *param == value)
                    .map(|at| (index, at))
            }) else {
                return false;
            };
            incoming[block].iter().all(|(_, args)| {
                args.get(at)
                    .is_some_and(|arg| true_only_if_not_nan(func, incoming, *arg, slot, seen))
            })
        }
        _ => false,
    }
}

/// Whether `value` is parameter `slot`, through conversions that keep it.
fn is_param(func: &Func, value: ValueId, slot: u32) -> bool {
    match func.values[value.0 as usize].kind {
        OpKind::Param(at) => at == slot,
        OpKind::Convert(from) => is_param(func, from, slot),
        _ => false,
    }
}

/// The index of the checked string read `value` is, through the conversions
/// that widen a unit without changing it.
fn unit_read_index(func: &Func, value: ValueId) -> Option<ValueId> {
    match func.values[value.0 as usize].kind {
        OpKind::StringUnitAt {
            index,
            checked: true,
            ..
        } => Some(index),
        OpKind::Convert(from) => unit_read_index(func, from),
        _ => None,
    }
}

/// Narrow `a` to an interval, keeping the flags an interval cannot express.
fn meet(a: Facts, lo: f64, hi: f64, clear_nan: bool) -> Facts {
    let new_lo = a.lo.max(lo);
    let new_hi = a.hi.min(hi);
    if new_lo > new_hi {
        // No numeric member survives, though NaN may still reach here.
        return Facts {
            maybe_nan: if clear_nan { false } else { a.maybe_nan },
            ..Facts::BOTTOM
        };
    }
    Facts::new(
        new_lo,
        new_hi,
        a.whole,
        if clear_nan { false } else { a.maybe_nan },
        a.maybe_negative_zero,
    )
}

/// Narrow `a` given that `a OP b` holds.
///
/// Wholeness sharpens a strict bound by a full step: a whole `x < b` is not
/// merely `x <= b`, it is `x <= ceil(b) - 1`. That single rule is what turns
/// `while (i < 10)` into `i` in `[0, 9]` rather than `[0, 10]` — and an
/// off-by-one in a range analysis is an off-by-one in the emitted program.
fn refine(op: BinOp, a: Facts, b: Facts, clear_nan: bool) -> Facts {
    let cleared = Facts {
        maybe_nan: if clear_nan { false } else { a.maybe_nan },
        ..a
    };
    if a.lo > a.hi || b.lo > b.hi {
        return cleared;
    }
    // On a failed ordered comparison, a NaN on the other side satisfies the
    // failure whatever this side holds, so nothing about this side is proven.
    if !clear_nan && b.maybe_nan && matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge) {
        return cleared;
    }

    match op {
        BinOp::Lt => meet(
            a,
            f64::NEG_INFINITY,
            if a.whole { b.hi.ceil() - 1.0 } else { b.hi },
            clear_nan,
        ),
        BinOp::Le => meet(
            a,
            f64::NEG_INFINITY,
            if a.whole { b.hi.floor() } else { b.hi },
            clear_nan,
        ),
        BinOp::Gt => meet(
            a,
            if a.whole { b.lo.floor() + 1.0 } else { b.lo },
            f64::INFINITY,
            clear_nan,
        ),
        BinOp::Ge => meet(
            a,
            if a.whole { b.lo.ceil() } else { b.lo },
            f64::INFINITY,
            clear_nan,
        ),
        BinOp::Eq => meet(a, b.lo, b.hi, clear_nan),
        // Knowing a value is not equal to something only helps when that
        // something sits on one of its endpoints; otherwise the set has a hole
        // in it, which an interval cannot represent.
        BinOp::Ne => {
            if b.is_singleton() && a.whole && b.lo.fract() == 0.0 {
                if a.lo == b.lo {
                    return meet(a, a.lo + 1.0, a.hi, clear_nan);
                }
                if a.hi == b.lo {
                    return meet(a, a.lo, a.hi - 1.0, clear_nan);
                }
            }
            cleared
        }
        _ => cleared,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, Param};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    /// Every helper whose result has facts declares that result: the facts
    /// narrow the call's value, and the declaration is how `specialize` keeps
    /// the call answering what the runtime answers.
    #[test]
    fn a_helper_with_result_facts_declares_its_result() {
        for name in INDEX.iter().chain(LENGTH).chain(STORAGE) {
            assert!(
                runtime_result(name).is_some(),
                "{name} is listed and has no facts"
            );
            assert_eq!(
                crate::hir::runtime::result(name),
                Some(&HirType::Float { bits: 64 }),
                "{name}: its facts would retype a call whose declared result is unknown"
            );
        }
        // The helpers whose result follows their operand (`operand_result`),
        // on the same terms. `nts_to_index` had no row, so its fact retyped
        // the call `: i32` over C's `double`: the JVM refused
        // `typed-array-aliasing` and ran `open-typed-values` wrong, where C
        // converted silently.
        for name in ["nts_math_sign", "nts_to_index"] {
            assert_eq!(
                crate::hir::runtime::result(name),
                Some(&HirType::Float { bits: 64 }),
                "{name}: its facts would retype a call whose declared result is unknown"
            );
        }
        // The cursor is declared what it is, and its facts fit the declaration
        // with room for the walk's one step past them.
        for name in CURSOR {
            let facts = runtime_result(name).expect("a cursor has facts");
            assert_eq!(
                crate::hir::runtime::result(name),
                Some(&HirType::Int {
                    bits: 32,
                    signed: true
                }),
                "{name}: a cursor is an int32"
            );
            assert!(facts.lo >= facts::I32_MIN && facts.hi + 1.0 <= facts::I32_MAX);
        }
    }

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind) -> Op {
        Op {
            kind,
            ty: HirType::Float { bits: 64 },
            origin: origin(),
        }
    }

    fn test_value_id(index: usize) -> ValueId {
        ValueId(u32::try_from(index).expect("test value count fits u32"))
    }

    fn test_number(index: usize) -> f64 {
        f64::from(u32::try_from(index).expect("test number fits u32"))
    }

    fn test_path_fact(path: &PathFacts, values: &[Facts], value: ValueId) -> Facts {
        path.get(&value)
            .copied()
            .unwrap_or(values[value.0 as usize])
    }

    fn func(values: Vec<Op>, blocks: Vec<Block>, params: usize) -> Func {
        Func {
            name: "f".to_owned(),
            params: (0..params)
                .map(|_| Param {
                    name: "n".to_owned(),
                    ty: HirType::Float { bits: 64 },
                    origin: origin(),
                    known: Facts::TOP,
                    written: None,
                    shape: crate::hir::ParamShape::Ordinary,
                })
                .collect(),
            return_type: HirType::Float { bits: 64 },
            values,
            blocks,
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    fn block(params: Vec<ValueId>, ops: Vec<ValueId>, terminator: Terminator) -> Block {
        Block {
            params,
            ops,
            terminator,
        }
    }

    /// A reverse-numbered DAG that took one more full sweep per block in the
    /// old scheduler. RPO should finish it in epoch 0.
    #[test]
    fn retains_a_guarded_length_queried_by_a_later_checked_read() {
        let mut values = vec![
            op(OpKind::Param(0)),
            op(OpKind::Length(ValueId(0))),
            op(OpKind::ConstInt(0)),
            op(Op_binary(BinOp::Eq, 1, 2)),
            op(OpKind::ConstFloat(-1.0)),
            op(OpKind::StringUnitAt {
                string: ValueId(0),
                index: ValueId(2),
                checked: true,
            }),
        ];
        values[0].ty = HirType::Managed(super::super::ManagedType::String);
        values[1].ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        values[2].ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        values[3].ty = HirType::Bool;
        let mut body = func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(1), ValueId(2), ValueId(3)],
                    Terminator::Branch {
                        cond: ValueId(3),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(4)))),
                block(
                    Vec::new(),
                    vec![ValueId(5)],
                    Terminator::Return(Some(ValueId(5))),
                ),
            ],
            1,
        );
        body.params[0].ty = HirType::Managed(super::super::ManagedType::String);

        let analysis = analyze(&body);
        let length_on_nonempty_arm = analysis.get_at(BlockId(2), ValueId(1));
        assert_eq!(length_on_nonempty_arm.lo, 1.0);
        assert!(length_on_nonempty_arm.hi > 1.0);
    }

    fn repeated_checked_string_queries(length_count: usize, read_count: usize) -> Func {
        let string = ValueId(0);
        let index = ValueId(1);
        let mut values = vec![op(OpKind::Param(0)), op(OpKind::ConstInt(0))];
        values[string.0 as usize].ty = HirType::Managed(super::super::ManagedType::String);
        values[index.0 as usize].ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let mut placed = vec![string, index];
        for _ in 0..length_count {
            let id = test_value_id(values.len());
            let mut length = op(OpKind::Length(string));
            length.ty = HirType::Int {
                bits: 32,
                signed: false,
            };
            values.push(length);
            placed.push(id);
        }
        for _ in 0..read_count {
            let id = test_value_id(values.len());
            values.push(op(OpKind::StringUnitAt {
                string,
                index,
                checked: true,
            }));
            placed.push(id);
        }
        let mut body = func(
            values,
            vec![block(Vec::new(), placed, Terminator::Return(None))],
            1,
        );
        body.params[0].ty = HirType::Managed(super::super::ManagedType::String);
        body
    }

    #[test]
    fn repeated_checked_reads_expand_each_strings_lengths_once() {
        let body = repeated_checked_string_queries(32, 32);
        let mut work = WorkCounts::default();
        let queried = analysis_query_inputs(&body, false, &mut work);
        assert_eq!(queried[0].len(), 32);
        assert_eq!(work.query_length_entries, 32);
    }

    #[test]
    fn repeated_checked_reads_with_one_length_expand_one_entry() {
        let body = repeated_checked_string_queries(1, 32);
        let mut work = WorkCounts::default();
        let queried = analysis_query_inputs(&body, false, &mut work);
        assert_eq!(queried[0].len(), 1);
        assert_eq!(work.query_length_entries, 1);
    }

    #[test]
    fn string_query_does_not_keep_lengths_from_sibling_arms_live() {
        let mut values = vec![
            op(OpKind::Param(0)),
            op(OpKind::Param(1)),
            op(OpKind::Length(ValueId(0))),
            op(OpKind::Length(ValueId(0))),
            op(OpKind::ConstInt(0)),
            op(OpKind::StringUnitAt {
                string: ValueId(0),
                index: ValueId(4),
                checked: true,
            }),
        ];
        values[0].ty = HirType::Managed(super::super::ManagedType::String);
        values[1].ty = HirType::Bool;
        values[2].ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        values[3].ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        values[4].ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let mut body = func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1)],
                    Terminator::Branch {
                        cond: ValueId(1),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(2)],
                    Terminator::Jump {
                        target: BlockId(3),
                        args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(3)],
                    Terminator::Jump {
                        target: BlockId(3),
                        args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(4), ValueId(5)],
                    Terminator::Return(Some(ValueId(5))),
                ),
            ],
            2,
        );
        body.params[0].ty = HirType::Managed(super::super::ManagedType::String);
        let queried = analysis_query_inputs(&body, false, &mut WorkCounts::default());
        assert!(queried[3].is_empty());
    }

    #[test]
    fn queried_string_length_is_live_across_its_guard_edge() {
        let mut values = vec![
            op(OpKind::Param(0)),
            op(OpKind::Length(ValueId(0))),
            op(OpKind::ConstInt(0)),
            op(Op_binary(BinOp::Gt, 1, 2)),
            op(OpKind::StringUnitAt {
                string: ValueId(0),
                index: ValueId(2),
                checked: true,
            }),
        ];
        values[0].ty = HirType::Managed(super::super::ManagedType::String);
        values[1].ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        values[2].ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        values[3].ty = HirType::Bool;
        let mut body = func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
                    Terminator::Branch {
                        cond: ValueId(3),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(4)],
                    Terminator::Return(Some(ValueId(4))),
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(None)),
            ],
            1,
        );
        body.params[0].ty = HirType::Managed(super::super::ManagedType::String);
        let query_uses = analysis_query_inputs(&body, false, &mut WorkCounts::default());
        assert!(query_uses[1].contains(&ValueId(1)));
        let liveness = super::super::liveness::analyze_with_additional_uses(&body, &query_uses)
            .expect("query-use liveness is complete");
        assert!(liveness.live_in(BlockId(1)).contains(&ValueId(1)));
        assert!(!liveness.live_in(BlockId(0)).contains(&ValueId(1)));
    }

    #[test]
    fn branch_refinement_records_indirect_comparison_reads() {
        let mut lhs = op(OpKind::Param(0));
        lhs.ty = HirType::NUMBER;
        let mut rhs = op(OpKind::ConstInt(5));
        rhs.ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let mut comparison = op(OpKind::Binary {
            op: BinOp::Lt,
            lhs: ValueId(0),
            rhs: ValueId(1),
        });
        comparison.ty = HirType::Bool;
        let body = func(
            vec![lhs, rhs, comparison],
            vec![block(
                Vec::new(),
                vec![ValueId(0), ValueId(1), ValueId(2)],
                Terminator::Return(Some(ValueId(2))),
            )],
            1,
        );
        let recorded_reads = {
            let mut dependencies = TransferResult::default();
            let global_facts = [
                Facts::new(0.0, 10.0, true, false, false),
                Facts::constant(5.0),
                Facts::TOP,
            ];
            let mut view = FactView::new(&global_facts, &mut dependencies);
            let _ = refine_edge(
                &body,
                &FxHashMap::default(),
                &PathFacts::default(),
                ValueId(2),
                true,
                &mut view,
            );
            dependencies.global_reads.clone()
        };
        assert_eq!(
            recorded_reads,
            [ValueId(0), ValueId(1)].into_iter().collect()
        );
    }

    #[test]
    #[allow(clippy::expect_used, clippy::unwrap_used)]
    fn stale_indirect_compare_keeps_the_array_check_after_the_fixpoint() {
        use nts_frontend_ts::Frontend;

        let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"));
        let config =
            root.join("../../tests/outcomes/stale-sparse-flow-out-of-bounds-c/tsconfig.json");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("the stale-compare fixture snapshots");
        assert!(!snapshot.has_errors());
        let prepared =
            super::super::prepare(&snapshot).expect("the stale-compare fixture prepares");
        let function = prepared
            .program
            .funcs
            .iter()
            .find(|function| function.name.contains("pick"))
            .expect("the fixture function is present in prepared HIR");
        assert!(
            function
                .values
                .iter()
                .any(|op| matches!(op.kind, OpKind::ArrayGet { checked: true, .. })),
            "an indirect comparison read that went stale once must not remove the array check"
        );
    }

    #[test]
    fn checked_array_queries_keep_all_lengths_consumed_by_bounds() {
        let mut length = op(OpKind::ConstInt(4));
        length.ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let mut array = op(OpKind::ArrayNew {
            length: ValueId(0),
            fill: super::super::ArrayFill::Holes,
        });
        array.ty = HirType::Managed(super::super::ManagedType::Array(Box::new(HirType::NUMBER)));
        let mut index = op(OpKind::ConstInt(0));
        index.ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let body = func(
            vec![
                length,
                array,
                index,
                op(OpKind::ArrayGet {
                    array: ValueId(1),
                    index: ValueId(2),
                    checked: true,
                }),
            ],
            vec![block(
                Vec::new(),
                vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
                Terminator::Return(Some(ValueId(3))),
            )],
            0,
        );
        let queried = analysis_query_inputs(&body, false, &mut WorkCounts::default());
        assert!(queried[0].contains(&ValueId(0)));
    }

    #[test]
    fn checked_view_queries_keep_the_constructor_length_live() {
        let mut tracking = op(OpKind::ConstBool(false));
        tracking.ty = HirType::Bool;
        let mut view = op(OpKind::Call {
            callee: Callee::External("nts_view_new".to_owned()),
            args: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3), ValueId(4)],
            frame: None,
        });
        view.ty = HirType::Managed(super::super::ManagedType::View(Box::new(HirType::NUMBER)));
        let mut index = op(OpKind::ConstInt(0));
        index.ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let body = func(
            vec![
                op(OpKind::Param(0)),
                op(OpKind::ConstInt(0)),
                op(OpKind::ConstInt(8)),
                op(OpKind::ConstInt(8)),
                tracking,
                view,
                index,
                op(OpKind::ArrayGet {
                    array: ValueId(5),
                    index: ValueId(6),
                    checked: true,
                }),
            ],
            vec![block(
                Vec::new(),
                (0..8).map(ValueId).collect(),
                Terminator::Return(Some(ValueId(7))),
            )],
            1,
        );
        let queried = analysis_query_inputs(&body, false, &mut WorkCounts::default());
        assert!(queried[0].contains(&ValueId(2)));
    }

    fn reverse_merge(depth: u32) -> Func {
        let mut blocks = vec![
            block(
                Vec::new(),
                vec![ValueId(0), ValueId(1), ValueId(2)],
                Terminator::Branch {
                    cond: ValueId(2),
                    then_target: BlockId(depth - 1),
                    then_args: Vec::new(),
                    else_target: BlockId(1),
                    else_args: Vec::new(),
                },
            ),
            block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(0)))),
        ];
        blocks.extend((2..depth).map(|at| {
            block(
                Vec::new(),
                Vec::new(),
                Terminator::Jump {
                    target: BlockId(at - 1),
                    args: Vec::new(),
                },
            )
        }));
        func(
            vec![
                op(OpKind::Param(0)),
                op(OpKind::ConstFloat(7.0)),
                op(Op_binary(BinOp::Lt, 0, 1)),
            ],
            blocks,
            1,
        )
    }

    #[test]
    fn rpo_completes_deep_reverse_merge_with_precise_scalar_and_guard_facts() {
        let params = [Facts::constant(0.0).join(Facts::constant(10.0))];
        let whole = Whole::default();
        let written = Written::default();
        let context = Context {
            params: &params,
            caps: &FxHashMap::default(),
            param_lengths: &[Facts::constant(3.0)],
            whole: &whole,
            written: &written,
        };
        for depth in [8, 70] {
            let body = reverse_merge(depth);
            let (analysis, rounds) = solve(&body, &context);
            assert_eq!(rounds, 1, "RPO should finish this DAG in epoch 0");
            assert_eq!(analysis.get(ValueId(1)), Facts::constant(7.0));
            assert_eq!(analysis.get_at(BlockId(1), ValueId(0)), params[0]);
            assert!(analysis.get_at(BlockId(depth - 1), ValueId(0)).hi < 7.0);
            assert!(analysis.guarded_by(BlockId(depth - 1), ValueId(0), |v| v == ValueId(1)));
            assert!(!analysis.growable());
            assert_eq!(analysis.param_length(0), Facts::constant(3.0));
            for value in [ValueId(0), ValueId(1)] {
                assert_ne!(analysis.get(value), Facts::TOP, "{value:?}");
                assert!(analysis.is_integral_within(value, -100.0, 100.0));
                for at in 0..depth {
                    assert_ne!(analysis.get_at(BlockId(at), value), Facts::TOP);
                }
            }
        }
    }

    #[test]
    fn rpo_completes_deep_reverse_merge_with_field_observations() {
        use crate::hir::{ManagedType, TypeId};
        let object = |ty| HirType::Managed(ManagedType::Object(TypeId(ty)));
        let mut body = reverse_merge(70);
        let mut receiver = op(OpKind::Param(1));
        receiver.ty = object(123);
        body.params.push(Param {
            ty: object(123),
            ..body.params[0].clone()
        });
        let mut second_receiver = op(OpKind::Param(2));
        second_receiver.ty = object(123);
        body.params.push(Param {
            ty: object(123),
            ..body.params[0].clone()
        });
        body.values.extend([
            receiver,
            op(OpKind::FieldSet {
                object: ValueId(3),
                field: 0,
                value: ValueId(1),
            }),
            second_receiver,
            op(OpKind::FieldSet {
                object: ValueId(5),
                field: 0,
                value: ValueId(1),
            }),
        ]);
        body.blocks[0].ops.extend([ValueId(3), ValueId(4)]);
        // A second alias stores the same slot later in the forward chain,
        // forcing the first known value into the observation summary.
        body.blocks[2].ops.extend([ValueId(5), ValueId(6)]);
        let whole = Whole::default();
        let written = Written::default();
        let context = Context {
            params: &[],
            caps: &FxHashMap::default(),
            param_lengths: &[],
            whole: &whole,
            written: &written,
        };
        let (analysis, rounds) = solve(&body, &context);
        assert_eq!(rounds, 1, "RPO should finish this DAG in epoch 0");
        assert_eq!(
            analysis.observed().get(&(object(123), 0)),
            Some(&Facts::constant(7.0))
        );
    }

    #[test]
    fn round_cap_discards_all_unobserved_field_authorities() {
        use crate::hir::{FieldArm, ManagedType, TypeId};
        let object = |ty| HirType::Managed(ManagedType::Object(TypeId(ty)));
        let mut body = reverse_merge(70);
        let mut receiver = op(OpKind::Param(1));
        receiver.ty = object(123);
        body.params.push(Param {
            ty: object(123),
            ..body.params[0].clone()
        });
        body.values.extend([
            receiver,
            op(OpKind::FieldSet {
                object: ValueId(3),
                field: 0,
                value: ValueId(1),
            }),
            op(OpKind::FieldGet {
                object: ValueId(3),
                field: 1,
            }),
            op(OpKind::SharedFieldGet {
                value: ValueId(3),
                arms: vec![TypeId(124)],
                field: 2,
            }),
            op(OpKind::OpenFieldGet {
                object: ValueId(3),
                arms: vec![FieldArm {
                    ty: TypeId(125),
                    field: 3,
                }],
            }),
            op(OpKind::OpenFieldSet {
                object: ValueId(3),
                arms: vec![FieldArm {
                    ty: TypeId(126),
                    field: 4,
                }],
                value: ValueId(1),
            }),
        ]);
        body.blocks[0].ops.extend([ValueId(3), ValueId(4)]);
        // These accesses are not reached before this deliberately tiny cap.
        body.blocks[2].ops.extend((5..9).map(ValueId));
        // The cycle forces one successor into epoch 1, so cap 1 exercises the
        // actual exhaustion path after a partial transfer has run.
        body.blocks[69].terminator = Terminator::Jump {
            target: BlockId(69),
            args: Vec::new(),
        };
        let whole = Whole {
            field_facts: [((TypeId(127), 5), Facts::constant(2.0))]
                .into_iter()
                .collect(),
            ..Whole::default()
        };
        let written = Written {
            fields: [((TypeId(128), 6), Facts::constant(3.0))]
                .into_iter()
                .collect(),
            ..Written::default()
        };
        let context = Context {
            params: &[],
            caps: &FxHashMap::default(),
            param_lengths: &[],
            whole: &whole,
            written: &written,
        };
        let (analysis, epochs) = solve_with_limits(&body, &context, 1, WIDEN_AFTER);
        assert_eq!(epochs, 1);
        assert!(analysis.growable());
        for (ty, field) in [
            (123, 0),
            (123, 1),
            (124, 2),
            (125, 3),
            (126, 4),
            (127, 5),
            (128, 6),
        ] {
            assert_eq!(
                analysis.observed().get(&(object(ty), field)),
                Some(&Facts::TOP),
                "{ty}:{field}"
            );
        }
        assert!(analysis.observed().values().all(|fact| *fact == Facts::TOP));
    }

    #[test]
    fn cyclic_counter_exercises_epoch_cap_and_converges_when_raised() {
        // The production widening threshold is deliberately raised only for
        // this solver control. The counter then advances its interval one
        // epoch at a time to 100, proving the 64-epoch exhaustion path rather
        // than merely testing a large CFG that quickly widens.
        use crate::hir::ManagedType;
        let mut body = counted_loop(100.0);
        let object_type = HirType::Managed(ManagedType::Object(crate::hir::TypeId(500)));
        for slot in 0..2 {
            body.params.push(Param {
                name: format!("object{slot}"),
                ty: object_type.clone(),
                origin: origin(),
                known: Facts::TOP,
                written: None,
                shape: crate::hir::ParamShape::Ordinary,
            });
        }
        let mut first_object = op(OpKind::Param(0));
        first_object.ty = object_type.clone();
        let mut second_object = op(OpKind::Param(1));
        second_object.ty = object_type.clone();
        body.values.extend([
            first_object,
            op(OpKind::FieldSet {
                object: ValueId(6),
                field: 0,
                value: ValueId(0),
            }),
            second_object,
            op(OpKind::FieldSet {
                object: ValueId(8),
                field: 0,
                value: ValueId(0),
            }),
        ]);
        body.blocks[0].ops.extend([ValueId(6), ValueId(7)]);
        body.blocks[2].ops.extend([ValueId(8), ValueId(9)]);
        let whole = Whole::default();
        let written = Written::default();
        let context = Context {
            params: &[],
            caps: &FxHashMap::default(),
            param_lengths: &[Facts::constant(3.0)],
            whole: &whole,
            written: &written,
        };

        let (capped, capped_epochs) = solve_with_limits(&body, &context, ROUND_CAP, 128);
        assert_eq!(capped_epochs, ROUND_CAP);
        assert!(capped.values.iter().all(|facts| *facts == Facts::TOP));
        assert!(capped.less_than.iter().all(Vec::is_empty));
        assert!(
            capped
                .param_lengths
                .iter()
                .all(|facts| *facts == Facts::TOP)
        );
        assert_eq!(capped.param_length(0), Facts::TOP);
        assert!(capped.refined.iter().all(Refinements::is_empty));
        assert_eq!(
            capped.observed.get(&(object_type.clone(), 0)),
            Some(&Facts::TOP)
        );

        let (complete, complete_epochs) = solve_with_limits(&body, &context, 256, 128);
        assert!(
            complete_epochs > ROUND_CAP,
            "completed in only {complete_epochs} epochs"
        );
        assert!(complete_epochs <= 256, "took {complete_epochs} epochs");
        assert_eq!(complete.param_length(0), Facts::constant(3.0));
        assert_ne!(complete.get(ValueId(1)), Facts::TOP);
        assert!(complete.guarded_by(BlockId(2), ValueId(1), |value| value == ValueId(2)));
        assert_eq!(
            complete.observed.get(&(object_type, 0)),
            Some(&Facts::constant(0.0))
        );
        eprintln!("cap control: capped at {capped_epochs}, converged at {complete_epochs} epochs");
    }

    #[test]
    fn checked_element_facts_survive_storage_width_clamps() {
        let byte = HirType::Int {
            bits: 8,
            signed: false,
        };
        for container in [
            super::super::ManagedType::View(Box::new(byte.clone())),
            super::super::ManagedType::Array(Box::new(byte.clone())),
        ] {
            for checked in [false, true] {
                let array_type = HirType::Managed(container.clone());
                let mut array = op(OpKind::Param(0));
                array.ty = array_type.clone();
                let mut read = op(OpKind::ArrayGet {
                    array: ValueId(0),
                    index: ValueId(1),
                    checked,
                });
                read.ty = byte.clone();
                let mut converted = op(OpKind::Convert(ValueId(2)));
                converted.ty = HirType::Int {
                    bits: 32,
                    signed: true,
                };
                let mut body = func(
                    vec![array, op(OpKind::ConstFloat(0.0)), read, converted],
                    vec![block(
                        Vec::new(),
                        (0..4).map(ValueId).collect(),
                        Terminator::Return(Some(ValueId(3))),
                    )],
                    1,
                );
                body.params[0].ty = array_type;
                let facts = analyze(&body);
                // Checked or not, the read's value is an element: out of range
                // a checked read stops instead of answering (`may_stop`).
                for id in [ValueId(2), ValueId(3)] {
                    let known = facts.get(id);
                    assert_eq!((known.lo, known.hi), (0.0, 255.0));
                    assert!(known.whole);
                    assert!(!known.maybe_nan, "{container:?}, {checked}, {id:?}");
                }
            }
        }
    }

    #[test]
    fn a_proven_integer_read_becomes_finite() {
        let byte = HirType::Int {
            bits: 8,
            signed: false,
        };
        let mut array = op(OpKind::ArrayNew {
            length: ValueId(0),
            fill: super::super::ArrayFill::Holes,
        });
        array.ty = HirType::Managed(super::super::ManagedType::Array(Box::new(byte.clone())));
        let mut read = op(OpKind::ArrayGet {
            array: ValueId(1),
            index: ValueId(2),
            checked: true,
        });
        read.ty = byte;
        let mut body = func(
            vec![
                op(OpKind::ConstFloat(1.0)),
                array,
                op(OpKind::ConstFloat(0.0)),
                read,
            ],
            vec![block(
                Vec::new(),
                (0..4).map(ValueId).collect(),
                Terminator::Return(Some(ValueId(3))),
            )],
            0,
        );
        let before = analyze(&body);
        // An element before the proof too: a checked read stops rather than
        // answers out of range (`may_stop`). The proof is what removes the
        // check, not what makes the value finite.
        assert!(!before.get(ValueId(3)).maybe_nan);
        assert_eq!(
            super::super::bounds::eliminate_checks(
                &mut body,
                &before,
                &super::super::bounds::ProgramLengths::default()
            ),
            1
        );
        let after = analyze(&body).get(ValueId(3));
        assert!(!after.maybe_nan);
        assert!(after.integral());
        assert_eq!((after.lo, after.hi), (0.0, 255.0));
    }

    /// `let i = 0; while (i < 10) { i = i + 1 } return i`
    ///
    /// The shape the whole analysis exists for. Nothing about `i`'s definitions
    /// bounds it — `0` and `i + 1` are all a definition-walk sees. The bound
    /// comes from the guard on the edge into the body.
    fn counted_loop(limit: f64) -> Func {
        let values = vec![
            op(OpKind::ConstFloat(0.0)),     // %0  i = 0
            op(OpKind::BlockParam(0)),       // %1  i at the header
            op(OpKind::ConstFloat(limit)),   // %2  the limit
            op(Op_binary(BinOp::Lt, 1, 2)),  // %3  i < limit
            op(OpKind::ConstFloat(1.0)),     // %4
            op(Op_binary(BinOp::Add, 1, 4)), // %5  i + 1
        ];
        func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0)],
                    },
                ),
                block(
                    vec![ValueId(1)],
                    vec![ValueId(2), ValueId(3)],
                    Terminator::Branch {
                        cond: ValueId(3),
                        then_target: BlockId(2),
                        then_args: Vec::new(),
                        else_target: BlockId(3),
                        else_args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(4), ValueId(5)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(5)],
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(1)))),
            ],
            0,
        )
    }

    #[test]
    fn a_capped_accumulator_settles_without_capping_its_backedge_expression() {
        // i and total advance together ten times. The interval transfer alone
        // sees total + 1 as [1, 11]; the independently proved loop count caps
        // the header's total phi at [0, 10], not that source expression.
        let mut body = counted_loop(10.0);
        body.values.push(op(OpKind::BlockParam(1))); // %6 total
        body.values.push(op(Op_binary(BinOp::Add, 6, 4))); // %7 total + 1
        body.blocks[0].terminator = Terminator::Jump {
            target: BlockId(1),
            args: vec![ValueId(0), ValueId(0)],
        };
        body.blocks[1].params.push(ValueId(6));
        body.blocks[2].ops.push(ValueId(7));
        body.blocks[2].terminator = Terminator::Jump {
            target: BlockId(1),
            args: vec![ValueId(5), ValueId(7)],
        };
        body.blocks[3].terminator = Terminator::Return(Some(ValueId(6)));
        let caps = [(ValueId(6), Facts::new(0.0, 10.0, false, true, true))]
            .into_iter()
            .collect();
        let whole = Whole::default();
        let written = Written::default();
        let context = Context {
            params: &[],
            caps: &caps,
            param_lengths: &[],
            whole: &whole,
            written: &written,
        };
        let (analysis, rounds) = solve(&body, &context);
        assert!(
            rounds < 12,
            "a capped join must settle, not burn {rounds} rounds"
        );
        assert_eq!(
            analysis.get(ValueId(6)),
            Facts::new(0.0, 10.0, true, false, false)
        );
        assert_eq!(
            analysis.get(ValueId(7)),
            Facts::new(1.0, 11.0, true, false, false)
        );
        assert_eq!(
            analysis.get(ValueId(5)),
            Facts::new(1.0, 10.0, true, false, false),
            "the body reader must be revisited as the loop phi grows"
        );
    }

    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "this control exercises branch-edge rescheduling after a global broadening"
    )]
    fn loop_counter_definition_republishes_its_local_fact_after_global_broadening() {
        // The body computes `next = counter + 1` and branches on `next < 10`.
        // The true edge keeps `next` live through a forwarding block back to
        // the loop header, so its branch fact is an ordinary edge override,
        // not a target-parameter fact.
        let mut body = counted_loop(10.0);
        body.values.push(op(OpKind::Binary {
            op: BinOp::Lt,
            lhs: ValueId(5),
            rhs: ValueId(2),
        }));
        body.blocks[2].ops.push(ValueId(6));
        body.blocks[2].terminator = Terminator::Branch {
            cond: ValueId(6),
            then_target: BlockId(4),
            then_args: Vec::new(),
            else_target: BlockId(3),
            else_args: Vec::new(),
        };
        body.blocks.push(block(
            Vec::new(),
            Vec::new(),
            Terminator::Jump {
                target: BlockId(1),
                args: vec![ValueId(5)],
            },
        ));
        let mut values = vec![Facts::BOTTOM; body.values.len()];
        values[0] = Facts::constant(0.0);
        values[1] = Facts::new(0.0, 10.0, true, false, false);
        values[2] = Facts::constant(10.0);
        values[3] = Facts::new(0.0, 1.0, true, false, false);
        values[4] = Facts::constant(1.0);
        // The global result starts narrower than this loop-local transfer.
        values[5] = Facts::new(1.0, 2.0, true, false, false);
        let refinements = [(ValueId(1), Facts::new(0.0, 9.0, true, false, false))]
            .into_iter()
            .collect();
        let whole = Whole::default();
        let written = Written::default();
        let context = Context {
            params: &[],
            caps: &FxHashMap::default(),
            param_lengths: &[],
            whole: &whole,
            written: &written,
        };
        let mut edges = vec![
            vec![None],
            vec![None, None],
            vec![None, None],
            vec![],
            vec![None],
        ];
        let live_in = vec![
            rustc_hash::FxHashSet::default(),
            rustc_hash::FxHashSet::default(),
            rustc_hash::FxHashSet::default(),
            [ValueId(1)].into_iter().collect(),
            [ValueId(5)].into_iter().collect(),
        ];
        let mut work = WorkCounts::default();
        let positions = parameter_positions(&body, &mut work);
        let mut fields = vec![None; body.blocks.len()];
        let mut observed = Observed::default();
        let headers = loop_headers(&body);
        let mut result = TransferResult::default();

        transfer_block(
            &body,
            (&context, &local_tuples(&body)),
            BlockId(2),
            &refinements,
            &mut values,
            &mut edges,
            &live_in,
            &positions,
            &mut work,
            (&mut fields, &mut observed, &headers),
            &mut result,
        );

        let branch_edge = edges[2][0]
            .as_ref()
            .expect("the loop body records its true edge");
        assert_eq!(
            branch_edge.path_facts.get(&ValueId(5)),
            Some(&Facts::new(1.0, 9.0, true, false, false))
        );
        assert_eq!(values[5], Facts::new(1.0, 10.0, true, false, false));
        assert!(
            result
                .changed_values
                .iter()
                .any(|change| change.value == ValueId(5) && !change.read_before_change)
        );

        let readers = value_readers(&body, &live_in);
        assert!(
            readers[5].contains(&BlockId(2)),
            "the defining body is rescheduled"
        );
        let rank = [0, 1, 2, 3, 4];
        let mut scheduled = vec![None; body.blocks.len()];
        let mut pending = BTreeSet::new();
        enqueue(
            BlockId(2),
            BlockId(2),
            4,
            &rank,
            &mut pending,
            &mut scheduled,
        );
        assert_eq!(pending.first(), Some(&(5, 2)));

        // If a later path broadens the global result, the definition block is
        // run again and republishes the edge's local loop fact. A block entry
        // refinement alone cannot recover this: the edge argument is the
        // source of truth for the next recomputation.
        values[5] = Facts::TOP;
        result = TransferResult::default();
        transfer_block(
            &body,
            (&context, &local_tuples(&body)),
            BlockId(2),
            &refinements,
            &mut values,
            &mut edges,
            &live_in,
            &positions,
            &mut work,
            (&mut fields, &mut observed, &headers),
            &mut result,
        );
        assert_eq!(
            edges[2][0]
                .as_ref()
                .expect("the rerun records the loop's true edge")
                .path_facts
                .get(&ValueId(5)),
            Some(&Facts::new(1.0, 9.0, true, false, false))
        );

        let incoming = vec![
            Vec::new(),
            vec![(BlockId(0), 0), (BlockId(4), 0)],
            vec![(BlockId(1), 0)],
            vec![(BlockId(1), 1), (BlockId(2), 1)],
            vec![(BlockId(2), 0)],
        ];
        let entry = recompute_entry(
            &body,
            BlockId(4),
            &incoming,
            &edges,
            &values,
            &FxHashMap::default(),
            &positions[4],
            &mut work,
        )
        .expect("the refreshed branch edge reaches the forwarding block");
        assert_eq!(
            test_path_fact(&entry, &values, ValueId(5)),
            Facts::new(1.0, 9.0, true, false, false)
        );

        let analysis = analyze(&body);
        assert_eq!(
            analysis.get_at(BlockId(4), ValueId(5)),
            Facts::new(1.0, 9.0, true, false, false),
            "the solved loop keeps the branch fact at the forwarding block"
        );
    }

    #[test]
    #[allow(
        clippy::too_many_lines,
        reason = "the nested-loop control pins a path fact across an inner backedge"
    )]
    fn outer_loop_fact_survives_inner_loop_global_broadening() {
        // The outer counter is narrowed by `counter < n`, then carried through
        // an inner loop whose backedge does not mention it. Its path fact can
        // equal the global fact at one point in solving, but must survive if
        // the inner loop later broadens that global.
        let body = func(
            vec![
                op(OpKind::Param(0)),             // %0 n
                op(OpKind::ConstFloat(0.0)),      // %1 outer result
                op(OpKind::ConstFloat(0.0)),      // %2 outer counter
                op(OpKind::BlockParam(0)),        // %3 outer result phi
                op(OpKind::BlockParam(1)),        // %4 outer counter phi
                op(Op_binary(BinOp::Lt, 4, 0)),   // %5 outer condition
                op(OpKind::BlockParam(0)),        // %6 return value
                op(OpKind::ConstFloat(0.0)),      // %7 inner counter
                op(OpKind::BlockParam(0)),        // %8 inner result phi
                op(OpKind::BlockParam(1)),        // %9 inner counter phi
                op(Op_binary(BinOp::Lt, 9, 0)),   // %10 inner condition
                op(OpKind::ConstFloat(1.0)),      // %11
                op(Op_binary(BinOp::Add, 8, 11)), // %12 inner result + 1
                op(Op_binary(BinOp::Add, 9, 11)), // %13 inner counter + 1
                op(OpKind::BlockParam(0)),        // %14 inner exit result
                op(OpKind::ConstFloat(1.0)),      // %15
                op(Op_binary(BinOp::Add, 4, 15)), // %16 outer counter + 1
            ],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1), ValueId(2)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(1), ValueId(2)],
                    },
                ),
                block(
                    vec![ValueId(3), ValueId(4)],
                    vec![ValueId(5)],
                    Terminator::Branch {
                        cond: ValueId(5),
                        then_target: BlockId(2),
                        then_args: Vec::new(),
                        else_target: BlockId(3),
                        else_args: vec![ValueId(3)],
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(7)],
                    Terminator::Jump {
                        target: BlockId(4),
                        args: vec![ValueId(3), ValueId(7)],
                    },
                ),
                block(
                    vec![ValueId(6)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(6))),
                ),
                block(
                    vec![ValueId(8), ValueId(9)],
                    vec![ValueId(10)],
                    Terminator::Branch {
                        cond: ValueId(10),
                        then_target: BlockId(5),
                        then_args: Vec::new(),
                        else_target: BlockId(6),
                        else_args: vec![ValueId(8)],
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(11), ValueId(12), ValueId(13)],
                    Terminator::Jump {
                        target: BlockId(4),
                        args: vec![ValueId(12), ValueId(13)],
                    },
                ),
                block(
                    vec![ValueId(14)],
                    vec![ValueId(15), ValueId(16)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(14), ValueId(16)],
                    },
                ),
            ],
            1,
        );
        let whole = Whole::default();
        let written = Written::default();
        let params = [Facts::new(0.0, f64::from(i32::MAX), true, false, false)];
        let context = Context {
            params: &params,
            caps: &FxHashMap::default(),
            param_lengths: &[],
            whole: &whole,
            written: &written,
        };
        let analysis = analyze_with(&body, &context);
        assert_eq!(
            analysis.get_at(BlockId(4), ValueId(4)).hi,
            f64::from(i32::MAX - 1),
            "the outer guard remains available at the inner-loop header"
        );
        assert_eq!(
            analysis.get_at(BlockId(6), ValueId(4)).hi,
            f64::from(i32::MAX - 1)
        );
        assert_eq!(analysis.get(ValueId(16)).hi, f64::from(i32::MAX));
    }

    #[test]
    fn equal_global_edge_fact_survives_a_later_broadening() {
        let body = func(
            vec![op(OpKind::Param(0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(0)))),
            ],
            1,
        );
        let constrained = Facts::new(0.0, 9.0, true, false, false);
        let mut values = [constrained];
        let path = [(ValueId(0), constrained)].into_iter().collect();
        let mut edges = vec![vec![None], Vec::new()];
        let live_in = vec![
            rustc_hash::FxHashSet::default(),
            [ValueId(0)].into_iter().collect(),
        ];
        let positions = parameter_positions(&body, &mut WorkCounts::default());
        assert!(record_edge(
            &body,
            BlockId(0),
            0,
            BlockId(1),
            &[],
            &path,
            &values,
            &mut edges,
            &live_in,
            &positions,
            &FxHashMap::default(),
            &mut WorkCounts::default(),
        ));
        assert_eq!(
            edges[0][0]
                .as_ref()
                .expect("the edge is recorded")
                .path_facts
                .get(&ValueId(0)),
            Some(&constrained),
            "an explicit path fact is kept even when it currently equals global"
        );

        values[0] = Facts::new(0.0, 100.0, true, false, false);
        let incoming = vec![Vec::new(), vec![(BlockId(0), 0)]];
        let entry = recompute_entry(
            &body,
            BlockId(1),
            &incoming,
            &edges,
            &values,
            &FxHashMap::default(),
            &positions[1],
            &mut WorkCounts::default(),
        )
        .expect("the edge still reaches its destination");
        assert_eq!(test_path_fact(&entry, &values, ValueId(0)), constrained);
    }

    #[test]
    fn forwarding_block_reads_facts_needed_by_its_successor() {
        let body = func(
            vec![op(OpKind::ConstFloat(7.0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(2),
                        args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(0)))),
            ],
            0,
        );
        let live_in = vec![
            rustc_hash::FxHashSet::default(),
            rustc_hash::FxHashSet::default(),
            [ValueId(0)].into_iter().collect(),
        ];
        let readers = value_readers(&body, &live_in);
        assert!(
            readers[0].contains(&BlockId(1)),
            "the forwarding edge must be refreshed when its successor's live value broadens"
        );
    }

    #[test]
    fn edge_caps_rebind_to_target_parameters_and_preserve_flags() {
        let body = counted_loop(10.0);
        let cap = Facts::new(0.0, 10.0, false, true, true);
        let caps = [(ValueId(1), cap)].into_iter().collect();
        let mut values = vec![Facts::TOP; body.values.len()];
        values[5] = Facts::new(-1.0, 11.0, false, true, true);
        let before = values.clone();
        let mut edges = vec![vec![None], vec![None, None], vec![None], vec![]];
        let live_in = vec![rustc_hash::FxHashSet::default(); body.blocks.len()];
        let mut work = WorkCounts::default();
        let positions = parameter_positions(&body, &mut work);
        let refinements = Refinements::default();

        assert!(record_edge(
            &body,
            BlockId(2),
            0,
            BlockId(1),
            &[ValueId(5)],
            &refinements,
            &values,
            &mut edges,
            &live_in,
            &positions,
            &caps,
            &mut work,
        ));
        assert_eq!(
            edges[2][0]
                .as_ref()
                .expect("record_edge publishes its new state")
                .params,
            [cap]
        );
        assert!(!record_edge(
            &body,
            BlockId(2),
            0,
            BlockId(1),
            &[ValueId(5)],
            &refinements,
            &values,
            &mut edges,
            &live_in,
            &positions,
            &caps,
            &mut work,
        ));
        assert_eq!(
            edges[2][0]
                .as_ref()
                .expect("record_edge retains the equivalent state")
                .params,
            [cap]
        );
        assert_eq!(values, before, "a target cap never narrows its source");
    }

    #[test]
    fn published_block_entries_drop_overrides_equal_to_final_globals() {
        let body = func(
            vec![op(OpKind::ConstFloat(7.0)), op(OpKind::BlockParam(0))],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0)],
                    },
                ),
                block(
                    vec![ValueId(1)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(1))),
                ),
            ],
            0,
        );
        let analysis = analyze(&body);
        assert_eq!(analysis.get(ValueId(1)), Facts::constant(7.0));
        assert!(!analysis.refined[1].contains_key(&ValueId(1)));
        assert!(analysis.refined.iter().all(|refinements| {
            refinements
                .iter()
                .all(|(value, facts)| *facts != analysis.get(*value))
        }));
    }

    #[test]
    fn multi_phi_transfer_normalizes_all_changed_globals_before_asserting() {
        let body = func(
            vec![
                op(OpKind::ConstFloat(7.0)),
                op(OpKind::ConstFloat(8.0)),
                op(OpKind::BlockParam(0)),
                op(OpKind::BlockParam(1)),
                op(OpKind::Binary {
                    op: BinOp::Add,
                    lhs: ValueId(2),
                    rhs: ValueId(3),
                }),
            ],
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0), ValueId(1)],
                    },
                ),
                block(
                    vec![ValueId(2), ValueId(3)],
                    vec![ValueId(4)],
                    Terminator::Return(Some(ValueId(4))),
                ),
            ],
            0,
        );
        let analysis = analyze(&body);
        assert_eq!(analysis.get(ValueId(2)), Facts::constant(7.0));
        assert_eq!(analysis.get(ValueId(3)), Facts::constant(8.0));
        assert_eq!(analysis.get(ValueId(4)), Facts::constant(15.0));
        assert!(!analysis.refined[1].contains_key(&ValueId(2)));
        assert!(!analysis.refined[1].contains_key(&ValueId(3)));
        assert!(analysis.refined.iter().all(|refinements| {
            refinements
                .iter()
                .all(|(value, facts)| *facts != analysis.get(*value))
        }));
    }

    #[test]
    fn edge_parameter_fact_survives_global_widening_and_is_rederived() {
        let body = func(
            vec![op(OpKind::ConstFloat(0.0)), op(OpKind::BlockParam(0))],
            vec![
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0)],
                    },
                ),
                block(
                    vec![ValueId(1)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(1))),
                ),
            ],
            0,
        );
        let mut values = [Facts::constant(0.0), Facts::TOP];
        let edges = vec![
            vec![Some(EdgeState {
                path_facts: PathFacts::default(),
                params: vec![Facts::constant(0.0)],
            })],
            vec![],
        ];
        let incoming = vec![vec![], vec![(BlockId(0), 0)]];
        let caps = FxHashMap::default();
        let mut work = WorkCounts::default();
        let positions = parameter_positions(&body, &mut work);

        let first = recompute_entry(
            &body,
            BlockId(1),
            &incoming,
            &edges,
            &values,
            &caps,
            &positions[1],
            &mut work,
        )
        .expect("the edge reaches the block");
        assert_eq!(
            test_path_fact(&first, &values, ValueId(1)),
            Facts::constant(0.0)
        );
        assert!(first.contains_key(&ValueId(1)));

        values[1] = Facts::new(0.0, f64::INFINITY, true, false, false);
        let second = recompute_entry(
            &body,
            BlockId(1),
            &incoming,
            &edges,
            &values,
            &caps,
            &positions[1],
            &mut work,
        )
        .expect("the edge remains available after global growth");
        assert_eq!(
            test_path_fact(&second, &values, ValueId(1)),
            Facts::constant(0.0)
        );
    }

    #[test]
    fn equal_global_header_fact_survives_a_later_broadening() {
        let body = func(
            vec![op(OpKind::BlockParam(0))],
            vec![
                block(Vec::new(), Vec::new(), Terminator::Unreachable),
                block(
                    vec![ValueId(0)],
                    Vec::new(),
                    Terminator::Return(Some(ValueId(0))),
                ),
            ],
            0,
        );
        let narrow = Facts::new(0.0, 4.0, true, false, false);
        let mut values = [narrow];
        let mut path = [(ValueId(0), narrow)].into_iter().collect();
        let mut history = Some(vec![HeaderFact {
            raw: narrow,
            effective: narrow,
            changes: 0,
        }]);

        apply_header_widening(
            &body,
            BlockId(1),
            &mut path,
            &values,
            &FxHashMap::default(),
            WIDEN_AFTER,
            &mut history,
        );
        assert_eq!(path.get(&ValueId(0)), Some(&narrow));

        values[0] = Facts::new(0.0, 20.0, true, false, false);
        assert_eq!(
            test_path_fact(&path, &values, ValueId(0)),
            narrow,
            "header widening keeps the path fact after its global value grows"
        );
    }

    #[test]
    fn recomputed_join_uses_global_for_missing_edge_keys() {
        let body = func(
            vec![op(OpKind::Param(0))],
            vec![
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(2),
                        args: vec![],
                    },
                ),
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(2),
                        args: vec![],
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(0)))),
            ],
            1,
        );
        let edges = vec![
            vec![Some(EdgeState {
                path_facts: [(ValueId(0), Facts::new(0.0, 6.0, true, false, false))]
                    .into_iter()
                    .collect(),
                params: vec![],
            })],
            vec![Some(EdgeState {
                path_facts: PathFacts::default(),
                params: vec![],
            })],
            vec![],
        ];
        let values = [Facts::new(0.0, 10.0, true, false, false)];
        let positions = parameter_positions(&body, &mut WorkCounts::default());
        let global = values[0];
        for with_cap in [false, true] {
            let caps = if with_cap {
                [(ValueId(0), Facts::new(0.0, 9.0, false, true, true))]
                    .into_iter()
                    .collect()
            } else {
                FxHashMap::default()
            };
            let expected = capped(&caps, ValueId(0), global);
            for refined_first in [false, true] {
                let incoming = if refined_first {
                    vec![vec![], vec![], vec![(BlockId(0), 0), (BlockId(1), 0)]]
                } else {
                    vec![vec![], vec![], vec![(BlockId(1), 0), (BlockId(0), 0)]]
                };
                let entry = recompute_entry(
                    &body,
                    BlockId(2),
                    &incoming,
                    &edges,
                    &values,
                    &caps,
                    &positions[2],
                    &mut WorkCounts::default(),
                )
                .expect("both predecessor edges reach the block");
                assert_eq!(test_path_fact(&entry, &values, ValueId(0)), expected);
                assert!(
                    entry.contains_key(&ValueId(0)),
                    "edge path facts remain explicit even when equal to global"
                );
                assert_eq!(values, [global], "joining never mutates a source fact");
            }
        }
    }

    #[test]
    fn retracting_an_edge_override_recomputes_the_join_from_current_sources() {
        let body = func(
            vec![op(OpKind::Param(0))],
            vec![
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(2),
                        args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(2),
                        args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(0)))),
            ],
            1,
        );
        let narrow = Facts::new(0.0, 6.0, true, false, false);
        let values = [Facts::new(0.0, 10.0, true, false, false)];
        let positions = parameter_positions(&body, &mut WorkCounts::default());
        let incoming = vec![vec![], vec![], vec![(BlockId(0), 0), (BlockId(1), 0)]];
        let mut edges = vec![
            vec![Some(EdgeState {
                path_facts: [(ValueId(0), narrow)].into_iter().collect(),
                params: Vec::new(),
            })],
            vec![Some(EdgeState {
                path_facts: [(ValueId(0), narrow)].into_iter().collect(),
                params: Vec::new(),
            })],
            Vec::new(),
        ];
        let first = recompute_entry(
            &body,
            BlockId(2),
            &incoming,
            &edges,
            &values,
            &FxHashMap::default(),
            &positions[2],
            &mut WorkCounts::default(),
        )
        .expect("both narrow predecessor states reach the block");
        assert_eq!(test_path_fact(&first, &values, ValueId(0)), narrow);

        edges[0][0]
            .as_mut()
            .expect("the incoming edge remains present")
            .path_facts
            .clear();
        let retracted = recompute_entry(
            &body,
            BlockId(2),
            &incoming,
            &edges,
            &values,
            &FxHashMap::default(),
            &positions[2],
            &mut WorkCounts::default(),
        )
        .expect("the edge remains reachable after retracting its override");
        assert_eq!(test_path_fact(&retracted, &values, ValueId(0)), values[0]);
        assert!(retracted.contains_key(&ValueId(0)));

        edges[1][0]
            .as_mut()
            .expect("the second incoming edge remains present")
            .path_facts
            .clear();
        let fully_retracted = recompute_entry(
            &body,
            BlockId(2),
            &incoming,
            &edges,
            &values,
            &FxHashMap::default(),
            &positions[2],
            &mut WorkCounts::default(),
        )
        .expect("both edges remain reachable after retracting their facts");
        assert_eq!(
            test_path_fact(&fully_retracted, &values, ValueId(0)),
            values[0]
        );
        assert!(!fully_retracted.contains_key(&ValueId(0)));
    }

    #[test]
    fn many_phi_parameter_join_work_is_linear_in_parameter_count() {
        for count in [16_usize, 64, 256] {
            let source_values: Vec<_> = (0..count)
                .map(|index| op(OpKind::ConstFloat(test_number(index))))
                .collect();
            let target_params: Vec<_> = (count..count * 2).map(test_value_id).collect();
            let values = source_values
                .into_iter()
                .chain((0..count).map(|slot| op(OpKind::BlockParam(test_value_id(slot).0))))
                .collect();
            let args = (0..count).map(test_value_id).collect();
            let body = func(
                values,
                vec![
                    block(
                        Vec::new(),
                        (0..count).map(test_value_id).collect(),
                        Terminator::Jump {
                            target: BlockId(1),
                            args,
                        },
                    ),
                    block(target_params.clone(), Vec::new(), Terminator::Return(None)),
                ],
                0,
            );
            let mut work = WorkCounts::default();
            let positions = parameter_positions(&body, &mut work);
            let incoming = vec![vec![], vec![(BlockId(0), 0)]];
            let edge = EdgeState {
                path_facts: PathFacts::default(),
                params: (0..count)
                    .map(|index| Facts::constant(test_number(index)))
                    .collect(),
            };
            let edges = vec![vec![Some(edge)], vec![]];
            let globals = vec![Facts::TOP; body.values.len()];
            let entry = recompute_entry(
                &body,
                BlockId(1),
                &incoming,
                &edges,
                &globals,
                &FxHashMap::default(),
                &positions[1],
                &mut work,
            )
            .expect("the parameter edge reaches the join");
            #[cfg(test)]
            {
                assert_eq!(work.parameter_index_entries, count);
                assert_eq!(work.entry_keys_visited, count);
                assert_eq!(work.parameter_position_queries, count);
            }
            assert_eq!(entry.len(), count);
            assert_eq!(
                entry[&target_params[count - 1]],
                Facts::constant(test_number(count - 1))
            );
        }
    }

    #[test]
    fn edge_record_work_tracks_sparse_refinements_not_live_in_size() {
        let value_count = 4096_usize;
        let body = func(
            (0..value_count)
                .map(|index| op(OpKind::ConstFloat(test_number(index))))
                .collect(),
            vec![
                block(
                    Vec::new(),
                    Vec::new(),
                    Terminator::Jump {
                        target: BlockId(1),
                        args: Vec::new(),
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(None)),
            ],
            0,
        );
        let positions = parameter_positions(&body, &mut WorkCounts::default());
        let values = vec![Facts::constant(0.0); value_count];
        let mut large_live_in: Vec<rustc_hash::FxHashSet<ValueId>> =
            vec![rustc_hash::FxHashSet::default(); body.blocks.len()];
        large_live_in[1].extend((0..value_count).map(test_value_id));
        let small_live_in: Vec<_> = vec![
            rustc_hash::FxHashSet::default(),
            [ValueId(0), ValueId(1)].into_iter().collect(),
        ];
        let small_refinements = [
            (ValueId(0), Facts::constant(1.0)),
            (ValueId(1), Facts::constant(2.0)),
            (ValueId(2), Facts::constant(3.0)),
        ]
        .into_iter()
        .collect();
        let mut large_edges = vec![vec![None], vec![]];
        let mut large_work = WorkCounts::default();
        assert!(record_edge(
            &body,
            BlockId(0),
            0,
            BlockId(1),
            &[],
            &small_refinements,
            &values,
            &mut large_edges,
            &large_live_in,
            &positions,
            &FxHashMap::default(),
            &mut large_work,
        ));
        #[cfg(test)]
        {
            assert_eq!(large_work.sparse_refinement_visits, 3);
            assert_eq!(large_work.live_in_membership_probes, 3);
        }
        assert_eq!(
            large_edges[0][0]
                .as_ref()
                .expect("record_edge publishes the sparse edge")
                .path_facts
                .len(),
            3
        );

        let mut small_edges = vec![vec![None], vec![]];
        let mut small_work = WorkCounts::default();
        assert!(record_edge(
            &body,
            BlockId(0),
            0,
            BlockId(1),
            &[],
            &small_refinements,
            &values,
            &mut small_edges,
            &small_live_in,
            &positions,
            &FxHashMap::default(),
            &mut small_work,
        ));
        #[cfg(test)]
        {
            assert_eq!(small_work.sparse_refinement_visits, 3);
            assert_eq!(small_work.live_in_membership_probes, 3);
        }
        assert_eq!(
            small_edges[0][0]
                .as_ref()
                .expect("record_edge publishes the small edge")
                .path_facts
                .len(),
            2
        );
    }

    #[test]
    fn observations_report_only_real_delta_including_first_insertion() {
        let mut body = counted_loop(10.0);
        body.values[0].ty =
            HirType::Managed(super::super::ManagedType::Object(super::super::TypeId(0)));
        let mut observed = Observed::default();
        assert!(observe(&body, &mut observed, ValueId(0), 0, Facts::BOTTOM));
        assert!(!observe(&body, &mut observed, ValueId(0), 0, Facts::BOTTOM));
        assert!(observe(
            &body,
            &mut observed,
            ValueId(0),
            0,
            Facts::constant(1.0)
        ));
        assert!(!observe(
            &body,
            &mut observed,
            ValueId(0),
            0,
            Facts::constant(1.0)
        ));
        assert!(observe(
            &body,
            &mut observed,
            ValueId(0),
            0,
            Facts::constant(2.0)
        ));
        assert!(!observe(
            &body,
            &mut observed,
            ValueId(0),
            0,
            Facts::constant(1.0)
        ));
    }

    #[allow(non_snake_case)]
    fn Op_binary(op: BinOp, lhs: u32, rhs: u32) -> OpKind {
        OpKind::Binary {
            op,
            lhs: ValueId(lhs),
            rhs: ValueId(rhs),
        }
    }

    #[test]
    fn a_constant_bounded_counter_is_provably_an_integer() {
        let analysis = analyze(&counted_loop(10.0));
        let counter = analysis.get(ValueId(1));
        assert!(counter.whole, "the counter is whole: {counter:?}");
        assert!(!counter.maybe_nan);
        assert_eq!(counter.lo, 0.0);

        // The upper bound is the widening threshold, not 10. A counter's bound
        // grows by one per round, so a loop bounded by a million would need a
        // million rounds; widening jumps a still-growing bound to the next point
        // where a verdict could change. The verdict is what matters, and it is
        // preserved: this is still provably `i32`.
        assert!(analysis.is_integral_within(ValueId(1), -2_147_483_648.0, 2_147_483_647.0));
    }

    #[test]
    fn widening_does_not_manufacture_a_verdict_it_cannot_prove() {
        // The counterpart to the test above, and the reason those thresholds are
        // the ones they are. A counter bounded past `i32` widens to the *next*
        // threshold rather than stopping at a convenient one, so it is reported
        // as `i64` and not as `i32`. Widening only ever grows a bound, so the
        // answer stays an over-approximation of the truth.
        let analysis = analyze(&counted_loop(3_000_000_000.0));
        assert!(
            !analysis.is_integral_within(ValueId(1), -2_147_483_648.0, 2_147_483_647.0),
            "{:?} does not fit i32",
            analysis.get(ValueId(1))
        );
        assert!(analysis.is_integral_within(ValueId(1), facts::SAFE_MIN, facts::SAFE_MAX));
    }

    #[test]
    fn a_counter_bounded_by_a_parameter_is_not() {
        // Same loop, but the limit is an unanalyzed input. This is the case that
        // makes exported functions hard, and the analysis has to say so rather
        // than guess: the counter really can exceed any integer range.
        let mut function = counted_loop(10.0);
        function.values[2] = op(OpKind::Param(0));
        function.params.push(Param {
            name: "limit".to_owned(),
            ty: HirType::Float { bits: 64 },
            origin: origin(),
            known: Facts::TOP,
            written: None,
            shape: crate::hir::ParamShape::Ordinary,
        });

        let analysis = analyze(&function);
        assert!(
            !analysis.is_integral_within(ValueId(1), -2_147_483_648.0, 2_147_483_647.0),
            "an unbounded counter must not be claimed as i32: {:?}",
            analysis.get(ValueId(1))
        );
    }

    #[test]
    fn wholeness_sharpens_a_strict_bound_by_a_full_step() {
        // A whole `x < 10` is `x <= 9`, not `x <= 10`. Without this the loop
        // above proves `[0, 11]` and every derived bound is one too wide.
        let whole = Facts::new(0.0, 100.0, true, false, false);
        let limit = Facts::constant(10.0);
        assert_eq!(refine(BinOp::Lt, whole, limit, true).hi, 9.0);

        // A value that is not known to be whole gets only the weak bound: it
        // may be 9.5.
        let fractional = Facts::new(0.0, 100.0, false, false, false);
        assert_eq!(refine(BinOp::Lt, fractional, limit, true).hi, 10.0);
    }

    #[test]
    fn a_failed_ordered_comparison_proves_nothing_about_nan() {
        // `!(x < 10)` does not mean `x >= 10`: a NaN fails every ordered
        // comparison. Narrowing on the false edge would let a NaN be proven to
        // be a large integer.
        let unknown = Facts::TOP;
        let limit = Facts::constant(10.0);
        let refined = refine(BinOp::Ge, unknown, limit, false);
        assert!(
            refined.maybe_nan,
            "NaN survives the false edge: {refined:?}"
        );

        // The true edge does exclude it: `x < 10` being true means `x` is a
        // number.
        let taken = refine(BinOp::Lt, unknown, limit, true);
        assert!(!taken.maybe_nan);
    }

    #[test]
    fn a_parameter_is_unknown_rather_than_assumed() {
        let function = func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Return(Some(ValueId(0))),
            )],
            1,
        );
        let analysis = analyze(&function);
        let facts = analysis.get(ValueId(0));
        assert!(facts.maybe_nan && !facts.whole, "{facts:?}");
    }

    #[test]
    fn a_literal_contract_never_overrides_an_arrival_proof() {
        let mut function = func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Return(Some(ValueId(0))),
            )],
            1,
        );
        function.params[0].known = Facts::constant(64.0);
        assert_eq!(analyze(&function).get(ValueId(0)), Facts::TOP);

        let whole = Whole::default();
        let caps = FxHashMap::default();
        let written = Written::default();
        let actual = [Facts::constant(2.0)];
        let context = Context {
            params: &actual,
            caps: &caps,
            param_lengths: &[],
            whole: &whole,
            written: &written,
        };
        assert_eq!(analyze_with(&function, &context).get(ValueId(0)), actual[0]);

        // A physical integer slot still supplies its actual representation's
        // range, independently of the declaration's alleged singleton.
        function.params[0].ty = HirType::Int {
            bits: 8,
            signed: false,
        };
        function.values[0].ty = function.params[0].ty.clone();
        let represented = analyze(&function).get(ValueId(0));
        assert_eq!(represented, Facts::new(0.0, 255.0, true, false, false));
    }

    /// The arm whose absence cost the `bytes` benchmark 2.4x. A conversion is
    /// not an unknown: it is the value it was given, as far as the result type
    /// can hold it.
    #[test]
    fn a_conversion_keeps_the_facts_of_its_operand() {
        let narrow = HirType::Int {
            bits: 8,
            signed: false,
        };
        let values = vec![
            Op {
                kind: OpKind::ConstInt(200),
                ty: narrow,
                origin: origin(),
            },
            Op {
                kind: OpKind::Convert(ValueId(0)),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
            },
        ];
        let blocks = vec![block(
            Vec::new(),
            vec![ValueId(0), ValueId(1)],
            Terminator::Return(Some(ValueId(1))),
        )];
        let analysis = analyze(&func(values, blocks, 0));
        let converted = analysis.get(ValueId(1));
        assert!(
            converted.is_singleton() && converted.contains(200.0),
            "a widening conversion is exact: {converted:?}"
        );
    }

    /// And a machine type's width is a range on its own, which is the only
    /// fact a *declared* `Uint8Array` has — nothing narrowed it, so nothing
    /// recorded what it holds.
    #[test]
    fn a_narrow_result_type_bounds_the_conversion() {
        let values = vec![
            Op {
                kind: OpKind::ConstFloat(70_000.0),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
            },
            Op {
                kind: OpKind::Convert(ValueId(0)),
                ty: HirType::Int {
                    bits: 16,
                    signed: false,
                },
                origin: origin(),
            },
        ];
        let blocks = vec![block(
            Vec::new(),
            vec![ValueId(0), ValueId(1)],
            Terminator::Return(Some(ValueId(1))),
        )];
        let analysis = analyze(&func(values, blocks, 0));
        let narrowed = analysis.get(ValueId(1));
        assert!(
            narrowed.hi <= 65535.0 && narrowed.lo >= 0.0,
            "a `u16` holds 0 to 65535 whatever reached it: {narrowed:?}"
        );
    }
}
