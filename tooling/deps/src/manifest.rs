//! `package.json`, and the entry points it names.
//!
//! Only the fields that answer "which file is this specifier?" are modelled.
//! Everything else in a manifest is somebody else's business.

use std::collections::BTreeMap;

use camino::{Utf8Path, Utf8PathBuf};
use serde::Deserialize;

/// The subset of `package.json` this crate reads.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub module: Option<String>,
    #[serde(default)]
    pub types: Option<String>,
    #[serde(default)]
    pub typings: Option<String>,
    /// Left as raw JSON: the shape is a recursive union and modelling it as a
    /// type buys nothing that [`Manifest::entry_points`] does not already do.
    #[serde(default)]
    pub exports: Option<serde_json::Value>,
    #[serde(default)]
    pub dependencies: BTreeMap<String, String>,
    #[serde(default)]
    pub optional_dependencies: BTreeMap<String, String>,
}

/// One public specifier, and every file the manifest offers for it.
///
/// `targets` is a candidate list rather than a resolution. npm's condition
/// tree exists to hand different files to different consumers, and this
/// compiler is not one of the consumers it was written for: the `import`
/// branch, the `require` branch and the `types` branch are all evidence about
/// where the implementation lives, and [`crate::recover`] decides which of them
/// it can actually use.
#[derive(Debug, Clone)]
pub struct EntryPoint {
    /// What a program writes: `"zod"`, or `"zod/v4"`.
    pub specifier: String,
    /// Package-relative paths, in the order the manifest offered them.
    pub targets: Vec<String>,
}

fn normalize(target: &str) -> Option<String> {
    let trimmed = target.strip_prefix("./").unwrap_or(target);
    // A target that leaves the package, or is not a path at all, is not ours to
    // follow. `exports` also permits `null` to *deny* a subpath, which arrives
    // here as a non-string and never reaches this function.
    (!trimmed.starts_with("../") && !trimmed.starts_with('/')).then(|| trimmed.replace("//", "/"))
}

/// How much a condition costs to go through.
///
/// `exports` is an ordered map and a real resolver honours that order, but the
/// order is lost by any JSON parser that sorts keys — and what a compiler
/// wants out of the tree is not what a runtime wants anyway. So conditions are
/// ranked instead of ordered, deterministically and by what makes a better
/// *compiler input*.
///
/// This exists because it was wrong: `lru-cache` publishes `browser`, `node`
/// and `default` under `import`, and collecting every leaf without ranking
/// them mapped the package's main specifier at
/// `src/diagnostics-channel-browser.ts` — a real file, and not the one the
/// specifier means. Mapping a specifier to the wrong source is worse than
/// leaving it unmapped.
fn condition_cost(condition: &str) -> Option<u32> {
    match condition {
        // A declaration is a contract, never an implementation.
        "types" | "typings" => None,
        "import" | "module" | "default" => Some(0),
        // Platform variants: real entries, but not the one a bare specifier
        // means when a neutral branch exists beside them.
        "node" => Some(2),
        "require" => Some(5),
        "browser" | "react-native" | "deno" | "worker" | "electron" => Some(10),
        // An unrecognised condition is usually a publisher's own, and those
        // are the ones that point at source. Cheap, but not free.
        _ => Some(1),
    }
}

/// Collect every string leaf under one `exports` value, cheapest first.
fn collect(value: &serde_json::Value, cost: u32, into: &mut Vec<(u32, String)>) {
    match value {
        serde_json::Value::String(s) => {
            if let Some(path) = normalize(s) {
                // A minified bundle is source-shaped in name only; prefer the
                // unminified sibling when a package publishes both.
                let cost = cost + u32::from(path.contains(".min.")) * 3;
                if !into.iter().any(|(_, seen)| *seen == path) {
                    into.push((cost, path));
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect(item, cost, into);
            }
        }
        serde_json::Value::Object(map) => {
            for (condition, value) in map {
                let Some(extra) = condition_cost(condition) else {
                    continue;
                };
                collect(value, cost + extra, into);
            }
        }
        _ => {}
    }
}

/// Flatten a ranked candidate list into the order to try them in.
fn ranked(mut candidates: Vec<(u32, String)>) -> Vec<String> {
    candidates.sort_by_key(|(cost, _)| *cost);
    candidates.into_iter().map(|(_, path)| path).collect()
}

impl Manifest {
    pub fn read(path: &Utf8Path) -> Result<Self, ManifestError> {
        let text = std::fs::read_to_string(path).map_err(|source| ManifestError::Read {
            path: path.to_owned(),
            source,
        })?;
        serde_json::from_str(&text).map_err(|source| ManifestError::Parse {
            path: path.to_owned(),
            source,
        })
    }

    /// Every specifier this package publishes, with the files behind it.
    ///
    /// Subpath *patterns* — an `exports` key containing `*` — are deliberately
    /// not expanded. Expanding one means guessing which files in the package
    /// the pattern was meant to reach, and a guess that `dist/foo.js`
    /// corresponds to `src/foo.ts` is exactly the inference
    /// `docs/npm-deps.md` says not to make. They are reported instead, by
    /// [`EntryPoint::specifier`] never mentioning them.
    #[must_use]
    pub fn entry_points(&self) -> Vec<EntryPoint> {
        let mut out = Vec::new();
        let name = &self.name;

        match &self.exports {
            Some(serde_json::Value::Object(map))
                if map.keys().any(|key| key.starts_with('.')) =>
            {
                for (key, value) in map {
                    if !key.starts_with('.') || key.contains('*') {
                        continue;
                    }
                    let specifier = if key == "." {
                        name.clone()
                    } else {
                        format!("{name}/{}", key.trim_start_matches("./"))
                    };
                    let mut candidates = Vec::new();
                    collect(value, 0, &mut candidates);
                    let targets = ranked(candidates);
                    if !targets.is_empty() {
                        out.push(EntryPoint { specifier, targets });
                    }
                }
            }
            // A bare string, or an object of conditions with no subpath keys,
            // is sugar for `"."`.
            Some(value) => {
                let mut candidates = Vec::new();
                collect(value, 0, &mut candidates);
                let targets = ranked(candidates);
                if !targets.is_empty() {
                    out.push(EntryPoint {
                        specifier: name.clone(),
                        targets,
                    });
                }
            }
            None => {}
        }

        // `main`/`module` are the pre-`exports` spelling of `"."`. They are
        // consulted even when `exports` exists and answered: a package that
        // ships both often points them at different files, and both are
        // evidence about where the implementation is.
        if let Some(root) = out.iter_mut().find(|entry| entry.specifier == *name) {
            for legacy in [&self.module, &self.main].into_iter().flatten() {
                if let Some(path) = normalize(legacy)
                    && !root.targets.contains(&path)
                {
                    root.targets.push(path);
                }
            }
        } else {
            let mut targets = Vec::new();
            for legacy in [&self.module, &self.main].into_iter().flatten() {
                if let Some(path) = normalize(legacy)
                    && !targets.contains(&path)
                {
                    targets.push(path);
                }
            }
            if targets.is_empty() {
                targets.push("index.js".to_owned());
            }
            out.push(EntryPoint {
                specifier: name.clone(),
                targets,
            });
        }

        out.sort_by(|a, b| a.specifier.cmp(&b.specifier));
        out
    }

    /// Subpath patterns the manifest declares, which are reported rather than
    /// expanded. Kept so the report can say what it did not cover.
    #[must_use]
    pub fn export_patterns(&self) -> Vec<String> {
        let Some(serde_json::Value::Object(map)) = &self.exports else {
            return Vec::new();
        };
        map.keys()
            .filter(|key| key.starts_with('.') && key.contains('*'))
            .map(|key| {
                if key == "./*" {
                    format!("{}/*", self.name)
                } else {
                    format!("{}/{}", self.name, key.trim_start_matches("./"))
                }
            })
            .collect()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("could not read `{path}`: {source}")]
    Read {
        path: Utf8PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("`{path}` is not valid JSON: {source}")]
    Parse {
        path: Utf8PathBuf,
        #[source]
        source: serde_json::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(json: &str) -> Manifest {
        serde_json::from_str(json).expect("test manifest parses")
    }

    #[test]
    fn conditions_without_subpaths_are_the_root_specifier() {
        let m = manifest(
            r#"{"name":"p","exports":{"types":"./d.d.ts","import":"./dist/i.js"}}"#,
        );
        let entries = m.entry_points();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].specifier, "p");
        assert!(entries[0].targets.contains(&"dist/i.js".to_owned()));
    }

    #[test]
    fn subpaths_become_their_own_specifiers() {
        let m = manifest(
            r#"{"name":"z","exports":{".":"./dist/index.js","./v4":"./dist/v4.js"}}"#,
        );
        let specifiers: Vec<_> = m.entry_points().into_iter().map(|e| e.specifier).collect();
        assert_eq!(specifiers, vec!["z".to_owned(), "z/v4".to_owned()]);
    }

    /// A pattern is reported, never expanded: expanding it means guessing which
    /// source file a generated path came from.
    #[test]
    fn patterns_are_reported_rather_than_expanded() {
        let m = manifest(r#"{"name":"p","exports":{".":"./i.js","./lib/*":"./dist/*.js"}}"#);
        assert_eq!(m.entry_points().len(), 1);
        assert_eq!(m.export_patterns(), vec!["p/lib/*".to_owned()]);
    }

    /// `main` is evidence even when `exports` already answered, because the two
    /// routinely point at different files.
    #[test]
    fn legacy_fields_join_the_root_specifier() {
        let m = manifest(r#"{"name":"p","exports":{".":"./esm/i.js"},"main":"./cjs/i.js"}"#);
        let root = &m.entry_points()[0];
        assert!(root.targets.contains(&"esm/i.js".to_owned()));
        assert!(root.targets.contains(&"cjs/i.js".to_owned()));
    }

    #[test]
    fn a_package_with_no_entry_fields_still_has_one() {
        let m = manifest(r#"{"name":"p"}"#);
        assert_eq!(m.entry_points()[0].targets, vec!["index.js".to_owned()]);
    }

    #[test]
    fn a_target_that_escapes_the_package_is_not_a_target() {
        let m = manifest(r#"{"name":"p","exports":"../outside/i.js"}"#);
        assert_eq!(m.entry_points()[0].targets, vec!["index.js".to_owned()]);
    }
}
