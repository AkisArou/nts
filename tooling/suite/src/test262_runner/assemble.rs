use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use thiserror::Error;
use xxhash_rust::xxh3::xxh3_64;

use super::{
    host_assets::{HOST_CONTRACT, HOST_DECLARATIONS},
    model::{
        AssemblyPlan, HostProfilePlan, RequiredCapability, SourceUnit, SourceUnitKind, TestRecord,
        VariantPlan,
    },
    schedule::schedule_strict_script,
};

const HOST_PROFILE_ID: &str = "native-ts-test262-v1";

#[derive(Debug, Error)]
pub enum AssemblyError {
    #[error("variant and record differ in {field}")]
    RecordMismatch { field: &'static str },
    #[error("unsafe Test262 harness include: {0:?}")]
    UnsafeInclude(String),
    #[error("reading Test262 source unit {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("Test262 source unit is not UTF-8: {0}")]
    NonUtf8(PathBuf),
    #[error("Test262 harness include resolves outside harness/: {0}")]
    IncludeEscapesHarness(PathBuf),
}

/// Resolver tied to one Test262 checkout, so repeated assembly canonicalizes
/// the trusted harness root only once.
#[derive(Clone, Debug)]
pub struct SuiteAssembler {
    harness_root: PathBuf,
    canonical_harness: PathBuf,
}

impl SuiteAssembler {
    pub fn new(suite_root: &Path) -> Result<Self, AssemblyError> {
        let harness_root = suite_root.join("harness");
        let canonical_harness =
            fs::canonicalize(&harness_root).map_err(|source| AssemblyError::Io {
                path: harness_root.clone(),
                source,
            })?;
        Ok(Self {
            harness_root,
            canonical_harness,
        })
    }

    pub fn assemble(
        &self,
        record: &TestRecord,
        variant: VariantPlan,
    ) -> Result<AssemblyPlan, AssemblyError> {
        validate_record(&variant, record)?;
        let mut source_units = Vec::with_capacity(variant.includes.len() + 1);

        for include in &variant.includes {
            validate_include(include)?;
            let path = self.harness_root.join(include);
            let canonical = fs::canonicalize(&path).map_err(|source| AssemblyError::Io {
                path: path.clone(),
                source,
            })?;
            if !canonical.starts_with(&self.canonical_harness) {
                return Err(AssemblyError::IncludeEscapesHarness(path));
            }
            let bytes = fs::read(&canonical).map_err(|source| AssemblyError::Io {
                path: path.clone(),
                source,
            })?;
            let source =
                String::from_utf8(bytes).map_err(|_| AssemblyError::NonUtf8(path.clone()))?;
            source_units.push(SourceUnit {
                kind: SourceUnitKind::Include,
                logical_path: format!("harness/{include}"),
                source_hash: hash(source.as_bytes()),
                prefix: String::new(),
                source,
            });
        }

        source_units.push(SourceUnit {
            kind: SourceUnitKind::Test,
            logical_path: record.path.clone(),
            source_hash: record.body_hash.clone(),
            prefix: variant.strict_prefix.clone(),
            source: record.body.clone(),
        });

        let mut replaces_harness = vec!["assert.js".to_owned(), "sta.js".to_owned()];
        if variant
            .required_capabilities
            .contains(&RequiredCapability::AsyncCompletion)
        {
            replaces_harness.push("doneprintHandle.js".to_owned());
        }

        Ok(AssemblyPlan {
            host_profile: HostProfilePlan {
                id: HOST_PROFILE_ID.to_owned(),
                declarations_hash: hash(HOST_DECLARATIONS.as_bytes()),
                contract_hash: hash(HOST_CONTRACT.as_bytes()),
                replaces_harness,
            },
            variant,
            source_units,
        })
    }
}

/// Resolve a scheduled variant into immutable, ordered source units.
///
/// The default `assert.js`, `sta.js`, and async completion bindings are
/// profile-owned host intrinsics. Metadata `includes` remain exact Test262
/// JavaScript and retain their declared order. The strict prefix is attached
/// only to the test unit; no concatenated wrapper file is produced.
pub fn assemble_variant(
    suite_root: &Path,
    record: &TestRecord,
    variant: VariantPlan,
) -> Result<AssemblyPlan, AssemblyError> {
    SuiteAssembler::new(suite_root)?.assemble(record, variant)
}

fn validate_record(variant: &VariantPlan, record: &TestRecord) -> Result<(), AssemblyError> {
    let super::model::ScheduleOutcome::Planned { plan: expected } = schedule_strict_script(record)
    else {
        return Err(AssemblyError::RecordMismatch {
            field: "schedule-outcome",
        });
    };
    if expected != *variant {
        return Err(AssemblyError::RecordMismatch {
            field: "scheduled-plan",
        });
    }
    Ok(())
}

fn validate_include(include: &str) -> Result<(), AssemblyError> {
    if include.is_empty()
        || include.contains('\\')
        || Path::new(include)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AssemblyError::UnsafeInclude(include.to_owned()));
    }
    Ok(())
}

fn hash(bytes: &[u8]) -> String {
    format!("{:016x}", xxh3_64(bytes))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, BTreeSet},
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn record() -> TestRecord {
        TestRecord {
            path: "test/language/example.js".to_owned(),
            source_hash: "original".to_owned(),
            body_hash: hash(b"assert.sameValue(1, 1);"),
            header: String::new(),
            body: "assert.sameValue(1, 1);".to_owned(),
            metadata: BTreeMap::new(),
            flags: BTreeSet::new(),
            includes: vec!["helpers/value.js".to_owned()],
            features: Vec::new(),
            negative: None,
        }
    }

    fn variant(record: &TestRecord) -> VariantPlan {
        VariantPlan {
            id: format!("{}#strict", record.path),
            test_path: record.path.clone(),
            strict_prefix: "\"use strict\";\n".to_owned(),
            includes: record.includes.clone(),
            features: record.features.clone(),
            negative: record.negative.clone(),
            required_capabilities: BTreeSet::new(),
        }
    }

    #[test]
    fn keeps_includes_and_test_as_distinct_ordered_units() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nts-test262-{}-{nonce}", std::process::id()));
        let helper = root.join("harness/helpers/value.js");
        fs::create_dir_all(helper.parent().expect("helper parent")).expect("create harness");
        fs::write(&helper, "function value() { return 1; }").expect("write include");

        let record = record();
        let plan = assemble_variant(&root, &record, variant(&record)).expect("assemble plan");

        assert_eq!(plan.host_profile.replaces_harness, ["assert.js", "sta.js"]);
        assert_eq!(plan.source_units.len(), 2);
        assert_eq!(plan.source_units[0].kind, SourceUnitKind::Include);
        assert_eq!(
            plan.source_units[0].logical_path,
            "harness/helpers/value.js"
        );
        assert!(plan.source_units[0].prefix.is_empty());
        assert_eq!(plan.source_units[1].kind, SourceUnitKind::Test);
        assert_eq!(plan.source_units[1].prefix, "\"use strict\";\n");
        assert_eq!(plan.source_units[1].source, record.body);

        fs::remove_dir_all(&root).expect("remove isolated test directory");
    }

    #[test]
    fn rejects_include_traversal_before_reading() {
        for include in ["../assert.js", "/tmp/assert.js", "sm\\assert.js", ""] {
            assert!(matches!(
                validate_include(include),
                Err(AssemblyError::UnsafeInclude(_))
            ));
        }
    }

    #[test]
    #[ignore = "walks the optional vendored Test262 checkout"]
    fn every_strict_lane_include_resolves_at_the_pin() {
        use crate::test262_runner::{TEST262_PIN, discover_suite};

        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../third_party/test262");
        if !root.is_dir() {
            return;
        }
        let (_, records) =
            discover_suite(&root, TEST262_PIN).expect("the pinned suite must parse completely");
        let assembler = SuiteAssembler::new(&root).expect("create suite assembler");
        let mut assembled = 0;
        for record in &records {
            if let super::super::model::ScheduleOutcome::Planned { plan } =
                schedule_strict_script(record)
            {
                assembler
                    .assemble(record, plan)
                    .unwrap_or_else(|error| panic!("assembling {}: {error}", record.path));
                assembled += 1;
            }
        }
        assert_eq!(assembled, 46_661);
    }
}
