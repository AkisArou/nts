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

/// Schedule the one variant `NativeTS` targets: strict global script, or module.
///
/// Parsing and scheduling are intentionally separate: every file is parsed,
/// while `noStrict` and raw files remain visible as reasoned scope exclusions.
#[must_use]
pub fn schedule_strict_script(record: &TestRecord) -> ScheduleOutcome {
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

    // **A module test is in the lane** (the project owner's decision,
    // 2026-10-02). It runs once, as a module, which is strict by definition:
    // INTERPRETING.md runs a `module` file only as module code, never as a
    // script, so there is no strict-script variant of it to plan.
    let module = record.flags.contains("module");
    ScheduleOutcome::Planned {
        plan: VariantPlan {
            id: format!("{}#{}", record.path, if module { "module" } else { "strict" }),
            test_path: record.path.clone(),
            strict_prefix: if module { String::new() } else { "\"use strict\";\n".to_owned() },
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
    fn excludes_non_strict_and_raw_lanes() {
        for (flag, reason) in [
            ("noStrict", "initial-lane:no-strict"),
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
    fn schedules_a_module_test_as_its_one_module_variant() {
        let ScheduleOutcome::Planned { plan } = schedule_strict_script(&record(&["module"])) else {
            panic!("a module test is in the lane");
        };
        assert_eq!(plan.id, "language/example.js#module");
        assert_eq!(plan.strict_prefix, "");
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
    fn schedules_ecma_402_as_an_implementation_gap() {
        let mut record = record(&[]);
        record.path = "test/intl402/NumberFormat/example.js".to_owned();
        assert!(matches!(schedule_strict_script(&record), ScheduleOutcome::Planned { .. }));
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
