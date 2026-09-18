//! A machine-readable selection, for the gap census.
//!
//! The census asks a narrower question than the protocol does: *why does the
//! compiler refuse this file*, never *does this file pass*. It needs a list of
//! files with the metadata that decides how each is fed to a compiler, and it
//! needs that list to be produced by the parser that is already validated
//! against Test262's own, rather than by a second reader.
//!
//! # Why this emits, rather than compiles
//!
//! Nothing here touches the compiler, and that boundary is deliberate: the
//! crate keeps `nts-core` and friends behind the optional `measurements`
//! feature so this layer can be trusted as standards-facing. A driver consumes
//! what `select` emits and does the compiling out of process, which also means
//! a panic in lowering over an arbitrary input costs one row rather than the
//! whole run.
//!
//! **The driver must never open a test file's frontmatter.** `metadata.rs`
//! implements Test262's `monkeyYaml` dialect and is checked against the suite's
//! own Python parser over every standalone file; a second YAML reader in the
//! driver would be two derivations of one fact, and they would disagree.
//!
//! # Every file is emitted, including the ones that are not scheduled
//!
//! An exclusion that is not in the output is an exclusion nobody can audit. A
//! `noStrict` file appears with `schedule: "scope-excluded"` and the
//! scheduler's own reason code, not by being absent -- which is the same
//! discipline `runtime/node/*/not-applicable` carries for the Node corpus, and
//! the reason `stale-exclusions.mjs` can ask whether a stated reason has
//! stopped being true.

use serde::Serialize;

use super::model::{NegativeExpectation, ScheduleOutcome, TestRecord};
use super::schedule::schedule_strict_script;

/// One test file, and what the protocol decided about it.
#[derive(Debug, Clone, Serialize)]
pub struct Selection {
    pub path: String,
    /// `planned`, `scope-excluded` or `unsupported` -- the scheduler's own
    /// vocabulary, not a census invention.
    pub schedule: &'static str,
    /// The scheduler's reason code. `None` only for `planned`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_id: Option<String>,
    /// What the strict variant prepends to the *test* unit. Emitted rather than
    /// reconstructed: the driver writing `"use strict";` itself would be a
    /// second derivation of a rule `assemble.rs` already owns.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strict_prefix: Option<String>,
    pub includes: Vec<String>,
    pub features: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub negative: Option<NegativeExpectation>,
    pub source_hash: String,
    pub body_hash: String,
    /// Whether the test body contains a `function` keyword or a `=>`.
    ///
    /// **A textual floor, not a parse, and named so it cannot be mistaken for
    /// one.** It exists to find the slice with no unannotated parameters --
    /// those files cannot produce an implicit `any`, so their refusals are
    /// lowering gaps rather than the typecheck wall. A file with `function` in
    /// a string literal counts as having one, which makes this
    /// conservative in the safe direction: the slice it selects is smaller
    /// than the true one, never larger.
    pub function_token: bool,
}

/// Every record under `prefix`, with what the strict-script scheduler decided.
///
/// `prefix` is matched against the suite-relative path, so
/// `test/language/expressions` selects that directory and nothing else.
#[must_use]
pub fn select(records: &[TestRecord], prefix: &str) -> Vec<Selection> {
    let mut chosen: Vec<_> = records
        .iter()
        .filter(|record| record.path.starts_with(prefix))
        .map(selection_for)
        .collect();
    // Sorted, so two runs over one checkout are byte-identical and a diff
    // between them is a change in the suite rather than in the walk order.
    chosen.sort_by(|left, right| left.path.cmp(&right.path));
    chosen
}

fn selection_for(record: &TestRecord) -> Selection {
    let common = |schedule, reason, variant_id, strict_prefix| Selection {
        path: record.path.clone(),
        schedule,
        reason,
        variant_id,
        strict_prefix,
        includes: record.includes.clone(),
        features: record.features.clone(),
        negative: record.negative.clone(),
        source_hash: record.source_hash.clone(),
        body_hash: record.body_hash.clone(),
        function_token: has_a_function_token(&record.body),
    };
    match schedule_strict_script(record) {
        ScheduleOutcome::Planned { plan } => common(
            "planned",
            None,
            Some(plan.id.clone()),
            Some(plan.strict_prefix.clone()),
        ),
        ScheduleOutcome::ScopeExcluded { reason } => {
            common("scope-excluded", Some(reason), None, None)
        },
        ScheduleOutcome::Unsupported { reason } => common("unsupported", Some(reason), None, None),
    }
}

/// Whether a body mentions a function at all.
///
/// Deliberately textual. Recognising a function properly needs a parser, and
/// the one question this answers -- *could this file have an unannotated
/// parameter* -- is answered safely by over-counting: a match in a comment or a
/// string shrinks the selected slice and never widens it.
fn has_a_function_token(body: &str) -> bool {
    body.contains("=>") || body.contains("function")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test262_runner::model::{NegativePhase, YamlValue};
    use std::collections::{BTreeMap, BTreeSet};

    fn record(path: &str, flags: &[&str], body: &str) -> TestRecord {
        let mut metadata = BTreeMap::new();
        metadata.insert("description".to_owned(), YamlValue::String("t".to_owned()));
        TestRecord {
            path: path.to_owned(),
            source_hash: "s".to_owned(),
            body_hash: "b".to_owned(),
            header: String::new(),
            body: body.to_owned(),
            metadata,
            flags: flags.iter().map(|flag| (*flag).to_owned()).collect::<BTreeSet<_>>(),
            includes: Vec::new(),
            features: Vec::new(),
            negative: None,
        }
    }

    #[test]
    fn a_scope_excluded_file_is_emitted_with_its_reason_rather_than_dropped() {
        let records = vec![record("test/language/expressions/a.js", &["noStrict"], "1;")];
        let chosen = select(&records, "test/language/expressions");
        assert_eq!(chosen.len(), 1, "an exclusion nobody can see is not auditable");
        assert_eq!(chosen[0].schedule, "scope-excluded");
        assert!(
            chosen[0].reason.as_ref().is_some_and(|it| !it.is_empty()),
            "every exclusion carries a reason code"
        );
        assert!(chosen[0].variant_id.is_none());
    }

    #[test]
    fn a_planned_file_carries_the_variant_and_the_strict_prefix() {
        let records = vec![record("test/language/expressions/a.js", &[], "1;")];
        let chosen = select(&records, "test/language/expressions");
        assert_eq!(chosen[0].schedule, "planned");
        assert!(chosen[0].reason.is_none());
        assert!(chosen[0].variant_id.is_some());
        assert_eq!(
            chosen[0].strict_prefix.as_deref(),
            Some("\"use strict\";\n"),
            "emitted, so the driver never reconstructs a rule assemble.rs owns"
        );
    }

    #[test]
    fn the_prefix_selects_a_directory_and_nothing_else() {
        let records = vec![
            record("test/language/expressions/a.js", &[], "1;"),
            record("test/built-ins/Math/b.js", &[], "1;"),
        ];
        let chosen = select(&records, "test/language/expressions");
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].path, "test/language/expressions/a.js");
    }

    #[test]
    fn the_function_token_separates_the_two_slices() {
        let records = vec![
            record("test/language/expressions/a.js", &[], "assert.sameValue(typeof true, \"boolean\");"),
            record("test/language/expressions/b.js", &[], "function f(x) { return x; }"),
            record("test/language/expressions/c.js", &[], "const f = (x) => x;"),
        ];
        let chosen = select(&records, "test/language/expressions");
        assert!(!chosen[0].function_token, "literals only: no parameter to leave unannotated");
        assert!(chosen[1].function_token);
        assert!(chosen[2].function_token, "an arrow is a function for this question");
    }

    #[test]
    fn the_order_does_not_depend_on_the_order_records_arrive_in() {
        let forward = vec![
            record("test/language/expressions/a.js", &[], "1;"),
            record("test/language/expressions/b.js", &[], "1;"),
        ];
        let mut backward = forward.clone();
        backward.reverse();
        let left = select(&forward, "test/language/expressions");
        let right = select(&backward, "test/language/expressions");
        assert_eq!(
            left.iter().map(|it| it.path.as_str()).collect::<Vec<_>>(),
            right.iter().map(|it| it.path.as_str()).collect::<Vec<_>>(),
        );
    }

    #[test]
    fn a_negative_expectation_survives_into_the_selection() {
        let mut only = record("test/language/expressions/a.js", &[], "1;");
        only.negative = Some(NegativeExpectation {
            phase: NegativePhase::Parse,
            error_type: "SyntaxError".to_owned(),
        });
        let chosen = select(&[only], "test/language/expressions");
        let negative = chosen[0].negative.as_ref().expect("the expectation is carried");
        assert_eq!(negative.error_type, "SyntaxError");
    }
}
