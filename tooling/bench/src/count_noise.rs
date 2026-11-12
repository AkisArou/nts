//! Empirical repeat ranges, read from the calibration owner's results record.
use anyhow::{Context, Result, ensure};
use camino::Utf8Path;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    measure: String,
    definition: String,
    provenance: serde_json::Value,
    observations: Vec<serde_json::Value>,
    columns: Vec<Column>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Column {
    name: String,
    samples: Vec<u64>,
    min: u64,
    max: u64,
    band_basis_points: u64,
}

pub(super) struct Bands {
    pub(super) values: BTreeMap<String, u64>,
    pub(super) provenance: serde_json::Value,
}

pub(super) fn read(root: &Utf8Path, expected: &[&str]) -> Result<Bands> {
    let path = root.join("results/benchmarks/count-bands.json");
    let record: Record = serde_json::from_slice(&std::fs::read(&path).with_context(|| {
        format!("count bands: cannot read {path}; run count-bands.ts --record")
    })?)
    .context("count bands: invalid results record")?;
    validate(record, expected)
}

fn validate(record: Record, expected: &[&str]) -> Result<Bands> {
    ensure!(
        record.version == 1,
        "count bands: unsupported record version {}",
        record.version
    );
    ensure!(
        record.measure == "instructions:u/per-op"
            && record.definition == "max-minus-min-over-min-ceil-bp-v1",
        "count bands: unsupported measurement or rounding rule"
    );
    let runs = record.observations.len();
    ensure!(
        record.provenance["version"] == 1,
        "count bands: unsupported provenance version"
    );
    for field in ["case", "profile", "unit", "host"] {
        ensure!(
            record.provenance[field]
                .as_str()
                .is_some_and(|x| !x.trim().is_empty()),
            "count bands: missing {field} provenance"
        );
    }
    ensure!(
        runs >= 2 && record.provenance["runs"].as_u64() == Some(runs as u64),
        "count bands: incomplete cohort"
    );
    let cpu = record.provenance["counter_cpu"]
        .as_u64()
        .context("count bands: missing CPU provenance")?;
    ensure!(
        ![4, 5].contains(&cpu) && record.provenance["measurement_lock"] == false,
        "count bands: cohort used the measurement pair or lock"
    );
    for (field, length) in [
        ("source_commit", 40),
        ("binary_sha256", 64),
        ("raw_cohort_sha256", 64),
    ] {
        let value = record.provenance[field]
            .as_str()
            .with_context(|| format!("count bands: missing {field}"))?;
        ensure!(
            value.len() == length && value.bytes().all(|x| x.is_ascii_hexdigit()),
            "count bands: invalid {field}"
        );
    }
    ensure!(
        record.columns.len() == expected.len(),
        "count bands: incomplete column inventory"
    );
    let mut bands = BTreeMap::new();
    for (column, expected) in record.columns.into_iter().zip(expected) {
        ensure!(
            column.name == *expected && column.samples.len() == runs,
            "count bands: column identity or cohort length changed: {}",
            column.name
        );
        let low = *column
            .samples
            .iter()
            .min()
            .context("count bands: empty samples")?;
        let high = *column
            .samples
            .iter()
            .max()
            .context("count bands: empty samples")?;
        ensure!(
            low > 0 && column.min == low && column.max == high,
            "count bands: invalid sample range for {}",
            column.name
        );
        let numerator = u128::from(high - low) * 10000;
        let observed = numerator.div_ceil(u128::from(low));
        ensure!(
            u128::from(column.band_basis_points) == observed,
            "count bands: band disagrees with samples for {}",
            column.name
        );
        bands.insert(column.name, column.band_basis_points);
    }
    Ok(Bands {
        values: bands,
        provenance: record.provenance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../results/benchmarks/count-bands.json"))
            .expect("tool-written calibration")
    }
    fn check(value: &serde_json::Value) -> Result<Bands> {
        let names = value["columns"]
            .as_array()
            .expect("column inventory")
            .iter()
            .map(|x| x["name"].as_str().expect("column name"))
            .collect::<Vec<_>>();
        validate(serde_json::from_value(value.clone())?, &names)
    }
    #[test]
    fn the_recorded_bands_recompute_from_the_retained_samples() {
        let bands = check(&record()).expect("authentic measured ranges");
        assert_eq!(bands.values.len(), 9);
        for name in ["nts C", "nts LLVM", "C++", "ScriptC"] {
            assert!(bands.values[name] < 100);
        }
    }
    #[test]
    fn a_missing_sample_invented_band_or_future_format_is_refused() {
        for (field, value) in [
            ("version", serde_json::json!(2)),
            ("measure", serde_json::json!("wall time")),
        ] {
            let mut changed = record();
            changed[field] = value;
            assert!(check(&changed).is_err());
        }
        let mut changed = record();
        changed["columns"][0]["band_basis_points"] = serde_json::json!(9999);
        assert!(check(&changed).is_err());
        let mut changed = record();
        changed["columns"][0]["samples"]
            .as_array_mut()
            .expect("samples")
            .pop();
        assert!(check(&changed).is_err());
    }
}
