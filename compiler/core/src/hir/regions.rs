//! Call regions: which calls could allocate everything they make in one region,
//! given back at once where their result dies.
//!
//! For a call `r = f(args)` in a caller `g`, the runtime can bump every object
//! `f` makes out of a region (`nts_region_open`) and give the region back where
//! `r` dies (`nts_region_reset`): no walk of the result, no free per object. The
//! runtime trusts three facts, and this decides them:
//!
//! 1. **Nothing made inside escapes except through `r`.** `f` and everything it
//!    calls store only into objects made inside the call: no global, no field or
//!    element of an argument, no helper that keeps what it is given somewhere
//!    else.
//! 2. **Containers keep only references made inside the call or immortal.**
//!    A clone inserts no counts, but container helpers can retain or release
//!    their contents. Keeping an external reference alive until reset does not
//!    balance those counts; external edges need the later ownership protocol.
//! 3. **`r` dies at a point, and nothing reached from it survives that point.**
//!    `g` only reads through `r`: it stores no part of it, returns none, and
//!    hands it only to calls that read.
//!
//! This is the reporting half (R2 in the design): it answers which calls
//! qualify and why the others do not, so the corpora say how far regions reach
//! before anything is rewritten. The answer is `Prepared::regions`; `nts
//! stats` prints the counts and `nts regions` the reasons.
//!
//! Every fact is a fixpoint over the whole program, and every one moves in the
//! same direction as rounds pass -- a claim of freshness is withdrawn, a
//! parameter becomes a store's container, a body is refused -- so the rounds
//! end. Recursion is admitted: a function that calls itself is judged by what
//! its body does, assuming the call does the same.

use std::collections::{BTreeMap, BTreeSet};

use rustc_hash::{FxHashMap, FxHashSet};

use super::{BlockId, Callee, Func, HirType, OpKind, Program, Terminator, ValueId};

pub mod placement;

/// Which calls a region could serve, and why each other candidate cannot.
#[derive(Debug, Clone, Default)]
pub struct Report {
    /// Per-site placement, distinct from the legacy whole-call eligibility.
    /// No allocation consumer exists until every selected site has a proof.
    pub placement: placement::Report,
    /// Calls to a function of the program whose result is a reference and
    /// whose call allocates: the calls a region would be for.
    pub candidates: usize,
    /// Of those, the ones all three facts hold for.
    pub sites: usize,
    /// Of the sites, the ones whose call may raise a value it made, which a
    /// region must hand to the heap before its reset.
    pub raising: usize,
    /// Each refused candidate's first reason, and how many share it.
    pub refused: BTreeMap<String, usize>,
    /// Every candidate, in program order.
    pub calls: Vec<Candidate>,
}

/// One candidate call and its verdict.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub caller: String,
    pub callee: String,
    /// `Ok` for a site; otherwise the first fact that failed, and the function
    /// it failed in.
    pub verdict: Result<(), Refusal>,
}

/// Why a candidate is not a site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub reason: String,
    pub function: String,
}

/// What a runtime helper does to memory, as far as a region needs to know.
///
/// Refused by default: a helper is region-safe only by name, because the one
/// that keeps what it is given somewhere -- an intern table, a registry, a
/// timer -- would hold region memory past the reset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Helper {
    /// Reads its arguments and keeps none of them. A reference it answers is
    /// borrowed from one of them.
    Reads,
    /// Reads its arguments, keeps none, and answers a fresh allocation.
    Makes,
    /// Reads its arguments, keeps none of them anywhere else, may allocate,
    /// and answers an owned (+1) result that is either fresh or exactly
    /// argument `from`, retained. Case conversion answering its input when
    /// nothing changed. Not a borrowed answer: the caller owns a count
    /// either way, so this is not `own::RUNTIME_HANDS_BACK`.
    MakesOrRetains { from: usize },
    /// Makes a shallow copy, including the source container's references.
    Copies { from: usize },
    /// Writes into argument `into` and keeps its other reference arguments
    /// there; answers that argument, a fresh replacement, or a scalar.
    Fills { into: usize },
    /// Writes into argument `into` and keeps nothing else: an append copies
    /// its text, a numeric push its number. Answers as `Fills` does.
    Grows { into: usize },
    /// Takes an element out of argument `from`, which it writes, and answers
    /// the element: as fresh as that array's elements are.
    Takes { from: usize },
    /// `nts_raise`: hands its argument to the runtime's raise slot. A value
    /// made inside the call must be moved to the heap before the reset.
    Raises,
}

fn helper(name: &str) -> Option<Helper> {
    if super::runtime::reads_only(name) {
        return Some(Helper::Reads);
    }
    Some(match name {
        "nts_string_eq"
        | "nts_str_index_of"
        | "nts_str_index_of_from"
        | "nts_str_last_index_of"
        | "nts_str_includes"
        | "nts_str_starts_with"
        | "nts_str_ends_with"
        | "nts_str_char_code_at"
        | "nts_str_char_code_at_fn"
        | "nts_str_char_code_at_int"
        | "nts_str_char_code_at_int_fn"
        | "nts_str_code_point_at"
        | "nts_str_is_well_formed"
        | "nts_str_to_number"
        | "nts_string_truthy"
        | "nts_array_includes"
        | "nts_array_includes_ref"
        | "nts_array_includes_str"
        | "nts_array_index_of"
        | "nts_array_index_of_ref"
        | "nts_array_index_of_str"
        | "nts_array_last_index_of"
        | "nts_array_length"
        | "nts_array_at"
        | "nts_array_at_ref"
        | "nts_array_at_value"
        | "nts_map_has"
        | "nts_map_get"
        | "nts_map_key_at"
        | "nts_map_value_at"
        | "nts_value_of_number"
        | "nts_value_of_boolean"
        | "nts_raising"
        | "nts_uncaught"
        | "nts_refused"
        | "nts_assertion_failed"
        | "nts_is_finite" => Helper::Reads,
        "nts_concat"
        | "nts_str_slice"
        | "nts_str_substring"
        | "nts_str_substring_general"
        | "nts_str_at"
        | "nts_str_char_at"
        | "nts_str_repeat"
        | "nts_str_pad_start"
        | "nts_str_pad_end"
        | "nts_str_to_well_formed"
        | "nts_string_from_char_code"
        | "nts_string_from_code_point"
        | "nts_string_from_utf8"
        | "nts_number_to_string"
        | "nts_number_to_string_radix"
        | "nts_number_to_fixed"
        | "nts_map_new"
        | "nts_set_new"
        | "nts_array_new"
        | "nts_array_new_uninitialized"
        | "nts_array_join_str" => Helper::Makes,
        "nts_str_to_lower_case" | "nts_str_to_upper_case" => Helper::MakesOrRetains { from: 0 },
        "nts_array_slice" => Helper::Copies { from: 0 },
        "nts_array_push_ref"
        | "nts_array_push_value"
        | "nts_array_unshift_ref"
        | "nts_map_set"
        | "nts_set_add" => Helper::Fills { into: 0 },
        "nts_array_push"
        | "nts_array_unshift"
        | "nts_array_set_length"
        | "nts_array_set_length_ref"
        | "nts_array_set_length_value"
        | "nts_array_fill"
        | "nts_array_fill_bool"
        | "nts_array_sort_str"
        | "nts_map_delete"
        | "nts_str_append" => Helper::Grows { into: 0 },
        "nts_array_pop" | "nts_array_shift" | "nts_array_shift_ref" | "nts_array_shift_value" => {
            Helper::Takes { from: 0 }
        }
        "nts_raise" => Helper::Raises,
        _ => return None,
    })
}

/// Where a value is used: by an operation, or by its block's terminator.
#[derive(Debug, Clone, Copy)]
enum Use {
    Op(ValueId),
    /// Passed along an edge, as the target block's parameter at `position`.
    Edge {
        target: BlockId,
        position: usize,
    },
    Returned,
    /// A branch's condition: read, never kept.
    Tested,
}

/// Every value's uses, and which block parameter each `BlockParam` is.
#[derive(Debug, Default)]
struct Uses {
    of: FxHashMap<ValueId, Vec<Use>>,
    /// `(block, position)` for each block parameter's value.
    param_at: FxHashMap<ValueId, (BlockId, usize)>,
    /// Each block parameter's incoming values, by `(block, position)`.
    incoming: FxHashMap<(BlockId, usize), Vec<ValueId>>,
}

impl Uses {
    fn of(func: &Func) -> Self {
        let mut uses = Self::default();
        for (at, block) in func.blocks.iter().enumerate() {
            let here = BlockId(u32::try_from(at).unwrap_or(u32::MAX));
            for (position, param) in block.params.iter().enumerate() {
                uses.param_at.insert(*param, (here, position));
            }
            for op in &block.ops {
                for operand in super::verify::operands(&func.values[op.0 as usize].kind) {
                    uses.of.entry(operand).or_default().push(Use::Op(*op));
                }
            }
            let edge = |target: BlockId, args: &[ValueId], uses: &mut Self| {
                for (position, arg) in args.iter().enumerate() {
                    uses.of
                        .entry(*arg)
                        .or_default()
                        .push(Use::Edge { target, position });
                    uses.incoming
                        .entry((target, position))
                        .or_default()
                        .push(*arg);
                }
            };
            match &block.terminator {
                Terminator::Return(Some(value)) => {
                    uses.of.entry(*value).or_default().push(Use::Returned);
                }
                Terminator::Jump { target, args } => edge(*target, args, &mut uses),
                Terminator::Branch {
                    cond,
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                } => {
                    uses.of.entry(*cond).or_default().push(Use::Tested);
                    edge(*then_target, then_args, &mut uses);
                    edge(*else_target, else_args, &mut uses);
                }
                _ => {}
            }
        }
        uses
    }

    fn of_value(&self, value: ValueId) -> &[Use] {
        self.of.get(&value).map_or(&[], Vec::as_slice)
    }
}

/// A field of a class (`Some`) or an array's elements (`None`), by the type of
/// the object that holds them.
type Slot = (HirType, Option<u32>);

/// Shared names, uses and the direct-call graph, computed once per program.
struct Shared<'p> {
    program: &'p Program,
    by_name: FxHashMap<&'p str, usize>,
    uses: Vec<Uses>,
    edges: Vec<Vec<usize>>,
    callers: Vec<Vec<usize>>,
    components: Vec<usize>,
}

impl<'p> Shared<'p> {
    fn new(program: &'p Program) -> Self {
        let by_name: FxHashMap<&str, usize> = program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, func)| (func.name.as_str(), at))
            .collect();
        let edges: Vec<Vec<usize>> = program
            .funcs
            .iter()
            .map(|func| {
                func.values
                    .iter()
                    .filter_map(|op| match &op.kind {
                        OpKind::Call {
                            callee: Callee::Direct(name),
                            ..
                        } => by_name.get(name.as_str()).copied(),
                        _ => None,
                    })
                    .collect()
            })
            .collect();
        let mut callers = vec![Vec::new(); program.funcs.len()];
        for (at, callees) in edges.iter().enumerate() {
            for callee in callees {
                callers[*callee].push(at);
            }
        }
        let components = super::strongly_connected(&edges);
        Self {
            program,
            by_name,
            edges,
            callers,
            components,
            uses: program.funcs.iter().map(Uses::of).collect(),
        }
    }

    /// The functions `at` calls directly.
    fn callees(&self, at: usize) -> &[usize] {
        &self.edges[at]
    }

    /// Every function a call to `root` can run, `root` first.
    fn members(&self, root: usize) -> Vec<usize> {
        let mut seen: FxHashSet<usize> = FxHashSet::default();
        let mut pending = vec![root];
        let mut members = Vec::new();
        while let Some(at) = pending.pop() {
            if !seen.insert(at) {
                continue;
            }
            members.push(at);
            pending.extend(self.callees(at));
        }
        members
    }
}

/// Which functions a round refines, and from where their parameters come.
#[derive(Debug, Clone, Copy)]
enum Scope<'s> {
    /// Every function, every parameter from outside: what holds wherever a
    /// function is called from. Fact 3 is read here, in a caller that is not
    /// inside any region.
    Program,
    /// One region's call: `root` and what it can run. Inside it, a member's
    /// parameter is fresh when every call to it from a member passes something
    /// made in the call; the root's never are -- its caller made them.
    Region { root: usize, members: &'s [usize] },
}

/// The facts of one scope, refined round by round.
struct Facts<'p, 's> {
    /// Whether these facts judge bodies inside a region's call, where the
    /// clone runs uncounted. (The `Scope` itself borrows the member list,
    /// which outlives construction but is not stored.)
    in_region: bool,
    shared: &'s Shared<'p>,
    program: &'p Program,
    members: Vec<usize>,
    /// Whether every value a function returns was made inside its call.
    returns_fresh: Vec<bool>,
    /// Parameter slots every caller fills with something it made: a function
    /// reached only by direct calls, whose every call passes a fresh value
    /// there. What is read out of one is as fresh as what is read out of
    /// anything made in the call.
    fresh_params: Vec<FxHashSet<u32>>,
    /// Whether a call to the function allocates at all.
    allocates: Vec<bool>,
    /// Whether a call may raise a value it made.
    raises: Vec<bool>,
    /// Whether a call builds a string by appending. A string made in a region
    /// is immortal, and an append onto an immortal string copies it; and a
    /// clone is never counted, so the concatenations counting would have
    /// turned into appends in place stay copies. A string built that way in a
    /// region is built in quadratic time.
    appends: Vec<bool>,
    /// Whether a call allocates repeatedly -- in a loop, in a member that
    /// recurses, or in a call to one that does -- so that what it makes can
    /// outweigh what a region costs to open and give back. A call that makes a
    /// string or two does not, and a region would only slow it.
    repeats: Vec<bool>,
    /// The members of a region's call that can call themselves.
    recursive: FxHashSet<usize>,
    /// Parameter slots the function stores into, itself or through a callee:
    /// its callers must pass something made inside the call there.
    containers: Vec<FxHashSet<u32>>,
    /// Parameter slots whose argument the function keeps in something it made,
    /// itself or through a callee: its callers must pass a value a region
    /// object may point at there (fact 2).
    kept: Vec<FxHashSet<u32>>,
    /// Fields and element slots something not made inside a call is stored
    /// into somewhere, so a read of one is not known to be fresh.
    stale: FxHashSet<Slot>,
    /// Why a function's body breaks fact 1 or 2, first reason found.
    refused: Vec<Option<String>>,
    /// Parameter slots the function only reads through (fact 3).
    reads_only: Vec<FxHashSet<u32>>,
}

impl<'p, 's> Facts<'p, 's> {
    fn new(shared: &'s Shared<'p>, scope: Scope<'_>) -> Self {
        let program = shared.program;
        let count = program.funcs.len();
        let params = |at: usize| -> FxHashSet<u32> {
            (0..u32::try_from(program.funcs[at].params.len()).unwrap_or(u32::MAX)).collect()
        };
        let (members, fresh_params) = match scope {
            Scope::Program => ((0..count).collect(), vec![FxHashSet::default(); count]),
            Scope::Region { root, members } => {
                let mut fresh = vec![FxHashSet::default(); count];
                for member in members {
                    if *member != root {
                        fresh[*member] = params(*member);
                    }
                }
                (members.to_vec(), fresh)
            }
        };
        let recursive = match scope {
            Scope::Program => FxHashSet::default(),
            Scope::Region { members, .. } => members
                .iter()
                .copied()
                .filter(|member| {
                    let callees = shared.callees(*member);
                    callees
                        .iter()
                        .any(|callee| shared.members(*callee).contains(member))
                })
                .collect(),
        };
        Self {
            in_region: matches!(scope, Scope::Region { .. }),
            shared,
            program,
            members,
            fresh_params,
            returns_fresh: vec![true; count],
            allocates: vec![false; count],
            raises: vec![false; count],
            appends: vec![false; count],
            repeats: vec![false; count],
            recursive,
            containers: vec![FxHashSet::default(); count],
            kept: vec![FxHashSet::default(); count],
            stale: FxHashSet::default(),
            refused: vec![None; count],
            reads_only: (0..count).map(params).collect(),
        }
    }

    /// Bottom-up SCC worklist. Summaries flow to callers, freshness of
    /// parameters flows to callees, and a stale slot can affect every body.
    /// Those reverse/global dependencies requeue components explicitly.
    fn settle(&mut self) {
        self.settle_with_budget(
            100_000usize.saturating_add(self.members.len().saturating_mul(100)),
        );
    }

    fn settle_with_budget(&mut self, mut remaining: usize) {
        let components = &self.shared.components;
        let mut groups = vec![Vec::new(); components.iter().max().map_or(0, |at| at + 1)];
        for at in &self.members {
            groups[components[*at]].push(*at);
        }
        let mut pending: BTreeSet<usize> = self.members.iter().map(|at| components[*at]).collect();
        while let Some(component) = pending.pop_first() {
            for at in &groups[component] {
                if remaining == 0 {
                    // Refuse the entire dependent scope. Neither this body's
                    // optimistic freshness nor its callers' read-only facts
                    // can authorize a region after an incomplete proof.
                    for member in &self.members {
                        self.refused[*member] = Some("region analysis budget exhausted".to_owned());
                        self.returns_fresh[*member] = false;
                        self.fresh_params[*member].clear();
                        self.reads_only[*member].clear();
                    }
                    return;
                }
                remaining -= 1;
                let (changed, parameters, stale) = self.refine(*at);
                if changed {
                    for caller in &self.shared.callers[*at] {
                        pending.insert(components[*caller]);
                    }
                }
                for callee in parameters {
                    pending.insert(components[callee]);
                }
                if stale {
                    pending.extend(self.members.iter().map(|at| components[*at]));
                }
            }
        }
    }

    fn callee(&self, name: &str) -> Option<usize> {
        self.shared.by_name.get(name).copied()
    }

    /// Values a function made inside its call -- allocations, fresh results of
    /// its callees, and what it reads out of those through slots nothing stale
    /// is stored into -- through the views that keep identity. A greatest
    /// fixpoint, so a loop carrying a fresh value stays fresh.
    fn fresh(&self, at: usize) -> FxHashSet<ValueId> {
        let func = &self.program.funcs[at];
        let uses = &self.shared.uses[at];
        let mut fresh: FxHashSet<ValueId> = FxHashSet::default();
        for (index, op) in func.values.iter().enumerate() {
            let candidate = match &op.kind {
                OpKind::ObjectNew { .. }
                | OpKind::ArrayNew { .. }
                | OpKind::Binary {
                    op: super::BinOp::Concat,
                    ..
                }
                | OpKind::FieldGet { .. }
                | OpKind::ArrayGet { .. }
                | OpKind::Erase { .. }
                | OpKind::Unerase { .. }
                | OpKind::Convert(_)
                | OpKind::FieldView { .. }
                | OpKind::BlockParam(_)
                // Nothing at all: stored, it points at nothing, and a store
                // into it throws before it writes.
                | OpKind::ConstNull
                | OpKind::ConstUndefined
                // Immortal, and never a container: harmless wherever a fresh
                // value is.
                | OpKind::ConstString(_)
                | OpKind::ConstTemplate { .. }
                | OpKind::ClosureStatic => true,
                OpKind::Param(slot) => self.fresh_params[at].contains(slot),
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } => self
                    .callee(name)
                    .is_some_and(|callee| self.returns_fresh[callee]),
                OpKind::Call {
                    callee: Callee::External(name),
                    ..
                } => matches!(
                    helper(name),
                    Some(
                        Helper::Makes
                            | Helper::MakesOrRetains { .. }
                            | Helper::Copies { .. }
                            | Helper::Fills { .. }
                            | Helper::Grows { .. }
                            | Helper::Takes { .. }
                    )
                ),
                _ => false,
            };
            if candidate {
                fresh.insert(ValueId(u32::try_from(index).unwrap_or(u32::MAX)));
            }
        }
        loop {
            let before = fresh.len();
            let kept: FxHashSet<ValueId> = fresh
                .iter()
                .copied()
                .filter(|value| self.stays_fresh(func, uses, *value, &fresh))
                .collect();
            fresh = kept;
            if fresh.len() == before {
                return fresh;
            }
        }
    }

    fn stays_fresh(
        &self,
        func: &Func,
        uses: &Uses,
        value: ValueId,
        fresh: &FxHashSet<ValueId>,
    ) -> bool {
        let op = &func.values[value.0 as usize];
        match &op.kind {
            OpKind::FieldGet { object, field } => {
                fresh.contains(object)
                    && !self.stale.contains(&slot_of(func, *object, Some(*field)))
            }
            OpKind::ArrayGet { array, .. } => {
                fresh.contains(array) && !self.stale.contains(&slot_of(func, *array, None))
            }
            OpKind::Erase { value: inner, .. }
            | OpKind::Unerase { value: inner, .. }
            | OpKind::Convert(inner)
            | OpKind::FieldView { value: inner, .. } => fresh.contains(inner),
            OpKind::BlockParam(_) => uses.param_at.get(&value).is_some_and(|at| {
                uses.incoming
                    .get(at)
                    .is_some_and(|incoming| incoming.iter().all(|arg| fresh.contains(arg)))
            }),
            // A helper that fills its argument answers it or a replacement
            // made in the call: fresh exactly when what it filled was.
            OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } => match helper(name) {
                // The answer is fresh or the retained input itself: fresh
                // (region-relative) exactly when the input is.
                Some(Helper::MakesOrRetains { from }) => {
                    args.get(from).is_some_and(|arg| fresh.contains(arg))
                }
                Some(Helper::Fills { into } | Helper::Grows { into }) => {
                    args.get(into).is_some_and(|arg| fresh.contains(arg))
                }
                Some(Helper::Copies { from }) => args.get(from).is_some_and(|arg| {
                    !matches!(&func.values[arg.0 as usize].ty,
                        HirType::Managed(super::ManagedType::Array(element)) if element.may_hold_a_reference())
                        || fresh.contains(arg)
                }),
                Some(Helper::Takes { from }) => args.get(from).is_some_and(|arg| {
                    fresh.contains(arg) && !self.stale.contains(&slot_of(func, *arg, None))
                }),
                _ => true,
            },
            _ => true,
        }
    }

    /// One round over one function: what it returns, allocates, raises, stores
    /// into and is refused for. Returns summary changes, refuted callee
    /// parameters, and whether a globally shared slot became stale.
    fn refine(&mut self, at: usize) -> (bool, Vec<usize>, bool) {
        let program = self.program;
        let func = &program.funcs[at];
        let fresh = self.fresh(at);
        let mut judged = Judged {
            func,
            fresh: &fresh,
            allocates: false,
            raises: false,
            appends: false,
            containers: self.containers[at].clone(),
            kept: self.kept[at].clone(),
            stale: Vec::new(),
            refused: None,
        };
        let mut repeats = false;
        for (index, block) in func.blocks.iter().enumerate() {
            let looped =
                super::loops::in_a_cycle(func, BlockId(u32::try_from(index).unwrap_or(u32::MAX)));
            for op in &block.ops {
                let kind = &func.values[op.0 as usize].kind;
                judged.op(self, kind);
                let (makes, callee_repeats) = self.allocating(kind);
                repeats |= callee_repeats || (makes && (looped || self.recursive.contains(&at)));
            }
        }
        let refuted = self.refuted_params(func, &fresh);
        let returns_fresh = returns_only(func, &fresh);
        let reads_only = self.reads_only_params(at);
        let Judged {
            allocates,
            raises,
            appends,
            containers,
            kept,
            stale,
            refused,
            ..
        } = judged;

        let mut changed = false;
        let mut parameters = Vec::new();
        for (callee, slot) in refuted {
            if self.fresh_params[callee].remove(&slot) {
                parameters.push(callee);
            }
        }
        if self.returns_fresh[at] && !returns_fresh {
            self.returns_fresh[at] = false;
            changed = true;
        }
        if allocates && !self.allocates[at] {
            self.allocates[at] = true;
            changed = true;
        }
        if raises && !self.raises[at] {
            self.raises[at] = true;
            changed = true;
        }
        if appends && !self.appends[at] {
            self.appends[at] = true;
            changed = true;
        }
        if repeats && !self.repeats[at] {
            self.repeats[at] = true;
            changed = true;
        }
        if containers.len() != self.containers[at].len() {
            self.containers[at] = containers;
            changed = true;
        }
        if kept.len() != self.kept[at].len() {
            self.kept[at] = kept;
            changed = true;
        }
        let mut stale_changed = false;
        for slot in stale {
            stale_changed |= self.stale.insert(slot);
        }
        if self.refused[at].is_none() && refused.is_some() {
            self.refused[at] = refused;
            changed = true;
        }
        if reads_only.len() != self.reads_only[at].len() {
            self.reads_only[at] = reads_only;
            changed = true;
        }
        (changed, parameters, stale_changed)
    }

    /// The parameter slots a function only reads through (fact 3, one call
    /// in): kept from the last round's answer, less those whose uses refute it.
    fn reads_only_params(&self, at: usize) -> FxHashSet<u32> {
        let func = &self.program.funcs[at];
        self.reads_only[at]
            .iter()
            .copied()
            .filter(|slot| {
                let starts: Vec<ValueId> = func
                    .values
                    .iter()
                    .enumerate()
                    .filter(|(_, op)| matches!(op.kind, OpKind::Param(p) if p == *slot))
                    .map(|(index, _)| ValueId(u32::try_from(index).unwrap_or(u32::MAX)))
                    .collect();
                self.only_read(at, &starts, Returning::HandsBack).is_ok()
            })
            .collect()
    }

    /// Whether every use of `starts`, and of everything read out of them,
    /// only reads (fact 3). The first use that does more, otherwise.
    fn only_read(
        &self,
        at: usize,
        starts: &[ValueId],
        returning: Returning,
    ) -> Result<Vec<ValueId>, String> {
        let func = &self.program.funcs[at];
        let uses = &self.shared.uses[at];
        let mut pending: Vec<ValueId> = starts.to_vec();
        let mut seen: FxHashSet<ValueId> = FxHashSet::default();
        while let Some(value) = pending.pop() {
            if !seen.insert(value) {
                continue;
            }
            for found in uses.of_value(value) {
                let reader = match *found {
                    Use::Tested => continue,
                    Use::Returned if returning == Returning::HandsBack => continue,
                    Use::Returned => return Err("returns part of the result".to_owned()),
                    Use::Edge { target, position } => {
                        if let Some(param) = func.blocks[target.0 as usize].params.get(position) {
                            pending.push(*param);
                        }
                        continue;
                    }
                    Use::Op(reader) => reader,
                };
                if self.reads(func, value, reader, returning)?
                    && func.values[reader.0 as usize].ty.is_counted()
                {
                    pending.push(reader);
                }
            }
        }
        let mut read: Vec<ValueId> = seen.into_iter().collect();
        read.sort_unstable();
        Ok(read)
    }

    /// Whether one operation only reads `value`, and whether what it answers
    /// may be read out of it -- so that it, too, is only to be read.
    fn reads(
        &self,
        func: &Func,
        value: ValueId,
        reader: ValueId,
        returning: Returning,
    ) -> Result<bool, String> {
        match &func.values[reader.0 as usize].kind {
            OpKind::FieldGet { .. }
            | OpKind::SharedFieldGet { .. }
            | OpKind::OpenFieldGet { .. }
            | OpKind::ArrayGet { .. }
            | OpKind::Erase { .. }
            | OpKind::Unerase { .. }
            | OpKind::Convert(_)
            | OpKind::FieldView { .. } => Ok(true),
            OpKind::Length(_)
            | OpKind::StringUnitAt { .. }
            | OpKind::TagOf { .. }
            | OpKind::InstanceOf { .. }
            | OpKind::Binary { .. }
            | OpKind::Unary { .. } => Ok(false),
            OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } => match helper(name) {
                Some(Helper::Reads) => Ok(true),
                // The answer may be the value itself, retained: what is
                // read out of the answer is read out of the value.
                Some(Helper::MakesOrRetains { from }) if args.get(from) == Some(&value) => Ok(true),
                Some(Helper::Copies { from })
                    if args.get(from) == Some(&value)
                        && matches!(&func.values[value.0 as usize].ty,
                        HirType::Managed(super::ManagedType::Array(element)) if element.may_hold_a_reference()) =>
                {
                    Err("copies references out of the result".to_owned())
                }
                Some(
                    Helper::Fills { into: at }
                    | Helper::Grows { into: at }
                    | Helper::Takes { from: at },
                ) if args.get(at) == Some(&value) => Err("writes into the result".to_owned()),
                Some(Helper::Fills { .. }) => Err("stores part of the result".to_owned()),
                Some(
                    Helper::Makes
                    | Helper::MakesOrRetains { .. }
                    | Helper::Copies { .. }
                    | Helper::Grows { .. }
                    | Helper::Takes { .. },
                ) => Ok(false),
                Some(Helper::Raises) => Err("raises part of the result".to_owned()),
                None => Err(format!("hands part of the result to `{name}`")),
            },
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } => {
                let Some(callee) = self.callee(name) else {
                    return Err(
                        "hands part of the result to a function not in the program".to_owned()
                    );
                };
                let kept = args.iter().enumerate().any(|(slot, arg)| {
                    *arg == value
                        && !self.reads_only[callee]
                            .contains(&u32::try_from(slot).unwrap_or(u32::MAX))
                });
                if kept {
                    return Err("hands part of the result to a call that keeps it".to_owned());
                }
                // What it answers may be read out of what it was given.
                Ok(true)
            }
            OpKind::Call { .. } => {
                Err("hands part of the result to a call through a slot".to_owned())
            }
            OpKind::FieldSet { object, .. } | OpKind::ArraySet { array: object, .. }
                if *object == value =>
            {
                Err("writes into the result".to_owned())
            }
            OpKind::FieldSet { .. }
            | OpKind::ArraySet { .. }
            | OpKind::OpenFieldSet { .. }
            | OpKind::GlobalSet { .. } => Err("stores part of the result".to_owned()),
            OpKind::Return(_) if returning == Returning::HandsBack => Ok(false),
            OpKind::Return(_) => Err("returns part of the result".to_owned()),
            _ => Err("uses the result other than by reading it".to_owned()),
        }
    }

    /// Facts 1 and 2 for a call to `root`, read in its region's scope.
    fn body_verdict(&self, root: usize) -> Result<(), Refusal> {
        let at = |function: usize, reason: &str| Refusal {
            reason: reason.to_owned(),
            function: self.program.funcs[function].name.clone(),
        };
        for member in &self.members {
            if let Some(reason) = &self.refused[*member] {
                return Err(at(*member, reason));
            }
        }
        if !self.containers[root].is_empty() {
            return Err(at(root, "stores into an argument"));
        }
        // What it returns is the caller's to release, which is harmless only
        // on an object the region made or an immortal: an argument or a
        // global's value handed back would be released once too often.
        if !self.returns_fresh[root] {
            return Err(at(root, "may return something not made in the call"));
        }
        if self.raises[root] {
            return Err(at(root, "may raise a value it made"));
        }
        if self.appends[root] {
            return Err(at(root, "builds a string by appending"));
        }
        if !self.repeats[root] {
            return Err(at(
                root,
                "allocates too little for a region to pay for itself",
            ));
        }
        Ok(())
    }

    /// The callees' fresh parameters this function's calls refute: a slot it
    /// fills with something not made in the call.
    fn refuted_params(&self, func: &Func, fresh: &FxHashSet<ValueId>) -> Vec<(usize, u32)> {
        let mut refuted = Vec::new();
        for op in &func.values {
            if let OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } = &op.kind
                && let Some(callee) = self.callee(name)
            {
                for (slot, arg) in args.iter().enumerate() {
                    let slot = u32::try_from(slot).unwrap_or(u32::MAX);
                    if self.fresh_params[callee].contains(&slot) && !fresh.contains(arg) {
                        refuted.push((callee, slot));
                    }
                }
            }
        }
        refuted
    }

    /// Whether one operation allocates, and whether it is a call to one that
    /// allocates repeatedly.
    fn allocating(&self, kind: &OpKind) -> (bool, bool) {
        match kind {
            OpKind::ObjectNew { frame: false }
            | OpKind::ArrayNew { .. }
            | OpKind::Binary {
                op: super::BinOp::Concat,
                ..
            } => (true, false),
            OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } => self.callee(name).map_or((false, false), |callee| {
                (self.allocates[callee], self.repeats[callee])
            }),
            OpKind::Call {
                callee: Callee::External(name),
                ..
            } => (
                matches!(
                    helper(name),
                    Some(
                        Helper::Makes
                            | Helper::MakesOrRetains { .. }
                            | Helper::Copies { .. }
                            | Helper::Fills { .. }
                            | Helper::Grows { .. }
                            | Helper::Takes { .. }
                    )
                ),
                false,
            ),
            _ => (false, false),
        }
    }
}

/// What returning a value read out of the result means where it is returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Returning {
    /// In the call's caller: the result leaves the span the region covers.
    Escapes,
    /// In a callee handed part of it: the value comes back as that call's
    /// answer, which its caller goes on reading as part of the result.
    HandsBack,
}

/// The holder of a field or an element, by the type of the object holding it.
fn slot_of(func: &Func, container: ValueId, field: Option<u32>) -> Slot {
    (func.values[container.0 as usize].ty.clone(), field)
}

/// What one round finds in one body: facts 1 and 2, operation by operation.
struct Judged<'f> {
    func: &'f Func,
    fresh: &'f FxHashSet<ValueId>,
    allocates: bool,
    raises: bool,
    appends: bool,
    containers: FxHashSet<u32>,
    kept: FxHashSet<u32>,
    stale: Vec<Slot>,
    refused: Option<String>,
}

impl Judged<'_> {
    fn refuse(&mut self, reason: impl Into<String>) {
        if self.refused.is_none() {
            self.refused = Some(reason.into());
        }
    }

    /// A store's container: something the call made, or a parameter, which
    /// then becomes its callers' obligation.
    fn contain(&mut self, container: ValueId) {
        if self.fresh.contains(&container) {
            return;
        }
        let params = self.params(container);
        if !params.is_empty() {
            self.containers.extend(params);
        } else if matches!(
            self.func.values[container.0 as usize].kind,
            OpKind::FieldGet { object, .. } | OpKind::ArrayGet { array: object, .. }
                if self.fresh.contains(&object)
        ) {
            self.refuse("stores into a slot that may hold something not made in the call");
        } else {
            self.refuse("stores into something not made in the call");
        }
    }

    /// The parameter slots a value is, through the views that keep identity.
    fn params(&self, value: ValueId) -> Vec<u32> {
        let func = self.func;
        super::carried_values(func, value)
            .filter_map(|at| match func.values[at.0 as usize].kind {
                OpKind::Param(slot) => Some(slot),
                _ => None,
            })
            .collect()
    }

    /// A reference kept in a container (fact 2), and the slot it is kept in,
    /// which a read can no longer call fresh unless what is kept was.
    fn keep(&mut self, container: ValueId, field: Option<u32>, value: ValueId) {
        if !self.func.values[value.0 as usize].ty.is_counted() {
            return;
        }
        if !self.fresh.contains(&value) {
            self.refuse("stores a reference not made in the call");
        }
        let params = self.params(value);
        self.kept.extend(params);
        if !self.fresh.contains(&value) {
            self.stale.push(slot_of(self.func, container, field));
        }
    }

    fn op(&mut self, facts: &Facts<'_, '_>, kind: &OpKind) {
        match kind {
            OpKind::ObjectNew { .. } | OpKind::ArrayNew { .. } => self.allocates = true,
            OpKind::Binary {
                op: super::BinOp::Concat,
                ..
            } => {
                self.allocates = true;
                self.appends = true;
            }
            OpKind::FieldSet {
                object,
                field,
                value,
            } => {
                self.contain(*object);
                self.keep(*object, Some(*field), *value);
            }
            OpKind::ArraySet { array, value, .. } => {
                self.contain(*array);
                self.keep(*array, None, *value);
            }
            OpKind::CellReady { cell, .. } => self.contain(*cell),
            OpKind::OpenFieldSet { .. } => self.refuse("stores through an open field"),
            OpKind::GlobalSet { .. } => self.refuse("writes a global"),
            OpKind::Await { .. }
            | OpKind::Yield { .. }
            | OpKind::Suspend { .. }
            | OpKind::PromiseSubscribe { .. } => self.refuse("suspends"),
            OpKind::NativeStore { .. }
            | OpKind::NativeBitStore { .. }
            | OpKind::NativeCopy { .. }
            | OpKind::NativeMalloc { .. }
            | OpKind::NativeFree { .. }
            | OpKind::NativeBridge { .. }
            | OpKind::NativeBlock { .. } => self.refuse("touches native memory"),
            OpKind::Call { callee, args, .. } => self.call(facts, callee, args),
            _ => {}
        }
    }

    fn call(&mut self, facts: &Facts<'_, '_>, callee: &Callee, args: &[ValueId]) {
        match callee {
            Callee::Direct(name) => {
                let Some(callee) = facts.callee(name) else {
                    self.refuse("calls a function not in the program");
                    return;
                };
                self.allocates |= facts.allocates[callee];
                self.raises |= facts.raises[callee];
                self.appends |= facts.appends[callee];
                for (slot, arg) in args.iter().enumerate() {
                    let slot = u32::try_from(slot).unwrap_or(u32::MAX);
                    if facts.containers[callee].contains(&slot) {
                        self.contain(*arg);
                    }
                    if facts.kept[callee].contains(&slot) {
                        if self.func.values[arg.0 as usize].ty.is_counted()
                            && !self.fresh.contains(arg)
                        {
                            self.refuse("passes a reference not made in the call to be kept");
                        }
                        let params = self.params(*arg);
                        self.kept.extend(params);
                    }
                }
            }
            Callee::External(name) => match helper(name) {
                Some(Helper::Reads) => {}
                Some(Helper::Makes) => self.allocates = true,
                Some(Helper::MakesOrRetains { from }) => {
                    self.allocates = true;
                    // A region clone runs uncounted: the retained-input
                    // path would acquire a count no generated release
                    // balances. So inside a region the input must be made
                    // in the call or immortal (both are `fresh` here) --
                    // refused even if the result is only read and dropped,
                    // until an external-edge ownership protocol exists.
                    if facts.in_region
                        && let Some(input) = args.get(from)
                        && self.func.values[input.0 as usize].ty.is_counted()
                        && !self.fresh.contains(input)
                    {
                        self.refuse(format!(
                            "may retain through `{name}` a reference not made in the call"
                        ));
                    }
                }
                Some(Helper::Copies { from }) => {
                    self.allocates = true;
                    if let Some(source) = args.get(from)
                        && matches!(&self.func.values[source.0 as usize].ty,
                            HirType::Managed(super::ManagedType::Array(element)) if element.may_hold_a_reference())
                        && !self.fresh.contains(source)
                    {
                        self.refuse("copies references from outside the call");
                    }
                }
                Some(Helper::Fills { into }) => {
                    self.allocates = true;
                    if let Some(container) = args.get(into).copied() {
                        self.contain(container);
                        for (slot, arg) in args.iter().enumerate() {
                            if slot != into {
                                self.keep(container, None, *arg);
                            }
                        }
                    }
                }
                Some(Helper::Grows { into: at } | Helper::Takes { from: at }) => {
                    self.allocates = true;
                    self.appends |= name == "nts_str_append";
                    if let Some(container) = args.get(at).copied() {
                        self.contain(container);
                    }
                }
                Some(Helper::Raises) => self.raises = true,
                None => self.refuse(format!("calls `{name}`")),
            },
            Callee::Native(_) => self.refuse("calls native code"),
            Callee::Virtual { .. } | Callee::Closure { .. } => self.refuse("calls through a slot"),
        }
    }
}

/// A call a region serves: what the rewrite needs to know about it.
#[derive(Debug, Clone)]
struct Site {
    caller: usize,
    call: ValueId,
    root: usize,
    /// The root's parameter slots whose argument it keeps (fact 2).
    kept: Vec<u32>,
    /// The result and everything read out of it in the caller (fact 3).
    read: Vec<ValueId>,
    /// Where the caller holds the handle.
    holds: Vec<Hold>,
    /// What a call to the root can run, the root first.
    members: Vec<usize>,
}

/// Which calls in `program` a region could serve.
#[must_use]
pub fn analyze(program: &Program) -> Report {
    judge(program).0
}

fn judge(program: &Program) -> (Report, Vec<Site>) {
    let shared = Shared::new(program);
    let mut whole = Facts::new(&shared, Scope::Program);
    whole.settle();
    // One scope per callee, shared by every call to it.
    let mut regions: FxHashMap<usize, (Facts<'_, '_>, Vec<usize>)> = FxHashMap::default();
    let mut report = Report::default();
    let mut sites = Vec::new();
    for (caller, func) in program.funcs.iter().enumerate() {
        let mut flow: Option<Result<Flow, super::liveness::Failure>> = None;
        for block in &func.blocks {
            for call in &block.ops {
                let op = &func.values[call.0 as usize];
                let OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } = &op.kind
                else {
                    continue;
                };
                let Some(root) = whole.callee(name) else {
                    continue;
                };
                if !op.ty.is_counted() || !whole.allocates[root] {
                    continue;
                }
                report.candidates += 1;
                let (region, members) = regions.entry(root).or_insert_with(|| {
                    let members = shared.members(root);
                    let mut facts = Facts::new(
                        &shared,
                        Scope::Region {
                            root,
                            members: &members,
                        },
                    );
                    facts.settle();
                    (facts, members)
                });
                let read = region.body_verdict(root).and_then(|()| {
                    whole
                        .only_read(caller, &[*call], Returning::Escapes)
                        .map_err(|reason| Refusal {
                            reason,
                            function: func.name.clone(),
                        })
                });
                let read = read.and_then(|read| {
                    let flow = flow.get_or_insert_with(|| {
                        Flow::of(func).map_err(super::liveness::Failure::for_optional)
                    });
                    flow.as_ref()
                        .map_err(|failure| Refusal {
                            reason: failure.to_string(),
                            function: func.name.clone(),
                        })?
                        .holds(*call, &read)
                        .map(|holds| (read, holds))
                        .map_err(|reason| Refusal {
                            reason: reason.to_owned(),
                            function: func.name.clone(),
                        })
                });
                let verdict = read.as_ref().map(|_| ()).map_err(Clone::clone);
                match read {
                    Ok((read, holds)) => {
                        report.sites += 1;
                        let mut kept: Vec<u32> = region.kept[root].iter().copied().collect();
                        kept.sort_unstable();
                        sites.push(Site {
                            caller,
                            call: *call,
                            root,
                            kept,
                            read,
                            holds,
                            members: members.clone(),
                        });
                    }
                    Err(refusal) => *report.refused.entry(refusal.reason).or_default() += 1,
                }
                report.calls.push(Candidate {
                    caller: func.name.clone(),
                    callee: name.clone(),
                    verdict,
                });
            }
        }
    }
    (report, sites)
}

/// A caller's liveness and dominators, for where a served call's handle is
/// held.
struct Flow {
    live: super::liveness::Liveness,
    idom: Vec<Option<BlockId>>,
    block_of: FxHashMap<ValueId, usize>,
    /// What each block's terminator hands along its edges.
    handed_on: Vec<Vec<ValueId>>,
    predecessors: Vec<Vec<usize>>,
}

/// Where a served call's handle is held.
#[derive(Debug, Clone, Copy)]
enum Hold {
    /// After the block's last operation reading the result.
    After(usize),
    /// First thing in the block, where the result died on the edge in.
    OnEntry(usize),
}

impl Flow {
    fn of(func: &Func) -> Result<Self, super::liveness::Failure> {
        let reachable = super::verify::reachable_blocks(func);
        let mut block_of = FxHashMap::default();
        for (index, block) in func.blocks.iter().enumerate() {
            for op in &block.ops {
                block_of.insert(*op, index);
            }
        }
        Ok(Self {
            live: super::liveness::analyze(func)?,
            idom: super::verify::dominators(func, &reachable),
            block_of,
            handed_on: func
                .blocks
                .iter()
                .map(|block| handed_on(&block.terminator))
                .collect(),
            predecessors: {
                let mut into = vec![Vec::new(); func.blocks.len()];
                for (index, block) in func.blocks.iter().enumerate() {
                    for target in block.terminator.successors() {
                        into[target.0 as usize].push(index);
                    }
                }
                into
            },
        })
    }

    /// Whether something read out of the result outlives a block: live out of
    /// it, or handed along one of its edges -- which liveness counts as the
    /// terminator's read, not as live out.
    fn outlives(&self, index: usize, here: BlockId, read: &FxHashSet<ValueId>) -> bool {
        self.live
            .live_out(here)
            .iter()
            .any(|value| read.contains(value))
            || self.handed_on[index]
                .iter()
                .any(|value| read.contains(value))
    }

    fn dominates(&self, over: usize, block: usize) -> bool {
        let mut at = Some(BlockId(u32::try_from(block).unwrap_or(u32::MAX)));
        while let Some(here) = at {
            if here.0 as usize == over {
                return true;
            }
            at = self.idom[here.0 as usize];
        }
        false
    }

    /// Where a handle made at `call` is held: in each block where something
    /// read out of the result is last alive -- after the block's last reader
    /// of it, or on entry where it died along the edge in. Refused unless the
    /// call dominates every block such a value is in, so the handle is defined
    /// on every path to a hold, and unless the values die somewhere.
    fn holds(&self, call: ValueId, read: &[ValueId]) -> Result<Vec<Hold>, &'static str> {
        let Some(home) = self.block_of.get(&call).copied() else {
            return Err("the call is in no block");
        };
        let read: FxHashSet<ValueId> = read.iter().copied().collect();
        let mut holds = Vec::new();
        for index in 0..self.idom.len() {
            let here = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
            let present = self
                .live
                .available(here)
                .iter()
                .any(|value| read.contains(value));
            if present {
                if !self.dominates(home, index) {
                    return Err("what is read out of the result meets a value from another path");
                }
                if !self.outlives(index, here, &read) {
                    holds.push(Hold::After(index));
                }
            } else if self.dominates(home, index)
                && self.predecessors[index].iter().any(|from| {
                    self.outlives(
                        *from,
                        BlockId(u32::try_from(*from).unwrap_or(u32::MAX)),
                        &read,
                    )
                })
            {
                holds.push(Hold::OnEntry(index));
            }
        }
        if holds.is_empty() {
            Err("what is read out of the result never dies")
        } else {
            Ok(holds)
        }
    }
}

/// Whether an operation ends a served call's region window
/// (`nts_region_end_call`), which nothing may come between the call and.
#[must_use]
pub(super) fn ends_a_call(kind: &OpKind) -> bool {
    matches!(
        kind,
        OpKind::Call {
            callee: Callee::External(name),
            ..
        } if name == "nts_region_end_call"
    )
}

/// Whether every reference a function returns is among `fresh`.
fn returns_only(func: &Func, fresh: &FxHashSet<ValueId>) -> bool {
    func.blocks.iter().all(|block| match block.terminator {
        Terminator::Return(Some(value)) => {
            !func.values[value.0 as usize].ty.is_counted() || fresh.contains(&value)
        }
        _ => true,
    })
}

/// The values a terminator passes along its edges.
fn handed_on(terminator: &Terminator) -> Vec<ValueId> {
    match terminator {
        Terminator::Jump { args, .. } => args.clone(),
        Terminator::Branch {
            then_args,
            else_args,
            ..
        } => then_args.iter().chain(else_args).copied().collect(),
        _ => Vec::new(),
    }
}

/// What a region's clone of a function is called.
pub const CLONE_SUFFIX: &str = "#region";

/// Whether a function is a region's clone: compiled with nothing counted,
/// because everything it makes is the region's and everything else it only
/// reads (`rc::insert` passes it by).
#[must_use]
pub fn is_clone(name: &str) -> bool {
    name.ends_with(CLONE_SUFFIX)
}

/// Serve every call a region can (R3): clone what each call can run, with
/// nothing counted, and around each call open a region behind a counted
/// handle that the caller holds where the result is last read.
///
/// Returns the report the sites were chosen from.
pub fn rewrite(program: &mut Program) -> Report {
    let (report, sites) = judge(program);
    if sites.is_empty() {
        return report;
    }
    // One clone per function any served call can run, shared by every site:
    // a clone retargets its calls to clones, and every call a member makes is
    // to a member.
    let mut cloned: Vec<usize> = sites
        .iter()
        .flat_map(|site| site.members.iter().copied())
        .collect();
    cloned.sort_unstable();
    cloned.dedup();
    let names: FxHashSet<String> = cloned
        .iter()
        .map(|member| program.funcs[*member].name.clone())
        .collect();
    for member in &cloned {
        let mut clone = program.funcs[*member].clone();
        clone.name.push_str(CLONE_SUFFIX);
        clone.exported = false;
        for op in &mut clone.values {
            if let OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } = &mut op.kind
                && names.contains(name.as_str())
            {
                name.push_str(CLONE_SUFFIX);
            }
        }
        program.funcs.push(clone);
    }
    let mut by_caller: FxHashMap<usize, Vec<&Site>> = FxHashMap::default();
    for site in &sites {
        by_caller.entry(site.caller).or_default().push(site);
    }
    for (caller, at_sites) in by_caller {
        let root_names: Vec<String> = at_sites
            .iter()
            .map(|site| program.funcs[site.root].name.clone())
            .collect();
        let func = &mut program.funcs[caller];
        for (site, root) in at_sites.into_iter().zip(root_names) {
            serve(func, site, &root);
        }
    }
    report
}

/// One call, served: `begin`, `keep` for each kept argument, the clone, `end`
/// right after it -- before a raise is tested -- and a `hold` in each block
/// where what was read out of the result is last alive.
fn serve(func: &mut Func, site: &Site, root: &str) {
    let origin = func.values[site.call.0 as usize].origin.clone();
    let push = |func: &mut Func, kind: OpKind, ty: HirType| -> ValueId {
        let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
        func.values.push(super::Op {
            kind,
            ty,
            origin: origin.clone(),
        });
        id
    };
    let runtime = |name: &str, args: Vec<ValueId>| OpKind::Call {
        callee: Callee::External(name.to_owned()),
        args,
        frame: None,
    };
    let handle = push(
        func,
        runtime("nts_region_begin", Vec::new()),
        HirType::Managed(super::ManagedType::Region),
    );
    let OpKind::Call { args, .. } = &func.values[site.call.0 as usize].kind else {
        return;
    };
    let kept: Vec<ValueId> = site
        .kept
        .iter()
        .filter_map(|slot| args.get(*slot as usize).copied())
        .filter(|arg| func.values[arg.0 as usize].ty.is_counted())
        .collect();
    let mut before = vec![handle];
    for arg in kept {
        before.push(push(
            func,
            runtime("nts_region_keep", vec![handle, arg]),
            HirType::Void,
        ));
    }
    let end = push(
        func,
        runtime("nts_region_end_call", vec![handle]),
        HirType::Void,
    );
    if let OpKind::Call {
        callee: Callee::Direct(name),
        ..
    } = &mut func.values[site.call.0 as usize].kind
    {
        *name = format!("{root}{CLONE_SUFFIX}");
    }
    for block in &mut func.blocks {
        if let Some(at) = block.ops.iter().position(|op| *op == site.call) {
            block.ops.insert(at + 1, end);
            for (offset, op) in before.iter().enumerate() {
                block.ops.insert(at + offset, *op);
            }
            break;
        }
    }
    // The holds: in each block where something read out of the result is
    // present and none of it outlives the block, after the last operation that
    // reads it. Reference counting releases the handle after the last hold on
    // each path, and that release is the reset.
    let read: FxHashSet<ValueId> = site.read.iter().copied().collect();
    for place in &site.holds {
        let hold = push(
            func,
            runtime("nts_region_hold", vec![handle]),
            HirType::Void,
        );
        let (index, at) = match *place {
            Hold::OnEntry(index) => (index, 0),
            Hold::After(index) => {
                let last = func.blocks[index].ops.iter().rposition(|op| {
                    super::verify::operands(&func.values[op.0 as usize].kind)
                        .iter()
                        .any(|operand| read.contains(operand))
                        || *op == site.call
                        || *op == end
                });
                (index, last.map_or(0, |last| last + 1))
            }
        };
        func.blocks[index].ops.insert(at, hold);
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Block, ManagedType, Op, Param, TypeId};
    use super::*;
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }
    fn object() -> HirType {
        HirType::Managed(ManagedType::Object(TypeId(1)))
    }
    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }
    fn func(name: &str, values: Vec<Op>, returned: ValueId) -> Func {
        let ops = (0..values.len())
            .map(|v| ValueId(u32::try_from(v).unwrap_or(u32::MAX)))
            .collect();
        Func {
            name: name.to_owned(),
            params: vec![Param {
                name: "arg".to_owned(),
                ty: object(),
                origin: origin(),
                known: super::super::facts::Facts::TOP,
                written: None,
                shape: super::super::ParamShape::Ordinary,
            }],
            return_type: values[returned.0 as usize].ty.clone(),
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: Terminator::Return(Some(returned)),
            }],
            origin: origin(),
            exported: false,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            exact: FxHashMap::default(),
            written_return: None,
            result_absent: super::super::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    #[test]
    fn freshness_crosses_long_chains_and_budget_exhaustion_refuses() {
        let funcs = (0..320)
            .map(|at| {
                let mut values = vec![op(OpKind::Param(0), object())];
                let result = if at == 319 {
                    ValueId(0)
                } else {
                    values.push(op(
                        OpKind::Call {
                            callee: Callee::Direct(format!("f{}", at + 1)),
                            args: vec![ValueId(0)],
                            frame: None,
                        },
                        object(),
                    ));
                    ValueId(1)
                };
                func(&format!("f{at}"), values, result)
            })
            .collect();
        let program = Program {
            funcs,
            ..Program::default()
        };
        let shared = Shared::new(&program);
        let mut facts = Facts::new(&shared, Scope::Program);
        facts.settle();
        assert!(facts.returns_fresh.iter().all(|fresh| !fresh));
        let mut limited = Facts::new(&shared, Scope::Program);
        limited.settle_with_budget(1);
        assert!(limited.refused.iter().all(Option::is_some));
        assert!(limited.returns_fresh.iter().all(|fresh| !fresh));
        assert!(limited.reads_only.iter().all(FxHashSet::is_empty));
    }

    #[test]
    fn a_region_cannot_keep_external_references_even_if_the_caller_keeps_them_alive() {
        for helper in [
            "nts_array_push_ref",
            "nts_array_unshift_ref",
            "nts_map_set",
            "nts_set_add",
        ] {
            for fresh in [false, true] {
                let values = vec![
                    op(OpKind::Param(0), object()),
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(OpKind::ObjectNew { frame: false }, object()),
                    op(
                        OpKind::Call {
                            callee: Callee::External(helper.to_owned()),
                            args: vec![ValueId(1), if fresh { ValueId(2) } else { ValueId(0) }],
                            frame: None,
                        },
                        HirType::Void,
                    ),
                ];
                let program = Program {
                    funcs: vec![func("root", values, ValueId(1))],
                    ..Program::default()
                };
                let shared = Shared::new(&program);
                let mut facts = Facts::new(
                    &shared,
                    Scope::Region {
                        root: 0,
                        members: &[0],
                    },
                );
                facts.settle();
                assert_eq!(
                    facts.refused[0].is_some(),
                    !fresh,
                    "{helper}, fresh={fresh}"
                );
            }
        }
    }

    #[test]
    fn copying_reference_elements_is_not_a_read_only_use_of_a_region_result() {
        for element in [object(), HirType::NUMBER] {
            let references = element.may_hold_a_reference();
            let array = HirType::Managed(ManagedType::Array(Box::new(element)));
            let values = vec![
                op(OpKind::Param(0), array.clone()),
                op(
                    OpKind::Call {
                        callee: Callee::External("nts_array_slice".to_owned()),
                        args: vec![ValueId(0)],
                        frame: None,
                    },
                    array,
                ),
            ];
            let program = Program {
                funcs: vec![func("copy", values, ValueId(1))],
                ..Program::default()
            };
            let shared = Shared::new(&program);
            let mut facts = Facts::new(&shared, Scope::Program);
            facts.settle();
            assert_eq!(facts.reads_only[0].contains(&0), !references);
        }
    }

    #[test]
    fn a_shallow_copy_does_not_make_external_elements_region_owned() {
        let array = HirType::Managed(ManagedType::Array(Box::new(object())));
        let values = vec![
            op(OpKind::Param(0), array.clone()),
            op(
                OpKind::Call {
                    callee: Callee::External("nts_array_slice".to_owned()),
                    args: vec![ValueId(0)],
                    frame: None,
                },
                array,
            ),
        ];
        let program = Program {
            funcs: vec![func("copy", values, ValueId(1))],
            ..Program::default()
        };
        let shared = Shared::new(&program);
        let mut facts = Facts::new(
            &shared,
            Scope::Region {
                root: 0,
                members: &[0],
            },
        );
        facts.settle();
        assert!(facts.refused[0].is_some());
        assert!(!facts.returns_fresh[0]);
    }
}
