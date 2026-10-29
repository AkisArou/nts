//! A closed direct-call convention for a linear, unpublished string carrier.
//!
//! Ownership transfer is a prerequisite, not a uniqueness proof. The local
//! proof checks every version's last use; the caller pass checks each real
//! ingress with that same proof. No field, closure, foreign or public ABI is
//! changed. Recursive families are never admitted optimistically.

use std::collections::{BTreeMap, VecDeque};

use rustc_hash::FxHashMap;

use crate::hir::{Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, ValueId};

mod continuations;

/// Why a string-returning function with string parameters kept its normal ABI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejection {
    /// A public entry keeps the language's immutable-string contract.
    PublicAbi,
    /// Shared ownership/ingress analysis does not transfer a string parameter.
    NoTransfer,
    /// No proved parameter is returned as one linear, unpublished carrier.
    UnprovedChain,
    /// At least one actual caller cannot relinquish its old immutable version.
    UnprovedCaller,
    /// The bounded work budget was exhausted; no optimistic answer is kept.
    Budget,
    /// A bounded graph analysis did not converge to a complete answer.
    IncompleteGraph,
    /// A language exception or unknown continuation has no ownership adapter.
    UnsupportedContinuation,
}

/// Backend-neutral carrier slots, with an explicit rejected-family census.
#[derive(Debug, Default)]
pub struct Plan<'a> {
    parameters: BTreeMap<String, u32>,
    rejected: BTreeMap<String, Rejection>,
    values: BTreeMap<String, (&'a Func, rustc_hash::FxHashSet<ValueId>)>,
    graph_units: usize,
    graph_limit: usize,
}

fn is_string(ty: &HirType) -> bool {
    *ty == HirType::Managed(ManagedType::String)
}

fn candidate(func: &Func) -> bool {
    is_string(&func.return_type) && func.params.iter().any(|param| is_string(&param.ty))
}

impl<'a> Plan<'a> {
    /// Prove a bounded, monotone set of closed linear writer families.
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        Self::build(program, GraphBudget::new(program))
    }

    fn build(program: &'a Program, mut graph: GraphBudget) -> Self {
        let candidates: Vec<_> = program
            .funcs
            .iter()
            .filter(|func| candidate(func))
            .collect();
        if candidates.is_empty() {
            return Self::default();
        }
        if candidates
            .iter()
            .all(|func| func.exported || func.abstract_declaration || func.blocks.is_empty())
        {
            let rejected = candidates
                .iter()
                .map(|func| {
                    (
                        func.name.clone(),
                        if func.exported {
                            Rejection::PublicAbi
                        } else {
                            Rejection::NoTransfer
                        },
                    )
                })
                .collect();
            return Self {
                rejected,
                ..Self::default()
            };
        }
        let summaries = super::super::own::summarize(program, &program.layouts);
        let mut plan = Self {
            graph_limit: graph.left,
            ..Self::default()
        };
        plan.rejected.extend(
            candidates
                .iter()
                .map(|func| (func.name.clone(), Rejection::UnprovedChain)),
        );
        let Some(quiet) = continuations::quiet(program, &mut graph) else {
            return exhausted(plan, &graph);
        };
        let mut schedule = Schedule::new(&candidates, &summaries, &quiet, &mut plan);
        // A coarse scheduling charge, not actual inner work or wall time.
        // The local liveness/reachability walks are separately bounded; their
        // actual work accounting must remain distinct from this retry bound.
        // Exhausting scheduling never enables representation.
        let mut budget = program
            .funcs
            .iter()
            .map(|func| func.values.len().saturating_add(1))
            .sum::<usize>()
            .saturating_mul(8);
        while let Some(index) = schedule.pending.pop_front() {
            schedule.queued[index] = false;
            let func = candidates[index];
            if plan.parameters.contains_key(&func.name) {
                continue;
            }
            let Some(slots) = summaries.consumes(&func.name) else {
                continue;
            };
            let mut slots: Vec<_> = slots.iter().copied().collect();
            slots.sort_unstable();
            for slot in slots {
                if !spend(&mut budget, func) {
                    return exhausted(plan, &graph);
                }
                let Some(proved) = plan.proves(func, slot, &mut graph) else {
                    if graph.exhausted {
                        return exhausted(plan, &graph);
                    }
                    plan.rejected
                        .insert(func.name.clone(), Rejection::IncompleteGraph);
                    continue;
                };
                if proved {
                    plan.parameters.insert(func.name.clone(), slot);
                    plan.rejected.remove(&func.name);
                    if let Some(readers) = schedule.dependents.get(func.name.as_str()) {
                        for &reader in readers {
                            if !schedule.queued[reader] {
                                schedule.queued[reader] = true;
                                schedule.pending.push_back(reader);
                            }
                        }
                    }
                    break;
                }
            }
        }
        plan.check_callers(program, budget, graph, &quiet)
    }

    /// The one carrier parameter selected for a proved private direct target.
    #[must_use]
    fn parameter(&self, name: &str) -> Option<u32> {
        self.parameters.get(name).copied()
    }

    /// A proved parameter of this exact function in the borrowed program.
    /// Names locate a target; they never authorize reuse in another IR arena.
    #[must_use]
    pub fn parameter_of(&self, func: &Func) -> Option<u32> {
        let (subject, _) = self.values.get(&func.name)?;
        std::ptr::eq(*subject, func)
            .then(|| self.parameter(&func.name))
            .flatten()
    }

    /// Values which may share a private carrier in this exact function.
    #[must_use]
    pub fn values_in(&self, func: &Func) -> Option<rustc_hash::FxHashSet<ValueId>> {
        match self.values.get(&func.name) {
            Some((subject, values)) if std::ptr::eq(*subject, func) => Some(values.clone()),
            _ => None,
        }
    }

    /// Conservative graph/set work reservations used and available, not CPU or instructions.
    #[must_use]
    pub const fn graph_work(&self) -> (usize, usize) {
        (self.graph_units, self.graph_limit)
    }

    /// Deterministic proof census; no generated-name classification is involved.
    pub fn admitted(&self) -> impl Iterator<Item = (&str, u32)> {
        self.parameters
            .iter()
            .map(|(name, slot)| (name.as_str(), *slot))
    }

    /// Deterministic reasons for keeping the immutable-string ABI.
    pub fn rejected(&self) -> impl Iterator<Item = (&str, Rejection)> {
        self.rejected
            .iter()
            .map(|(name, why)| (name.as_str(), *why))
    }

    fn proves(&self, func: &Func, slot: u32, graph: &mut GraphBudget) -> Option<bool> {
        if !func
            .params
            .get(slot as usize)
            .is_some_and(|param| is_string(&param.ty))
        {
            return Some(false);
        }
        let Some(parameter) = func
            .parameter_values()
            .and_then(|params| params.get(slot as usize).copied().flatten())
        else {
            return Some(false);
        };
        let analysis = super::analyze_limited(
            func,
            &|name| self.parameter(name),
            Some(slot),
            &mut |units| graph.take(units),
        )?;
        Some(returned_carrier(func, parameter, &analysis))
    }

    fn check_callers(
        mut self,
        program: &'a Program,
        mut budget: usize,
        mut graph: GraphBudget,
        quiet: &rustc_hash::FxHashSet<&str>,
    ) -> Self {
        loop {
            if self.parameters.is_empty() {
                self.graph_units = graph.charged;
                return self;
            }
            let mut invalid = BTreeMap::new();
            let mut frozen = BTreeMap::new();
            for func in &program.funcs {
                if !spend(&mut budget, func) {
                    return exhausted(self, &graph);
                }
                let Some(analysis) = super::analyze_limited(
                    func,
                    &|name| self.parameter(name),
                    self.parameter(&func.name),
                    &mut |units| graph.take(units),
                ) else {
                    if graph.exhausted {
                        return exhausted(self, &graph);
                    }
                    return incomplete(self, &graph);
                };
                for op in &func.values {
                    if let OpKind::Call {
                        callee: Callee::Direct(name),
                        args,
                        ..
                    } = &op.kind
                        && let Some(slot) = self.parameter(name)
                    {
                        if !quiet.contains(func.name.as_str()) {
                            invalid.insert(name.clone(), Rejection::UnsupportedContinuation);
                        } else if !args
                            .get(slot as usize)
                            .is_some_and(|value| analysis.held.contains(value))
                        {
                            invalid.insert(name.clone(), Rejection::UnprovedCaller);
                        }
                    }
                }
                if let Some(slot) = self.parameter(&func.name) {
                    let parameter = func
                        .parameter_values()
                        .and_then(|values| values.get(slot as usize).copied().flatten());
                    if !parameter
                        .is_some_and(|parameter| returned_carrier(func, parameter, &analysis))
                    {
                        invalid.insert(func.name.clone(), Rejection::UnprovedChain);
                    }
                }
                frozen.insert(func.name.clone(), (func, analysis.held));
            }
            if invalid.is_empty() {
                // This exact completed analysis proves callers and returns and
                // becomes the render plan; freezing does not rerun the proof.
                self.values = frozen;
                self.graph_units = graph.charged;
                return self;
            }
            for (name, why) in invalid {
                self.parameters.remove(&name);
                self.rejected.insert(name, why);
            }
        }
    }
}

/// The same incoming carrier reaches every normal return. Unsupported error
/// continuations have already been excluded by the closure/edge adapter.
fn returned_carrier(func: &Func, parameter: ValueId, analysis: &super::Analysis) -> bool {
    if !analysis.held.contains(&parameter) {
        return false;
    }
    let root = analysis.roots[parameter.0 as usize];
    let mut returned = false;
    for block in &func.blocks {
        if let Terminator::Return(value) = block.terminator {
            let Some(value) = value else {
                return false;
            };
            if !analysis.held.contains(&value) || analysis.roots[value.0 as usize] != root {
                return false;
            }
            returned = true;
        }
    }
    returned
}

fn spend(budget: &mut usize, func: &Func) -> bool {
    let Some(left) = budget.checked_sub(func.values.len().saturating_add(1)) else {
        return false;
    };
    *budget = left;
    true
}

fn exhausted<'a>(mut plan: Plan<'a>, graph: &GraphBudget) -> Plan<'a> {
    plan.values.clear();
    plan.graph_units = graph.charged;
    for (name, _) in std::mem::take(&mut plan.parameters) {
        plan.rejected.insert(name, Rejection::Budget);
    }
    for why in plan.rejected.values_mut() {
        if *why == Rejection::UnprovedChain {
            *why = Rejection::Budget;
        }
    }
    plan
}

struct Schedule<'a> {
    pending: VecDeque<usize>,
    queued: Vec<bool>,
    dependents: FxHashMap<&'a str, Vec<usize>>,
}

impl<'a> Schedule<'a> {
    fn new(
        candidates: &[&'a Func],
        summaries: &crate::hir::own::Summaries,
        quiet: &rustc_hash::FxHashSet<&str>,
        plan: &mut Plan<'a>,
    ) -> Self {
        let mut pending = VecDeque::new();
        let mut queued = vec![false; candidates.len()];
        let mut dependents: FxHashMap<&str, Vec<usize>> = FxHashMap::default();
        for (index, func) in candidates.iter().enumerate() {
            let rejection = if func.exported {
                Rejection::PublicAbi
            } else {
                Rejection::NoTransfer
            };
            plan.rejected.insert(func.name.clone(), rejection);
            if func.exported || func.abstract_declaration || func.blocks.is_empty() {
                continue;
            }
            if !quiet.contains(func.name.as_str()) {
                plan.rejected
                    .insert(func.name.clone(), Rejection::UnsupportedContinuation);
                continue;
            }
            if !summaries.consumes(&func.name).is_some_and(|slots| {
                slots.iter().any(|slot| {
                    func.params
                        .get(*slot as usize)
                        .is_some_and(|param| is_string(&param.ty))
                })
            }) {
                continue;
            }
            plan.rejected
                .insert(func.name.clone(), Rejection::UnprovedChain);
            pending.push_back(index);
            queued[index] = true;
            for op in &func.values {
                if let OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } = &op.kind
                {
                    let readers = dependents.entry(name).or_default();
                    if readers.last() != Some(&index) {
                        readers.push(index);
                    }
                }
            }
        }
        Self {
            pending,
            queued,
            dependents,
        }
    }
}

fn incomplete<'a>(mut plan: Plan<'a>, graph: &GraphBudget) -> Plan<'a> {
    plan.values.clear();
    plan.graph_units = graph.charged;
    for (name, _) in std::mem::take(&mut plan.parameters) {
        plan.rejected.insert(name, Rejection::IncompleteGraph);
    }
    plan
}

/// Separate from scheduling: these conservative reservations are charged inside
/// union-find, use enumeration, reachability and the shared liveness/alias walk.
/// Scale is visible in the proof census; exhaustion is Budget, never semantics.
struct GraphBudget {
    left: usize,
    charged: usize,
    exhausted: bool,
}
impl GraphBudget {
    fn new(program: &Program) -> Self {
        let square = program.funcs.iter().fold(0usize, |sum, func| {
            sum.saturating_add(
                func.values
                    .len()
                    .saturating_add(func.blocks.len())
                    .saturating_add(1)
                    .saturating_pow(2),
            )
        });
        Self {
            left: square.saturating_mul(4096).saturating_add(1_000_000),
            charged: 0,
            exhausted: false,
        }
    }
    fn take(&mut self, units: usize) -> bool {
        let Some(left) = self.left.checked_sub(units) else {
            self.exhausted = true;
            return false;
        };
        self.left = left;
        self.charged = self.charged.saturating_add(units);
        true
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::hir::{self, Block, Op, Param, ParamShape};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn function(name: &str, params: Vec<Param>, kinds: Vec<OpKind>, exported: bool) -> Func {
        let ops: Vec<_> = (0..kinds.len())
            .map(|index| ValueId(u32::try_from(index).unwrap()))
            .collect();
        let result = *ops.last().unwrap();
        Func {
            name: name.into(),
            params,
            return_type: HirType::Managed(ManagedType::String),
            values: kinds
                .into_iter()
                .map(|kind| Op {
                    kind,
                    ty: HirType::Managed(ManagedType::String),
                    origin: origin(),
                })
                .collect(),
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: Terminator::Return(Some(result)),
            }],
            origin: origin(),
            exported,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: hir::ExactArithmetic::default(),
            written_return: None,
            result_absent: hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    #[test]
    fn zero_budget_freezes_an_unknown_plan_without_any_lookup_proof_work() {
        let parameter = Param {
            name: "out".into(),
            ty: HirType::Managed(ManagedType::String),
            origin: origin(),
            shape: ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        };
        let writer = function(
            "writer",
            vec![parameter],
            vec![
                OpKind::Param(0),
                OpKind::ConstString("!".into()),
                OpKind::Binary {
                    op: hir::BinOp::Concat,
                    lhs: ValueId(0),
                    rhs: ValueId(1),
                },
            ],
            false,
        );
        let caller = function(
            "caller",
            Vec::new(),
            vec![
                OpKind::ConstString("".into()),
                OpKind::Call {
                    callee: Callee::Direct("writer".into()),
                    args: vec![ValueId(0)],
                    frame: None,
                },
            ],
            true,
        );
        let program = Program {
            funcs: vec![writer, caller],
            ..Program::default()
        };
        let complete = Plan::new(&program);
        assert_eq!(
            complete.parameter_of(&program.funcs[0]),
            Some(0),
            "{complete:?}"
        );
        assert!(complete.values_in(&program.funcs[1]).is_some());
        let plan = Plan::build(
            &program,
            GraphBudget {
                left: 0,
                charged: 0,
                exhausted: false,
            },
        );
        assert!(
            plan.rejected().any(|(_, why)| why == Rejection::Budget),
            "{plan:?}"
        );
        assert_eq!(plan.graph_work(), (0, 0));
        for _ in 0..8 {
            for func in &program.funcs {
                assert!(
                    plan.values_in(func).is_none(),
                    "a frozen miss may never run legacy local analysis"
                );
                assert_eq!(plan.parameter_of(func), None);
            }
        }
        assert_eq!(plan.graph_work(), (0, 0));
        let copied = program.funcs[0].clone();
        assert!(
            complete.values_in(&copied).is_none(),
            "an IR subject mismatch is a miss, not a recapture"
        );
    }
    #[test]
    fn transitive_calls_and_helper_effects_cannot_hide_an_exception() {
        let external = |name: &str| {
            let mut func = function(
                "helper",
                Vec::new(),
                vec![
                    OpKind::ConstString("value".into()),
                    OpKind::Call {
                        callee: Callee::External(name.into()),
                        args: if name == "nts_uncaught" {
                            vec![ValueId(0)]
                        } else {
                            Vec::new()
                        },
                        frame: None,
                    },
                ],
                false,
            );
            func.values[1].ty = HirType::Void;
            func.blocks[0].terminator = Terminator::Return(Some(ValueId(0)));
            func
        };
        let caller = function(
            "caller",
            Vec::new(),
            vec![OpKind::Call {
                callee: Callee::Direct("helper".into()),
                args: Vec::new(),
                frame: None,
            }],
            true,
        );
        for (name, accepted) in [
            ("nts_counting_reset", true),
            ("nts_checkpoint", false),
            ("nts_uncaught", false),
            ("unknown_contract", false),
        ] {
            let program = Program {
                funcs: vec![external(name), caller.clone()],
                ..Program::default()
            };
            let quiet = continuations::quiet(&program, &mut GraphBudget::new(&program)).unwrap();
            assert_eq!(quiet.contains("helper"), accepted, "{name}: {quiet:?}");
            assert_eq!(
                quiet.contains("caller"),
                accepted,
                "transitive {name}: {quiet:?}"
            );
        }
        let program = Program {
            funcs: vec![caller],
            ..Program::default()
        };
        assert!(
            continuations::quiet(&program, &mut GraphBudget::new(&program))
                .unwrap()
                .is_empty(),
            "an unresolved direct target is not a quiet body"
        );
        assert!(super::super::outgoing(&Terminator::FellThrough).is_none());
    }
}
