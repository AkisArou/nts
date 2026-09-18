//! Test262 protocol handling that has no compiler or runtime dependency.

mod adapter;
mod assemble;
mod discover;
mod host_assets;
mod metadata;
mod model;
mod report;
mod schedule;
mod verdict;

pub use adapter::{ExecutionAdapter, ScriptedAdapter};
pub use assemble::{AssemblyError, SuiteAssembler, assemble_variant};
pub use discover::{DiscoveryError, SuiteInventory, discover_suite};
pub use host_assets::{
    HOST_CONTRACT, HOST_DECLARATIONS, HostContractManifest, HostIntrinsic, parse_host_contract,
};
pub use metadata::{MetadataError, parse_test_record, parse_yaml};
pub use model::{
    AssemblyPlan, CompileEvent, ExecutionTrace, HostProfilePlan, NegativeExpectation,
    NegativePhase, RequiredCapability, RunEvent, ScheduleOutcome, SourceUnit, SourceUnitKind,
    TestRecord, UnscheduledResult, UnscheduledStatus, VariantPlan, VariantResult, Verdict,
    VerdictStatus, YamlValue,
};
pub use report::{ReportSummary, RunReport, SummaryCount};
pub use schedule::schedule_strict_script;
pub use verdict::judge_execution;

/// The Test262 revision against which this protocol implementation is tested.
///
/// **One place decides this.** The constant was correct and two `#[cfg(test)]`
/// call sites in `discover.rs` spelled the same SHA as a literal, so the pin was
/// three derivations of one fact; `assemble.rs` used the constant, which is why
/// the drift below was invisible from that side.
///
/// Advanced 2026-09-18 from `d86b2294eb0a17eaa281ff12c73c473ec864c72f`, which
/// no checkout in this tree held. `discover_suite` returns `WrongPin` before
/// doing any work and both subcommands go through it, so **the whole protocol
/// layer had never run against the corpus it was written for** -- and
/// `bootstrap.sh` clones master without checking anything out, so a fresh
/// bootstrap lands off-pin by construction rather than by accident.
///
/// Advancing rather than checking the vendored tree backwards: a pin that
/// `bootstrap.sh` cannot produce holds only on machines that already have the
/// tree, which is the state that produced this.
pub const TEST262_PIN: &str = "14e8c908e54ae2e770e473bcacf536f8cb654929";
