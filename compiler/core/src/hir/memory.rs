//! One pre-counting memory graph. Stage 2 publishes diagnostics only: no
//! allocator, counting pass or backend may consult this report yet.
//!
//! SSA copies are directional inclusions. Heap slots are keyed by allocation
//! identity and semantic field identity, and weakly join all possible writes.
//! In particular, a singleton *site* is never treated as a singleton instance.

use std::collections::{BTreeMap, BTreeSet};

use super::{Memory, OpKind, Program};

mod build;
mod graph;
mod lifetime;
mod outcomes;
mod report;
mod summary;

pub use super::regions::placement::Storage;
pub use report::{Frontier, FunctionSummary, Outcome, Proof, Report, Site, SlotFact, Value};

#[cfg(test)]
std::thread_local! {
    static ANALYSIS_RUNS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn analysis_runs() -> usize {
    ANALYSIS_RUNS.with(std::cell::Cell::get)
}

/// Internal resource limits, independent of allocator choices. Every exhausted
/// limit invalidates the unfinished answer, including its dependents.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub work_per_operation: usize,
    pub edges_per_operation: usize,
    pub contexts_per_function: usize,
    pub context_depth: usize,
    pub aliases_per_value: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            work_per_operation: 256,
            edges_per_operation: 8,
            contexts_per_function: 4,
            context_depth: 4,
            aliases_per_value: 8,
        }
    }
}

/// Stable source identity. A call's returned alias is not another allocation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SiteId {
    pub function: String,
    pub value: u32,
    pub storage: Storage,
}

/// A home requires an independent proof. The cohort variant is reserved for
/// a sealed lifetime, retention and runtime-edge contract, not a candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Home {
    Immortal,
    Frame,
    Cohort { owner: String },
    Heap(Reason),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Reason {
    WorkBudget,
    EdgeBudget,
    ContextBudget,
    Outside(String),
    Returned(String),
    OutlivesFrame(String),
    RepeatedInstances,
    StorageBoundUnproved,
    RuntimeRootContract,
    ManualStorage,
    ProducerUnproved,
    WeakUnionBudget,
    MissingOutcome(String),
    InvalidControlFlow(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Multiplicity {
    One { witness: String },
    Bounded { limit: usize, witness: String },
    Unbounded { witness: String },
}

/// Facts are borrowed from exactly this immutable program revision. Mutation
/// cannot overlap a query. The detached report contains diagnostics, not an
/// allocation permission that a later revision could accidentally consume.
#[derive(Debug)]
pub struct Analysis<'p> {
    program: &'p Program,
    report: Report,
}

impl<'p> Analysis<'p> {
    #[must_use]
    pub fn of(program: &'p Program) -> Self {
        Self::with_limits(program, Limits::default())
    }

    #[must_use]
    pub fn with_limits(program: &'p Program, limits: Limits) -> Self {
        #[cfg(test)]
        ANALYSIS_RUNS.with(|runs| runs.set(runs.get() + 1));
        Self {
            program,
            report: build::analyze(program, limits),
        }
    }

    #[must_use]
    pub const fn report(&self) -> &Report {
        &self.report
    }

    #[must_use]
    pub const fn program(&self) -> &'p Program {
        self.program
    }

    #[must_use]
    pub fn into_report(self) -> Report {
        self.report
    }
}

/// The legacy answer is observed after its rewrites. Names and value IDs are
/// preserved by these rewrites; region clones add an explicit lineage suffix.
/// Report-only operations introduced by counting are not source allocations.
impl Report {
    pub(super) fn compare_legacy(&mut self, program: &Program, provider: Memory) {
        let mut observed: BTreeMap<(String, u32), BTreeSet<String>> = BTreeMap::new();
        for function in &program.funcs {
            let region = super::regions::is_clone(&function.name);
            let name = function
                .name
                .strip_suffix(super::regions::CLONE_SUFFIX)
                .unwrap_or(&function.name);
            for &id in function.blocks.iter().flat_map(|block| &block.ops) {
                let kind = &function.value(id).kind;
                let home = if region {
                    "call-region"
                } else if matches!(kind, OpKind::ObjectNew { frame: true })
                    || matches!(kind, OpKind::Call { frame: Some(_), .. })
                {
                    "frame"
                } else if matches!(provider, Memory::HostGc) {
                    "host"
                } else {
                    "heap"
                };
                observed
                    .entry((name.to_owned(), id.0))
                    .or_default()
                    .insert(home.to_owned());
            }
        }
        for site in &mut self.sites {
            site.legacy = observed
                .get(&(site.id.function.clone(), site.id.value))
                .map(|homes| homes.iter().cloned().collect())
                .unwrap_or_default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::analysis_runs;
    use crate::hir::{self, Memory, Options, PreparationOptions, RawProgram};
    use nts_semantic_schema::SemanticSnapshot;

    #[test]
    #[allow(clippy::expect_used)]
    fn normal_preparation_does_not_run_the_memory_solver() {
        let snapshot = SemanticSnapshot::default();
        for provider in [Memory::NoGc, Memory::ReferenceCounting, Memory::HostGc] {
            let options = Options {
                provider,
                ..Options::default()
            };
            let before = analysis_runs();
            let normal = hir::prepare_with(&snapshot, &options).expect("the control prepares");
            assert!(normal.memory.is_none());
            assert_eq!(
                analysis_runs(),
                before,
                "ordinary preparation ran the solver"
            );

            let observed = RawProgram::lower(&snapshot, options.entry_files, options.foreign)
                .into_unverified_with_memory(&PreparationOptions::from(&options));
            let expected_runs = usize::from(provider != Memory::HostGc);
            assert_eq!(analysis_runs() - before, expected_runs);
            assert_eq!(observed.memory.is_some(), provider != Memory::HostGc);
            assert_eq!(
                format!("{:?}", normal.program),
                format!("{:?}", observed.program)
            );
            println!(
                "memory-demand-control\tprovider={provider:?}\tnormal=0\tdiagnostic={expected_runs}"
            );
        }
    }
}
