//! One location vocabulary for compiler mappings, identities and observations.
use super::SOURCE_BUNDLE;
use anyhow::{Context as _, Result, bail};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

pub(super) const MAPPING_POLICY: &str = "bundled-source-paths-v2";

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "path", rename_all = "kebab-case")]
pub(super) enum InputPath {
    Bundle(String),
    External(PathBuf),
}

pub(super) struct SourcePaths {
    root: PathBuf,
    virtual_root: PathBuf,
}

impl SourcePaths {
    pub(super) fn new(root: &Path) -> Result<Self> {
        let root = root.canonicalize()?;
        let spelling = root
            .to_str()
            .context("bundled dependency source root is not UTF-8")?;
        // JSON's quote/backslash escapes are C string escapes too. Control
        // characters would instead introduce JSON-only universal escapes in
        // #line. '=' cannot be represented in a prefix-map's old-path field.
        if spelling.chars().any(char::is_control) || spelling.contains('=') {
            bail!(
                "bundled dependency source root cannot contain control characters or '=': {}",
                root.display()
            );
        }
        Ok(Self {
            root,
            virtual_root: PathBuf::from(format!("/nts/node-deps/{SOURCE_BUNDLE}")),
        })
    }

    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    pub(super) fn virtual_root(&self) -> &Path {
        &self.virtual_root
    }

    pub(super) fn mappings(&self) -> Vec<String> {
        ["-ffile-prefix-map", "-fdebug-prefix-map"]
            .map(|flag| {
                format!(
                    "{flag}={}={}",
                    self.root.display(),
                    self.virtual_root.display()
                )
            })
            .to_vec()
    }

    pub(super) fn input(&self, path: &Path) -> Result<InputPath> {
        if !path.is_absolute() {
            bail!(
                "native dependency observation is not absolute: {}",
                path.display()
            );
        }
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return Ok(InputPath::External(path.to_owned()));
        };
        // The verified bundle has no links. Normalize a depfile's internal
        // src/../include spelling only while it remains inside that bundle.
        // Never simplify an external path across a possible symbolic link.
        let mut normalized = PathBuf::new();
        for part in relative.components() {
            if part == Component::ParentDir {
                if !normalized.pop() {
                    return Ok(InputPath::External(path.to_owned()));
                }
            } else {
                normalized.push(part);
            }
        }
        Ok(InputPath::Bundle(
            normalized
                .to_str()
                .context("bundled dependency path is not UTF-8")?
                .to_owned(),
        ))
    }

    pub(super) fn resolve(&self, input: &InputPath) -> Result<PathBuf> {
        match input {
            InputPath::Bundle(relative) => {
                let path = Path::new(relative);
                if relative.is_empty()
                    || path
                        .components()
                        .any(|part| !matches!(part, Component::Normal(_)))
                {
                    bail!("invalid bundled dependency observation path: {relative}");
                }
                Ok(self.root.join(path))
            }
            InputPath::External(path) if path.is_absolute() => Ok(path.clone()),
            InputPath::External(path) => bail!(
                "external native dependency observation is not absolute: {}",
                path.display()
            ),
        }
    }

    pub(super) fn identity(&self, path: &Path) -> Result<String> {
        let trailing = path.as_os_str().as_encoded_bytes().last() == Some(&b'/');
        let path = match self.input(path)? {
            InputPath::Bundle(relative) => self.virtual_root.join(relative),
            InputPath::External(path) => path,
        };
        let mut result = path
            .to_str()
            .context("native dependency identity path is not UTF-8")?
            .to_owned();
        // A prefix such as GCC_EXEC_PREFIX can give a trailing slash meaning.
        if trailing && !result.ends_with('/') {
            result.push('/');
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::{InputPath, SourcePaths};
    use std::path::Path;

    #[test]
    fn only_internal_components_rebase_and_observation_escapes_refuse() {
        let own = crate::scratch::StdScratchDir::in_std_target("native-observation-paths");
        let paths = SourcePaths::new(&own).expect("source identity");
        assert_eq!(
            paths
                .input(&own.join("deps/../header.h"))
                .expect("internal spelling"),
            InputPath::Bundle("header.h".into())
        );
        let external = own.join("../external/header.h");
        assert_eq!(
            paths.input(&external).expect("external spelling"),
            InputPath::External(external.clone())
        );
        assert_eq!(
            paths.identity(&external).expect("external identity"),
            external.to_string_lossy()
        );
        for path in ["", "../header.h", "/outside.h", "nested/../../header.h"] {
            assert!(
                paths.resolve(&InputPath::Bundle(path.into())).is_err(),
                "{path}"
            );
        }
        assert!(
            paths
                .resolve(&InputPath::External(Path::new("relative.h").into()))
                .is_err()
        );
    }
    #[test]
    fn source_mapping_root_refuses_unsafe_directive_and_option_characters() {
        let own = crate::scratch::StdScratchDir::in_std_target("native-probe-root-grammar");
        for name in ["line\nbreak", "control\u{0001}byte", "prefix=map"] {
            let path = own.join(name);
            std::fs::create_dir(&path).expect("private root spelling");
            let error = SourcePaths::new(&path)
                .err()
                .expect("root grammar refusal")
                .to_string();
            assert!(error.contains("source root cannot contain"), "{error}");
        }
    }
}
