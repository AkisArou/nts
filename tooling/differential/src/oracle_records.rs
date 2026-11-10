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
    /// A planner past its CPU bound on these backends named its entry and
    /// planned nothing: the entry's plan budget, beside the rows, which no case
    /// key names.
    #[serde(default)]
    unplanned: Option<Value>,
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
        matches!(record.version, 1 | 2)
            && record.fixture == expected
            && (!record.rows.is_empty() || record.unplanned.is_some()),
        "oracle not measured: invalid fixture record for {expected}"
    );
    ensure!(
        record.version == 2
            || (record.unplanned.is_none()
                && !record.rows.iter().any(|row| row["kind"] == "budget")),
        "oracle budget rows require fixture record version 2"
    );
    if let Some(unplanned) = &record.unplanned {
        let backends = unplanned["backends"]
            .as_array()
            .context("a plan budget names its backends")?;
        let source = unplanned["source"]
            .as_str()
            .context("a plan budget names its entry")?;
        ensure!(
            fixture_of(source)? == expected
                && !backends.is_empty()
                && backends
                    .iter()
                    .all(|backend| matches!(backend.as_str(), Some("c" | "llvm" | "jvm")))
                && unplanned["budget"]["version"] == 1
                && unplanned["budget"]["phase"] == "plan",
            "oracle not measured: invalid plan budget for {expected}"
        );
    }
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
    Ok(serde_json::json!({"version":1,"rows":record.rows,"unplanned":record.unplanned}))
}

/// The record a source's fixture is held to, relative to the repository.
pub(super) fn record_path(source: &str) -> Result<String> {
    Ok(format!(
        "results/oracle-counts/{}.json",
        fixture_of(source)?
    ))
}

/// The source's fixture record, or `None` when the fixture has none yet: a
/// pending fixture, recorded after landing by the full check.
pub(super) fn read(root: &Utf8Path, source: &str) -> Result<Option<Value>> {
    let fixture = fixture_of(source)?;
    let generator = root.join("results/oracle-counts/_generator.json");
    header(
        &std::fs::read(&generator)
            .with_context(|| format!("missing generator header {generator}"))?,
    )?;
    let path = root.join(record_path(source)?);
    let bytes = match std::fs::read(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        bytes => bytes.with_context(|| format!("reading fixture record {path}"))?,
    };
    record(&bytes, &fixture).map(Some)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    #[test]
    fn a_fixture_without_a_record_is_pending_but_a_missing_header_is_not() {
        let root = camino::Utf8PathBuf::from_path_buf(
            std::env::temp_dir().join(format!("nts-oracle-records-{}", std::process::id())),
        )
        .unwrap();
        let source = "tests/programs/example/src/main.ts";
        assert!(read(&root, source).is_err(), "no generator header");
        let fixtures = root.join("results/oracle-counts/tests/programs");
        std::fs::create_dir_all(&fixtures).unwrap();
        let generator = json!({"version":1,"generator_version":1,"generator_digest":"a".repeat(32),"seed":null});
        std::fs::write(
            root.join("results/oracle-counts/_generator.json"),
            serde_json::to_vec(&generator).unwrap(),
        )
        .unwrap();
        assert!(read(&root, source).unwrap().is_none(), "no fixture record");
        let row = json!({"source":source,"signature":"one","keys":{"c":"key"}});
        let shard = json!({"version":1,"fixture":"tests/programs/example","rows":[row]});
        std::fs::write(
            fixtures.join("example.json"),
            serde_json::to_vec(&shard).unwrap(),
        )
        .unwrap();
        assert!(read(&root, source).unwrap().is_some());
        assert_eq!(
            record_path(source).unwrap(),
            "results/oracle-counts/tests/programs/example.json"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

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
    fn a_budget_requires_its_version_and_never_becomes_a_zero_count() {
        let fixture = "benchmarks/cases/private";
        let mut shard = json!({"version":2,"fixture":fixture,"rows":[{
            "kind":"budget","source":"benchmarks/cases/private/case.ts",
            "signature":"one","keys":{"c":"key"},
            "budget":{"version":1,"phase":"execute","outcome":"timeout","bound":60,"signal":"SIGKILL","reason":"oracle timed out"}
        }]});
        let parsed = record(&serde_json::to_vec(&shard).unwrap(), fixture).unwrap();
        assert_eq!(parsed["rows"][0]["kind"], "budget");
        assert!(parsed["rows"][0].get("count").is_none());
        shard["version"] = json!(1);
        assert!(
            record(&serde_json::to_vec(&shard).unwrap(), fixture)
                .unwrap_err()
                .to_string()
                .contains("require fixture record version 2")
        );
        shard["version"] = json!(3);
        assert!(record(&serde_json::to_vec(&shard).unwrap(), fixture).is_err());
    }

    #[test]
    fn a_plan_budget_is_its_entrys_record_beside_rows_it_may_have_none_of() {
        let fixture = "benchmarks/cases/slow";
        let shard = json!({"version":2,"fixture":fixture,"rows":[],"unplanned":{
            "source":"benchmarks/cases/slow/case.ts","backends":["c","llvm"],
            "budget":{"version":1,"phase":"plan","outcome":"timeout","bound":600,"signal":"SIGKILL","reason":"oracle planner timed out"},
            "revision":{"entry":"e","node":"n","producer":"p","policy":"q"}}});
        let read = |value: &Value| record(&serde_json::to_vec(value).unwrap(), fixture);
        let parsed = read(&shard).unwrap();
        assert_eq!(parsed["rows"], json!([]));
        assert_eq!(parsed["unplanned"]["backends"], json!(["c", "llvm"]));
        let mut empty = shard.clone();
        empty.as_object_mut().unwrap().remove("unplanned");
        assert!(read(&empty).is_err(), "a record of nothing");
        for (path, value) in [
            ("/version", json!(1)),
            ("/unplanned/source", json!("benchmarks/cases/other/case.ts")),
            ("/unplanned/backends", json!([])),
            ("/unplanned/backends", json!(["wasm"])),
            ("/unplanned/budget/phase", json!("execute")),
        ] {
            let mut changed = shard.clone();
            *changed.pointer_mut(path).unwrap() = value;
            assert!(read(&changed).is_err(), "{path}");
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
