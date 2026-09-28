//! `SwiftPM`, read from what `swift package resolve` left: `Package.resolved`
//! for the remote packages' pins, `.build/checkouts` for their sources, and
//! the package manifests for what their targets are.
//!
//! Nothing here resolves. A manifest (`Package.swift`) is a Swift program,
//! whose targets, paths and headers are what it computes, so it is read by
//! `SwiftPM`'s own `swift-package dump-package`, which runs it and prints the
//! result -- the one reading of a manifest that cannot differ from Xcode's.
//! A remote package's checkout must be the revision `Package.resolved` pins,
//! which `SwiftPM` records in `.build/workspace-state.json` as it checks one
//! out; a local package (`.package(path:)`) is read where it is, and pinned by
//! nothing.
//!
//! Each library target is a module: a C or Objective-C one compiled from its
//! sources and bound from its public headers (`include/`), a Swift one
//! compiled and bound from the header Swift writes, a binary one
//! (`.binaryTarget(path:)`) the `.xcframework` it is.

use std::collections::{BTreeMap, BTreeSet};
use std::process::Command;

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use serde_json::Value;

use super::{Dependencies, NativeModule, Resolution};

/// Every library target of every package the root manifest beside
/// `Package.resolved` depends on, transitively, as a module.
pub(super) fn resolve(dir: &Utf8Path, id: &str, claim: &Dependencies) -> Result<Resolution> {
    let Some(named) = &claim.lockfile else {
        bail!("`dependencies.{id}` resolves with SwiftPM and names no `lockfile`: `Package.resolved`, beside the `Package.swift` whose dependencies it pins")
    };
    let lockfile = dir.join(named.trim_start_matches("./"));
    let root = lockfile.parent().unwrap_or(dir).to_path_buf();
    let checkouts = Checkouts::read(&root, &lockfile)?;
    if !root.join("Package.swift").is_file() {
        // A lockfile that pins nothing, copied in on its own, as an empty
        // `Podfile.lock` pins nothing: there is nothing to build.
        if checkouts.by_identity.is_empty() && lockfile.is_file() {
            return Ok(Resolution::default());
        }
        bail!("{root} has no Package.swift, whose dependencies {lockfile} would pin")
    }
    let mut seen = BTreeSet::new();
    let mut pending = dependencies(&root, &checkouts)?;
    let mut resolution = Resolution::default();
    while let Some(package) = pending.pop() {
        if !seen.insert(package.clone()) {
            continue;
        }
        let manifest = dump(&package)?;
        pending.extend(dependencies_of(&manifest, &package, &checkouts)?);
        let (modules, libs) = modules_of(&manifest, &package)?;
        resolution.native.extend(modules);
        resolution.libs.extend(libs);
    }
    resolution.libs = super::dedup_link_flags(resolution.libs);
    Ok(resolution)
}

/// Where each remote package is checked out, as `SwiftPM` recorded it,
/// checked against the revision `Package.resolved` pins.
struct Checkouts {
    /// By package identity, the checkout's directory.
    by_identity: BTreeMap<String, Utf8PathBuf>,
}

impl Checkouts {
    fn read(root: &Utf8Path, lockfile: &Utf8Path) -> Result<Self> {
        let pins: BTreeMap<String, String> = match std::fs::read_to_string(lockfile) {
            Ok(text) => {
                let json: Value = serde_json::from_str(&text).with_context(|| format!("{lockfile} is not JSON"))?;
                json.get("pins")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|pin| Some((pin.get("identity")?.as_str()?.to_owned(), pin.pointer("/state/revision")?.as_str()?.to_owned())))
                    .collect()
            }
            // A manifest with only local packages pins nothing, and SwiftPM
            // writes no lockfile for it.
            Err(_) => BTreeMap::new(),
        };
        let state = root.join(".build").join("workspace-state.json");
        let recorded: Vec<Value> = std::fs::read_to_string(&state)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|json| json.pointer("/object/dependencies").and_then(Value::as_array).cloned())
            .unwrap_or_default();
        let mut by_identity = BTreeMap::new();
        for (identity, revision) in &pins {
            let checkout = recorded.iter().find(|dependency| dependency.pointer("/packageRef/identity").and_then(Value::as_str) == Some(identity));
            let checked_out = checkout.and_then(|dependency| dependency.pointer("/state/checkoutState/revision")).and_then(Value::as_str);
            let subpath = checkout.and_then(|dependency| dependency.get("subpath")).and_then(Value::as_str);
            match (checked_out, subpath) {
                (Some(checked_out), Some(subpath)) if checked_out == revision => {
                    by_identity.insert(identity.clone(), root.join(".build").join("checkouts").join(subpath));
                }
                _ => bail!(
                    "{lockfile} pins `{identity}` at {revision}, and {state} does not record that checkout: \
                     run `swift package resolve` beside it, which checks the pins out"
                ),
            }
        }
        Ok(Self { by_identity })
    }
}

/// The packages the root manifest depends on.
fn dependencies(root: &Utf8Path, checkouts: &Checkouts) -> Result<Vec<Utf8PathBuf>> {
    dependencies_of(&dump(root)?, root, checkouts)
}

/// The packages `manifest` depends on: a local one's path, a remote one's
/// checkout.
fn dependencies_of(manifest: &Value, package: &Utf8Path, checkouts: &Checkouts) -> Result<Vec<Utf8PathBuf>> {
    let mut found = Vec::new();
    for dependency in manifest.get("dependencies").and_then(Value::as_array).into_iter().flatten() {
        if let Some(local) = dependency.pointer("/fileSystem/0/path").and_then(Value::as_str) {
            found.push(Utf8PathBuf::from(local));
        } else if let Some(identity) = dependency.pointer("/sourceControl/0/identity").and_then(Value::as_str) {
            let checkout = checkouts.by_identity.get(identity).with_context(|| {
                format!("{package}'s manifest depends on `{identity}`, which Package.resolved does not pin: run `swift package resolve`")
            })?;
            found.push(checkout.clone());
        } else {
            bail!("{package}'s manifest depends on a package neither local nor from source control (a registry's), which is not read yet")
        }
    }
    Ok(found)
}

/// `swift-package dump-package`: the manifest of `package`, as `SwiftPM`
/// evaluates it.
fn dump(package: &Utf8Path) -> Result<Value> {
    let tool = crate::swift::toolchain_root()?.join("usr").join("bin").join("swift-package");
    let output = Command::new(&tool)
        .args(["dump-package", "--package-path", package.as_str()])
        .output()
        .with_context(|| format!("running {}", tool.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // The toolchain's own libraries, which a distribution it was not built
        // for may name differently: the loader's word, with what fixes it.
        if stderr.contains("error while loading shared libraries") {
            bail!(
                "{} cannot start: {}. It is swift.org's Linux build, which links its distribution's libraries \
                 (libxml2.so.2 is Arch's `libxml2-legacy`)",
                tool.display(),
                stderr.trim()
            )
        }
        bail!("{} could not read {package}/Package.swift:\n{}", tool.display(), stderr.trim())
    }
    serde_json::from_slice(&output.stdout).context("swift-package dump-package printed something that is not JSON")
}

/// The targets of `manifest`'s library products, and those they depend on in
/// the package, each as a module; and what they link, from their linker
/// settings.
fn modules_of(manifest: &Value, package: &Utf8Path) -> Result<(Vec<NativeModule>, Vec<String>)> {
    let targets: BTreeMap<&str, &Value> = manifest
        .get("targets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|target| Some((target.get("name")?.as_str()?, target)))
        .collect();
    let mut wanted: Vec<&str> = manifest
        .get("products")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|product| product.pointer("/type/library").is_some())
        .flat_map(|product| product.get("targets").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str))
        .collect();
    let mut chosen = BTreeSet::new();
    while let Some(name) = wanted.pop() {
        let Some(target) = targets.get(name) else { continue };
        if !chosen.insert(name) {
            continue;
        }
        for dependency in target.get("dependencies").and_then(Value::as_array).into_iter().flatten() {
            if let Some(named) = dependency.pointer("/byName/0").or_else(|| dependency.pointer("/target/0")).and_then(Value::as_str) {
                wanted.push(named);
            }
        }
    }
    let mut modules = Vec::new();
    let mut libs = Vec::new();
    for name in chosen {
        let target = targets[name];
        let kind = target.get("type").and_then(Value::as_str).unwrap_or_default();
        let path = target.get("path").and_then(Value::as_str);
        match kind {
            "regular" => {
                let root = package.join(path.map_or_else(|| format!("Sources/{name}"), str::to_owned));
                let excluded: Vec<Utf8PathBuf> = strings(target.get("exclude")).into_iter().map(|path| root.join(path)).collect();
                let listed = target.get("sources").and_then(Value::as_array).map(|sources| sources.iter().filter_map(Value::as_str).map(|path| root.join(path)).collect::<Vec<_>>());
                let files = files_under(&root, listed.as_deref(), &excluded);
                let public = root.join(target.get("publicHeadersPath").and_then(Value::as_str).unwrap_or("include"));
                let headers = files_under(&public, None, &[]).into_iter().filter(|path| path.extension() == Some("h")).collect();
                let include = [public, root.clone()].into_iter().filter(|dir| dir.is_dir()).collect();
                modules.push(NativeModule { name: name.to_owned(), sources: root, files: Some(files), headers, include, frameworks: Vec::new() });
            }
            "binary" => {
                let Some(path) = path else {
                    bail!("{package}'s binary target `{name}` is downloaded (`url:`), which is not read yet: a binary target by `path:` is")
                };
                modules.push(NativeModule {
                    name: name.to_owned(),
                    sources: package.join(path),
                    files: Some(Vec::new()),
                    headers: Vec::new(),
                    include: Vec::new(),
                    frameworks: vec![package.join(path)],
                });
            }
            // Tests, executables, plugins and macros are not what a program links.
            _ => continue,
        }
        libs.extend(linker_settings(target));
    }
    Ok((modules, libs))
}

/// A target's linker settings: `.linkedFramework("X")`, `.linkedLibrary("z")`.
fn linker_settings(target: &Value) -> Vec<String> {
    let mut flags = Vec::new();
    for setting in target.get("settings").and_then(Value::as_array).into_iter().flatten() {
        if setting.get("tool").and_then(Value::as_str) != Some("linker") {
            continue;
        }
        if let Some(framework) = setting.pointer("/kind/linkedFramework/0").and_then(Value::as_str) {
            flags.extend(["-framework".to_owned(), framework.to_owned()]);
        } else if let Some(library) = setting.pointer("/kind/linkedLibrary/0").and_then(Value::as_str) {
            flags.push(format!("-l{library}"));
        }
    }
    flags
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value.and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
}

/// The files under `root` -- or under each of `listed`, where the manifest
/// names its sources -- less those under an excluded path, sorted.
fn files_under(root: &Utf8Path, listed: Option<&[Utf8PathBuf]>, excluded: &[Utf8PathBuf]) -> Vec<Utf8PathBuf> {
    let mut found = Vec::new();
    let mut pending: Vec<Utf8PathBuf> = listed.map_or_else(|| vec![root.to_path_buf()], <[Utf8PathBuf]>::to_vec);
    while let Some(at) = pending.pop() {
        if excluded.iter().any(|path| at.starts_with(path)) {
            continue;
        }
        if at.is_file() {
            found.push(at);
            continue;
        }
        for entry in std::fs::read_dir(&at).into_iter().flatten().flatten() {
            if let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) {
                pending.push(path);
            }
        }
    }
    found.sort();
    found
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn claim() -> Dependencies {
        Dependencies { from: super::super::Resolver::Swiftpm, lockfile: Some("Package.resolved".to_owned()), packages: None }
    }

    fn scratch(name: &str) -> Utf8PathBuf {
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-swiftpm-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A `Package.resolved` copied in on its own that pins nothing resolves
    /// to nothing, as an empty `Podfile.lock` does.
    #[test]
    fn a_lockfile_pinning_nothing_resolves_to_nothing() {
        let dir = scratch("empty");
        std::fs::write(dir.join("Package.resolved"), r#"{ "pins": [], "version": 2 }"#).unwrap();
        assert!(resolve(&dir, "ios-17", &claim()).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A pin `SwiftPM` has not checked out -- no workspace state records it --
    /// is refused by name, before anything is read from a checkout that is
    /// not the pinned one.
    #[test]
    fn a_pin_nothing_checked_out_is_refused() {
        let dir = scratch("stale");
        std::fs::write(
            dir.join("Package.resolved"),
            r#"{ "pins": [ { "identity": "files", "kind": "remoteSourceControl", "location": "https://github.com/JohnSundell/Files", "state": { "revision": "e85f2b4a8dfa0f242889f45236f3867d16e40480", "version": "4.3.0" } } ], "version": 2 }"#,
        )
        .unwrap();
        std::fs::write(dir.join("Package.swift"), "// swift-tools-version:5.9\n").unwrap();
        let error = resolve(&dir, "macos-13", &claim()).unwrap_err().to_string();
        assert!(error.contains("run `swift package resolve`"), "{error}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
