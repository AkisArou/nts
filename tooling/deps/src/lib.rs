//! Acquiring the TypeScript behind a project's dependencies.
//!
//! # The whole idea in one paragraph
//!
//! `compiled_files` in the frontend drops every file TypeScript resolved out
//! of `node_modules`, whatever route resolved it — a `paths` override does not
//! help and neither does a custom `exports` condition, because the
//! discriminator is the file rather than the specifier. The identical bytes
//! sitting anywhere else become a module and lower. So acquiring a dependency
//! is not a compiler change: it is writing the implementation somewhere the
//! compiler already looks, and pointing a generated `paths` at it.
//!
//! # What it will and will not get
//!
//! Measured over a 458-package closure in `docs/npm-deps.md`: 26 packages have
//! their entry point's implementation recoverable, almost all through embedded
//! source-map content rather than shipped `.ts`. This crate gets those, gets
//! every workspace package for free, and says precisely why it could not get
//! the rest. It never falls back to JavaScript, because there is no JavaScript
//! fallback in this compiler.

pub mod emit;
pub mod manifest;
pub mod recover;
pub mod report;
pub mod resolution;
pub mod resolve;
pub mod workspace;

use std::collections::BTreeMap;

use camino::{Utf8Path, Utf8PathBuf};

use crate::emit::{Lock, LockedPackage};
use crate::manifest::Manifest;
use crate::recover::Route;

/// Where a package's source came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// The developer's own package, elsewhere in the repository. Pointed at
    /// where it lives, never copied.
    Workspace,
    /// Installed from a registry. Recovered into the vendor tree.
    Registry,
}

/// What happened to one dependency.
#[derive(Debug, Clone)]
pub struct PackageReport {
    pub name: String,
    pub version: String,
    pub origin: Origin,
    pub route: Route,
    pub depth: usize,
    /// Specifiers this package now answers, and the file each resolves to.
    pub mapped: Vec<(String, Utf8PathBuf)>,
    /// Specifiers the program imports from this package, acquired or not.
    ///
    /// Kept separately from `mapped`, which is empty for a package that could
    /// not be acquired — and that is exactly the package a developer needs
    /// named, because a name imported from it is about to refuse with no
    /// mention of where it came from.
    pub imported: Vec<String>,
    /// Files written into the vendor tree.
    pub files: usize,
    /// `exports` subpath patterns, which are reported rather than guessed at.
    pub patterns: Vec<String>,
    /// What the checker said about this package's *recovered* source.
    ///
    /// Acquired and buildable are different claims, and this is the second.
    /// Measured over a real corpus: seven of fourteen acquired packages arrive
    /// with nothing to say here, and the rest are mostly missing an ambient
    /// their own build supplied.
    pub complaints: Vec<Complaint>,
}

/// One kind of thing the checker said about a package's recovered source.
#[derive(Debug, Clone)]
pub struct Complaint {
    pub code: String,
    pub count: usize,
    /// The first message of this kind, as an example.
    pub example: String,
}

impl PackageReport {
    #[must_use]
    pub const fn acquired(&self) -> bool {
        matches!(self.origin, Origin::Workspace) || self.route.recovered()
    }
}

/// The result of one acquisition.
#[derive(Debug, Clone)]
pub struct Acquisition {
    pub project: Utf8PathBuf,
    pub workspace: Utf8PathBuf,
    /// The config to point the compiler at, if one was written.
    pub tsconfig: Option<Utf8PathBuf>,
    pub packages: Vec<PackageReport>,
    /// Declared as a dependency and not installed.
    pub missing: Vec<String>,
    /// Vendored packages removed because they left the closure.
    pub pruned: Vec<String>,
    pub files_written: usize,
    /// True when nothing needed doing, which is the common case.
    pub unchanged: bool,
}

impl Acquisition {
    #[must_use]
    pub fn acquired(&self) -> usize {
        self.packages.iter().filter(|p| p.acquired()).count()
    }
}

/// Knobs. The defaults are what a build wants.
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Report what would happen and write nothing.
    pub dry_run: bool,
    /// Where `tsgo` is, so specifiers can be resolved by the authority rather
    /// than by a second implementation of npm's `exports`.
    ///
    /// `None` falls back to reading each package's manifest, which is what the
    /// tests use and what a checkout without a built tsgo gets. The fallback
    /// cannot see subpath patterns or tell two installed versions apart, so it
    /// is a degradation and the report says so.
    pub tsgo: Option<Utf8PathBuf>,
}


/// A sibling package in the same repository, pointed at where it lives.
///
/// `None` when the package is installed from a registry, or when it is a
/// workspace package that publishes only a build — a sibling's `dist` is as
/// opaque as anybody else's, and gets the ordinary treatment.
fn as_workspace_package(
    installed: &resolve::Installed,
    entry_points: &[manifest::EntryPoint],
    patterns: &[String],
) -> Option<PackageReport> {
    if !workspace::is_workspace_package(&installed.dir) {
        return None;
    }
    let mapped: Vec<(String, Utf8PathBuf)> = entry_points
        .iter()
        .filter_map(|entry| {
            let target = entry
                .targets
                .iter()
                .find(|target| is_source(target) && installed.dir.join(target).is_file())?;
            Some((entry.specifier.clone(), installed.dir.join(target)))
        })
        .collect();
    if mapped.is_empty() {
        return None;
    }
    Some(PackageReport {
        name: installed.name.clone(),
        version: installed.version.clone(),
        origin: Origin::Workspace,
        route: Route::ShippedTypeScript,
        depth: installed.depth,
        imported: mapped.iter().map(|(name, _)| name.clone()).collect(),
        mapped,
        files: 0,
        patterns: patterns.to_vec(),
        complaints: Vec::new(),
    })
}

/// What one resolution pass found.
#[derive(Debug, Clone, Default)]
struct Traced {
    /// Packages, with the specifiers each must answer.
    packages: Vec<(resolution::PackageRef, Vec<(String, Utf8PathBuf)>)>,
    /// Specifiers that resolved to source outside any `node_modules` — a
    /// sibling package in the same repository.
    locals: Vec<(String, Utf8PathBuf)>,
    /// What the checker said in passing. Free, and the only evidence that
    /// acquired source can be built.
    diagnostics: Vec<resolution::Diagnostic>,
}

/// One package to work through, and — when the checker answered — the
/// specifiers it has to satisfy. `None` means fall back to its manifest.
type WorkList = Vec<(resolve::Installed, Option<Vec<(String, Utf8PathBuf)>>)>;

/// The packages a program actually imports, as the checker resolved them.
///
/// Returns `None` when there is no tsgo to ask, which is the signal to fall
/// back to walking `node_modules` and reading manifests.
fn resolved_packages(
    tsgo: Option<&Utf8Path>,
    tsconfig: &Utf8Path,
    project: &Utf8Path,
    vendor_root: &Utf8Path,
) -> Option<Traced> {
    let tsgo = tsgo?;
    let resolution = resolution::trace(tsgo, tsconfig).ok()?;
    if resolution.modules.is_empty() {
        return None;
    }

    let mut packages: Vec<(resolution::PackageRef, Vec<(String, Utf8PathBuf)>)> = Vec::new();
    let mut local: Vec<(String, Utf8PathBuf)> = Vec::new();

    for module in &resolution.modules {
        // Relative specifiers are resolved *within* a package, and following
        // them is the recovery walk's job rather than this one's.
        if module.specifier.starts_with('.') || module.specifier.starts_with('#') {
            continue;
        }
        if let Some(package) = &module.package {
            if !packages.iter().any(|(known, _)| known.dir == package.dir) {
                packages.push((package.clone(), Vec::new()));
            }
            let entries = &mut packages
                .iter_mut()
                .find(|(known, _)| known.dir == package.dir)?
                .1;
            if !entries.iter().any(|(name, _)| *name == module.specifier) {
                entries.push((module.specifier.clone(), module.file.clone()));
            }
        } else {
            // Outside `node_modules`: a sibling package in the same repository,
            // reached through a workspace link. Its source is already the
            // implementation, so it is pointed at rather than recovered. A
            // specifier that resolves *inside* this project is one of the
            // project's own aliases and is already in the program.
            {
                // Already acquired: a later pass traces the *generated* config,
                // where an acquired specifier resolves into the vendor tree.
                // Reading that as a new discovery is how the second pass once
                // reported every vendored package as workspace source and then
                // pruned the tree it had just written.
                if module.file.starts_with(vendor_root) {
                    continue;
                }
                if module.file.starts_with(project) || !is_source(module.file.as_str()) {
                    continue;
                }
                if !local.iter().any(|(name, _)| *name == module.specifier) {
                    local.push((module.specifier.clone(), module.file.clone()));
                }
            }
        }
    }
    Some(Traced {
        packages,
        locals: local,
        diagnostics: resolution.diagnostics,
    })
}

/// Acquire everything acquirable for the project rooted at `project`.
///
/// `project` is the directory holding the `package.json`; `tsconfig` is the
/// config the developer builds with, which is extended rather than modified.
///
/// # Why this runs more than once
///
/// Resolution is taken from the program as it stands, and the program as it
/// stands does not contain the source that has not been acquired yet. A
/// dependency's *own* dependencies are invisible on the first pass: nothing
/// imports them until its source is in the program. So each pass traces the
/// best config so far and stops when a pass discovers nothing new — usually
/// the second, and bounded because a cycle in a broken tree must not spin.
pub fn acquire(
    project: &Utf8Path,
    tsconfig: &Utf8Path,
    options: &Options,
) -> Result<Acquisition, Error> {
    const PASSES: usize = 6;
    let project_dir = project
        .canonicalize_utf8()
        .unwrap_or_else(|_| project.to_owned());
    let vendor_root = workspace::root(&project_dir).join(".nts").join("vendor");

    // Accumulated across passes. A pass can only *add*: a specifier that
    // resolved into the vendor tree on a later pass is one this already knows
    // about, and re-deriving the whole set from the newest trace would lose it.
    let mut discovered: Vec<(resolution::PackageRef, Vec<(String, Utf8PathBuf)>)> = Vec::new();
    let mut local: Vec<(String, Utf8PathBuf)> = Vec::new();
    let mut complaints: Vec<resolution::Diagnostic> = Vec::new();
    let mut trace_with = tsconfig.to_owned();
    let mut last: Option<Acquisition> = None;

    for pass in 0..PASSES {
        let traced = resolved_packages(
            options.tsgo.as_deref(),
            &trace_with,
            &project_dir,
            &vendor_root,
        );
        let mut grew = false;
        if let Some(Traced {
            packages,
            locals,
            diagnostics,
        }) = traced
        {
            complaints = diagnostics;
            for (package, specifiers) in packages {
                if let Some((_, known)) =
                    discovered.iter_mut().find(|(known, _)| known.dir == package.dir)
                {
                    for entry in specifiers {
                        if !known.iter().any(|(name, _)| *name == entry.0) {
                            known.push(entry);
                            grew = true;
                        }
                    }
                } else {
                    discovered.push((package, specifiers));
                    grew = true;
                }
            }
            for entry in locals {
                if !local.iter().any(|(name, _)| *name == entry.0) {
                    local.push(entry);
                    grew = true;
                }
            }
        }

        let resolved = options.tsgo.as_ref().map(|_| Traced {
            packages: discovered.clone(),
            locals: local.clone(),
            diagnostics: Vec::new(),
        });
        let mut acquisition = acquire_once(&project_dir, tsconfig, resolved.as_ref(), options)?;
        // The trace that answered "where did this go" also typechecked, and its
        // complaints about the *vendor tree* are the only evidence that the
        // source just acquired can be built. Attributed from the previous
        // pass's trace, which is the newest one that saw the current tree.
        attribute(&mut acquisition, &complaints, &vendor_root);
        let next = acquisition.tsconfig.clone();
        last = Some(acquisition);

        if !grew && pass > 0 {
            break;
        }
        if options.tsgo.is_none() || pass + 1 == PASSES {
            break;
        }
        match next {
            Some(generated) => trace_with = generated,
            None => break,
        }
    }
    last.ok_or(Error::NoPass)
}

/// What to work through this pass, and the workspace specifiers to point at.
///
/// Split out because it is the half that differs between "the checker told us"
/// and "we read the manifests", and reading them side by side is the only way
/// to see that they differ in *what they can see* rather than in what they do.
fn work_list(
    project: &Utf8Path,
    closure: &resolve::Closure,
    resolved: Option<&Traced>,
    paths: &mut BTreeMap<String, Vec<String>>,
    packages: &mut Vec<PackageReport>,
) -> WorkList {
    let mut queue: WorkList = Vec::new();
    match resolved {
        Some(Traced {
            packages: traced,
            locals: local,
            ..
        }) => {
            // A sibling package in the same repository: the checker already
            // named its source file, so there is nothing to recover and nothing
            // to choose. Point at it.
            for (specifier, file) in local {
                paths.insert(specifier.clone(), vec![relative(project, file)]);
                if !packages.iter().any(|report: &PackageReport| report.name == *specifier) {
                    let version = package_version_at(file);
                    packages.push(PackageReport {
                        name: specifier.clone(),
                        version,
                        origin: Origin::Workspace,
                        route: Route::ShippedTypeScript,
                        depth: 0,
                        imported: vec![specifier.clone()],
                        mapped: vec![(specifier.clone(), file.clone())],
                        files: 0,
                        patterns: Vec::new(),
                        complaints: Vec::new(),
                    });
                }
            }
            for (package, specifiers) in traced {
                let Ok(manifest) = Manifest::read(&package.dir.join("package.json")) else {
                    continue;
                };
                let depth = closure
                    .packages
                    .iter()
                    .find(|known| known.name == package.name)
                    .map_or(1, |known| known.depth);
                queue.push((
                    resolve::Installed {
                        name: package.name.clone(),
                        version: if package.version.is_empty() {
                            manifest.version.clone()
                        } else {
                            package.version.clone()
                        },
                        dir: package.dir.clone(),
                        depth,
                        manifest,
                    },
                    Some(specifiers.clone()),
                ));
            }
        }
        None => queue.extend(closure.packages.iter().map(|installed| (installed.clone(), None))),
    }

    queue
}

/// Attach the checker's complaints to the packages whose source they are about.
///
/// Only the vendor tree: an error in the developer's own code is theirs, was
/// there before acquisition, and is not this tool's to report. Grouped by
/// error code rather than listed, because forty instances of `Cannot find name
/// 'process'` are one fact about a package's build environment and not forty
/// facts.
fn attribute(
    acquisition: &mut Acquisition,
    diagnostics: &[resolution::Diagnostic],
    vendor_root: &Utf8Path,
) {
    for package in &mut acquisition.packages {
        package.complaints.clear();
    }
    // The vendor directory's own name, matched inside the path rather than as a
    // prefix: tsgo reports a file relative to *its* working directory, so an
    // absolute prefix does not match and every complaint was silently dropped.
    let marker = format!(
        "/{}/",
        vendor_root
            .file_name()
            .map_or_else(|| ".nts/vendor".to_owned(), ToOwned::to_owned)
    );
    for diagnostic in diagnostics {
        let path = diagnostic.file.as_str();
        let Some(at) = path.rfind(&marker) else {
            continue;
        };
        // `<name>@<version>/…`, the way `emit::package_dir` wrote it.
        let Some(slug) = path[at + marker.len()..]
            .split('/')
            .next()
            .map(ToOwned::to_owned)
        else {
            continue;
        };
        let Some(package) = acquisition.packages.iter_mut().find(|package| {
            emit::package_dir(&format!("{}@{}", package.name, package.version)) == slug
        }) else {
            continue;
        };
        match package
            .complaints
            .iter_mut()
            .find(|complaint| complaint.code == diagnostic.code)
        {
            Some(complaint) => complaint.count += 1,
            None => package.complaints.push(Complaint {
                code: diagnostic.code.clone(),
                count: 1,
                example: diagnostic.message.clone(),
            }),
        }
    }
    for package in &mut acquisition.packages {
        package.complaints.sort_by_key(|complaint| std::cmp::Reverse(complaint.count));
    }
}

/// What every package in one pass shares.
struct Pass<'a> {
    project: &'a Utf8Path,
    vendor_root: &'a Utf8Path,
    previous: &'a Lock,
    options: &'a Options,
}

/// Recover one package, write what it produced, and report on it.
///
/// Separated from the pass around it because the pass is bookkeeping and this
/// is the decision: which route a package's source came by, and what the
/// specifiers it publishes now resolve to.
fn acquire_package(
    installed: &resolve::Installed,
    traced: Option<&Vec<(String, Utf8PathBuf)>>,
    pass: &Pass<'_>,
    lock: &mut Lock,
    paths: &mut BTreeMap<String, Vec<String>>,
) -> Result<(PackageReport, usize), Error> {
    let entry_points = installed.manifest.entry_points();
    let patterns = if traced.is_some() {
        // A pattern the checker expanded is not an unexpanded pattern.
        Vec::new()
    } else {
        installed.manifest.export_patterns()
    };

    if traced.is_none()
        && let Some(report) = as_workspace_package(installed, &entry_points, &patterns)
    {
        for (specifier, at) in &report.mapped {
            paths.insert(specifier.clone(), vec![relative(pass.project, at)]);
        }
        return Ok((report, 0));
    }

    let recovery = match traced {
        Some(specifiers) => recover::recover_resolved(installed, specifiers),
        None => recover::recover(installed, &entry_points),
    };
    let route = recovery.headline();
    // The version is in the directory name so two versions of one package can
    // coexist, and so that looking at the vendor tree answers "which version am
    // I compiling" without opening anything.
    let slug = format!("{}@{}", installed.name, installed.version);
    let package_root = pass.vendor_root.join(emit::package_dir(&slug));
    let digest = emit::digest(&recovery.files);

    let mapped: Vec<(String, Utf8PathBuf)> = recovery
        .entries
        .iter()
        .filter_map(|entry| {
            entry
                .entry
                .as_ref()
                .map(|at| (entry.specifier.clone(), package_root.join(at)))
        })
        .collect();

    let mut files_written = 0;
    if recovery.any_recovered() && !pass.options.dry_run {
        let stale = pass
            .previous
            .packages
            .get(&installed.name)
            .is_none_or(|locked| locked.digest != digest);
        if stale || !package_root.is_dir() {
            files_written = emit::write_package(pass.vendor_root, &slug, &recovery.files)?;
        }
    }

    if recovery.any_recovered() {
        for (specifier, at) in &mapped {
            paths.insert(specifier.clone(), vec![relative(pass.project, at)]);
        }
        lock.packages.insert(
            installed.name.clone(),
            LockedPackage {
                version: installed.version.clone(),
                source: installed.dir.to_string(),
                route: route.describe(),
                digest,
                files: recovery.files.len(),
            },
        );
    }

    Ok((
        PackageReport {
            name: installed.name.clone(),
            version: installed.version.clone(),
            origin: Origin::Registry,
            route,
            depth: installed.depth,
            imported: traced.map(|specifiers| {
                specifiers.iter().map(|(name, _)| name.clone()).collect()
            }).unwrap_or_default(),
            mapped,
            files: recovery.files.len(),
            patterns,
            complaints: Vec::new(),
        },
        files_written,
    ))
}

fn acquire_once(
    project: &Utf8Path,
    tsconfig: &Utf8Path,
    resolved: Option<&Traced>,
    options: &Options,
) -> Result<Acquisition, Error> {
    let project = project
        .canonicalize_utf8()
        .unwrap_or_else(|_| project.to_owned());
    let root_manifest = Manifest::read(&project.join("package.json"))?;
    let workspace = workspace::root(&project);
    let vendor_root = workspace.join(".nts").join("vendor");

    // The checker's answer where it can be had, and a manifest walk where it
    // cannot. They differ in what they can see rather than in what they do:
    // resolution knows the exact subpaths a program imported, which version of
    // a package each importer got, and how a subpath *pattern* expanded — none
    // of which a manifest states.
    let closure = resolve::closure(&project, &root_manifest);
    let previous = emit::read_lock(&workspace);
    let mut lock = Lock {
        version: emit::LOCK_VERSION,
        packages: BTreeMap::new(),
    };

    // `paths` targets are written relative to the generated config's directory,
    // which is the project. A monorepo sibling and a vendored package are both
    // reached the same way from there.
    let mut paths: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut packages = Vec::new();
    let mut files_written = 0usize;

    // What to work through, and — when the checker answered — which specifiers
    // each package has to satisfy. `None` means fall back to whatever the
    // package's manifest offers.
    let queue = work_list(&project, &closure, resolved, &mut paths, &mut packages);

    for (installed, traced) in &queue {
        let (report, written) = acquire_package(
            installed,
            traced.as_ref(),
            &Pass {
                project: &project,
                vendor_root: &vendor_root,
                previous: &previous,
                options,
            },
            &mut lock,
            &mut paths,
        )?;
        files_written += written;
        packages.push(report);
    }

    packages.sort_by(|a, b| {
        (!a.acquired(), a.depth, &a.name).cmp(&(!b.acquired(), b.depth, &b.name))
    });

    let lock_unchanged = lock.packages == previous.packages;
    let mut pruned = Vec::new();
    let mut written_tsconfig = None;

    // Nothing to map means nothing to write. A project with no acquirable
    // dependency should be left exactly as it was found -- a generated config
    // that only re-states `extends` is a file the developer did not ask for and
    // has to wonder about.
    if !options.dry_run && !paths.is_empty() {
        let (removed, config) = finish(&project, tsconfig, &workspace, &vendor_root, &lock, &paths)?;
        pruned = removed;
        written_tsconfig = Some(config);
    }

    Ok(Acquisition {
        project,
        workspace,
        tsconfig: written_tsconfig,
        packages,
        missing: closure.missing,
        unchanged: files_written == 0 && lock_unchanged && pruned.is_empty(),
        files_written,
        pruned,
    })
}

/// Write the lock and the generated config, and drop what left the graph.
fn finish(
    project: &Utf8Path,
    tsconfig: &Utf8Path,
    workspace: &Utf8Path,
    vendor_root: &Utf8Path,
    lock: &Lock,
    paths: &BTreeMap<String, Vec<String>>,
) -> Result<(Vec<String>, Utf8PathBuf), Error> {
    let keep: Vec<String> = lock
        .packages
        .iter()
        .map(|(name, locked)| emit::package_dir(&format!("{name}@{}", locked.version)))
        .collect();
    let pruned = emit::prune(vendor_root, &keep);
    emit::write_lock(workspace, lock)?;
    // The developer's config, named from beside the generated one. Both paths
    // are canonicalised first: `strip_prefix` on a relative argument against an
    // absolute project silently fell through to the whole given path, and
    // `extends: ./examples/library/tsconfig.json` inherits nothing.
    let canonical = tsconfig
        .canonicalize_utf8()
        .unwrap_or_else(|_| tsconfig.to_owned());
    let config = emit::write_tsconfig(
        project,
        &relative(project, &canonical),
        &relative_dir(project, workspace),
        paths,
        &inherited_paths(tsconfig),
    )?;
    Ok((pruned, config))
}

/// The version of the package a source file belongs to, by walking up to the
/// nearest `package.json`. Cosmetic — it is what the report prints.
fn package_version_at(file: &Utf8Path) -> String {
    let mut at = file.parent();
    while let Some(dir) = at {
        if let Ok(manifest) = Manifest::read(&dir.join("package.json")) {
            return manifest.version;
        }
        at = dir.parent();
    }
    String::new()
}

fn is_source(path: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts"].iter().any(|ext| path.ends_with(ext))
        && !path.ends_with(".d.ts")
        && !path.ends_with(".d.mts")
        && !path.ends_with(".d.cts")
}

/// A path from `base` to a directory, as `rootDir` wants it: `.` when they are
/// the same directory rather than the empty string.
fn relative_dir(base: &Utf8Path, target: &Utf8Path) -> String {
    let path = relative(base, target);
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "." {
        ".".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// A path from `base` to `target`, as `paths` wants it.
fn relative(base: &Utf8Path, target: &Utf8Path) -> String {
    let base: Vec<&str> = base.components().map(|c| c.as_str()).collect();
    let target_parts: Vec<&str> = target.components().map(|c| c.as_str()).collect();
    let shared = base
        .iter()
        .zip(&target_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let up = base.len() - shared;
    let mut out: Vec<&str> = std::iter::repeat_n("..", up).collect();
    out.extend(&target_parts[shared..]);
    let joined = out.join("/");
    if joined.starts_with("..") {
        joined
    } else {
        format!("./{joined}")
    }
}

/// The `paths` the project already declares, so generating ours does not erase
/// them. A hand-written mapping is a decision, and it outranks anything here.
fn inherited_paths(tsconfig: &Utf8Path) -> BTreeMap<String, Vec<String>> {
    let Ok(text) = std::fs::read_to_string(tsconfig) else {
        return BTreeMap::new();
    };
    serde_json::from_str::<serde_json::Value>(&strip_jsonc(&text))
        .ok()
        .and_then(|value| value.get("compilerOptions")?.get("paths")?.as_object().cloned())
        .map(|map| {
            map.into_iter()
                .filter_map(|(key, value)| {
                    let targets: Vec<String> = value
                        .as_array()?
                        .iter()
                        .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                        .collect();
                    Some((key, targets))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// tsconfig files are JSON with comments and trailing commas.
fn strip_jsonc(text: &str) -> String {
    let mut out: Vec<u8> = Vec::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut at = 0usize;
    let mut in_string = false;

    while at < bytes.len() {
        let byte = bytes[at];
        if in_string {
            out.push(byte);
            if byte == b'\\' && at + 1 < bytes.len() {
                out.push(bytes[at + 1]);
                at += 2;
                continue;
            }
            if byte == b'"' {
                in_string = false;
            }
            at += 1;
            continue;
        }
        match byte {
            b'"' => {
                in_string = true;
                out.push(b'"');
                at += 1;
            }
            b'/' if at + 1 < bytes.len() && bytes[at + 1] == b'/' => {
                while at < bytes.len() && bytes[at] != b'\n' {
                    at += 1;
                }
            }
            b'/' if at + 1 < bytes.len() && bytes[at + 1] == b'*' => {
                at += 2;
                while at + 1 < bytes.len() && !(bytes[at] == b'*' && bytes[at + 1] == b'/') {
                    at += 1;
                }
                at = (at + 2).min(bytes.len());
            }
            b',' => {
                // A trailing comma is one followed only by whitespace and a
                // closing bracket.
                let next = bytes[at + 1..]
                    .iter()
                    .position(|b| !b.is_ascii_whitespace())
                    .map(|offset| bytes[at + 1 + offset]);
                if !matches!(next, Some(b'}' | b']')) {
                    out.push(b',');
                }
                at += 1;
            }
            other => {
                out.push(other);
                at += 1;
            }
        }
    }
    // Every byte kept came from `text`, and comments are removed whole.
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("acquisition made no pass at all, which cannot happen")]
    NoPass,
    #[error(transparent)]
    Manifest(#[from] manifest::ManifestError),
    #[error(transparent)]
    Emit(#[from] emit::EmitError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_path_climbs_and_descends() {
        assert_eq!(
            relative(
                Utf8Path::new("/r/packages/app"),
                Utf8Path::new("/r/.nts/vendor/mitt@3.0.1/src/index.ts")
            ),
            "../../.nts/vendor/mitt@3.0.1/src/index.ts"
        );
        assert_eq!(
            relative(Utf8Path::new("/r"), Utf8Path::new("/r/a/b.ts")),
            "./a/b.ts"
        );
    }

    #[test]
    fn comments_and_trailing_commas_leave_valid_json() {
        let text = r#"{
            // a line comment
            "compilerOptions": { /* inline */ "paths": { "a": ["./a.ts"], } },
            "url": "https://example.com/not-a-comment",
        }"#;
        let value: serde_json::Value =
            serde_json::from_str(&strip_jsonc(text)).expect("stripped JSONC parses");
        assert_eq!(value["url"], "https://example.com/not-a-comment");
        assert!(value["compilerOptions"]["paths"]["a"].is_array());
    }
}
