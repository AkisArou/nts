use std::collections::BTreeSet;

use super::model::{NegativePhase, RequiredCapability, ScheduleOutcome, TestRecord, VariantPlan};

const KNOWN_FLAGS: &[&str] = &[
    "CanBlockIsFalse",
    "CanBlockIsTrue",
    "async",
    "generated",
    "module",
    "noStrict",
    "onlyStrict",
    "raw",
];

/// Schedule the one strict global-script variant `NativeTS` initially targets.
///
/// Parsing and scheduling are intentionally separate: every file is parsed,
/// while `noStrict`, module, and raw files remain visible as reasoned scope
/// exclusions.
#[must_use]
pub fn schedule_strict_script(record: &TestRecord) -> ScheduleOutcome {
    if record.path.starts_with("test/intl402/") {
        return ScheduleOutcome::ScopeExcluded {
            reason: "initial-lane:intl402".to_owned(),
        };
    }

    if let Some(flag) = record
        .flags
        .iter()
        .find(|flag| !KNOWN_FLAGS.contains(&flag.as_str()))
    {
        return ScheduleOutcome::Unsupported {
            reason: format!("unknown-flag:{flag}"),
        };
    }

    if let Some(negative) = &record.negative
        && let NegativePhase::Other(phase) = &negative.phase
    {
        return ScheduleOutcome::Unsupported {
            reason: format!("unknown-negative-phase:{phase}"),
        };
    }

    if record.flags.contains("noStrict") {
        return ScheduleOutcome::ScopeExcluded {
            reason: "initial-lane:no-strict".to_owned(),
        };
    }
    if record.flags.contains("module") {
        return ScheduleOutcome::ScopeExcluded {
            reason: "initial-lane:module".to_owned(),
        };
    }
    if record.flags.contains("raw") {
        return ScheduleOutcome::ScopeExcluded {
            reason: "initial-lane:raw".to_owned(),
        };
    }

    let mut required_capabilities = BTreeSet::new();
    if record.flags.contains("async") {
        required_capabilities.insert(RequiredCapability::AsyncCompletion);
    }
    if record.flags.contains("CanBlockIsFalse") {
        required_capabilities.insert(RequiredCapability::CanBlockFalse);
    }
    if record.flags.contains("CanBlockIsTrue") {
        required_capabilities.insert(RequiredCapability::CanBlockTrue);
    }

    ScheduleOutcome::Planned {
        plan: VariantPlan {
            id: format!("{}#strict", record.path),
            test_path: record.path.clone(),
            strict_prefix: "\"use strict\";\n".to_owned(),
            includes: record.includes.clone(),
            features: record.features.clone(),
            negative: record.negative.clone(),
            required_capabilities,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;

    fn record(flags: &[&str]) -> TestRecord {
        TestRecord {
            path: "language/example.js".to_owned(),
            source_hash: String::new(),
            body_hash: String::new(),
            header: String::new(),
            body: String::new(),
            metadata: BTreeMap::new(),
            flags: flags.iter().map(|flag| (*flag).to_owned()).collect(),
            includes: vec!["propertyHelper.js".to_owned()],
            features: vec!["let".to_owned()],
            negative: None,
        }
    }

    #[test]
    fn defaults_to_one_strict_script() {
        let ScheduleOutcome::Planned { plan } = schedule_strict_script(&record(&[])) else {
            panic!("default test should be scheduled");
        };
        assert_eq!(plan.id, "language/example.js#strict");
        assert_eq!(plan.strict_prefix, "\"use strict\";\n");
        assert_eq!(plan.includes, ["propertyHelper.js"]);
        assert_eq!(plan.required_capabilities, BTreeSet::new());
    }

    #[test]
    fn excludes_non_strict_module_and_raw_lanes() {
        for (flag, reason) in [
            ("noStrict", "initial-lane:no-strict"),
            ("module", "initial-lane:module"),
            ("raw", "initial-lane:raw"),
        ] {
            assert_eq!(
                schedule_strict_script(&record(&[flag])),
                ScheduleOutcome::ScopeExcluded {
                    reason: reason.to_owned()
                }
            );
        }
    }

    #[test]
    fn records_capabilities_without_removing_the_test() {
        let ScheduleOutcome::Planned { plan } =
            schedule_strict_script(&record(&["onlyStrict", "async"]))
        else {
            panic!("strict async test should be scheduled");
        };
        assert!(
            plan.required_capabilities
                .contains(&RequiredCapability::AsyncCompletion)
        );
    }

    #[test]
    fn unknown_flags_are_never_ignored() {
        assert_eq!(
            schedule_strict_script(&record(&["futureFlag"])),
            ScheduleOutcome::Unsupported {
                reason: "unknown-flag:futureFlag".to_owned()
            }
        );
    }

    #[test]
    fn excludes_ecma_402_before_feature_scheduling() {
        let mut record = record(&[]);
        record.path = "test/intl402/NumberFormat/example.js".to_owned();
        assert_eq!(
            schedule_strict_script(&record),
            ScheduleOutcome::ScopeExcluded {
                reason: "initial-lane:intl402".to_owned()
            }
        );
    }

    #[test]
    fn unknown_negative_phases_are_never_guessed() {
        let mut record = record(&[]);
        record.negative = Some(super::super::model::NegativeExpectation {
            phase: NegativePhase::Other("future".to_owned()),
            error_type: "FutureError".to_owned(),
        });
        assert_eq!(
            schedule_strict_script(&record),
            ScheduleOutcome::Unsupported {
                reason: "unknown-negative-phase:future".to_owned()
            }
        );
    }
}
