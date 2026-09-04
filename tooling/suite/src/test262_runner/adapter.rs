use std::collections::BTreeMap;

use super::model::{AssemblyPlan, CompileEvent, ExecutionTrace};

/// Compiler-independent execution seam for the Test262 protocol.
pub trait ExecutionAdapter {
    fn execute(&self, plan: &AssemblyPlan) -> ExecutionTrace;
}

/// Deterministic adapter used to test protocol and verdict behavior before the
/// compiler exposes a global-script entry point.
#[derive(Clone, Debug, Default)]
pub struct ScriptedAdapter {
    traces: BTreeMap<String, ExecutionTrace>,
}

impl ScriptedAdapter {
    #[must_use]
    pub fn new(traces: impl IntoIterator<Item = (String, ExecutionTrace)>) -> Self {
        Self {
            traces: traces.into_iter().collect(),
        }
    }
}

impl ExecutionAdapter for ScriptedAdapter {
    fn execute(&self, plan: &AssemblyPlan) -> ExecutionTrace {
        self.traces
            .get(&plan.variant.id)
            .cloned()
            .unwrap_or_else(|| ExecutionTrace {
                compile: CompileEvent::InfrastructureError {
                    reason: "mock:no-scripted-trace".to_owned(),
                },
                run: None,
            })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::test262_runner::{
        HostProfilePlan, RunEvent, VariantPlan,
        model::{AssemblyPlan, SourceUnit},
    };

    fn plan() -> AssemblyPlan {
        AssemblyPlan {
            host_profile: HostProfilePlan {
                id: "test".to_owned(),
                declarations_hash: String::new(),
                contract_hash: String::new(),
                replaces_harness: Vec::new(),
            },
            variant: VariantPlan {
                id: "test/example.js#strict".to_owned(),
                test_path: "test/example.js".to_owned(),
                strict_prefix: "\"use strict\";\n".to_owned(),
                includes: Vec::new(),
                features: Vec::new(),
                negative: None,
                required_capabilities: BTreeSet::new(),
            },
            source_units: Vec::<SourceUnit>::new(),
        }
    }

    #[test]
    fn returns_only_the_trace_scripted_for_the_variant() {
        let trace = ExecutionTrace {
            compile: CompileEvent::Succeeded,
            run: Some(RunEvent::Completed),
        };
        let adapter = ScriptedAdapter::new([(plan().variant.id.clone(), trace.clone())]);
        assert_eq!(adapter.execute(&plan()), trace);
    }

    #[test]
    fn an_unscripted_variant_is_an_infrastructure_error() {
        let trace = ScriptedAdapter::default().execute(&plan());
        assert!(matches!(
            trace.compile,
            CompileEvent::InfrastructureError { .. }
        ));
        assert!(trace.run.is_none());
    }
}
