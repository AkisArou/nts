//! A reference declares who wrote its implementation, without changing it.
use anyhow::{Context, Result, ensure};
use camino::Utf8Path;
use serde::Deserialize;
use std::collections::BTreeMap;

const SOURCES: [&str; 2] = ["ref.cpp", "ref.java"];
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Origin {
    NtsAuthored {},
    ThirdParty { upstream: Vec<String> },
}
impl Origin {
    fn validate(&self) -> Result<()> {
        if let Self::ThirdParty { upstream } = self {
            ensure!(
                !upstream.is_empty(),
                "third-party reference needs its upstream"
            );
            let mut seen = std::collections::BTreeSet::new();
            for url in upstream {
                ensure!(
                    url.starts_with("https://")
                        && url.len() > 8
                        && !url.chars().any(char::is_whitespace),
                    "reference upstream must be an HTTPS URL"
                );
                ensure!(seen.insert(url), "duplicate reference upstream");
            }
        }
        Ok(())
    }
    fn warning_flags(&self) -> &'static [&'static str] {
        match self {
            Self::NtsAuthored {} => &[],
            Self::ThirdParty { .. } => &["-Wno-error"],
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    #[serde(deserialize_with = "unique_references")]
    references: BTreeMap<String, Origin>,
}

fn unique_references<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, Origin>, D::Error> {
    struct Unique;
    impl<'de> serde::de::Visitor<'de> for Unique {
        type Value = BTreeMap<String, Origin>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("references declared once each")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> std::result::Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((name, origin)) = map.next_entry::<String, Origin>()? {
                if result.insert(name.clone(), origin).is_some() {
                    return Err(serde::de::Error::custom(format!(
                        "duplicate reference provenance {name}"
                    )));
                }
            }
            Ok(result)
        }
    }
    deserializer.deserialize_map(Unique)
}

fn read(case: &Utf8Path) -> Result<Option<Document>> {
    let path = case.join("ref.provenance.json");
    if !path.exists() && SOURCES.iter().all(|name| !case.join(name).exists()) {
        return Ok(None);
    }
    let document: Document = serde_json::from_slice(
        &std::fs::read(&path).with_context(|| format!("missing reference provenance {path}"))?,
    )
    .with_context(|| format!("invalid reference provenance {path}"))?;
    ensure!(
        document.version == 1,
        "unknown reference provenance version at {path}"
    );
    for (name, origin) in &document.references {
        ensure!(
            SOURCES.contains(&name.as_str()) && case.join(name).is_file(),
            "stale or unknown reference declaration {name} at {path}"
        );
        origin
            .validate()
            .with_context(|| format!("reference {name} at {path}"))?;
    }
    for name in SOURCES {
        ensure!(
            !case.join(name).exists() || document.references.contains_key(name),
            "reference {name} has no provenance in {path}"
        );
    }
    ensure!(
        !document.references.is_empty(),
        "empty reference provenance at {path}"
    );
    Ok(Some(document))
}

pub(super) fn validate(case: &Utf8Path) -> Result<()> {
    read(case).map(|_| ())
}

/// Generated drivers retain the authored policy. Only an actual reference
/// source receives the diagnostic override, after the shared warning flags.
pub(super) fn warning_flags(source: &Utf8Path) -> Result<&'static [&'static str]> {
    if source.file_name() != Some("ref.cpp") {
        return Ok(&[]);
    }
    let case = source.parent().context("reference has no case directory")?;
    let document = read(case)?.context("reference provenance is missing")?;
    Ok(document
        .references
        .get("ref.cpp")
        .context("C++ reference has no provenance")?
        .warning_flags())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    fn fixture(action: impl FnOnce(&Utf8Path)) {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "nts-ref-origin-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        let root = camino::Utf8PathBuf::from_path_buf(path).unwrap();
        std::fs::write(root.join("ref.cpp"), "int value = 1;\n").unwrap();
        action(&root);
        std::fs::remove_dir_all(root).unwrap();
    }
    fn declare(root: &Utf8Path, origin: &str) {
        std::fs::write(
            root.join("ref.provenance.json"),
            format!("{{\"version\":1,\"references\":{{\"ref.cpp\":{origin}}}}}"),
        )
        .unwrap();
    }
    #[test]
    fn every_existing_reference_has_one_valid_declaration() {
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/cases");
        for case in std::fs::read_dir(root).unwrap() {
            let case = camino::Utf8PathBuf::from_path_buf(case.unwrap().path()).unwrap();
            if case.is_dir() {
                validate(&case).unwrap();
            }
        }
    }
    #[test]
    fn missing_and_stale_reference_metadata_is_an_error() {
        fixture(|root| {
            assert!(validate(root).is_err());
            declare(root, "{\"kind\":\"nts-authored\"}");
            validate(root).unwrap();
            std::fs::remove_file(root.join("ref.cpp")).unwrap();
            assert!(validate(root).is_err());
        });
    }
    #[test]
    fn origins_are_strict_and_third_party_requires_an_upstream() {
        fixture(|root| {
            for origin in [
                "{\"kind\":\"unknown\"}",
                "{\"kind\":\"third-party\",\"upstream\":[]}",
                "{\"kind\":\"nts-authored\",\"extra\":true}",
            ] {
                declare(root, origin);
                assert!(validate(root).is_err());
            }
        });
    }
    #[test]
    fn duplicate_reference_declarations_are_errors() {
        fixture(|root| {
            std::fs::write(root.join("ref.provenance.json"), r#"{"version":1,"references":{"ref.cpp":{"kind":"nts-authored"},"ref.cpp":{"kind":"nts-authored"}}}"#).unwrap();
            assert!(validate(root).is_err());
        });
    }
    #[test]
    fn only_third_party_references_relax_warning_fatality() {
        fixture(|root| {
            declare(root, "{\"kind\":\"nts-authored\"}");
            assert!(warning_flags(&root.join("ref.cpp")).unwrap().is_empty());
            declare(
                root,
                "{\"kind\":\"third-party\",\"upstream\":[\"https://example.com/upstream.cpp\"]}",
            );
            assert_eq!(
                warning_flags(&root.join("ref.cpp")).unwrap(),
                &["-Wno-error"]
            );
            assert!(warning_flags(&root.join("driver.cpp")).unwrap().is_empty());
        });
    }
}
