use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::model::{UnscheduledResult, UnscheduledStatus, VariantResult, VerdictStatus};

/// Stable, compiler-independent report for the initial strict-script lane.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RunReport {
    pub schema_version: u32,
    pub suite_pin: String,
    pub lane: String,
    pub results: Vec<VariantResult>,
    pub unscheduled: Vec<UnscheduledResult>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SummaryCount {
    pub status: VerdictStatus,
    pub count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReportSummary {
    pub verdicts: Vec<SummaryCount>,
    pub scope_excluded: usize,
    pub schedule_unsupported: usize,
}

impl RunReport {
    #[must_use]
    pub fn new(
        suite_pin: impl Into<String>,
        results: impl IntoIterator<Item = VariantResult>,
        unscheduled: impl IntoIterator<Item = UnscheduledResult>,
    ) -> Self {
        let mut results: Vec<_> = results.into_iter().collect();
        results.sort_by(|left, right| {
            (
                &left.variant_id,
                &left.test_path,
                left.verdict.status,
                &left.verdict.reason,
            )
                .cmp(&(
                    &right.variant_id,
                    &right.test_path,
                    right.verdict.status,
                    &right.verdict.reason,
                ))
        });
        let mut unscheduled: Vec<_> = unscheduled.into_iter().collect();
        unscheduled.sort_by(|left, right| {
            (&left.test_path, left.status, &left.reason).cmp(&(
                &right.test_path,
                right.status,
                &right.reason,
            ))
        });
        Self {
            schema_version: 1,
            suite_pin: suite_pin.into(),
            lane: "strict-global-script".to_owned(),
            results,
            unscheduled,
        }
    }

    #[must_use]
    pub fn summary(&self) -> ReportSummary {
        let mut counts = BTreeMap::new();
        for result in &self.results {
            *counts.entry(result.verdict.status).or_insert(0) += 1;
        }
        let verdicts = counts
            .into_iter()
            .map(|(status, count)| SummaryCount { status, count })
            .collect();
        let scope_excluded = self
            .unscheduled
            .iter()
            .filter(|result| result.status == UnscheduledStatus::ScopeExcluded)
            .count();
        let schedule_unsupported = self.unscheduled.len() - scope_excluded;
        ReportSummary {
            verdicts,
            scope_excluded,
            schedule_unsupported,
        }
    }

    pub fn to_pretty_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test262_runner::Verdict;

    fn result(id: &str, status: VerdictStatus) -> VariantResult {
        VariantResult {
            variant_id: id.to_owned(),
            test_path: id.split('#').next().expect("test path").to_owned(),
            verdict: Verdict {
                status,
                reason: "scripted".to_owned(),
            },
        }
    }

    #[test]
    fn sorts_results_and_counts_statuses_deterministically() {
        let report = RunReport::new(
            "pin",
            [
                result("test/z.js#strict", VerdictStatus::Fail),
                result("test/a.js#strict", VerdictStatus::StrictPass),
                result("test/b.js#strict", VerdictStatus::StrictPass),
            ],
            [
                UnscheduledResult {
                    test_path: "test/no-strict.js".to_owned(),
                    status: UnscheduledStatus::ScopeExcluded,
                    reason: "initial-lane:no-strict".to_owned(),
                },
                UnscheduledResult {
                    test_path: "test/future.js".to_owned(),
                    status: UnscheduledStatus::Unsupported,
                    reason: "unknown-flag:future".to_owned(),
                },
            ],
        );
        assert_eq!(report.results[0].variant_id, "test/a.js#strict");
        assert_eq!(
            report.summary(),
            ReportSummary {
                verdicts: vec![
                    SummaryCount {
                        status: VerdictStatus::StrictPass,
                        count: 2,
                    },
                    SummaryCount {
                        status: VerdictStatus::Fail,
                        count: 1,
                    },
                ],
                scope_excluded: 1,
                schedule_unsupported: 1,
            }
        );
        let json = report.to_pretty_json().expect("serialize report");
        // Ordered, not merely present: a report whose failures move between
        // runs is a report nobody can diff.
        let first = json.find("test/a.js").expect("the first failure is reported");
        let second = json.find("test/z.js").expect("the second failure is reported");
        assert!(first < second, "failures are reported in path order");
    }
}
