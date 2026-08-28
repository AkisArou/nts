use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::{
    metadata::{MetadataError, parse_test_record},
    model::{ScheduleOutcome, TestRecord},
    schedule::schedule_strict_script,
};

/// Counts that make suite discovery and strict scheduling auditable.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct SuiteInventory {
    pub pin: String,
    pub javascript_files: usize,
    pub fixtures: usize,
    pub standalone: usize,
    pub standalone_variants: usize,
    pub intl402: usize,
    pub intl402_variants: usize,
    pub ecma262: usize,
    pub ecma262_variants: usize,
    pub strict_script: usize,
    pub no_strict: usize,
    pub module: usize,
    pub raw: usize,
    pub unsupported_metadata: usize,
}

#[derive(Debug, Error)]
pub enum DiscoveryError {
    #[error("reading Test262 path {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("Test262 contains a non-UTF-8 path: {0:?}")]
    NonUtf8Path(PathBuf),
    #[error("unable to read the Test262 git pin: {0}")]
    Git(String),
    #[error("wrong Test262 pin: expected {expected}, found {actual}")]
    WrongPin { expected: String, actual: String },
    #[error("Test262 checkout has local changes:\n{0}")]
    DirtyCheckout(String),
    #[error(transparent)]
    Metadata(#[from] MetadataError),
}

/// Validate and parse the entire vendored suite.
///
/// Fixtures are inventoried but never parsed as standalone records. Returned
/// records are sorted by suite-relative path.
pub fn discover_suite(
    suite_root: &Path,
    expected_pin: &str,
) -> Result<(SuiteInventory, Vec<TestRecord>), DiscoveryError> {
    let pin = read_pin(suite_root)?;
    if pin != expected_pin {
        return Err(DiscoveryError::WrongPin {
            expected: expected_pin.to_owned(),
            actual: pin,
        });
    }
    ensure_clean_checkout(suite_root)?;

    let test_root = suite_root.join("test");
    let mut files = Vec::new();
    collect_javascript(&test_root, &mut files)?;
    files.sort_by_cached_key(|path| {
        path.strip_prefix(suite_root)
            .expect("collected paths are beneath the suite root")
            .to_string_lossy()
            .replace('\\', "/")
    });

    let mut inventory = SuiteInventory {
        pin,
        javascript_files: files.len(),
        ..SuiteInventory::default()
    };
    let mut records = Vec::new();

    for file in files {
        let relative = file
            .strip_prefix(suite_root)
            .expect("collected paths are beneath the suite root");
        let relative = relative
            .to_str()
            .ok_or_else(|| DiscoveryError::NonUtf8Path(relative.to_owned()))?
            .replace('\\', "/");
        if relative.ends_with("_FIXTURE.js") {
            inventory.fixtures += 1;
            continue;
        }

        let source = fs::read_to_string(&file).map_err(|source| DiscoveryError::Io {
            path: file.clone(),
            source,
        })?;
        let record = parse_test_record(&relative, &source)?;
        let full_variants = full_protocol_variant_count(&record);
        inventory.standalone += 1;
        inventory.standalone_variants += full_variants;

        if relative.starts_with("test/intl402/") {
            inventory.intl402 += 1;
            inventory.intl402_variants += full_variants;
        } else {
            inventory.ecma262 += 1;
            inventory.ecma262_variants += full_variants;
            match schedule_strict_script(&record) {
                ScheduleOutcome::Planned { .. } => inventory.strict_script += 1,
                ScheduleOutcome::ScopeExcluded { ref reason }
                    if reason == "initial-lane:no-strict" =>
                {
                    inventory.no_strict += 1;
                }
                ScheduleOutcome::ScopeExcluded { ref reason }
                    if reason == "initial-lane:module" =>
                {
                    inventory.module += 1;
                }
                ScheduleOutcome::ScopeExcluded { ref reason } if reason == "initial-lane:raw" => {
                    inventory.raw += 1;
                }
                ScheduleOutcome::ScopeExcluded { .. } | ScheduleOutcome::Unsupported { .. } => {
                    inventory.unsupported_metadata += 1;
                }
            }
        }
        records.push(record);
    }

    Ok((inventory, records))
}

fn full_protocol_variant_count(record: &TestRecord) -> usize {
    if record
        .flags
        .iter()
        .any(|flag| matches!(flag.as_str(), "module" | "noStrict" | "onlyStrict" | "raw"))
    {
        1
    } else {
        2
    }
}

fn collect_javascript(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), DiscoveryError> {
    let entries = fs::read_dir(dir).map_err(|source| DiscoveryError::Io {
        path: dir.to_owned(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| DiscoveryError::Io {
            path: dir.to_owned(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_javascript(&path, files)?;
        } else if path.extension().is_some_and(|extension| extension == "js") {
            files.push(path);
        }
    }
    Ok(())
}

fn read_pin(suite_root: &Path) -> Result<String, DiscoveryError> {
    let output = Command::new("git")
        .args(["-C"])
        .arg(suite_root)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|error| DiscoveryError::Git(error.to_string()))?;
    if !output.status.success() {
        return Err(DiscoveryError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn ensure_clean_checkout(suite_root: &Path) -> Result<(), DiscoveryError> {
    let output = Command::new("git")
        .args(["-C"])
        .arg(suite_root)
        .args(["status", "--porcelain=v1", "--untracked-files=all"])
        .output()
        .map_err(|error| DiscoveryError::Git(error.to_string()))?;
    if !output.status.success() {
        return Err(DiscoveryError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let changes = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if changes.is_empty() {
        Ok(())
    } else {
        Err(DiscoveryError::DirtyCheckout(changes))
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    use serde::Deserialize;

    use super::*;

    #[test]
    #[ignore = "walks the optional vendored Test262 checkout"]
    fn pinned_corpus_matches_the_documented_strict_inventory() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../third_party/test262");
        if !root.is_dir() {
            return;
        }
        let (inventory, records) =
            discover_suite(&root, "d86b2294eb0a17eaa281ff12c73c473ec864c72f")
                .expect("the pinned suite must parse completely");
        assert_eq!(inventory.javascript_files, 53_872);
        assert_eq!(inventory.fixtures, 294);
        assert_eq!(inventory.standalone, 53_578);
        assert_eq!(inventory.standalone_variants, 102_918);
        assert_eq!(records.len(), 53_578);
        assert_eq!(inventory.intl402, 3_357);
        assert_eq!(inventory.intl402_variants, 6_714);
        assert_eq!(inventory.ecma262, 50_221);
        assert_eq!(inventory.ecma262_variants, 96_204);
        assert_eq!(inventory.strict_script, 46_661);
        assert_eq!(inventory.no_strict, 2_687);
        assert_eq!(inventory.module, 843);
        assert_eq!(inventory.raw, 30);
        assert_eq!(inventory.unsupported_metadata, 0);
    }

    #[derive(Debug, Deserialize)]
    struct PythonRecord {
        path: String,
        metadata: serde_json::Value,
        body_hash: String,
    }

    #[test]
    #[ignore = "walks Test262 and invokes its bundled Python parser"]
    fn rust_metadata_matches_test262s_parser_for_the_whole_pin() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../third_party/test262");
        if !root.is_dir() {
            return;
        }
        let (_, records) = discover_suite(&root, "d86b2294eb0a17eaa281ff12c73c473ec864c72f")
            .expect("the Rust parser must accept the pin");

        let script = r#"
import json
import os
import sys

root = os.path.abspath(sys.argv[1])
packaging = os.path.join(root, "tools", "packaging")
sys.path.insert(0, packaging)
import monkeyYaml
import parseTestRecord

def fnv1a(text):
    value = 0xcbf29ce484222325
    for byte in text.encode("utf-8"):
        value ^= byte
        value = (value * 0x100000001b3) & 0xffffffffffffffff
    return f"{value:016x}"

paths = []
test_root = os.path.join(root, "test")
for directory, _, files in os.walk(test_root):
    for name in files:
        if name.endswith(".js") and not name.endswith("_FIXTURE.js"):
            paths.append(os.path.join(directory, name))

for path in sorted(paths):
    with open(path, "r", encoding="utf-8", newline="") as source_file:
        source = source_file.read()
    errors = []
    attrs = parseTestRecord.findAttrs(source)[1]
    metadata = monkeyYaml.load(attrs) if attrs else {}
    record = parseTestRecord.parseTestRecord(source, path, errors.append)
    if errors:
        raise RuntimeError("; ".join(errors))
    relative = os.path.relpath(path, root).replace(os.sep, "/")
    print(json.dumps({
        "path": relative,
        "metadata": metadata,
        "body_hash": fnv1a(record["test"]),
    }, sort_keys=True, separators=(",", ":")))
"#;

        let mut child = Command::new("python3")
            .args(["-c", script])
            .arg(&root)
            .stdout(Stdio::piped())
            .spawn()
            .expect("python3 is required for the explicit parity audit");
        let stdout = child.stdout.take().expect("captured Python output");
        let mut lines = BufReader::new(stdout).lines();

        for record in &records {
            let line = lines
                .next()
                .expect("Python emitted one record per standalone test")
                .expect("read Python output");
            let reference: PythonRecord =
                serde_json::from_str(&line).expect("Python emitted valid JSON");
            assert_eq!(reference.path, record.path);
            assert_eq!(
                reference.metadata,
                serde_json::to_value(&record.metadata).expect("serialize Rust metadata"),
                "metadata differs for {}",
                record.path
            );
            assert_eq!(
                reference.body_hash,
                fnv1a(&record.body),
                "test body differs for {}",
                record.path
            );
        }
        assert!(
            lines.next().is_none(),
            "Python emitted unexpected extra records"
        );
        assert!(child.wait().expect("wait for Python parser").success());
    }

    fn fnv1a(text: &str) -> String {
        let mut value = 0xcbf2_9ce4_8422_2325_u64;
        for byte in text.as_bytes() {
            value ^= u64::from(*byte);
            value = value.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{value:016x}")
    }
}
