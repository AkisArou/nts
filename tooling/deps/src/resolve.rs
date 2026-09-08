//! Finding installed packages, and the closure they form.
//!
//! # Why `node_modules` and not a lockfile
//!
//! There are four lockfile formats and one `node_modules`. More importantly,
//! `node_modules` is what the developer's program actually resolves against —
//! so reading it cannot disagree with what `tsc`, node, or the editor sees,
//! and a lockfile parser can. pnpm's symlink layout, npm's hoisted layout and
//! a nested `node_modules` all answer the same lookup.

use camino::{Utf8Path, Utf8PathBuf};
use rustc_hash::FxHashMap;

use crate::manifest::Manifest;

/// A package as installed on disk.
#[derive(Debug, Clone)]
pub struct Installed {
    pub name: String,
    pub version: String,
    /// Where the package's files are, after symlinks are followed.
    pub dir: Utf8PathBuf,
    /// How many edges from a direct dependency, for reporting.
    pub depth: usize,
    pub manifest: Manifest,
}

/// Node's lookup, minus the parts that do not apply to a directory walk.
///
/// Walks up from `from`, trying `<dir>/node_modules/<name>`. Symlinks are
/// resolved, which is what makes pnpm's store work: `node_modules/mitt` is a
/// link into `node_modules/.pnpm/mitt@3.0.1/node_modules/mitt`, and the real
/// path is where the package's own `node_modules` lives.
#[must_use]
pub fn find_package(from: &Utf8Path, name: &str) -> Option<Utf8PathBuf> {
    let mut at = Some(from);
    while let Some(dir) = at {
        let candidate = dir.join("node_modules").join(name);
        if candidate.join("package.json").is_file() {
            return candidate
                .canonicalize_utf8()
                .ok()
                .or(Some(candidate));
        }
        at = dir.parent();
    }
    None
}

/// Every runtime dependency reachable from a project, breadth first.
///
/// Development dependencies are excluded: they are not in the program. An
/// optional dependency that is not installed is not an error — that is what
/// optional means.
#[must_use]
pub fn closure(project: &Utf8Path, root: &Manifest) -> Closure {
    let mut found: FxHashMap<String, Installed> = FxHashMap::default();
    let mut missing: Vec<String> = Vec::new();
    // `(name, resolve-from directory, depth)`. Resolving each package's own
    // dependencies *from its own directory* is what makes a nested
    // `node_modules` resolve the way node would.
    let mut queue: Vec<(String, Utf8PathBuf, usize)> = root
        .dependencies
        .keys()
        .map(|name| (name.clone(), project.to_owned(), 0))
        .collect();
    queue.sort();

    while let Some((name, from, depth)) = queue.pop() {
        if found.contains_key(&name) {
            // Keep the shallowest depth: it is what the report orders by.
            if let Some(existing) = found.get_mut(&name) {
                existing.depth = existing.depth.min(depth);
            }
            continue;
        }
        let Some(dir) = find_package(&from, &name) else {
            if !missing.contains(&name) {
                missing.push(name);
            }
            continue;
        };
        let Ok(manifest) = Manifest::read(&dir.join("package.json")) else {
            if !missing.contains(&name) {
                missing.push(name);
            }
            continue;
        };
        for dependency in manifest.dependencies.keys() {
            queue.push((dependency.clone(), dir.clone(), depth + 1));
        }
        found.insert(
            name.clone(),
            Installed {
                name,
                version: manifest.version.clone(),
                dir,
                depth,
                manifest,
            },
        );
    }

    let mut packages: Vec<Installed> = found.into_values().collect();
    packages.sort_by(|a, b| (a.depth, &a.name).cmp(&(b.depth, &b.name)));
    missing.sort();
    Closure { packages, missing }
}

#[derive(Debug, Clone)]
pub struct Closure {
    pub packages: Vec<Installed>,
    /// Named as a dependency and not installed. Reported rather than fatal:
    /// an uninstalled optional dependency is not in the program either.
    pub missing: Vec<String>,
}

/// Resolve a relative import the way TypeScript does.
///
/// The extension substitution is the part that matters and the part a naive
/// resolver gets wrong: TypeScript deliberately resolves `./helper.js` to
/// `helper.ts`, because that is what a module-correct ESM TypeScript program
/// writes. This is not the same as guessing that `dist/x.js` corresponds to
/// `src/x.ts` — it is one specifier, one directory, and the extension the
/// source is allowed to omit.
// Module specifiers are case-sensitive: `./a.JS` is not `./a.js` to a module
// resolver, so lowercasing the comparison would accept specifiers TypeScript
// rejects.
#[allow(clippy::case_sensitive_file_extension_comparisons)]
#[must_use]
pub fn relative_import(from_file: &Utf8Path, specifier: &str) -> Option<Utf8PathBuf> {
    let base = from_file.parent()?.join(specifier);
    let stem = base.as_str();

    let swapped: Vec<String> = match () {
        () if stem.ends_with(".js") => vec![stem.replace_suffix(".js", ".ts"), stem.replace_suffix(".js", ".tsx")],
        () if stem.ends_with(".mjs") => vec![stem.replace_suffix(".mjs", ".mts")],
        () if stem.ends_with(".cjs") => vec![stem.replace_suffix(".cjs", ".cts")],
        () => Vec::new(),
    };

    let candidates = swapped
        .into_iter()
        .map(Utf8PathBuf::from)
        .chain([base.clone()])
        .chain(
            ["ts", "tsx", "mts", "cts"]
                .into_iter()
                .map(|ext| Utf8PathBuf::from(format!("{stem}.{ext}"))),
        )
        .chain(
            ["index.ts", "index.tsx", "index.mts", "index.cts"]
                .into_iter()
                .map(|leaf| base.join(leaf)),
        );

    candidates.into_iter().find(|path| path.is_file()).map(|path| normalize(&path))
}

/// Fold `.` and `..` away, so one file has one spelling.
///
/// `Utf8PathBuf::join` does not do this, and without it `src/a/../b.ts` and
/// `src/b.ts` are different keys for the same file. A module walk that
/// memoises on the key then revisits the same file once per path that reaches
/// it, which turns a 324-file package into a walk that does not finish.
#[must_use]
pub fn normalize(path: &Utf8Path) -> Utf8PathBuf {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.as_str().split('/') {
        match part {
            "." => {}
            "" if !parts.is_empty() => {}
            ".." => {
                if matches!(parts.last(), Some(&last) if last != ".." && !last.is_empty()) {
                    parts.pop();
                } else {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    Utf8PathBuf::from(parts.join("/"))
}

/// `str::replace` on a suffix only, so `a.js.js` loses one extension.
trait ReplaceSuffix {
    fn replace_suffix(&self, from: &str, to: &str) -> String;
}

impl ReplaceSuffix for str {
    fn replace_suffix(&self, from: &str, to: &str) -> String {
        self.strip_suffix(from)
            .map_or_else(|| self.to_owned(), |head| format!("{head}{to}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_suffix_is_replaced_once_and_at_the_end() {
        assert_eq!("a.js.js".replace_suffix(".js", ".ts"), "a.js.ts");
        assert_eq!("a.json".replace_suffix(".js", ".ts"), "a.json");
    }
}

#[cfg(test)]
mod normalize_tests {
    use super::*;

    #[test]
    fn one_file_has_one_spelling() {
        assert_eq!(
            normalize(Utf8Path::new("/p/src/v4/core/../util.ts")),
            Utf8PathBuf::from("/p/src/v4/util.ts")
        );
        assert_eq!(
            normalize(Utf8Path::new("/p/./src//a.ts")),
            Utf8PathBuf::from("/p/src/a.ts")
        );
    }

    /// A relative path that genuinely climbs keeps its `..`, rather than
    /// silently becoming a different path.
    #[test]
    fn a_climb_with_nothing_to_pop_is_kept() {
        assert_eq!(
            normalize(Utf8Path::new("../../a.ts")),
            Utf8PathBuf::from("../../a.ts")
        );
    }
}
