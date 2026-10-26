//! Stable landing population. The complete upstream corpus is a separate survey.

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};

const MANIFEST: &str = include_str!("../corpus-core.json");

fn names(text: &str) -> Result<Vec<String>> {
    let names: Vec<String> = serde_json::from_str(text).context("core corpus manifest")?;
    let mut previous: Option<&str> = None;
    for name in &names {
        let path = Utf8Path::new(name);
        if path.is_absolute()
            || path
                .components()
                .any(|part| !matches!(part, camino::Utf8Component::Normal(_)))
            || !matches!(path.extension(), Some("ts" | "tsx"))
            || previous.is_some_and(|before| before >= name.as_str())
        {
            bail!("invalid or unordered core corpus manifest path: {name}");
        }
        previous = Some(name);
    }
    if names.is_empty() {
        bail!("the core corpus manifest is empty");
    }
    Ok(names)
}

pub(crate) fn core(corpus: &Utf8Path) -> Result<Vec<Utf8PathBuf>> {
    names(MANIFEST)?
        .into_iter()
        .map(|name| {
            let path = corpus.join(&name);
            if !path.is_file() {
                bail!("core corpus manifest case is missing: {name} at {path}");
            }
            Ok(path)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_core_population_keeps_the_old_source_case_inventory() {
        let names = names(MANIFEST).expect("valid manifest");
        assert_eq!(names.len(), 316);
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("compiler/"))
                .count(),
            297
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("conformance/"))
                .count(),
            19
        );
    }

    #[test]
    fn an_empty_duplicate_unordered_or_escaping_selection_is_refused() {
        for text in [
            "[]",
            r#"["a.ts","a.ts"]"#,
            r#"["b.ts","a.ts"]"#,
            r#"["../a.ts"]"#,
            r#"["/a.ts"]"#,
            r#"["a.js"]"#,
        ] {
            assert!(names(text).is_err(), "{text}");
        }
    }

    #[test]
    fn a_missing_selected_case_is_named_rather_than_skipped() {
        let path = std::env::temp_dir().join(format!("nts-missing-corpus-{}", std::process::id()));
        let path = Utf8PathBuf::from_path_buf(path).expect("UTF-8 scratch");
        let error = core(&path).expect_err("missing corpus").to_string();
        assert!(
            error.contains("compiler/allowSyntheticDefaultImports9.ts"),
            "{error}"
        );
    }
}
