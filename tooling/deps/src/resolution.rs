//! Where every specifier actually went, according to the only authority.
//!
//! # Why not resolve it here
//!
//! Because TypeScript resolves the program this compiler compiles, so its
//! answer is the one that binds. Anything that resolves bare specifiers
//! independently — `oxc_resolver`, or an `exports` walk of our own — has to be
//! kept in agreement with the checker, and a disagreement between them has no
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

/// A diagnostic attributed to the source file that produced it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Diagnostic {
    pub file: Utf8PathBuf,
    /// `TS2591`, `TS7006`.
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct Resolution {
    pub modules: Vec<ResolvedModule>,
    /// Config, program and syntax diagnostics from resolution. Semantic
    /// diagnostics come from the ordinary compilation, or the standalone
    /// dependency report's single final check.
    pub diagnostics: Vec<Diagnostic>,
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

/// Resolve imports without constructing a semantic checker or diagnostics pool.
///
/// # Errors
/// Loading the config, reading the working directory, or naming an import failed.
pub fn resolve(
    tsconfig: &Utf8Path,
    count: Option<std::num::NonZeroU16>,
) -> Result<Resolution, ResolutionError> {
    let (options, spec) = request(tsconfig, count)?;
    nts_frontend_tsrs::run(options, move |session| {
        let resolved = session
            .resolve(spec)
            .map_err(|error| ResolutionError::Project(error.to_string()))?;
        let project = resolved
            .projects()
            .next()
            .ok_or(ResolutionError::MissingProject)?;
        let mut modules = Vec::new();
        for file in project.files() {
            for import in file.resolved_imports() {
                let specifier = text(import.specifier, file.path())?;
                let Some(target) = import.resolved_path else {
                    continue;
                };
                let version = import
                    .package_version
                    .map(|version| text(version, file.path()))
                    .transpose()?;
                modules.push(ResolvedModule {
                    package: package_of(target, version),
                    specifier,
                    file: target.to_owned(),
                });
            }
        }
        Ok(Resolution {
            modules,
            diagnostics: diagnostics(resolved.diagnostics(), tsconfig),
        })
    })
}

/// One full check for the standalone dependency report, after acquisition settles.
///
/// # Errors
/// The working directory or native project could not be loaded.
pub(crate) fn check(
    tsconfig: &Utf8Path,
    count: Option<std::num::NonZeroU16>,
    memo: &Utf8Path,
    write_memo: bool,
) -> Result<(Vec<Diagnostic>, bool), ResolutionError> {
    let (options, spec) = request(tsconfig, count)?;
    nts_frontend_tsrs::run(options, move |session| {
        // Acquisition has just resolved the current roots. Replay the full
        // check's observations before reusing its facts, including negative
        // lookups; another program and a diagnostics pool are unnecessary.
        if let Some(reused) = crate::complaint_cache::read(memo, session, &spec) {
            return Ok((reused, true));
        }
        if write_memo {
            crate::complaint_cache::prepare(memo);
        }
        let identity = crate::complaint_cache::identity(session);
        let checked = session
            .open(spec.clone())
            .map_err(|error| ResolutionError::Project(error.to_string()))?;
        let project = checked
            .projects()
            .next()
            .ok_or(ResolutionError::MissingProject)?;
        let paths: Vec<_> = project
            .files()
            .filter(|file| !file.is_default_library())
            .map(|file| file.path().to_owned())
            .collect();
        let finished = checked
            .start_diagnostics(nts_frontend_tsrs::DiagnosticScope::Files(&paths))
            .finish();
        let inputs = finished.inputs();
        let reported = diagnostics(finished.diagnostics(), tsconfig);
        if write_memo {
            crate::complaint_cache::write(memo, identity, &spec, inputs, &reported);
        }
        Ok((reported, false))
    })
}

fn request(
    tsconfig: &Utf8Path,
    count: Option<std::num::NonZeroU16>,
) -> Result<
    (
        nts_frontend_tsrs::SessionOptions,
        nts_frontend_tsrs::ProjectSpec,
    ),
    ResolutionError,
> {
    let directory = std::env::current_dir().map_err(ResolutionError::Directory)?;
    let cwd =
        Utf8PathBuf::from_path_buf(directory).map_err(|_| ResolutionError::WorkingDirectory)?;
    let config = if tsconfig.is_absolute() {
        tsconfig.to_owned()
    } else {
        cwd.join(tsconfig)
    };
    let mut options = nts_frontend_tsrs::SessionOptions::new(cwd);
    options.checker_count = count;
    Ok((options, nts_frontend_tsrs::ProjectSpec::new(config)))
}

fn text(
    value: nts_frontend_tsrs::JsString<'_>,
    file: &Utf8Path,
) -> Result<String, ResolutionError> {
    value.utf8().map(str::to_owned).ok_or_else(|| {
        let escaped = format!("{:x?}", value.utf16());
        ResolutionError::Specifier {
            file: file.to_owned(),
            specifier: escaped,
        }
    })
}

fn diagnostics(reported: Vec<nts_frontend_tsrs::Diagnostic>, config: &Utf8Path) -> Vec<Diagnostic> {
    reported
        .into_iter()
        .filter(|diagnostic| diagnostic.category == nts_frontend_tsrs::DiagnosticCategory::Error)
        .map(|diagnostic| Diagnostic {
            file: diagnostic.path.unwrap_or_else(|| config.to_owned()),
            code: format!("TS{}", diagnostic.code),
            message: diagnostic.message,
        })
        .collect()
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
    #[error("cannot read the working directory: {0}")]
    Directory(std::io::Error),
    #[error("the working directory is not valid UTF-8")]
    WorkingDirectory,
    #[error("cannot resolve the native project: {0}")]
    Project(String),
    #[error("the requested native project is missing")]
    MissingProject,
    #[error("an import specifier in {file} cannot name a filesystem path: {specifier}")]
    Specifier {
        file: Utf8PathBuf,
        specifier: String,
    },
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::*;

    #[test]
    fn package_identity_comes_from_the_last_installed_path_segment() {
        for (path, name, dir) in [
            (
                "/r/node_modules/zod/v4/index.d.cts",
                "zod",
                "/r/node_modules/zod",
            ),
            (
                "/r/node_modules/@scope/pkg/dist/i.d.ts",
                "@scope/pkg",
                "/r/node_modules/@scope/pkg",
            ),
            (
                "/r/node_modules/.pnpm/node_modules/@types/node/index.d.ts",
                "@types/node",
                "/r/node_modules/.pnpm/node_modules/@types/node",
            ),
        ] {
            let package =
                package_of(Utf8Path::new(path), Some("2.0".into())).expect("an installed package");
            assert_eq!(package.name, name);
            assert_eq!(package.dir, dir);
            assert_eq!(package.version, "2.0");
        }
        assert!(
            package_of(
                Utf8Path::new("/r/packages/lib/src/index.ts"),
                Some("1.0".into())
            )
            .is_none()
        );
    }

    #[test]
    fn absent_package_id_does_not_invent_a_checker_version() {
        let package = package_of(Utf8Path::new("/r/node_modules/pkg/index.js"), None)
            .expect("installed path");
        assert_eq!(package.version, "");
    }
}
