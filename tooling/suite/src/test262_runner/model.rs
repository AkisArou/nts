use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// The deliberately small value model produced by Test262's `monkeyYaml`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum YamlValue {
    String(String),
    Integer(i64),
    Float(f64),
    Sequence(Vec<YamlValue>),
    Mapping(BTreeMap<String, YamlValue>),
}

impl YamlValue {
    pub(crate) fn as_mapping(&self) -> Option<&BTreeMap<String, Self>> {
        if let Self::Mapping(value) = self {
            Some(value)
        } else {
            None
        }
    }

    pub(crate) fn as_string(&self) -> Option<&str> {
        if let Self::String(value) = self {
            Some(value)
        } else {
            None
        }
    }

    pub(crate) fn as_sequence(&self) -> Option<&[Self]> {
        if let Self::Sequence(value) = self {
            Some(value)
        } else {
            None
        }
    }
}

/// The phase named by a Test262 negative expectation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NegativePhase {
    Parse,
    Resolution,
    Runtime,
    /// Preserved so a future suite addition is reported rather than guessed.
    Other(String),
}

/// The exact failure expected by a negative test.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NegativeExpectation {
    pub phase: NegativePhase,
    pub error_type: String,
}

/// One parsed Test262 source file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TestRecord {
    pub path: String,
    pub source_hash: String,
    pub body_hash: String,
    pub header: String,
    pub body: String,
    pub metadata: BTreeMap<String, YamlValue>,
    pub flags: BTreeSet<String>,
    pub includes: Vec<String>,
    pub features: Vec<String>,
    pub negative: Option<NegativeExpectation>,
}

/// A host or execution facility a scheduled variant needs.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequiredCapability {
    AsyncCompletion,
    CanBlockFalse,
    CanBlockTrue,
}

/// The compiler-independent plan for one strict global-script variant.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct VariantPlan {
    pub id: String,
    pub test_path: String,
    pub strict_prefix: String,
    pub includes: Vec<String>,
    pub features: Vec<String>,
    pub negative: Option<NegativeExpectation>,
    pub required_capabilities: BTreeSet<RequiredCapability>,
}

/// Why a parsed file is or is not in the initial strict-script lane.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ScheduleOutcome {
    Planned { plan: VariantPlan },
    ScopeExcluded { reason: String },
    Unsupported { reason: String },
}

/// The host initialization that precedes every source unit in a plan.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostProfilePlan {
    pub id: String,
    pub declarations_hash: String,
    pub contract_hash: String,
    pub replaces_harness: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceUnitKind {
    Include,
    Test,
}

/// One independently parsed global-script unit.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceUnit {
    pub kind: SourceUnitKind,
    pub logical_path: String,
    pub source_hash: String,
    pub prefix: String,
    /// Kept for an execution adapter, but omitted from stable plan JSON.
    #[serde(skip_serializing, default)]
    pub source: String,
}

/// Complete input to an execution adapter.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AssemblyPlan {
    pub host_profile: HostProfilePlan,
    pub variant: VariantPlan,
    pub source_units: Vec<SourceUnit>,
}

/// Structured outcome of the compile half of an adapter.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CompileEvent {
    Succeeded,
    Exception {
        phase: NegativePhase,
        error_type: String,
    },
    Unsupported {
        reason: String,
    },
    Inapplicable {
        reason: String,
    },
    Timeout,
    Crash {
        detail: String,
    },
    InfrastructureError {
        reason: String,
    },
}

/// Structured outcome of executing a successfully compiled variant.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RunEvent {
    Completed,
    Exception {
        phase: NegativePhase,
        error_type: String,
    },
    Unsupported {
        reason: String,
    },
    Inapplicable {
        reason: String,
    },
    Timeout,
    Crash {
        detail: String,
    },
    InfrastructureError {
        reason: String,
    },
}

/// An adapter trace. `run` is present exactly when compilation succeeded.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExecutionTrace {
    pub compile: CompileEvent,
    pub run: Option<RunEvent>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VerdictStatus {
    StrictPass,
    Fail,
    Unsupported,
    Inapplicable,
    Timeout,
    Crash,
    InfrastructureError,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Verdict {
    pub status: VerdictStatus,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct VariantResult {
    pub variant_id: String,
    pub test_path: String,
    pub verdict: Verdict,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnscheduledStatus {
    ScopeExcluded,
    Unsupported,
}

/// A parsed file for which scheduling deliberately produced no variant.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UnscheduledResult {
    pub test_path: String,
    pub status: UnscheduledStatus,
    pub reason: String,
}
