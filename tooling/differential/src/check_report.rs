//! Versioned machine results for `nts check`; prose never decides a verdict.

use serde::{Deserialize, Serialize};

use crate::Report;

/// Work the owned supervisor stopped, independently of the program's exit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Incomplete {
    /// The supervisor's observed stop cause.
    pub kind: IncompleteKind,
    /// Human-readable detail, including the measured CPU or inactivity budget.
    pub reason: String,
    /// Index in this compiled driver's case list, or cleanup after the list.
    pub case_index: Option<usize>,
}

/// A supervisor observation, independent of any completed program verdict.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncompleteKind {
    /// Neither output, CPU nor completed work advanced.
    Hung,
    /// CPU consumed the reviewed allowance.
    Runaway,
    /// The verifier could not be started or its result could not be observed.
    #[serde(rename = "tooling-setup")]
    ToolingSetup,
}

/// A lowering or emission refusal, independent of its rendered source location.
#[derive(Debug, Clone, Serialize)]
pub struct Refusal {
    /// The compiler stage that reported the diagnostic.
    pub stage: RefusalStage,
    /// Stable compiler diagnostic identifier.
    pub code: String,
    /// The construct that could not be compiled.
    pub message: String,
}

/// Diagnostic stages stay distinct when counting lowering roots and cascades.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalStage {
    /// The source checker rejected the program.
    Typecheck,
    /// Lowering or preparation could not compile a source construct.
    Lowering,
    /// The selected backend could not emit a construct.
    Backend,
}

impl From<&nts_diagnostics::Diagnostic> for Refusal {
    fn from(diagnostic: &nts_diagnostics::Diagnostic) -> Self {
        Self {
            stage: RefusalStage::Lowering,
            code: diagnostic.code.clone(),
            message: diagnostic.message.clone(),
        }
    }
}

impl Refusal {
    pub(crate) fn at(diagnostic: &nts_diagnostics::Diagnostic, stage: RefusalStage) -> Self {
        Self {
            stage,
            ..Self::from(diagnostic)
        }
    }
}

/// Distinct dispositions, including a source population with no compiled binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// The source declares no export the differential harness can drive.
    Nothing,
    /// Every generated case was compared and agreed.
    Agrees,
    /// Some cases were compared and all of those agreed.
    Partial,
    /// The full Node population was measured, but no compiled binding exists.
    AllUnavailable,
    /// Compiled bindings exist, but they declined every case at run time.
    AllDeclined,
    /// At least one compared answer differs.
    Disagrees,
    /// A compiled case stopped for an unexpected reason.
    Aborted,
    /// No comparison was possible, or the Node population was incomplete.
    NotMeasured,
    /// Compilation, planning or the execution harness failed.
    Error,
}

impl Status {
    /// Whether this disposition is an accepted check result.
    #[must_use]
    pub const fn succeeds(self) -> bool {
        matches!(
            self,
            Self::Nothing | Self::Agrees | Self::Partial | Self::AllUnavailable
        )
    }
}

/// The stage that failed, supplied by the stage rather than inferred from text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// The checker could not capture the source program.
    Capture,
    /// The source program has TypeScript errors.
    Typecheck,
    /// The source export contract or its declared population is invalid.
    SourcePlan,
    /// HIR preparation did not produce an executable program.
    Preparation,
    /// A backend could not emit the required program.
    BackendDeclined,
    /// A backend reported an internal emitter error.
    Emitter,
    /// The native toolchain could not build the emitted program.
    NativeBuild,
    /// A compiled driver could not be launched or supervised.
    Execution,
    /// The recorded oracle identity is missing or stale.
    OracleCoverage,
    /// Node did not deliver its complete promised population.
    OracleExecution,
    /// An unexpected error has no more specific stage annotation.
    Internal,
}

/// Typed context retained through `anyhow` without changing diagnostic messages.
#[derive(Debug)]
pub(crate) struct Failure {
    pub kind: FailureKind,
    pub refusals: Vec<Refusal>,
    pub source: Option<String>,
    pub message: String,
}

pub(crate) fn with_failure(
    error: anyhow::Error,
    kind: FailureKind,
    refusals: Vec<Refusal>,
    source: Option<String>,
) -> anyhow::Error {
    let message = format!("{error:#}");
    error.context(Failure {
        kind,
        refusals,
        source,
        message,
    })
}

pub(crate) fn annotate(error: anyhow::Error, kind: FailureKind) -> anyhow::Error {
    if error.downcast_ref::<Failure>().is_some() {
        error
    } else {
        with_failure(error, kind, Vec::new(), None)
    }
}

pub(crate) fn declined(
    message: String,
    diagnostics: &[nts_diagnostics::Diagnostic],
) -> anyhow::Error {
    with_failure(
        anyhow::anyhow!(message),
        FailureKind::BackendDeclined,
        diagnostics
            .iter()
            .map(|diagnostic| Refusal::at(diagnostic, RefusalStage::Backend))
            .collect(),
        None,
    )
}

impl std::fmt::Display for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "check stage {:?}", self.kind)
    }
}

/// Serialized report schema. A new incompatible shape increments this version.
pub const VERSION: u32 = 2;

impl Report {
    /// The disposition of this measured source population.
    #[must_use]
    pub fn status(&self) -> Status {
        if self.functions == 0 {
            Status::Nothing
        } else if self.node_received != self.expected {
            Status::NotMeasured
        } else if !self.disagreements.is_empty() {
            Status::Disagrees
        } else if !self.aborts.is_empty() {
            Status::Aborted
        } else if !self.incomplete.is_empty()
            || self.timeouts > 0
            || self.checked.checked_add(self.refused) != Some(self.expected)
        {
            Status::NotMeasured
        } else if self.unavailable == self.expected && self.expected > 0 {
            Status::AllUnavailable
        } else if self.checked == 0 {
            if self.refused == self.expected && self.expected > 0 {
                Status::AllDeclined
            } else {
                Status::NotMeasured
            }
        } else if self.checked == self.expected {
            Status::Agrees
        } else {
            Status::Partial
        }
    }

    /// Machine-readable check result. All counts describe the shared source plan.
    #[must_use]
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "version": VERSION,
            "status": self.status(),
            "counts": {
                "functions": self.functions,
                "expected": self.expected,
                "compared": self.checked,
                "unavailable": self.unavailable,
                "runtime_declined": self.refused.saturating_sub(self.unavailable),
                "timeouts": self.timeouts,
                "approximated": self.approximated,
                "disagreements": self.disagreements.len(),
                "aborts": self.aborts.len(),
            },
            "oracle": {
                "expected": self.expected,
                "received": self.node_received,
                "complete": self.node_received == self.expected,
            },
            "refusals": self.refusals,
            "disagreements": self.disagreements.iter().map(|(compiled, node)| {
                serde_json::json!({ "compiled": compiled, "node": node })
            }).collect::<Vec<_>>(),
            "aborts": self.aborts,
            "incomplete": self.incomplete,
            "error": null,
        })
    }
}

/// A failed check still produces a structured disposition on the JSON interface.
#[must_use]
pub fn error_json(error: &anyhow::Error) -> serde_json::Value {
    let failure = error.downcast_ref::<Failure>();
    serde_json::json!({
        "version": VERSION,
        "status": Status::Error,
        "counts": null,
        "oracle": null,
        "refusals": failure.map_or_else(Vec::new, |failure| failure.refusals.clone()),
        "disagreements": [],
        "aborts": [],
        "incomplete": [],
        "error": {
            "kind": failure.map_or(FailureKind::Internal, |failure| failure.kind),
            "source": failure.and_then(|failure| failure.source.as_deref()),
            "message": failure.map_or_else(|| format!("{error:#}"), |failure| failure.message.clone()),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_stage_metadata_preserves_the_original_error_message() {
        let text = "invalid HIR: check stage Preparation is part of the source message";
        let error = annotate(anyhow::anyhow!(text), FailureKind::Preparation);
        assert_eq!(error_json(&error)["error"]["message"], text);
        assert_eq!(error_json(&error)["error"]["kind"], "preparation");
    }

    #[test]
    fn unavailable_bindings_are_neither_agreement_nor_runtime_declines() {
        let mut report = Report {
            functions: 1,
            expected: 29,
            node_received: 29,
            refused: 29,
            unavailable: 29,
            ..Report::default()
        };
        assert_eq!(report.status(), Status::AllUnavailable);
        assert!(!report.agreed());
        assert_eq!(report.json()["counts"]["runtime_declined"], 0);
        report.unavailable = 0;
        assert_eq!(report.status(), Status::AllDeclined);
        assert!(!report.status().succeeds());
        report.node_received = 28;
        assert_eq!(report.status(), Status::NotMeasured);
    }

    #[test]
    fn structured_verdict_retains_disagreement_and_abort_precedence() {
        let mut report = Report {
            functions: 1,
            expected: 29,
            node_received: 29,
            checked: 28,
            refused: 1,
            ..Report::default()
        };
        assert_eq!(report.status(), Status::Partial);
        report.aborts.push("failure".into());
        assert_eq!(report.status(), Status::Aborted);
        report.disagreements.push(("a".into(), "b".into()));
        assert_eq!(report.status(), Status::Disagrees);
    }

    #[test]
    fn a_timeout_or_unaccounted_call_cannot_be_partial_agreement() {
        let mut report = Report {
            functions: 1,
            expected: 2,
            node_received: 2,
            checked: 1,
            refused: 1,
            ..Report::default()
        };
        assert_eq!(report.status(), Status::Partial);
        report.refused = 0;
        assert_eq!(report.status(), Status::NotMeasured);
        report.timeouts = 1;
        assert_eq!(report.status(), Status::NotMeasured);
        assert!(!report.status().succeeds());
    }
}
