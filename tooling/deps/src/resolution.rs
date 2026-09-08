//! Where every specifier actually went, according to the only authority.
//!
//! # Why not resolve it here
//!
//! Because TypeScript resolves the program this compiler compiles, so its
//! answer is the one that binds. Anything that resolves bare specifiers
//! independently — `oxc_resolver`, or an `exports` walk of our own — has to be
//! kept in agreement with tsgo, and a disagreement between them has no
//! adjudicator.
//!
//! The `exports` walk this replaces was the weakest code in the crate: JSON
//! object order is lost by the parser, so conditions had to be *ranked* rather
//! than matched in order, and that mapped `lru-cache` at
//! `diagnostics-channel-browser.ts` — a real file, and not the one the
//! specifier means. `imports`/`#internal` specifiers, self-reference and
//! `exports: null` denial were not handled at all. None of them need handling
//! now: they are answered before this crate is asked.
//!
//! # What it does not answer
//!
//! Which file holds the *implementation*. TypeScript resolves a specifier to
//! the package's **declarations** — `lru-cache` lands on
//! `dist/esm/index.d.ts` — because declarations are what a checker wants. So
//! resolution says *which package and which subpath*, exactly, and
//! [`crate::recover`] still has to find the source behind that answer.

use camino::{Utf8Path, Utf8PathBuf};

/// One specifier, and the file the checker resolved it to.
#[derive(Debug, Clone)]
pub struct ResolvedModule {
    /// As written in the source: `zod/v4`, `./helper.js`.
    pub specifier: String,
    pub file: Utf8PathBuf,
    /// Present when the file came out of a package rather than the project.
    pub package: Option<PackageRef>,
}

/// A package, as the checker identified it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageRef {
    pub name: String,
    pub version: String,
    /// The package's own directory: everything above the resolved file.
    pub dir: Utf8PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct Resolution {
    pub modules: Vec<ResolvedModule>,
}

impl Resolution {
    /// Every bare specifier that landed inside a package, deduplicated.
    ///
    /// Relative specifiers are dropped: they are resolved *within* whatever
    /// this returns, and following them is [`crate::recover`]'s job.
    #[must_use]
    pub fn package_specifiers(&self) -> Vec<&ResolvedModule> {
        let mut seen: Vec<&ResolvedModule> = Vec::new();
        for module in &self.modules {
            if module.specifier.starts_with('.') || module.package.is_none() {
                continue;
            }
            if seen.iter().any(|kept| kept.specifier == module.specifier) {
                continue;
            }
            seen.push(module);
        }
        seen.sort_by(|a, b| a.specifier.cmp(&b.specifier));
        seen
    }
}

/// Ask tsgo where everything went.
///
/// Runs the checker once with `--traceResolution` and reads the trace. It is a
/// separate process from the one the frontend runs, which costs a spawn — worth
/// it against maintaining a second resolver, and skippable entirely when
/// acquisition is already up to date.
pub fn trace(tsgo: &Utf8Path, tsconfig: &Utf8Path) -> Result<Resolution, ResolutionError> {
    let output = std::process::Command::new(tsgo)
        .arg("-p")
        .arg(tsconfig)
        .arg("--noEmit")
        .arg("--traceResolution")
        .output()
        .map_err(|source| ResolutionError::Spawn {
            executable: tsgo.to_owned(),
            source,
        })?;
    // A program with type errors still resolved its imports, and acquisition is
    // often what *fixes* those errors, so the exit status is deliberately not
    // consulted. An empty trace is the only real failure.
    Ok(parse(&String::from_utf8_lossy(&output.stdout)))
}

/// Read the trace.
///
/// The lines of interest look like:
///
/// ```text
/// ======== Module name 'zod/v4' was successfully resolved to '/…/zod/v4/index.d.cts' with Package ID 'zod/v4/index.d.cts@4.5.4'. ========
/// ```
#[must_use]
pub fn parse(trace: &str) -> Resolution {
    let mut modules = Vec::new();
    for line in trace.lines() {
        let Some(rest) = line.strip_prefix("======== Module name '") else {
            continue;
        };
        let Some((specifier, rest)) = rest.split_once('\'') else {
            continue;
        };
        let Some(rest) = rest.strip_prefix(" was successfully resolved to '") else {
            continue;
        };
        let Some((file, rest)) = rest.split_once('\'') else {
            continue;
        };
        let version = rest
            .strip_prefix(" with Package ID '")
            .and_then(|tail| tail.split_once('\''))
            .and_then(|(id, _)| id.rsplit_once('@'))
            .map(|(_, version)| version.to_owned());

        let file = Utf8PathBuf::from(file);
        modules.push(ResolvedModule {
            package: package_of(&file, version),
            specifier: specifier.to_owned(),
            file,
        });
    }
    Resolution { modules }
}

/// The package a resolved file belongs to, from its path.
///
/// The path is the authority rather than the Package ID, whose name half cannot
/// be split from its subpath without already knowing where the name ends:
/// `@demo/lib/src/index.ts@1.0.0` has a two-segment name and
/// `zod/v4/index.d.cts@4.5.4` has a one-segment name, and nothing in the string
/// says which. The path says: everything after the last `node_modules` is the
/// name, one segment or two.
fn package_of(file: &Utf8Path, version: Option<String>) -> Option<PackageRef> {
    let parts: Vec<&str> = file.as_str().split('/').collect();
    let at = parts.iter().rposition(|part| *part == "node_modules")?;
    let scoped = parts.get(at + 1)?.starts_with('@');
    let width = if scoped { 2 } else { 1 };
    let name = parts.get(at + 1..=at + width)?.join("/");
    let dir = Utf8PathBuf::from(parts.get(..=at + width)?.join("/"));
    Some(PackageRef {
        name,
        version: version.unwrap_or_default(),
        dir,
    })
}

#[derive(Debug, thiserror::Error)]
pub enum ResolutionError {
    #[error("could not run `{executable}`: {source}")]
    Spawn {
        executable: Utf8PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRACE: &str = "\
noise that is not a resolution
======== Module name '@demo/lib' was successfully resolved to '/r/packages/lib/src/index.ts' with Package ID '@demo/lib/src/index.ts@1.0.0'. ========
======== Module name 'mitt' was successfully resolved to '/r/app/node_modules/mitt/index.d.ts' with Package ID 'mitt/index.d.ts@3.0.1'. ========
======== Module name 'zod/v4' was successfully resolved to '/r/app/node_modules/zod/v4/index.d.cts' with Package ID 'zod/v4/index.d.cts@4.5.4'. ========
======== Module name '@scope/pkg' was successfully resolved to '/r/app/node_modules/@scope/pkg/dist/i.d.ts' with Package ID '@scope/pkg/dist/i.d.ts@2.0.0'. ========
======== Module name './math.ts' was successfully resolved to '/r/packages/lib/src/math.ts'. ========
======== Module name 'gone' was not resolved. ========
";

    #[test]
    fn a_subpath_specifier_keeps_its_own_identity() {
        let resolution = parse(TRACE);
        let zod = resolution
            .modules
            .iter()
            .find(|module| module.specifier == "zod/v4")
            .expect("the subpath specifier is traced");
        let package = zod.package.as_ref().expect("it came from a package");
        assert_eq!(package.name, "zod");
        assert_eq!(package.version, "4.5.4");
        assert_eq!(package.dir, "/r/app/node_modules/zod");
        assert_eq!(zod.file, "/r/app/node_modules/zod/v4/index.d.cts");
    }

    /// A scoped name is two segments, and the Package ID cannot say so.
    #[test]
    fn a_scoped_package_keeps_both_segments() {
        let resolution = parse(TRACE);
        let scoped = resolution
            .modules
            .iter()
            .find(|module| module.specifier == "@scope/pkg")
            .expect("traced");
        let package = scoped.package.as_ref().expect("from a package");
        assert_eq!(package.name, "@scope/pkg");
        assert_eq!(package.dir, "/r/app/node_modules/@scope/pkg");
    }

    /// A workspace sibling resolves outside `node_modules` and is not a package
    /// to acquire, however the trace labels it.
    #[test]
    fn a_workspace_sibling_is_not_a_package() {
        let resolution = parse(TRACE);
        let lib = resolution
            .modules
            .iter()
            .find(|module| module.specifier == "@demo/lib")
            .expect("traced");
        assert!(lib.package.is_none());
    }

    #[test]
    fn relative_specifiers_and_failures_are_not_package_specifiers() {
        let resolution = parse(TRACE);
        let specifiers: Vec<&str> = resolution
            .package_specifiers()
            .iter()
            .map(|module| module.specifier.as_str())
            .collect();
        assert_eq!(specifiers, vec!["@scope/pkg", "mitt", "zod/v4"]);
    }
}
