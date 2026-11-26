//! One pre-counting memory graph. Stage 2 publishes diagnostics only: no
//! allocator, counting pass or backend may consult this report yet.
//! The shared escaping-outcome primitive also seals entry conventions; that
//! primitive computes neither memory homes nor per-value ownership.
//!
//! SSA copies are directional inclusions. Heap slots are keyed by allocation
//! identity and semantic field identity, and weakly join all possible writes.
//! In particular, a singleton *site* is never treated as a singleton instance.

use super::{Memory, Program};

mod build;
mod census;
mod comparison;
mod events;
mod graph;
mod lifetime;
pub(super) mod outcomes;
mod report;
mod retention;
mod summary;

pub use super::regions::placement::Storage;
pub use census::Census;
pub use comparison::{ContextArrival, ContextId, ContextView, Variant as LegacyVariant};
pub use events::LaterWrite;
pub use report::{
    CaptureWrite, Edge, Frontier, FunctionSummary, Hold, Holder, LegacyAgreement, Outcome, Proof,
    Reached, Report, RetainedBytes, Retention, Root, Site, SlotFact, StoreVersion, Value,
};

#[cfg(test)]
std::thread_local! {
    static ANALYSIS_RUNS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn analysis_runs() -> usize {
    ANALYSIS_RUNS.with(std::cell::Cell::get)
}

/// Internal resource limits, independent of allocator choices. Every exhausted
/// limit invalidates the unfinished answer, including its dependents, except
/// the context limit, which merges contexts and names `ContextBudget`.
///
/// Every limit scales with the program (decision P-7). A function has at most
/// `contexts_per_function` caller-specific contexts and one merged context
/// for every later caller, so the operations analysed in all contexts are at
/// most `(contexts_per_function + 1) x` the program's: the same input that
/// sizes the work and edge budgets. Context depth needs no bound of its own:
/// a recursive call reuses its ancestor's context, so a chain is at most the
/// height of the condensed call graph, and the per-function limit bounds how
/// many chains there are.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub work_per_operation: usize,
    pub edges_per_operation: usize,
    pub contexts_per_function: usize,
    pub aliases_per_value: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            work_per_operation: 256,
            edges_per_operation: 8,
            contexts_per_function: 4,
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
    StoreOrderBudget,
    UnsealedWriter(String),
    BindingIdentityUnproved(String),
    RetainedEnvironment(String),
    MissingOutcome(String),
    InvalidControlFlow(String),
    UnsupportedPhase(String),
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

/// The legacy answer is observed along actual post-rewrite call edges. Clone
/// identity comes from the writer that made the clone, never its printed name.
impl Report {
    pub(super) fn compare_legacy(
        &mut self,
        program: &Program,
        provider: Memory,
        clones: &rustc_hash::FxHashMap<String, String>,
        entries: &[super::own::EntryDecision],
    ) {
        comparison::compare(self, program, provider, clones, entries);
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
                ..Options::new(
                    crate::hir::backend::Backend::C,
                    crate::hir::EntryUnwind::Terminal,
                )
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
