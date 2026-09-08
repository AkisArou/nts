//! Monorepos.
//!
//! Two things follow from a repository holding more than one package, and the
//! first is not an optimisation.
//!
//! **A sibling package is not a dependency to acquire.** `packages/app`
//! importing `packages/lib` resolves through `node_modules/@scope/lib`, which
//! is a symlink back into the repository — so the frontend drops it for being
//! external, and the developer's own TypeScript, sitting in their own tree,
//! refuses with the same message an unobtainable npm package gets. Copying it
//! into a vendor directory would "fix" that and freeze a snapshot that goes
//! stale on the next edit. The right answer is to point at it where it lives.
//!
//! **The vendor tree belongs to the workspace, not to one package in it.** A
//! sibling's source is outside the importing package's directory, so the
//! program's root has to be the workspace root anyway; once it is, one copy of
//! a shared dependency serves every package.

use camino::{Utf8Path, Utf8PathBuf};

/// The directory every generated path is anchored to.
///
/// The *nearest* ancestor that declares a workspace, or failing that the
/// nearest one that looks like a repository. Nearest rather than outermost:
/// outermost escapes into whatever happens to contain the project — a checkout
/// living inside another monorepo anchors the vendor tree in a repository that
/// knows nothing about it, and every generated path grows a `../..` per level
/// of accident.
#[must_use]
pub fn root(project: &Utf8Path) -> Utf8PathBuf {
    let mut at = Some(project);
    let mut repository: Option<Utf8PathBuf> = None;
    while let Some(dir) = at {
        if dir.join("pnpm-workspace.yaml").is_file() || declares_workspaces(dir) {
            return dir.to_owned();
        }
        // A repository boundary is the fallback and also the stopping point:
        // nothing above it is part of this project.
        if dir.join(".git").exists() {
            repository.get_or_insert_with(|| dir.to_owned());
            break;
        }
        at = dir.parent();
    }
    repository.unwrap_or_else(|| project.to_owned())
}

fn declares_workspaces(dir: &Utf8Path) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join("package.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.get("workspaces").cloned())
        .is_some()
}

/// Whether an installed package is the developer's own source.
///
/// The test is the resolved path, not the specifier or the link: every package
/// that really came from a registry lives under a `node_modules` somewhere —
/// including pnpm's store, which is `node_modules/.pnpm/<name>@<version>/…`.
/// A workspace package's real path is an ordinary directory in the repository.
#[must_use]
pub fn is_workspace_package(dir: &Utf8Path) -> bool {
    !dir.components().any(|part| part.as_str() == "node_modules")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_store_path_is_not_workspace_source() {
        assert!(!is_workspace_package(Utf8Path::new(
            "/repo/node_modules/.pnpm/mitt@3.0.1/node_modules/mitt"
        )));
        assert!(!is_workspace_package(Utf8Path::new("/repo/node_modules/mitt")));
    }

    #[test]
    fn a_sibling_package_is_workspace_source() {
        assert!(is_workspace_package(Utf8Path::new("/repo/packages/lib")));
    }
}
