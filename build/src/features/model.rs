use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::{FeatureId, Use};

/// A content identity supplied by the observer, never a timestamp or file size.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Digest(String);

impl Digest {
    #[must_use]
    pub fn of_bytes(bytes: &[u8]) -> Self {
        use std::fmt::Write;
        let mut encoded = String::from("sha256:");
        for byte in hmac_sha256::Hash::hash(bytes) {
            // Writing to String is infallible.
            let _ = write!(encoded, "{byte:02x}");
        }
        Self(encoded)
    }

    pub fn parse(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        let hex = value
            .strip_prefix("sha256:")
            .ok_or("a content identity must use sha256")?;
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("a sha256 identity must have 64 lowercase hexadecimal digits".into());
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Digest {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl From<Digest> for String {
    fn from(value: Digest) -> Self {
        value.0
    }
}

/// Every possible supplier contributes before a provider is selected.
/// Unknown namespace/receiver escape requires a complete public-surface proof.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Demand {
    #[serde(default)]
    pub uses: BTreeSet<Use>,
    #[serde(default)]
    pub members: BTreeSet<String>,
    #[serde(default)]
    pub extracted_members: BTreeSet<String>,
    #[serde(default)]
    pub open_surface: bool,
    #[serde(default)]
    pub sites: BTreeSet<String>,
}

impl Demand {
    /// Monotonic and independent of traversal order, including escape state.
    pub fn join(&mut self, other: &Self) {
        self.uses.extend(other.uses.iter().copied());
        self.members.extend(other.members.iter().cloned());
        self.extracted_members
            .extend(other.extracted_members.iter().cloned());
        self.open_surface |= other.open_surface;
        self.sites.extend(other.sites.iter().cloned());
    }
}

pub type Requirements = BTreeMap<FeatureId, Demand>;

/// Checked operation coverage, not inferred from a feature or helper's name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coverage {
    pub uses: BTreeSet<Use>,
    pub members: BTreeSet<String>,
    pub extracted_members: BTreeSet<String>,
    pub complete_surface: bool,
}

impl Coverage {
    #[must_use]
    pub fn covers(&self, demand: &Demand) -> bool {
        demand.uses.is_subset(&self.uses)
            && demand.members.is_subset(&self.members)
            && demand.extracted_members.is_subset(&self.extracted_members)
            && (!demand.open_surface || self.complete_surface && self.uses.contains(&Use::Value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderKey {
    pub package: String,
    /// Resolved package/locator identity, including its dependency context.
    /// Equal package.json bytes do not identify two installed instances.
    pub instance: Digest,
    pub manifest: Digest,
    pub feature: FeatureId,
}

/// A product override, profile pin, or ordered preference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selector {
    #[serde(rename = "use")]
    pub package: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance: Option<Digest>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, Value>,
}

impl Selector {
    #[must_use]
    pub fn selects(&self, provider: &ProviderKey) -> bool {
        self.package == provider.package
            && self
                .instance
                .as_ref()
                .is_none_or(|id| id == &provider.instance)
    }
}

/// Backend and host are separate: a C artifact may be hosted by Node or Blink.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub id: String,
    pub backend: String,
    pub host: String,
    pub os: String,
    pub arch: String,
    pub minimum_version: Option<String>,
}

/// Paths use named observation roots, so an author's checkout path is not an
/// input. The adapter validates symlink resolution and supplies every read.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputPath {
    pub root: String,
    pub path: String,
}

impl InputPath {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.root.is_empty()
            || self.root.contains('\0')
            || self.path.contains(['\\', '\0'])
            || self.path.starts_with('/')
            || !self.path.is_empty()
                && self
                    .path
                    .split('/')
                    .any(|part| part.is_empty() || matches!(part, "." | "..") || part.contains(':'))
        {
            return Err("an observation path must be relative to its named root".into());
        }
        Ok(())
    }
}

/// Missing files and directory listings are inputs just as present files are.
/// A current observer must reproduce the complete set; omission is not a hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum HostObservation {
    File {
        path: InputPath,
        #[serde(deserialize_with = "required_option")]
        content: Option<Digest>,
    },
    Directory {
        path: InputPath,
        #[serde(deserialize_with = "required_option")]
        entries: Option<BTreeMap<String, EntryKind>>,
    },
    Symlink {
        path: InputPath,
        #[serde(deserialize_with = "required_option")]
        target: Option<String>,
    },
    Environment {
        name: String,
        #[serde(deserialize_with = "required_option")]
        value: Option<String>,
    },
    Tool {
        name: String,
        identity: Digest,
    },
}

impl HostObservation {
    fn key(&self) -> (&'static str, &str, &str) {
        match self {
            Self::File { path, .. } => ("file", &path.root, &path.path),
            Self::Directory { path, .. } => ("directory", &path.root, &path.path),
            Self::Symlink { path, .. } => ("symlink", &path.root, &path.path),
            Self::Environment { name, .. } => ("environment", "", name),
            Self::Tool { name, .. } => ("tool", "", name),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "Vec<HostObservation>", into = "Vec<HostObservation>")]
pub struct ObservedInputs(Vec<HostObservation>);

impl ObservedInputs {
    pub fn new(mut rows: Vec<HostObservation>) -> Result<Self, String> {
        for row in &rows {
            match row {
                HostObservation::File { path, .. }
                | HostObservation::Directory { path, .. }
                | HostObservation::Symlink { path, .. } => path.validate()?,
                HostObservation::Environment { name, .. } | HostObservation::Tool { name, .. } => {
                    if name.is_empty() || name.contains('\0') {
                        return Err("an observation must have a name".into());
                    }
                }
            }
        }
        rows.sort_by(|left, right| left.key().cmp(&right.key()));
        if rows.windows(2).any(|pair| pair[0].key() == pair[1].key()) {
            return Err("duplicate host observation".into());
        }
        Ok(Self(rows))
    }
}

impl TryFrom<Vec<HostObservation>> for ObservedInputs {
    type Error = String;
    fn try_from(value: Vec<HostObservation>) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<ObservedInputs> for Vec<HostObservation> {
    fn from(value: ObservedInputs) -> Self {
        value.0
    }
}

/// The projection of effective profile decisions actually observed while
/// measuring a provider. A changed guard or supplier invalidates its closure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum DecisionObservation {
    Availability {
        feature: FeatureId,
        available: bool,
    },
    Selection {
        provider: ProviderKey,
        options: BTreeMap<String, Value>,
    },
    ProfileOption {
        name: String,
        value: Value,
    },
}

impl DecisionObservation {
    fn key(&self) -> (&'static str, &str) {
        match self {
            Self::Availability { feature, .. } => ("availability", feature.as_str()),
            Self::Selection { provider, .. } => ("selection", provider.feature.as_str()),
            Self::ProfileOption { name, .. } => ("profile-option", name),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordInputs {
    pub target: Target,
    pub profile: String,
    pub decisions: Vec<DecisionObservation>,
    pub observations: ObservedInputs,
    pub options: BTreeMap<String, Value>,
    /// Compiler implementation/build inputs, excluding record data itself.
    /// The producing binary identity is retained separately in run evidence.
    pub compiler_inputs: Digest,
    pub suite: Digest,
    /// Obtained independently from today's suite population, not from an old
    /// record's received prefix.
    pub expected_cases: u64,
}

impl RecordInputs {
    fn checked_decisions(&self) -> Result<Vec<&DecisionObservation>, String> {
        if self.profile.is_empty()
            || self.target.id.is_empty()
            || self.target.backend.is_empty()
            || self.target.host.is_empty()
            || self.target.os.is_empty()
            || self.target.arch.is_empty()
        {
            return Err("record target and profile identities must be explicit".into());
        }
        let mut decisions: Vec<_> = self.decisions.iter().collect();
        decisions.sort_by(|left, right| left.key().cmp(&right.key()));
        if decisions.iter().any(|decision| decision.key().1.is_empty())
            || decisions
                .windows(2)
                .any(|pair| pair[0].key() == pair[1].key())
        {
            return Err("duplicate or empty profile decision observation".into());
        }
        Ok(decisions)
    }

    pub fn canonical(mut self) -> Result<Self, String> {
        self.checked_decisions()?;
        self.decisions
            .sort_by(|left, right| left.key().cmp(&right.key()));
        Ok(self)
    }
}

/// A module in an identified package; it does not own another public feature.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImplementationModule {
    pub package: String,
    pub instance: Digest,
    pub manifest: Digest,
    pub path: String,
}

impl ImplementationModule {
    #[must_use]
    pub fn valid(&self) -> bool {
        !self.package.is_empty()
            && !self.package.contains('\0')
            && super::manifest::source_path(&self.path)
    }
}

/// A supervisor disposition is independent of a protocol's `done` marker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Disposition {
    Exited { code: i32 },
    Signalled { signal: i32 },
    CpuLimit,
    WallGuard,
    Incomplete,
}

/// Only the observer constructs evidence. The resolver revalidates exact
/// inputs and coverage, and consumes this complete target-specific closure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub version: u32,
    pub provider: ProviderKey,
    pub inputs: RecordInputs,
    pub coverage: Coverage,
    pub requirements: Requirements,
    /// Ordinary implementation modules, not second public feature providers.
    pub modules: BTreeSet<ImplementationModule>,
    pub completed_cases: u64,
    pub done: bool,
    pub failures: u64,
    pub disposition: Disposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RecordRejection {
    DifferentProvider,
    Incomplete,
    DifferentCompiler,
    DifferentSuite,
    DifferentTarget,
    DifferentProfile,
    DifferentDecisions,
    DifferentObservations,
    DifferentOptions,
    MalformedInputs { detail: String },
}

impl Record {
    /// A proof's content identity excludes the run or machine path that stored
    /// it. Equivalent evidence from two runs produces one deterministic plan.
    pub fn identity(&self) -> Result<Digest, String> {
        let mut canonical = self.clone();
        canonical.inputs = canonical.inputs.canonical()?;
        serde_json::to_vec(&canonical)
            .map(|bytes| Digest::of_bytes(&bytes))
            .map_err(|error| error.to_string())
    }

    /// External records use the same duplicate-key checks as manifests.
    pub fn parse(json: &str) -> Result<Self, String> {
        let mut record: Self = serde_json::from_value(super::manifest::strict_value(json)?)
            .map_err(|error| error.to_string())?;
        record.inputs = record.inputs.canonical()?;
        Ok(record)
    }

    #[must_use]
    pub fn complete(&self) -> bool {
        self.version == 1
            && self.inputs.expected_cases > 0
            && self.inputs.expected_cases == self.completed_cases
            && self.done
            && self.failures == 0
            && matches!(self.disposition, Disposition::Exited { code: 0 })
    }

    /// Current inputs come from fresh adapter observations, not from this
    /// record. In particular, absence and directory observations are retained.
    pub fn validate(
        &self,
        provider: &ProviderKey,
        current: &RecordInputs,
    ) -> Result<(), RecordRejection> {
        if &self.provider != provider {
            return Err(RecordRejection::DifferentProvider);
        }
        if !self.complete() {
            return Err(RecordRejection::Incomplete);
        }
        let old_decisions = self
            .inputs
            .checked_decisions()
            .map_err(|detail| RecordRejection::MalformedInputs { detail })?;
        let current_decisions = current
            .checked_decisions()
            .map_err(|detail| RecordRejection::MalformedInputs { detail })?;
        match &self.inputs {
            old if old.compiler_inputs != current.compiler_inputs => {
                Err(RecordRejection::DifferentCompiler)
            }
            old if old.suite != current.suite || old.expected_cases != current.expected_cases => {
                Err(RecordRejection::DifferentSuite)
            }
            old if old.target != current.target => Err(RecordRejection::DifferentTarget),
            old if old.profile != current.profile => Err(RecordRejection::DifferentProfile),
            old if old.options != current.options => Err(RecordRejection::DifferentOptions),
            _ if old_decisions != current_decisions => Err(RecordRejection::DifferentDecisions),
            old if old.observations != current.observations => {
                Err(RecordRejection::DifferentObservations)
            }
            _ => Ok(()),
        }
    }
}
