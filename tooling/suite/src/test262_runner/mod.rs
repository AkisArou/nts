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
pub const TEST262_PIN: &str = "d86b2294eb0a17eaa281ff12c73c473ec864c72f";
