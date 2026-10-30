//! The checked-in promise is full coverage of an explicitly recorded population.
//! Tables belong to the fixture checkout, so a pinned compiler can check a new
//! fixture using its checked-in record without embedding that fixture forever.
//! Numeric rows promise complete delivery of an ordered case list. A body-only
//! change needs no new row: every gate run measures delivery again and detects
//! shortfalls or disagreements. Only a no-oracle row needs a source digest,
//! because no execution checks its empty-population exception.
use anyhow::{Context, Result, bail, ensure};
use camino::{Utf8Path, Utf8PathBuf};
use nts_codegen_common::Backend;
use serde_json::Value;

pub(super) const CPU_SECONDS: u64 = 15;
pub(super) const WALL_MILLIS: u64 = 120_000;

pub(super) struct Coverage {
    pub(super) count: usize,
    pub(super) key: String,
}

pub(super) fn source_digest(entry: &Utf8Path) -> Result<String> {
    let bytes = std::fs::read(entry).with_context(|| format!("reading oracle source {entry}"))?;
    Ok(format!("{:032x}", xxhash_rust::xxh3::xxh3_128(&bytes)))
}

pub(super) fn root_and_source(entry: &Utf8Path) -> Option<(Utf8PathBuf, String)> {
    for root in entry.ancestors().skip(1) {
        if root.join("tsconfig.fixtures.json").is_file()
            && root.join("tooling/differential/Cargo.toml").is_file()
        {
            let relative = entry.strip_prefix(root).ok()?;
            if relative.starts_with("tests/programs") || relative.starts_with("benchmarks/cases") {
                return Some((root.to_owned(), relative.as_str().replace('\\', "/")));
            }
            return None;
        }
    }
    None
}

pub(super) fn resolve(
    entry: &Utf8Path,
    backend: Backend,
    cases: &[super::Testable],
) -> Result<Coverage> {
    let (ids, signature) = super::oracle_population(cases);
    let key = super::oracle_case_key(backend, &ids, &signature)?;
    let count = ids.len();
    if let Some((root, source)) = root_and_source(entry) {
        let command = record_command(&source);
        let table = super::oracle_records::read(&root, &source)
            .with_context(|| format!("oracle not measured: {source}; run: {command}"))?;
        validate(
            &table,
            &source,
            backend.name(),
            &key,
            count,
            &source_digest(entry)?,
        )?;
    }
    Ok(Coverage { count, key })
}

fn record_command(source: &str) -> String {
    let path = source.split('/').take(3).collect::<Vec<_>>().join("/");
    let quoted = if path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c))
    {
        path
    } else {
        format!("'{}'", path.replace('\'', "'\\''"))
    };
    format!("node tooling/differential/record-oracles.ts {quoted}")
}

fn validate(
    table: &Value,
    source: &str,
    backend: &str,
    key: &str,
    generated: usize,
    digest: &str,
) -> Result<()> {
    let command = record_command(source);
    ensure!(
        table["version"] == 1,
        "oracle not measured: unknown count-table version"
    );
    let rows = table["rows"]
        .as_array()
        .context("oracle not measured: count table needs rows")?;
    let found: Vec<_> = rows
        .iter()
        .filter(|row| row["source"] == source && row["keys"][backend] == key)
        .collect();
    ensure!(
        found.len() == 1,
        "oracle not measured: {source} ({backend}) has no unique recorded population {key}; run: {command}"
    );
    let row = found[0];
    if row["kind"] == "no-oracle" {
        ensure!(
            generated == 0
                && row["source_digest"] == digest
                && row.get("count").is_none()
                && row["reason"]
                    .as_str()
                    .is_some_and(|reason| !reason.is_empty()),
            "oracle not measured: no-oracle identity changed for {source} ({backend}); re-record it explicitly"
        );
        return Ok(());
    }
    ensure!(
        row["kind"] == "measured"
            && row["complete"] == true
            && row["count"].as_u64() == u64::try_from(generated).ok(),
        "oracle not measured: recorded count for {source} ({backend}) is not its full generated count"
    );
    Ok(())
}

pub(super) fn measured_rows(
    mut rows: Vec<String>,
    done: Option<usize>,
    status: &Value,
    coverage: &Coverage,
) -> Result<Vec<String>> {
    let exit = status["exit_code"].as_i64();
    let signal = &status["signal"];
    let wall = status["wall_guard_fired"]
        .as_bool()
        .context("oracle not measured: missing supervisor disposition")?;
    ensure!(
        status["version"] == 1
            && status["error"].is_null()
            && (exit.is_some() || !signal.is_null()),
        "oracle not measured: supervisor did not complete: {status}"
    );
    if wall || !signal.is_null() || done != Some(rows.len()) || rows.len() < coverage.count {
        bail!(
            "oracle not measured: delivered {} of {} promised rows; done={done:?}, exit={exit:?}, signal={signal:?}, wall_guard={wall}",
            rows.len(),
            coverage.count
        );
    }
    // A genuine nonzero exit is retained separately. It cannot turn a short
    // result into a measured prefix, or impersonate the supervisor's guard.
    rows.truncate(coverage.count);
    Ok(rows)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    #[test]
    fn stale_or_lowered_records_are_not_a_promise() {
        let mut table = json!({"version":1,"rows":[{"kind":"measured","source":"a","keys":{"c":"key"},"complete":true,"count":2}]});
        validate(&table, "a", "c", "key", 2, "digest").unwrap();
        assert!(validate(&table, "a", "c", "changed", 2, "digest").is_err());
        table["rows"][0]["count"] = json!(1);
        assert!(validate(&table, "a", "c", "key", 2, "digest").is_err());
    }

    #[test]
    fn a_compact_row_never_borrows_another_backends_identity() {
        let table = json!({"version":1,"rows":[{"kind":"measured","source":"a",
            "keys":{"c":"key"},"complete":true,"count":2}]});
        validate(&table, "a", "c", "key", 2, "digest").unwrap();
        assert!(validate(&table, "a", "llvm", "key", 2, "digest").is_err());
    }

    #[test]
    fn no_oracle_is_an_explicit_empty_source_identity_never_a_numeric_zero() {
        let mut table = json!({"version":1,"rows":[{"kind":"no-oracle","source":"jsx",
            "keys":{"c":"empty"},"source_digest":"digest","reason":"node cannot load .tsx directly"}]});
        validate(&table, "jsx", "c", "empty", 0, "digest").unwrap();
        assert!(validate(&table, "jsx", "c", "empty", 0, "changed").is_err());
        assert!(validate(&table, "jsx", "c", "empty", 1, "digest").is_err());
        table["rows"][0]["count"] = json!(0);
        assert!(validate(&table, "jsx", "c", "empty", 0, "digest").is_err());
    }

    #[test]
    fn no_guarded_or_truncated_prefix_can_be_compared() {
        let coverage = Coverage {
            count: 2,
            key: "key".into(),
        };
        let status = json!({"version":1,"exit_code":0,"signal":null,"wall_guard_fired":false});
        assert!(measured_rows(vec!["one".into()], None, &status, &coverage).is_err());
        let killed =
            json!({"version":1,"exit_code":null,"signal":"SIGKILL","wall_guard_fired":true});
        assert!(
            measured_rows(
                vec!["one".into(), "two".into()],
                Some(2),
                &killed,
                &coverage
            )
            .is_err()
        );
        let own124 = json!({"version":1,"exit_code":124,"signal":null,"wall_guard_fired":false});
        assert_eq!(
            measured_rows(
                vec!["one".into(), "two".into(), "surplus".into()],
                Some(3),
                &own124,
                &coverage
            )
            .unwrap(),
            vec!["one", "two"]
        );
    }
}
