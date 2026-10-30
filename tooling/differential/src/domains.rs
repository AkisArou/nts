//! Workload domains narrow generated calls, never compiler input contracts.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, ensure};
use camino::Utf8Path;
use nts_core::hir::{HirType, facts::Facts};
use nts_semantic_schema::{SemanticSnapshot, TypeId, TypeKind};
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NumericDomain {
    #[serde(
        default,
        deserialize_with = "number_bound",
        skip_serializing_if = "Option::is_none"
    )]
    min: Option<f64>,
    #[serde(
        default,
        deserialize_with = "number_bound",
        skip_serializing_if = "Option::is_none"
    )]
    max: Option<f64>,
    #[serde(default)]
    integer: bool,
    #[serde(default, rename = "allowNaN")]
    allow_nan: bool,
    reason: String,
}

fn number_bound<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<f64>, D::Error> {
    f64::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, Serialize)]
struct Parameters(#[serde(deserialize_with = "unique_names")] BTreeMap<String, NumericDomain>);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    #[serde(deserialize_with = "unique_names")]
    functions: BTreeMap<String, Parameters>,
}

/// JSON maps must not quietly replace a declaration with a later duplicate.
fn unique_names<'de, D, T>(deserializer: D) -> std::result::Result<BTreeMap<String, T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Unique<T>(std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for Unique<T> {
        type Value = BTreeMap<String, T>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("an object with unique names")
        }
        fn visit_map<M: MapAccess<'de>>(
            self,
            mut map: M,
        ) -> std::result::Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((name, value)) = map.next_entry::<String, T>()? {
                if result.insert(name.clone(), value).is_some() {
                    return Err(de::Error::custom(format!("duplicate domain name {name}")));
                }
            }
            Ok(result)
        }
    }
    deserializer.deserialize_map(Unique(std::marker::PhantomData))
}

#[derive(Default)]
pub(super) struct Domains {
    functions: BTreeMap<String, Parameters>,
}

#[derive(Serialize)]
pub(super) struct RecordedDomain {
    pub(super) identity: String,
    pub(super) declaration: serde_json::Value,
}

impl Domains {
    pub(super) fn recorded(&self) -> Option<RecordedDomain> {
        if self.functions.is_empty() {
            return None;
        }
        let declaration = serde_json::json!({"version":1,"functions":self.functions});
        let mut constraints = declaration.clone();
        if let Some(functions) = constraints["functions"].as_object_mut() {
            for parameters in functions
                .values_mut()
                .filter_map(serde_json::Value::as_object_mut)
            {
                for parameter in parameters
                    .values_mut()
                    .filter_map(serde_json::Value::as_object_mut)
                {
                    parameter.remove("reason");
                }
            }
        }
        let identity = format!(
            "{:032x}",
            xxhash_rust::xxh3::xxh3_128(constraints.to_string().as_bytes())
        );
        Some(RecordedDomain {
            identity,
            declaration,
        })
    }

    pub(super) fn load(entry: &Utf8Path, snapshot: &SemanticSnapshot) -> Result<Self> {
        let path = entry.with_extension("domains.json");
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(error).with_context(|| format!("reading {path}")),
        };
        Self::parse(&text, entry, snapshot)
            .with_context(|| format!("invalid workload domains in {path}"))
    }

    fn parse(text: &str, entry: &Utf8Path, snapshot: &SemanticSnapshot) -> Result<Self> {
        let document: Document = serde_json::from_str(text)?;
        ensure!(document.version == 1, "unknown workload domain version");
        ensure!(
            !document.functions.is_empty(),
            "workload domains need functions"
        );
        let module = snapshot
            .modules
            .iter()
            .find(|module| snapshot.sources[module.file.0 as usize].display_path == entry)
            .context("the domain entry has no module")?;
        let mut numeric_types = NumericTypes::new(snapshot);
        for (name, parameters) in &document.functions {
            ensure!(
                !parameters.0.is_empty(),
                "domain for {name} needs parameters"
            );
            let (_, symbol_id) = module
                .exports
                .iter()
                .find(|(export, _)| export == name)
                .with_context(|| format!("unknown exported function {name}"))?;
            let mut symbol = &snapshot.symbols[symbol_id.0 as usize];
            if let Some(aliased) = symbol.aliased {
                symbol = &snapshot.symbols[aliased.0 as usize];
            }
            // Generic declarations carry their signature on the declaration
            // node; a symbol's optional type is not the authoritative source.
            let signature = symbol
                .declarations
                .iter()
                .filter_map(|declaration| snapshot.node_types.get(declaration).copied())
                .chain(symbol.ty)
                .find_map(|ty| match snapshot.types[ty.0 as usize].kind {
                    TypeKind::Function(signature) => Some(signature),
                    _ => None,
                })
                .with_context(|| {
                    format!("domain export {name} is not a function with a recorded signature")
                })?;
            let signature = &snapshot.signatures[signature.0 as usize];
            for (parameter, domain) in &parameters.0 {
                let recorded = signature
                    .parameters
                    .iter()
                    .find(|item| &item.name == parameter)
                    .with_context(|| format!("unknown parameter {name}.{parameter}"))?;
                ensure!(
                    numeric_types.check(recorded.ty)?,
                    "domain parameter {name}.{parameter} is not numeric"
                );
                domain
                    .validate()
                    .with_context(|| format!("domain for {name}.{parameter}"))?;
            }
        }
        Ok(Self {
            functions: document.functions,
        })
    }

    pub(super) fn pools_for_parameters(
        &self,
        name: &str,
        params: &[(String, HirType, Facts)],
    ) -> Result<Option<Vec<Vec<f64>>>> {
        let Some(parameters) = self.functions.get(name) else {
            return Ok(None);
        };
        for name in parameters.0.keys() {
            ensure!(
                params.iter().any(|parameter| &parameter.0 == name),
                "domain parameter {name} has no source parameter"
            );
        }
        params
            .iter()
            .map(|(parameter, ty, known)| {
                let pool = super::inputs(ty, *known);
                let Some(domain) = parameters.0.get(parameter) else {
                    return Ok(pool);
                };
                domain
                    .project(&pool, ty)
                    .with_context(|| format!("domain for {name}.{parameter}"))
            })
            .collect::<Result<Vec<_>>>()
            .map(Some)
    }
}

const TYPE_GRAPH_WORK: usize = 16_384;

/// Share both completed results and a work budget across the whole sidecar.
/// An explicit stack bounds Rust stack use even for a deep acyclic type graph.
struct NumericTypes<'a> {
    snapshot: &'a SemanticSnapshot,
    completed: BTreeMap<TypeId, bool>,
    remaining: usize,
}

impl<'a> NumericTypes<'a> {
    fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self {
            snapshot,
            completed: BTreeMap::new(),
            remaining: TYPE_GRAPH_WORK,
        }
    }

    fn charge(&mut self) -> Result<()> {
        self.remaining = self
            .remaining
            .checked_sub(1)
            .context("workload domain numeric type graph exceeds validation budget")?;
        Ok(())
    }

    fn check(&mut self, ty: TypeId) -> Result<bool> {
        let mut pending = vec![(ty, 0)];
        let mut visiting = BTreeSet::new();
        while let Some(&(current, next)) = pending.last() {
            if self.completed.contains_key(&current) {
                pending.pop();
                continue;
            }
            if next == 0 && visiting.insert(current) {
                self.charge()?;
            }
            let kind = &self.snapshot.types[current.0 as usize].kind;
            let children = match kind {
                TypeKind::Union(types) | TypeKind::Intersection(types) => types.as_slice(),
                TypeKind::TypeParameter {
                    constraint: Some(child),
                    ..
                } => std::slice::from_ref(child),
                _ => &[],
            };
            if let Some(&child) = children.get(next) {
                self.charge()?;
                pending
                    .last_mut()
                    .context("domain type traversal is empty")?
                    .1 += 1;
                ensure!(
                    !visiting.contains(&child),
                    "workload domain has a cyclic numeric type graph"
                );
                if !self.completed.contains_key(&child) {
                    pending.push((child, 0));
                }
                continue;
            }
            let numeric = match kind {
                TypeKind::Number
                | TypeKind::Literal(nts_semantic_schema::LiteralValue::Number(_)) => true,
                TypeKind::Union(_) => {
                    !children.is_empty() && children.iter().all(|child| self.completed[child])
                }
                TypeKind::Intersection(_) => children.iter().any(|child| self.completed[child]),
                TypeKind::TypeParameter {
                    constraint: Some(child),
                    ..
                } => self.completed[child],
                _ => false,
            };
            self.completed.insert(current, numeric);
            visiting.remove(&current);
            pending.pop();
        }
        Ok(self.completed[&ty])
    }
}

impl NumericDomain {
    fn validate(&self) -> Result<()> {
        ensure!(!self.reason.trim().is_empty(), "reason is required");
        ensure!(
            self.min.is_none_or(f64::is_finite) && self.max.is_none_or(f64::is_finite),
            "domain bounds must be finite"
        );
        let low = self.min.unwrap_or(f64::NEG_INFINITY);
        let high = self.max.unwrap_or(f64::INFINITY);
        ensure!(low <= high, "domain minimum exceeds maximum");
        ensure!(
            !self.integer || low.ceil() <= high.floor(),
            "integer domain has no whole value"
        );
        Ok(())
    }

    fn project(&self, pool: &[f64], ty: &HirType) -> Result<Vec<f64>> {
        let representation = super::input_representation(ty)
            .context("domain parameter has no numeric input representation")?;
        let integer = self.integer || matches!(ty, HirType::Int { .. });
        ensure!(
            !self.allow_nan || !matches!(ty, HirType::Int { .. }),
            "an integer parameter cannot admit NaN"
        );
        let mut low = self.min.unwrap_or(f64::NEG_INFINITY).max(representation.lo);
        let mut high = self.max.unwrap_or(f64::INFINITY).min(representation.hi);
        if integer {
            low = low.ceil();
            high = high.floor();
        }
        ensure!(
            low <= high,
            "domain contradicts the parameter's numeric representation"
        );
        let mut result: Vec<f64> = Vec::new();
        let mut add = |value: f64| {
            if super::input_fits(ty, value)
                && !result.iter().any(|old| old.to_bits() == value.to_bits())
            {
                result.push(value);
            }
        };
        for &value in pool {
            if value.is_nan() {
                if self.allow_nan {
                    add(value);
                }
                continue;
            }
            let value = if integer { value.trunc() } else { value };
            let value = if value < low {
                low
            } else if value > high {
                high
            } else {
                value
            };
            add(value);
        }
        for edge in [low, high] {
            if edge.is_finite() {
                add(edge);
            }
        }
        ensure!(
            !result.is_empty(),
            "domain generates no input allowed by the numeric representation"
        );
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use camino::Utf8PathBuf;
    use nts_codegen_common::Backend;
    use nts_frontend_ts::Frontend;
    use serde_json::json;

    fn domain(value: serde_json::Value) -> NumericDomain {
        let result: NumericDomain = serde_json::from_value(value).unwrap();
        result.validate().unwrap();
        result
    }

    fn bits(values: &[f64]) -> Vec<u64> {
        values.iter().map(|value| value.to_bits()).collect()
    }

    #[test]
    fn numeric_validation_is_iterative_shared_and_bounded() {
        let mut snapshot = SemanticSnapshot::default();
        let mut add = |kind| {
            let id = TypeId(u32::try_from(snapshot.types.len()).unwrap());
            snapshot
                .types
                .push(nts_semantic_schema::TypeRecord { kind, symbol: None });
            id
        };
        let mut current = add(TypeKind::Number);
        // A shared DAG would require exponentially many recursive visits.
        for _ in 0..3_000 {
            current = add(TypeKind::Union(vec![current, current]));
        }
        let mut checker = NumericTypes::new(&snapshot);
        assert!(checker.check(current).unwrap());
        let remaining = checker.remaining;
        assert!(checker.check(current).unwrap());
        assert_eq!(checker.remaining, remaining);

        let mut exhausted = NumericTypes::new(&snapshot);
        exhausted.remaining = 20;
        let error = exhausted.check(current).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("numeric type graph exceeds validation budget")
        );

        let mut cyclic = SemanticSnapshot::default();
        cyclic.types.push(nts_semantic_schema::TypeRecord {
            kind: TypeKind::Union(vec![TypeId(0)]),
            symbol: None,
        });
        assert!(
            NumericTypes::new(&cyclic)
                .check(TypeId(0))
                .unwrap_err()
                .to_string()
                .contains("cyclic numeric type graph")
        );
    }

    #[test]
    fn clipping_keeps_signed_zero_and_only_explicit_nan() {
        let bounded = domain(json!({"min":-2,"max":2,"allowNaN":true,"reason":"small workload"}));
        let values = bounded
            .project(super::super::POOL, &HirType::NUMBER)
            .unwrap();
        let identity = bits(&values);
        for value in [0.0_f64, -0.0, -2.0, 2.0, 0.5, -0.5, f64::NAN] {
            assert!(identity.contains(&value.to_bits()), "missing {value:?}");
        }
        assert!(
            values
                .iter()
                .all(|value| value.is_nan() || (-2.0..=2.0).contains(value))
        );
        assert_eq!(
            identity
                .iter()
                .copied()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            identity.len()
        );
        let finite = domain(json!({"max":2,"reason":"finite workload"}));
        assert!(
            finite
                .project(super::super::POOL, &HirType::NUMBER)
                .unwrap()
                .iter()
                .all(|value| !value.is_nan())
        );
    }

    #[test]
    fn integer_boundaries_stay_inside_the_declared_range() {
        let bounded = domain(json!({"min":1.2,"max":4.8,"integer":true,"reason":"whole sizes"}));
        let values = bounded
            .project(super::super::POOL, &HirType::NUMBER)
            .unwrap();
        assert_eq!(bits(&values), bits(&[2.0, 3.0, 4.0]));
        let zeros = domain(json!({"min":0,"max":0,"integer":true,"reason":"zero sizes"}));
        assert_eq!(
            bits(&zeros.project(super::super::POOL, &HirType::NUMBER).unwrap()),
            bits(&[0.0, -0.0])
        );
    }

    #[test]
    fn explicit_domains_narrow_the_representation_instead_of_a_literal_claim() {
        let pool =
            super::super::inputs(&HirType::NUMBER, nts_core::hir::facts::Facts::constant(3.0));
        let bounded = domain(json!({"min":0,"max":9,"reason":"bounded size"}));
        let values = bounded.project(&pool, &HirType::NUMBER).unwrap();
        for value in [0.0_f64, -0.0, 0.5, 3.0, 9.0] {
            assert!(bits(&values).contains(&value.to_bits()));
        }
        assert!(values.iter().all(|value| (0.0..=9.0).contains(value)));
        let outside_claim = domain(json!({"max":2,"reason":"small workload"}));
        let narrowed = outside_claim.project(&pool, &HirType::NUMBER).unwrap();
        assert!(narrowed.iter().all(|value| *value <= 2.0));
        assert!(bits(&narrowed).contains(&2.0_f64.to_bits()));
    }

    #[test]
    fn domains_cannot_widen_the_numeric_representation() {
        let byte = HirType::Int {
            bits: 8,
            signed: false,
        };
        let bounded = domain(json!({"min":-100,"max":1000,"reason":"bounded byte workload"}));
        let values = bounded.project(super::super::POOL, &byte).unwrap();
        assert!(
            values
                .iter()
                .all(|value| (0.0..=255.0).contains(value) && value.fract() == 0.0)
        );
        assert!(!bits(&values).contains(&(-0.0_f64).to_bits()));
        assert!(bits(&values).contains(&255.0_f64.to_bits()));
        let impossible = domain(json!({"min":256,"reason":"outside byte representation"}));
        assert!(impossible.project(&[256.0], &byte).is_err());
        assert!(bounded.project(&[0.0], &HirType::Bool).is_err());
        let nan = domain(json!({"allowNaN":true,"reason":"floating input"}));
        assert!(nan.project(&[0.0], &byte).is_err());
    }

    #[test]
    fn float32_domains_keep_infinities_without_rounding_finite_overflow() {
        let float = HirType::Float { bits: 32 };
        let unbounded = domain(json!({"allowNaN":true,"reason":"all floating arrivals"}));
        let pool = [
            f64::NEG_INFINITY,
            f64::INFINITY,
            -0.0,
            f64::NAN,
            f64::MIN,
            f64::MAX,
        ];
        assert_eq!(
            bits(&unbounded.project(&pool, &float).unwrap()),
            bits(&pool[..4])
        );
        let bounded =
            domain(json!({"min":-2,"max":2,"allowNaN":true,"reason":"bounded floating workload"}));
        assert_eq!(
            bits(&bounded.project(&pool, &float).unwrap()),
            bits(&[-2.0, 2.0, -0.0, f64::NAN])
        );
        let finite = domain(json!({"reason":"no NaN workload"}));
        assert_eq!(
            bits(&finite.project(&pool, &float).unwrap()),
            bits(&pool[..3])
        );
    }

    #[test]
    fn unexplained_unknown_duplicate_and_contradictory_metadata_is_rejected() {
        for text in [
            r#"{"version":1,"functions":{"f":{"n":{"max":3}}}}"#,
            r#"{"version":1,"functions":{"f":{"n":{"max":null,"reason":"x"}}}}"#,
            r#"{"version":1,"functions":{"f":{"n":{"max":3,"reason":"x","typo":true}}}}"#,
            r#"{"version":1,"functions":{"f":{"n":{"max":3,"reason":"x"},"n":{"max":4,"reason":"y"}}}}"#,
            r#"{"version":1,"functions":{"f":{"n":{"max":3,"reason":"x"}},"f":{"n":{"max":4,"reason":"y"}}}}"#,
        ] {
            assert!(
                serde_json::from_str::<Document>(text).is_err(),
                "accepted {text}"
            );
        }
        for value in [
            json!({"max":3,"reason":"   "}),
            json!({"min":4,"max":3,"reason":"reversed range"}),
            json!({"min":1.2,"max":1.8,"integer":true,"reason":"empty integer range"}),
        ] {
            let bounded: NumericDomain = serde_json::from_value(value).unwrap();
            assert!(bounded.validate().is_err());
        }
    }

    fn fixture(label: &str) -> (super::super::Scratch, Utf8PathBuf, SemanticSnapshot) {
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        let scratch = super::super::Scratch::holding(
            Utf8PathBuf::from_path_buf(std::env::temp_dir())
                .unwrap()
                .join(format!("nts-domains-{label}-{}", std::process::id())),
        );
        std::fs::create_dir_all(&scratch.path).unwrap();
        let entry = scratch.path.join("case.ts");
        std::fs::write(&entry, "export const seed = 3; export function bounded(n: number, text: string): number { return n + text.length; } export function other(n: number): number { return n; }").unwrap();
        let config = scratch.path.join("tsconfig.json");
        std::fs::write(
            &config,
            json!({"extends":root.join("tsconfig.fixtures.json"),"files":[entry]}).to_string(),
        )
        .unwrap();
        let snapshot = Frontend::new(root).snapshot(&config).unwrap();
        assert!(!snapshot.has_errors());
        (scratch, entry, snapshot)
    }

    #[test]
    fn names_are_checked_against_the_frontend_even_before_backend_selection() {
        let (_scratch, entry, snapshot) = fixture("names");
        for (value, diagnostic) in [
            (
                json!({"version":2,"functions":{"bounded":{"n":{"reason":"x"}}}}),
                "unknown workload domain version",
            ),
            (
                json!({"version":1,"functions":{"missing":{"n":{"reason":"x"}}}}),
                "unknown exported function missing",
            ),
            (
                json!({"version":1,"functions":{"seed":{"n":{"reason":"x"}}}}),
                "not a function",
            ),
            (
                json!({"version":1,"functions":{"bounded":{"missing":{"reason":"x"}}}}),
                "unknown parameter bounded.missing",
            ),
            (
                json!({"version":1,"functions":{"bounded":{"text":{"reason":"x"}}}}),
                "not numeric",
            ),
        ] {
            let error = Domains::parse(&value.to_string(), &entry, &snapshot)
                .err()
                .unwrap();
            assert!(format!("{error:#}").contains(diagnostic), "{error:#}");
        }
    }

    #[test]
    fn one_population_reaches_all_drivers_without_changing_undeclared_subjects() {
        let (scratch, entry, snapshot) = fixture("population");
        assert!(
            Domains::load(&entry, &snapshot)
                .unwrap()
                .functions
                .is_empty()
        );
        let config = scratch.path.join("tsconfig.json");
        let mut frontend = Frontend::new(scratch.path.clone());
        let baseline = crate::oracle_plan(&config, &mut frontend, Backend::C).unwrap();
        let contract = json!({"version":1,"functions":{"bounded":{"n":{"min":-2,"max":2,"allowNaN":true,"reason":"exercise small bounds"}}}});
        std::fs::write(entry.with_extension("domains.json"), contract.to_string()).unwrap();
        let bounded = crate::oracle_plan(&config, &mut frontend, Backend::C).unwrap();
        assert!(baseline.get("input_domain").is_none());
        let first_identity = bounded["input_domain"]["identity"].clone();
        let mut reworded = contract;
        reworded["functions"]["bounded"]["n"]["reason"] =
            json!("same input bounds, clearer explanation");
        std::fs::write(entry.with_extension("domains.json"), reworded.to_string()).unwrap();
        let reworded_plan = crate::oracle_plan(&config, &mut frontend, Backend::C).unwrap();
        assert_eq!(reworded_plan["input_domain"]["identity"], first_identity);
        assert_eq!(reworded_plan["case_key"], bounded["case_key"]);
        let cases = |plan: &serde_json::Value, name: &str| {
            plan["cases"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|value| value.as_str().unwrap().starts_with(name))
                .cloned()
                .collect::<Vec<_>>()
        };
        assert_eq!(cases(&baseline, "other "), cases(&bounded, "other "));
        assert_ne!(baseline["case_key"], bounded["case_key"]);
        assert_eq!(baseline["generator_digest"], bounded["generator_digest"]);
        for backend in [Backend::Llvm, Backend::Jvm] {
            let plan = crate::oracle_plan(&config, &mut frontend, backend).unwrap();
            assert_eq!(plan["cases"], bounded["cases"]);
        }
        std::fs::remove_file(entry.with_extension("domains.json")).unwrap();
        let restored = crate::oracle_plan(&config, &mut frontend, Backend::C).unwrap();
        for key in [
            "case_key",
            "cases",
            "signature",
            "driver",
            "generator_digest",
        ] {
            assert_eq!(baseline[key], restored[key], "legacy {key} changed");
        }
    }
}
