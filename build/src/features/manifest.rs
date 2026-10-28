use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// A canonical library feature, not the spelling of a source identifier.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct FeatureId(String);

impl FeatureId {
    pub fn parse(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if value.is_empty()
            || value.chars().any(char::is_whitespace)
            || value.contains('\0')
            || value
                .split_once(':')
                .is_some_and(|(family, name)| family.is_empty() || name.is_empty())
        {
            return Err(
                "a feature identity must be nonempty and contain no whitespace or NUL".into(),
            );
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for FeatureId {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for FeatureId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

/// The public operation at a global root. Member names remain independent of
/// these operations: a named method is not automatically an extractable value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Use {
    Call,
    Construct,
    Value,
}

/// Exactly one kind key is written, matching package.json's `nts.provides`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderKind {
    Compiler,
    Source(String),
    Binding(String),
}

impl Serialize for ProviderKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(1))?;
        match self {
            Self::Compiler => map.serialize_entry("compiler", &true)?,
            Self::Source(path) => map.serialize_entry("source", path)?,
            Self::Binding(identity) => map.serialize_entry("binding", identity)?,
        }
        map.end()
    }
}

/// A claim is a restriction on a record, never a substitute for a record.
/// `limits` is explanatory text and is never interpreted by selection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawClaim")]
pub struct Claim {
    #[serde(flatten)]
    pub kind: ProviderKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<BTreeSet<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<BTreeSet<Use>>,
    #[serde(skip_serializing_if = "BTreeSet::is_empty")]
    pub requires: BTreeSet<FeatureId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backends: Option<BTreeSet<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hosts: Option<BTreeSet<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub targets: Option<BTreeSet<String>>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub limits: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawClaim {
    #[serde(default, deserialize_with = "present")]
    compiler: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    source: Option<String>,
    #[serde(default, deserialize_with = "present")]
    binding: Option<String>,
    #[serde(default, deserialize_with = "present")]
    members: Option<BTreeSet<String>>,
    #[serde(default, deserialize_with = "present")]
    uses: Option<BTreeSet<Use>>,
    #[serde(default)]
    requires: BTreeSet<FeatureId>,
    #[serde(default, deserialize_with = "present")]
    backends: Option<BTreeSet<String>>,
    #[serde(default, deserialize_with = "present")]
    hosts: Option<BTreeSet<String>>,
    #[serde(default, deserialize_with = "present")]
    targets: Option<BTreeSet<String>>,
    #[serde(default)]
    limits: String,
}

// Absence leaves a restriction open; an explicitly malformed/null value must
// not silently widen it or hide a second kind key.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

impl TryFrom<RawClaim> for Claim {
    type Error = String;

    fn try_from(raw: RawClaim) -> Result<Self, Self::Error> {
        let kind = match (raw.compiler, raw.source, raw.binding) {
            (Some(true), None, None) => ProviderKind::Compiler,
            (None, Some(path), None) => {
                if !source_path(&path) {
                    return Err("source must be a canonical package-relative ./ path".into());
                }
                ProviderKind::Source(path)
            }
            (None, None, Some(identity)) => {
                if !identity
                    .split_once(':')
                    .is_some_and(|(kind, name)| !kind.is_empty() && !name.is_empty())
                    || identity.chars().any(char::is_whitespace)
                    || identity.contains('\0')
                {
                    return Err("binding must name a nonempty scheme and identity".into());
                }
                ProviderKind::Binding(identity)
            }
            _ => return Err("exactly one of compiler:true, source or binding is required".into()),
        };
        if raw.members.as_ref().is_some_and(|members| {
            members.iter().any(|name| {
                name.is_empty() || name.chars().any(char::is_whitespace) || name.contains('\0')
            })
        }) {
            return Err("a claimed member must be nonempty and contain no whitespace".into());
        }
        Ok(Self {
            kind,
            members: raw.members,
            uses: raw.uses,
            requires: raw.requires,
            backends: raw.backends,
            hosts: raw.hosts,
            targets: raw.targets,
            limits: raw.limits,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Manifest {
    pub package: String,
    pub provides: BTreeMap<FeatureId, Claim>,
}

/// Read only the provider portion of a package. Other package/nts metadata is
/// owned by its existing reader. Duplicate keys anywhere are rejected before
/// converting to `Value`; `serde_json::Value` alone would silently overwrite them.
pub fn parse_manifest(package: &str, json: &str) -> Result<Manifest, String> {
    if package.is_empty() || package.chars().any(char::is_whitespace) || package.contains('\0') {
        return Err("a provider package must have an identity".into());
    }
    let value = strict_value(json)?;
    let object = value
        .as_object()
        .ok_or("a package manifest must be an object")?;
    if object
        .get("name")
        .is_some_and(|name| name.as_str() != Some(package))
    {
        return Err("package identity differs from the resolved package".into());
    }
    let entries = match object.get("nts") {
        None => None,
        Some(Value::Object(nts)) => nts.get("provides"),
        Some(_) => return Err("nts must be an object".into()),
    };
    let provides: BTreeMap<FeatureId, Claim> = match entries {
        None => BTreeMap::new(),
        Some(Value::Object(entries)) => entries
            .iter()
            .map(|(name, value)| {
                let feature = FeatureId::parse(name)?;
                let claim: Claim = serde_json::from_value(value.clone())
                    .map_err(|error| format!("{feature}: {error}"))?;
                let own_module = name == package || name.starts_with(&format!("{package}/"));
                if !name.starts_with("host:") && !own_module && !package.starts_with("@nts/") {
                    return Err(format!("{package} cannot provide feature {feature}"));
                }
                if matches!(claim.kind, ProviderKind::Compiler) && package != "@nts/compiler" {
                    return Err("compiler claims belong to @nts/compiler".into());
                }
                if claim.requires.contains(&feature) {
                    return Err(format!("{feature} requires itself"));
                }
                Ok((feature, claim))
            })
            .collect::<Result<_, String>>()?,
        Some(_) => return Err("nts.provides must be an object".into()),
    };
    Ok(Manifest {
        package: package.into(),
        provides,
    })
}

pub(super) fn strict_value(json: &str) -> Result<Value, String> {
    let UniqueValue(value) = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(value)
}

struct UniqueValue(Value);

impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueValue;
            fn expecting(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
                out.write_str("JSON without duplicate object keys")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut object = serde_json::Map::new();
                while let Some((key, UniqueValue(value))) =
                    map.next_entry::<String, UniqueValue>()?
                {
                    if object.insert(key.clone(), value).is_some() {
                        return Err(de::Error::custom(format!("duplicate JSON key {key}")));
                    }
                }
                Ok(UniqueValue(Value::Object(object)))
            }
            fn visit_seq<S: SeqAccess<'de>>(
                self,
                mut sequence: S,
            ) -> Result<Self::Value, S::Error> {
                let mut values = Vec::new();
                while let Some(UniqueValue(value)) = sequence.next_element()? {
                    values.push(value);
                }
                Ok(UniqueValue(Value::Array(values)))
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::String(value.into())))
            }
            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Bool(value)))
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Number(value.into())))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Number(value.into())))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| UniqueValue(Value::Number(number)))
                    .ok_or_else(|| de::Error::custom("a JSON number must be finite"))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Null))
            }
        }
        deserializer.deserialize_any(UniqueVisitor)
    }
}

pub(super) fn source_path(path: &str) -> bool {
    path.strip_prefix("./").is_some_and(|tail| {
        !tail.is_empty()
            && !tail.contains(['\\', '\0', ':'])
            && !tail.split('/').any(|part| matches!(part, "" | "." | ".."))
    })
}
