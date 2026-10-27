//! Reviewed workload exclusions. Identity is a fixture source path, function,
//! and complete argument tuple; a numeric value alone never selects a case.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use anyhow::{Context, Result, bail, ensure};
use camino::{Utf8Path, Utf8PathBuf};
use serde_json::Value;

const CATALOG: &str = include_str!("../oracle-exclusions.json");

struct Rule {
    fixture: String,
    source: Utf8PathBuf,
    function: String,
    tuple: Vec<u64>,
}

#[derive(Default)]
pub(super) struct Policy {
    pub(super) fixture: Option<String>,
    functions: Vec<(String, Vec<u64>)>,
}

impl Policy {
    pub(super) fn tuples_for(&self, function: &str) -> Vec<Vec<u64>> {
        self.functions
            .iter()
            .filter(|(name, _)| name == function)
            .map(|(_, tuple)| tuple.clone())
            .collect()
    }
}

fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value[field]
        .as_str()
        .filter(|text| !text.is_empty())
        .with_context(|| format!("oracle exclusion needs {field}"))
}

fn parse(catalog: &str) -> Result<Vec<Rule>> {
    let catalog: Value = serde_json::from_str(catalog)?;
    ensure!(catalog["version"] == 1, "unknown oracle exclusion version");
    let entries = catalog["entries"]
        .as_array()
        .context("oracle exclusions need entries")?;
    let mut unique = BTreeSet::new();
    let mut rules = Vec::new();
    for entry in entries {
        let fixture = text(entry, "fixture")?.to_owned();
        let source = Utf8PathBuf::from(text(entry, "source")?);
        ensure!(
            source.is_relative()
                && source.starts_with(&fixture)
                && !source.components().any(|part| part.as_str() == ".."),
            "oracle exclusion source must be inside its fixture: {source}"
        );
        let function = text(entry, "function")?.to_owned();
        let _ = text(entry, "reason")?;
        let tuple = entry["tuple"]
            .as_array()
            .context("oracle exclusion needs a tuple")?
            .iter()
            .map(|value| {
                let spelling = value.as_str().context("tuple values are strings")?;
                let number = if spelling == "NaN" {
                    f64::NAN
                } else {
                    spelling.parse::<f64>()?
                };
                ensure!(
                    number.is_finite() || spelling == "NaN",
                    "non-finite tuple value {spelling}"
                );
                Ok(number.to_bits())
            })
            .collect::<Result<Vec<_>>>()?;
        ensure!(
            unique.insert((source.clone(), function.clone(), tuple.clone())),
            "duplicate oracle exclusion: {fixture} {function}"
        );
        rules.push(Rule {
            fixture,
            source,
            function,
            tuple,
        });
    }
    Ok(rules)
}

pub(super) fn for_entry(entry: &Utf8Path) -> Result<Policy> {
    static RULES: OnceLock<std::result::Result<Vec<Rule>, String>> = OnceLock::new();
    let rules = match RULES.get_or_init(|| parse(CATALOG).map_err(|error| error.to_string())) {
        Ok(rules) => rules,
        Err(error) => bail!("invalid compiled oracle exclusions: {error}"),
    };
    let mut policy = Policy::default();
    // Component suffixes keep a fixture's identity across checkout paths,
    // project-config locations and working directories. A basename cannot
    // select a fixture, and unrelated functions in the same file stay intact.
    for rule in rules.iter().filter(|rule| entry.ends_with(&rule.source)) {
        policy.fixture = Some(rule.fixture.clone());
        policy
            .functions
            .push((rule.function.clone(), rule.tuple.clone()));
    }
    Ok(policy)
}

pub(super) fn matches(tuple: &[f64], excluded: &[Vec<u64>]) -> bool {
    excluded.iter().any(|candidate| {
        candidate.len() == tuple.len()
            && candidate
                .iter()
                .zip(tuple)
                .all(|(bits, value)| *bits == value.to_bits())
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn reviewed_catalog_is_unique_and_names_real_fixture_sources() {
        let rules = parse(CATALOG).unwrap();
        assert_eq!(rules.len(), 160);
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for rule in rules {
            let source = std::fs::read_to_string(root.join(&rule.source)).unwrap();
            assert!(source.contains(&format!("function {}(", rule.function)));
        }
    }

    #[test]
    fn every_catalog_row_matches_a_generated_tuple() {
        use nts_codegen_common::Backend;
        use nts_core::hir;
        use nts_frontend_ts::Frontend;
        use std::collections::BTreeMap;

        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        let scratch = super::super::Scratch::holding(
            camino::Utf8PathBuf::from_path_buf(std::env::temp_dir())
                .unwrap()
                .join(format!("nts-oracle-catalog-{}", std::process::id())),
        );
        std::fs::create_dir_all(&scratch.path).unwrap();
        let mut source = Frontend::new(&root);
        let mut grouped = BTreeMap::<Utf8PathBuf, Vec<Rule>>::new();
        for rule in parse(CATALOG).unwrap() {
            grouped.entry(rule.source.clone()).or_default().push(rule);
        }
        let mut unmatched = Vec::new();
        for (index, (path, rules)) in grouped.into_iter().enumerate() {
            let config = scratch.path.join(format!("fixture-{index}.json"));
            std::fs::write(
                &config,
                serde_json::to_vec(&serde_json::json!({
                    "extends":root.join("tsconfig.fixtures.json"),
                    "include":[root.join(path)]
                }))
                .unwrap(),
            )
            .unwrap();
            let snapshot = source.snapshot(&config).unwrap();
            assert!(!snapshot.has_errors(), "{config}");
            let provider = nts_codegen_common::provider::host_gc("jvm", false).unwrap();
            let options = super::super::pool_options(Backend::Jvm, provider);
            let raw = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign);
            let prepared = raw
                .into_prepared(&hir::PreparationOptions::from(&options))
                .unwrap_or_else(|error| panic!("{}", error.render(&snapshot.sources)));
            let (_, cases, _) =
                super::super::case_population(&snapshot, &prepared.program).unwrap();
            for rule in rules {
                let matched = cases.iter().any(|case| {
                    case.name == rule.function
                        && super::super::tuples(&case.params)
                            .iter()
                            .any(|tuple| matches(tuple, std::slice::from_ref(&rule.tuple)))
                });
                if !matched {
                    unmatched.push(format!(
                        "{} {} {:?}",
                        rule.fixture, rule.function, rule.tuple
                    ));
                }
            }
        }
        assert_eq!(unmatched, Vec::<String>::new(), "remove stale exclusions");
    }

    #[test]
    fn identity_is_fixture_function_and_whole_tuple() {
        let fixture = for_entry(Utf8Path::new(
            "/different/depth/benchmarks/cases/fib/case.ts",
        ))
        .unwrap();
        let excluded = fixture.tuples_for("fib");
        assert!(matches(&[100.0], &excluded));
        assert!(!matches(&[100.0, 3.0], &excluded));
        assert!(!matches(&[100.0], &fixture.tuples_for("other")));
        assert!(!matches(&[2_147_483_647.0], &excluded));
        assert!(!matches(&[f64::NAN], &excluded));
        let other = for_entry(Utf8Path::new("/tree/tests/programs/fib/case.ts")).unwrap();
        assert_eq!(other.tuples_for("fib"), Vec::<Vec<u64>>::new());
    }

    #[test]
    fn symbol_keys_keeps_every_other_pool_input() {
        let policy = for_entry(Utf8Path::new(
            "/checkout/benchmarks/cases/symbol-keys/case.ts",
        ))
        .unwrap();
        let rules = policy.tuples_for("keys");
        assert_eq!(rules.len(), 1);
        for input in crate::POOL {
            assert_eq!(
                matches(&[*input], &rules),
                input.to_bits() == 2_147_483_647_f64.to_bits()
            );
        }
        assert_eq!(policy.tuples_for("other"), Vec::<Vec<u64>>::new());
    }

    #[test]
    fn nan_is_excluded_only_for_the_two_infinite_iterators() {
        for (source, function) in [
            ("tests/programs/array-from/src/main.ts", "fromIterable"),
            ("benchmarks/cases/user-iterable/case.ts", "run"),
        ] {
            let policy = for_entry(Utf8Path::new(source)).unwrap();
            assert!(matches(&[f64::NAN], &policy.tuples_for(function)));
            assert!(!matches(&[f64::NAN], &policy.tuples_for("fromGenerator")));
            assert!(!matches(&[-0.0], &policy.tuples_for(function)));
        }
    }
}
