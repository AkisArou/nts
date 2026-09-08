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
            complaints_of(package, &mut out);
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

    notes(acquisition, &acquired, &mut out);

    if let Some(tsconfig) = &acquisition.tsconfig {
        let _ = write!(out, "\ncompile with: {tsconfig}\n");
    }

    out
}

/// Everything after the two lists: what was not expanded, not installed, not
/// kept, and not buildable.
fn notes(acquisition: &Acquisition, acquired: &[&PackageReport], out: &mut String) {
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

    let unbuildable: Vec<&PackageReport> = acquisition
        .packages
        .iter()
        .filter(|package| package.acquired() && !package.complaints.is_empty())
        .collect();
    if !unbuildable.is_empty() {
        let total: usize = unbuildable
            .iter()
            .map(|package| package.complaints.iter().map(|c| c.count).sum::<usize>())
            .sum();
        let _ = write!(
            out,
            "\n{} of {} acquired packages have {total} problem(s) in their recovered\nsource. The source is real; it was written for a configuration this project\ndoes not have.\n",
            unbuildable.len(),
            acquired.len(),
        );

        // The commonest single cause, and the one worth naming separately
        // because the fix is one line of the developer's own config.
        let ambient: usize = unbuildable
            .iter()
            .flat_map(|package| &package.complaints)
            .filter(|complaint| matches!(complaint.code.as_str(), "TS2591" | "TS2552" | "TS2503"))
            .map(|complaint| complaint.count)
            .sum();
        if ambient > 0 {
            let _ = write!(
                out,
                "\n{ambient} of those are an ambient the package's own build supplied — \
                 `process`,\n`Buffer`, a namespace. Adding it to `types` in your tsconfig \
                 fixes them.\n\nAcquisition will not add it for you: these are host globals, \
                 and a program\ncompiled to a native target may not have them. Source that \
                 needs `process` is\nsource with a requirement, and quietly satisfying it \
                 here would hide that.\n"
            );
        }
    }

}

/// What the checker said about one package's recovered source.
///
/// Acquired and buildable are different claims. A package whose recovered
/// source the checker complains about was still acquired — the source is real —
/// but saying only that would be half the story, and the half a developer finds
/// out later.
fn complaints_of(package: &PackageReport, out: &mut String) {
    for complaint in package.complaints.iter().take(3) {
        let _ = writeln!(
            out,
            "      {} × {}: {}",
            complaint.count, complaint.code, complaint.example
        );
    }
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
            "complaints": package.complaints.iter().map(|complaint| serde_json::json!({
                "code": complaint.code,
                "count": complaint.count,
                "example": complaint.example,
            })).collect::<Vec<_>>(),
            "specifiers": package.mapped.iter()
                .map(|(specifier, at)| serde_json::json!({ "specifier": specifier, "resolvesTo": at }))
                .collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}
