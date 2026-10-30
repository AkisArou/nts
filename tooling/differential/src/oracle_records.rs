//! A check reads the generator header and exactly its own fixture record.
//! The tooling inventory control validates the complete directory; a check
//! never scans unrelated fixture records or consults a legacy flat view.
use anyhow::{Context, Result, ensure};
use camino::Utf8Path;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    version: u32,
    generator_version: u32,
    generator_digest: String,
    seed: (),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Shard {
    version: u32,
    fixture: String,
    rows: Vec<Value>,
}

fn fixture_of(source: &str) -> Result<String> {
    let parts: Vec<_> = source.split('/').collect();
    ensure!(
        parts.len() >= 4
            && matches!(
                (parts[0], parts[1]),
                ("tests", "programs") | ("benchmarks", "cases")
            )
            && parts
                .iter()
                .all(|part| !part.is_empty() && !matches!(*part, "." | ".."))
            && !source.chars().any(|c| c.is_control() || c == '\\'),
        "oracle not measured: invalid subject path {source}"
    );
    Ok(parts[..3].join("/"))
}

fn header(bytes: &[u8]) -> Result<()> {
    let generator: Header = serde_json::from_slice(bytes)?;
    let () = generator.seed;
    ensure!(
        generator.version == 1
            && generator.generator_version > 0
            && generator.generator_digest.len() == 32
            && generator
                .generator_digest
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        "oracle not measured: invalid generator header"
    );
    Ok(())
}

fn record(bytes: &[u8], expected: &str) -> Result<Value> {
    let record: Shard = serde_json::from_slice(bytes)?;
    ensure!(
        record.version == 1 && record.fixture == expected && !record.rows.is_empty(),
        "oracle not measured: invalid fixture record for {expected}"
    );
    let mut identities = std::collections::BTreeSet::new();
    let mut populations = std::collections::BTreeSet::new();
    for row in &record.rows {
        let source = row["source"]
            .as_str()
            .context("oracle record needs a source")?;
        ensure!(
            fixture_of(source)? == expected,
            "oracle record contains another fixture's source"
        );
        let signature = row["signature"]
            .as_str()
            .context("oracle record needs a signature")?;
        ensure!(
            identities.insert((source, signature)),
            "duplicate oracle fixture record"
        );
        let keys = row["keys"]
            .as_object()
            .context("oracle record needs backend keys")?;
        ensure!(!keys.is_empty(), "oracle record has no backend keys");
        for (backend, key) in keys {
            ensure!(
                matches!(backend.as_str(), "c" | "llvm" | "jvm"),
                "unknown oracle backend"
            );
            let key = key.as_str().context("oracle backend key must be text")?;
            ensure!(
                populations.insert((source, backend, key)),
                "duplicate oracle population"
            );
        }
    }
    Ok(serde_json::json!({"version":1,"rows":record.rows}))
}

pub(super) fn read(root: &Utf8Path, source: &str) -> Result<Value> {
    let fixture = fixture_of(source)?;
    let directory = root.join("results/oracle-counts");
    let generator = directory.join("_generator.json");
    header(
        &std::fs::read(&generator)
            .with_context(|| format!("missing generator header {generator}"))?,
    )?;
    let path = directory.join(format!("{fixture}.json"));
    record(
        &std::fs::read(&path).with_context(|| format!("missing fixture record {path}"))?,
        &fixture,
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    #[test]
    fn header_is_strict_and_versioned() {
        let header_value = json!({"version":1,"generator_version":1,"generator_digest":"a".repeat(32),"seed":null});
        assert!(header(&serde_json::to_vec(&header_value).unwrap()).is_ok());
        for (field, value) in [
            ("version", json!(2)),
            ("seed", json!(1)),
            ("extra", json!(true)),
        ] {
            let mut changed = header_value.clone();
            changed[field] = value;
            assert!(header(&serde_json::to_vec(&changed).unwrap()).is_err());
        }
    }

    #[test]
    fn records_cannot_borrow_another_fixture_or_duplicate_a_population() {
        let row = json!({"source":"tests/programs/example/src/main.ts","signature":"one","keys":{"c":"key"}});
        let base = json!({"version":1,"fixture":"tests/programs/example","rows":[row]});
        let read =
            |value: &Value, fixture: &str| record(&serde_json::to_vec(value).unwrap(), fixture);
        assert!(read(&base, "tests/programs/example").is_ok());
        assert!(read(&base, "tests/programs/other").is_err());
        let mut duplicate = base.clone();
        duplicate["rows"].as_array_mut().unwrap().push(row.clone());
        assert!(read(&duplicate, "tests/programs/example").is_err());
        duplicate["rows"][1]["signature"] = json!("two");
        assert!(read(&duplicate, "tests/programs/example").is_err());
        for invalid in [
            "tests/programs/../escape/main.ts",
            "tests/programs/example/../../escape.ts",
        ] {
            assert!(fixture_of(invalid).is_err());
        }
    }
}
