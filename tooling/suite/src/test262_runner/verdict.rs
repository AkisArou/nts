use super::model::{
    CompileEvent, ExecutionTrace, NegativeExpectation, NegativePhase, RunEvent, VariantPlan,
    Verdict, VerdictStatus,
};

/// Compare a structured adapter trace with Test262's own expectation.
///
/// Only an event carrying the exact ECMAScript phase and exception constructor
/// can satisfy a negative test. An ordinary compiler diagnostic must be
/// reported as `Unsupported`, not disguised as an exception.
#[must_use]
pub fn judge_execution(plan: &VariantPlan, trace: &ExecutionTrace) -> Verdict {
    match (&trace.compile, &trace.run) {
        (CompileEvent::Succeeded, Some(run)) => judge_terminal(plan.negative.as_ref(), run),
        (CompileEvent::Succeeded, None) => verdict(
            VerdictStatus::InfrastructureError,
            "adapter:missing-run-event",
        ),
        (compile, Some(_)) => verdict(
            VerdictStatus::InfrastructureError,
            format!("adapter:run-after-compile-{}", compile_kind(compile)),
        ),
        (CompileEvent::Exception { phase, error_type }, None) => match phase {
            NegativePhase::Parse | NegativePhase::Resolution => {
                judge_exception(plan.negative.as_ref(), phase, error_type)
            }
            NegativePhase::Runtime | NegativePhase::Other(_) => verdict(
                VerdictStatus::InfrastructureError,
                format!(
                    "adapter:invalid-compile-exception-phase-{}",
                    phase_name(phase)
                ),
            ),
        },
        (CompileEvent::Unsupported { reason }, None) => verdict(VerdictStatus::Unsupported, reason),
        (CompileEvent::Inapplicable { reason }, None) => {
            verdict(VerdictStatus::Inapplicable, reason)
        }
        (CompileEvent::Timeout, None) => verdict(VerdictStatus::Timeout, "compile:timeout"),
        (CompileEvent::Crash { detail }, None) => verdict(VerdictStatus::Crash, detail),
        (CompileEvent::InfrastructureError { reason }, None) => {
            verdict(VerdictStatus::InfrastructureError, reason)
        }
    }
}

fn judge_terminal(expected: Option<&NegativeExpectation>, event: &RunEvent) -> Verdict {
    match event {
        RunEvent::Completed => {
            if let Some(expected) = expected {
                verdict(
                    VerdictStatus::Fail,
                    format!(
                        "expected-{}-{}:completed",
                        phase_name(&expected.phase),
                        expected.error_type
                    ),
                )
            } else {
                verdict(VerdictStatus::StrictPass, "positive:completed")
            }
        }
        RunEvent::Exception { phase, error_type } => match phase {
            NegativePhase::Runtime => judge_exception(expected, phase, error_type),
            NegativePhase::Parse | NegativePhase::Resolution | NegativePhase::Other(_) => verdict(
                VerdictStatus::InfrastructureError,
                format!("adapter:invalid-run-exception-phase-{}", phase_name(phase)),
            ),
        },
        RunEvent::Unsupported { reason } => verdict(VerdictStatus::Unsupported, reason),
        RunEvent::Inapplicable { reason } => verdict(VerdictStatus::Inapplicable, reason),
        RunEvent::Timeout => verdict(VerdictStatus::Timeout, "run:timeout"),
        RunEvent::Crash { detail } => verdict(VerdictStatus::Crash, detail),
        RunEvent::InfrastructureError { reason } => {
            verdict(VerdictStatus::InfrastructureError, reason)
        }
    }
}

fn judge_exception(
    expected: Option<&NegativeExpectation>,
    actual_phase: &NegativePhase,
    actual_type: &str,
) -> Verdict {
    let Some(expected) = expected else {
        return verdict(
            VerdictStatus::Fail,
            format!("unexpected-{}-{actual_type}", phase_name(actual_phase)),
        );
    };

    if expected.phase == *actual_phase && expected.error_type == actual_type {
        verdict(
            VerdictStatus::StrictPass,
            format!(
                "negative:matched-{}-{actual_type}",
                phase_name(actual_phase)
            ),
        )
    } else {
        verdict(
            VerdictStatus::Fail,
            format!(
                "negative:mismatch:expected-{}-{}:actual-{}-{actual_type}",
                phase_name(&expected.phase),
                expected.error_type,
                phase_name(actual_phase)
            ),
        )
    }
}

fn verdict(status: VerdictStatus, reason: impl Into<String>) -> Verdict {
    Verdict {
        status,
        reason: reason.into(),
    }
}

fn phase_name(phase: &NegativePhase) -> &str {
    match phase {
        NegativePhase::Parse => "parse",
        NegativePhase::Resolution => "resolution",
        NegativePhase::Runtime => "runtime",
        NegativePhase::Other(value) => value,
    }
}

fn compile_kind(event: &CompileEvent) -> &'static str {
    match event {
        CompileEvent::Succeeded => "succeeded",
        CompileEvent::Exception { .. } => "exception",
        CompileEvent::Unsupported { .. } => "unsupported",
        CompileEvent::Inapplicable { .. } => "inapplicable",
        CompileEvent::Timeout => "timeout",
        CompileEvent::Crash { .. } => "crash",
        CompileEvent::InfrastructureError { .. } => "infrastructure-error",
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    fn plan(negative: Option<NegativeExpectation>) -> VariantPlan {
        VariantPlan {
            id: "test/example.js#strict".to_owned(),
            test_path: "test/example.js".to_owned(),
            strict_prefix: "\"use strict\";\n".to_owned(),
            includes: Vec::new(),
            features: Vec::new(),
            negative,
            required_capabilities: BTreeSet::new(),
        }
    }

    fn trace(compile: CompileEvent, run: Option<RunEvent>) -> ExecutionTrace {
        ExecutionTrace { compile, run }
    }

    #[test]
    fn positive_completion_is_a_qualified_strict_pass() {
        assert_eq!(
            judge_execution(
                &plan(None),
                &trace(CompileEvent::Succeeded, Some(RunEvent::Completed))
            )
            .status,
            VerdictStatus::StrictPass
        );
    }

    #[test]
    fn negative_requires_exact_phase_and_constructor() {
        let plan = plan(Some(NegativeExpectation {
            phase: NegativePhase::Parse,
            error_type: "SyntaxError".to_owned(),
        }));
        let matching = trace(
            CompileEvent::Exception {
                phase: NegativePhase::Parse,
                error_type: "SyntaxError".to_owned(),
            },
            None,
        );
        assert_eq!(
            judge_execution(&plan, &matching).status,
            VerdictStatus::StrictPass
        );

        for mismatching in [
            trace(
                CompileEvent::Exception {
                    phase: NegativePhase::Resolution,
                    error_type: "SyntaxError".to_owned(),
                },
                None,
            ),
            trace(
                CompileEvent::Exception {
                    phase: NegativePhase::Parse,
                    error_type: "TypeError".to_owned(),
                },
                None,
            ),
        ] {
            assert_eq!(
                judge_execution(&plan, &mismatching).status,
                VerdictStatus::Fail
            );
        }
    }

    #[test]
    fn generic_refusal_never_satisfies_a_negative_test() {
        let plan = plan(Some(NegativeExpectation {
            phase: NegativePhase::Parse,
            error_type: "SyntaxError".to_owned(),
        }));
        let unsupported = trace(
            CompileEvent::Unsupported {
                reason: "compiler:cannot-lower".to_owned(),
            },
            None,
        );
        assert_eq!(
            judge_execution(&plan, &unsupported).status,
            VerdictStatus::Unsupported
        );
    }

    #[test]
    fn runtime_negative_matches_only_a_runtime_event() {
        let plan = plan(Some(NegativeExpectation {
            phase: NegativePhase::Runtime,
            error_type: "ReferenceError".to_owned(),
        }));
        let matching = trace(
            CompileEvent::Succeeded,
            Some(RunEvent::Exception {
                phase: NegativePhase::Runtime,
                error_type: "ReferenceError".to_owned(),
            }),
        );
        assert_eq!(
            judge_execution(&plan, &matching).status,
            VerdictStatus::StrictPass
        );
    }

    #[test]
    fn invalid_adapter_trace_is_an_infrastructure_error() {
        for invalid in [
            trace(CompileEvent::Timeout, Some(RunEvent::Completed)),
            trace(
                CompileEvent::Exception {
                    phase: NegativePhase::Runtime,
                    error_type: "ReferenceError".to_owned(),
                },
                None,
            ),
            trace(
                CompileEvent::Succeeded,
                Some(RunEvent::Exception {
                    phase: NegativePhase::Parse,
                    error_type: "SyntaxError".to_owned(),
                }),
            ),
        ] {
            assert_eq!(
                judge_execution(&plan(None), &invalid).status,
                VerdictStatus::InfrastructureError
            );
        }
    }
}
