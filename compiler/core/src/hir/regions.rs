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
//! 2. **Everything a region object points at outside outlives the reset.** What
//!    is stored into one is made inside the call, immortal (a literal, frame
//!    storage), a settled global's value, or an argument -- which `g` keeps
//!    alive to the reset.
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

use std::collections::BTreeMap;

use rustc_hash::{FxHashMap, FxHashSet};

use super::{BlockId, Callee, Func, HirType, OpKind, Program, Terminator, ValueId};

/// Which calls a region could serve, and why each other candidate cannot.
#[derive(Debug, Clone, Default)]
pub struct Report {
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
        | "nts_str_to_lower_case"
        | "nts_str_to_upper_case"
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
        | "nts_array_slice"
        | "nts_array_join_str" => Helper::Makes,
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

/// What every scope reads and none refines: the program, its names, its
/// settled globals and each function's uses.
struct Shared<'p> {
    program: &'p Program,
    by_name: FxHashMap<&'p str, usize>,
    settled: FxHashSet<u32>,
    uses: Vec<Uses>,
}

impl<'p> Shared<'p> {
    fn new(program: &'p Program) -> Self {
        Self {
            program,
            by_name: program
                .funcs
                .iter()
                .enumerate()
                .map(|(at, func)| (func.name.as_str(), at))
                .collect(),
            settled: super::own::settled_globals(program),
            uses: program.funcs.iter().map(Uses::of).collect(),
        }
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
            for op in &self.program.funcs[at].values {
                if let OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } = &op.kind
                    && let Some(callee) = self.by_name.get(name.as_str())
                {
                    pending.push(*callee);
                }
            }
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
        Self {
            shared,
            program,
            members,
            fresh_params,
            returns_fresh: vec![true; count],
            allocates: vec![false; count],
            raises: vec![false; count],
            containers: vec![FxHashSet::default(); count],
            kept: vec![FxHashSet::default(); count],
            stale: FxHashSet::default(),
            refused: vec![None; count],
            reads_only: (0..count).map(params).collect(),
        }
    }

    /// Refine until nothing moves. Each round moves at least one fact one step
    /// in its one direction, and there are finitely many; the bound only guards
    /// against a mistake here.
    fn settle(&mut self) {
        for _ in 0..256 {
            let mut changed = false;
            for index in 0..self.members.len() {
                let at = self.members[index];
                changed |= self.refine(at);
            }
            if !changed {
                break;
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
                | OpKind::ConstUndefined => true,
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
            | OpKind::Unerase { value: inner }
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
                Some(Helper::Fills { into } | Helper::Grows { into }) => {
                    args.get(into).is_some_and(|arg| fresh.contains(arg))
                }
                Some(Helper::Takes { from }) => args.get(from).is_some_and(|arg| {
                    fresh.contains(arg) && !self.stale.contains(&slot_of(func, *arg, None))
                }),
                _ => true,
            },
            _ => true,
        }
    }

    /// Values a region object may point at (fact 2): what the call made, an
    /// immortal, a settled global's value, a parameter -- which the call's
    /// callers answer for -- or a value that is not a reference at all.
    fn allowed(&self, at: usize, fresh: &FxHashSet<ValueId>) -> FxHashSet<ValueId> {
        let func = &self.program.funcs[at];
        let uses = &self.shared.uses[at];
        let mut allowed: FxHashSet<ValueId> = FxHashSet::default();
        for (index, op) in func.values.iter().enumerate() {
            let value = ValueId(u32::try_from(index).unwrap_or(u32::MAX));
            let base = !op.ty.is_counted()
                || fresh.contains(&value)
                || match &op.kind {
                    OpKind::ConstString(_)
                    | OpKind::ConstTemplate { .. }
                    | OpKind::ClosureStatic
                    | OpKind::ConstNull
                    | OpKind::ConstUndefined
                    | OpKind::Param(_)
                    | OpKind::Erase { .. }
                    | OpKind::Unerase { .. }
                    | OpKind::Convert(_)
                    | OpKind::FieldView { .. }
                    | OpKind::BlockParam(_) => true,
                    OpKind::GlobalGet(global) => self.shared.settled.contains(global),
                    _ => false,
                };
            if base {
                allowed.insert(value);
            }
        }
        loop {
            let before = allowed.len();
            let kept: FxHashSet<ValueId> = allowed
                .iter()
                .copied()
                .filter(|value| {
                    let op = &func.values[value.0 as usize];
                    if !op.ty.is_counted() || fresh.contains(value) {
                        return true;
                    }
                    match &op.kind {
                        OpKind::Erase { value: inner, .. }
                        | OpKind::Unerase { value: inner }
                        | OpKind::Convert(inner)
                        | OpKind::FieldView { value: inner, .. } => allowed.contains(inner),
                        OpKind::BlockParam(_) => uses.param_at.get(value).is_some_and(|at| {
                            uses.incoming.get(at).is_some_and(|incoming| {
                                incoming.iter().all(|arg| allowed.contains(arg))
                            })
                        }),
                        _ => true,
                    }
                })
                .collect();
            allowed = kept;
            if allowed.len() == before {
                return allowed;
            }
        }
    }

    /// One round over one function: what it returns, allocates, raises, stores
    /// into and is refused for. Returns whether anything moved.
    fn refine(&mut self, at: usize) -> bool {
        let program = self.program;
        let func = &program.funcs[at];
        let fresh = self.fresh(at);
        let allowed = self.allowed(at, &fresh);
        let mut judged = Judged {
            func,
            fresh: &fresh,
            allowed: &allowed,
            allocates: false,
            raises: false,
            containers: self.containers[at].clone(),
            kept: self.kept[at].clone(),
            stale: Vec::new(),
            refused: None,
        };
        for block in &func.blocks {
            for op in &block.ops {
                judged.op(self, &func.values[op.0 as usize].kind);
            }
        }
        let mut refuted: Vec<(usize, u32)> = Vec::new();
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
        let returns_fresh = func.blocks.iter().all(|block| match block.terminator {
            Terminator::Return(Some(value)) => {
                !func.values[value.0 as usize].ty.is_counted() || fresh.contains(&value)
            }
            _ => true,
        });
        let reads_only = self.reads_only_params(at);
        let Judged {
            allocates,
            raises,
            containers,
            kept,
            stale,
            refused,
            ..
        } = judged;

        let mut changed = false;
        for (callee, slot) in refuted {
            changed |= self.fresh_params[callee].remove(&slot);
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
        if containers.len() != self.containers[at].len() {
            self.containers[at] = containers;
            changed = true;
        }
        if kept.len() != self.kept[at].len() {
            self.kept[at] = kept;
            changed = true;
        }
        for slot in stale {
            changed |= self.stale.insert(slot);
        }
        if self.refused[at].is_none() && refused.is_some() {
            self.refused[at] = refused;
            changed = true;
        }
        if reads_only.len() != self.reads_only[at].len() {
            self.reads_only[at] = reads_only;
            changed = true;
        }
        changed
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
    fn only_read(&self, at: usize, starts: &[ValueId], returning: Returning) -> Result<(), String> {
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
        Ok(())
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
                Some(
                    Helper::Fills { into: at }
                    | Helper::Grows { into: at }
                    | Helper::Takes { from: at },
                ) if args.get(at) == Some(&value) => Err("writes into the result".to_owned()),
                Some(Helper::Fills { .. }) => Err("stores part of the result".to_owned()),
                Some(Helper::Makes | Helper::Grows { .. } | Helper::Takes { .. }) => Ok(false),
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
        // Not that it returns something it made: what it returns is read and
        // then dropped by the caller (fact 3) whatever it is, and a result that
        // is an argument or a literal is only a region with less in it.
        Ok(())
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
    allowed: &'f FxHashSet<ValueId>,
    allocates: bool,
    raises: bool,
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
        if !self.allowed.contains(&value) {
            self.refuse("stores a value read from outside the call");
        }
        let params = self.params(value);
        self.kept.extend(params);
        if !self.fresh.contains(&value) {
            self.stale.push(slot_of(self.func, container, field));
        }
    }

    fn op(&mut self, facts: &Facts<'_, '_>, kind: &OpKind) {
        match kind {
            OpKind::ObjectNew { .. }
            | OpKind::ArrayNew { .. }
            | OpKind::Binary {
                op: super::BinOp::Concat,
                ..
            } => self.allocates = true,
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
                for (slot, arg) in args.iter().enumerate() {
                    let slot = u32::try_from(slot).unwrap_or(u32::MAX);
                    if facts.containers[callee].contains(&slot) {
                        self.contain(*arg);
                    }
                    if facts.kept[callee].contains(&slot) {
                        if !self.allowed.contains(arg) {
                            self.refuse("passes a value read from outside the call to be kept");
                        }
                        let params = self.params(*arg);
                        self.kept.extend(params);
                    }
                }
            }
            Callee::External(name) => match helper(name) {
                Some(Helper::Reads) => {}
                Some(Helper::Makes) => self.allocates = true,
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

/// Which calls in `program` a region could serve.
#[must_use]
pub fn analyze(program: &Program) -> Report {
    let shared = Shared::new(program);
    let mut whole = Facts::new(&shared, Scope::Program);
    whole.settle();
    // One scope per callee, shared by every call to it.
    let mut regions: FxHashMap<usize, Facts<'_, '_>> = FxHashMap::default();
    let mut report = Report::default();
    for (caller, func) in program.funcs.iter().enumerate() {
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
                let region = regions.entry(root).or_insert_with(|| {
                    let members = shared.members(root);
                    let mut facts = Facts::new(
                        &shared,
                        Scope::Region {
                            root,
                            members: &members,
                        },
                    );
                    facts.settle();
                    facts
                });
                let verdict = region.body_verdict(root).and_then(|()| {
                    whole
                        .only_read(caller, &[*call], Returning::Escapes)
                        .map_err(|reason| Refusal {
                            reason,
                            function: func.name.clone(),
                        })
                });
                match &verdict {
                    Ok(()) => {
                        report.sites += 1;
                        if region.raises[root] {
                            report.raising += 1;
                        }
                    }
                    Err(refusal) => *report.refused.entry(refusal.reason.clone()).or_default() += 1,
                }
                report.calls.push(Candidate {
                    caller: func.name.clone(),
                    callee: name.clone(),
                    verdict,
                });
            }
        }
    }
    report
}
