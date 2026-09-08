//! What the developer reads.
//!
//! The report is the product as much as the vendor tree is. There is no
//! JavaScript fallback in this compiler, so a dependency it cannot take has to
//! be visible *before* a build fails on it — and visible as a sentence about a
//! package, not as a construct inside a generated file nobody chose to read.

use std::fmt::Write as _;

use crate::{Acquisition, Origin, PackageReport};

/// Render the human-facing report.
#[must_use]
pub fn render(acquisition: &Acquisition, verbose: bool) -> String {
    let mut out = String::new();
    let total = acquisition.packages.len();
    let acquired: Vec<&PackageReport> =
        acquisition.packages.iter().filter(|p| p.acquired()).collect();
    let refused: Vec<&PackageReport> = acquisition
        .packages
        .iter()
        .filter(|p| !p.acquired())
        .collect();

    let _ = writeln!(
        out,
        "{} of {total} dependencies acquired{}",
        acquired.len(),
        if acquisition.unchanged {
            "  (unchanged)"
        } else {
            ""
        }
    );

    if !acquired.is_empty() {
        out.push('\n');
        let width = acquired.iter().map(|p| p.name.len()).max().unwrap_or(0);
        for package in &acquired {
            let detail = match package.origin {
                Origin::Workspace => "workspace source, in place".to_owned(),
                Origin::Registry => {
                    let files = package.files;
                    let plural = if files == 1 { "file" } else { "files" };
                    format!("{}, {files} {plural}", package.route.describe())
                }
            };
            let _ = writeln!(
                out,
                "  {:width$}  {:9}  {detail}",
                package.name, package.version
            );
            if verbose {
                for (specifier, at) in &package.mapped {
                    let _ = writeln!(out, "      {specifier} -> {at}");
                }
            }
        }
    }

    if !refused.is_empty() {
        let _ = write!(out, "\nnot acquired\n");
        let width = refused.iter().map(|p| p.name.len()).max().unwrap_or(0);
        for package in &refused {
            let _ = writeln!(
                out,
                "  {:width$}  {:9}  {}",
                package.name,
                package.version,
                package.route.describe()
            );
        }
    }

    let patterns: Vec<&PackageReport> = acquisition
        .packages
        .iter()
        .filter(|p| p.acquired() && !p.patterns.is_empty())
        .collect();
    if !patterns.is_empty() {
        let _ = write!(
            out,
            "\nsubpath patterns, which are not expanded — mapping one means \
             guessing which\nsource file a generated path came from:\n"
        );
        for package in patterns {
            let _ = writeln!(out, "  {}", package.patterns.join(", "));
        }
    }

    if !acquisition.missing.is_empty() {
        let _ = write!(
            out,
            "\ndeclared and not installed (run your package manager):\n  {}\n",
            acquisition.missing.join(", ")
        );
    }

    if !acquisition.pruned.is_empty() {
        let _ = write!(
            out,
            "\nremoved, no longer in the dependency graph:\n  {}\n",
            acquisition.pruned.join(", ")
        );
    }

    if let Some(tsconfig) = &acquisition.tsconfig {
        let _ = write!(out, "\ncompile with: {tsconfig}\n");
    }

    out
}

/// The same thing, for anything that would otherwise parse the text.
#[must_use]
pub fn json(acquisition: &Acquisition) -> serde_json::Value {
    serde_json::json!({
        "project": acquisition.project,
        "workspace": acquisition.workspace,
        "tsconfig": acquisition.tsconfig,
        "unchanged": acquisition.unchanged,
        "filesWritten": acquisition.files_written,
        "missing": acquisition.missing,
        "pruned": acquisition.pruned,
        "packages": acquisition.packages.iter().map(|package| serde_json::json!({
            "name": package.name,
            "version": package.version,
            "origin": match package.origin {
                Origin::Workspace => "workspace",
                Origin::Registry => "registry",
            },
            "acquired": package.acquired(),
            "route": package.route.describe(),
            "depth": package.depth,
            "files": package.files,
            "patterns": package.patterns,
            "specifiers": package.mapped.iter()
                .map(|(specifier, at)| serde_json::json!({ "specifier": specifier, "resolvesTo": at }))
                .collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}
