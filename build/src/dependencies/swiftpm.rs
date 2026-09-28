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
//! compiled and bound from the header Swift writes, a binary one the
//! `.xcframework` it is -- where `path:` says, or, by `url:`, where `SwiftPM`
//! extracted the download it checked against the manifest's checksum
//! (`.build/artifacts`, recorded in `.build/workspace-state.json`).

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
    let workspace = Workspace::read(&root, &lockfile)?;
    if !root.join("Package.swift").is_file() {
        // A lockfile that pins nothing, copied in on its own, as an empty
        // `Podfile.lock` pins nothing: there is nothing to build.
        if workspace.by_identity.is_empty() && lockfile.is_file() {
            return Ok(Resolution::default());
        }
        bail!("{root} has no Package.swift, whose dependencies {lockfile} would pin")
    }
    let mut seen = BTreeSet::new();
    let mut pending = dependencies(&root, &workspace)?;
    let mut resolution = Resolution::default();
    while let Some(package) = pending.pop() {
        if !seen.insert(package.clone()) {
            continue;
        }
        let manifest = dump(&package)?;
        pending.extend(dependencies_of(&manifest, &package, &workspace)?);
        let (modules, libs) = modules_of(&manifest, &package, &workspace)?;
        resolution.native.extend(modules);
        resolution.libs.extend(libs);
    }
    resolution.libs = super::dedup_link_flags(resolution.libs);
    Ok(resolution)
}

/// What `swift package resolve` left, as `SwiftPM` recorded it in
/// `.build/workspace-state.json`: where each remote package is checked out,
/// checked against the revision `Package.resolved` pins, and each binary
/// target it downloaded.
struct Workspace {
    /// By package identity, the checkout's directory.
    by_identity: BTreeMap<String, Utf8PathBuf>,
    /// Each downloaded binary target, by the URL it came from.
    artifacts: BTreeMap<String, Artifact>,
    /// The state file, which a message names.
    state: Utf8PathBuf,
}

/// A binary target `SwiftPM` downloaded and extracted.
struct Artifact {
    /// What it checked the download against: the manifest's, when it did.
    checksum: String,
    /// The extracted `.xcframework`, under this root's `.build/artifacts`
    /// wherever the record says the root was.
    path: Utf8PathBuf,
}

impl Workspace {
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
        let json: Value = std::fs::read_to_string(&state).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        let recorded: Vec<Value> = json.pointer("/object/dependencies").and_then(Value::as_array).cloned().unwrap_or_default();
        // A record's path is absolute, where the root was when it resolved;
        // what is under `.build/artifacts` is where it is now.
        let artifacts = json
            .pointer("/object/artifacts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|artifact| {
                let url = artifact.pointer("/source/url")?.as_str()?.to_owned();
                let checksum = artifact.pointer("/source/checksum")?.as_str()?.to_owned();
                let recorded = artifact.get("path")?.as_str()?;
                let (_, under) = recorded.split_once("/.build/artifacts/")?;
                Some((url, Artifact { checksum, path: root.join(".build").join("artifacts").join(under) }))
            })
            .collect();
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
        Ok(Self { by_identity, artifacts, state })
    }
}

impl Workspace {
    /// The `.xcframework` `SwiftPM` extracted for the binary target `name`
    /// from `url` -- refused, naming `swift package resolve`, where it has
    /// not downloaded it, or downloaded it against another checksum than the
    /// manifest's now, which is a download the manifest no longer describes.
    fn artifact(&self, package: &Utf8Path, name: &str, url: &str, checksum: Option<&str>) -> Result<Utf8PathBuf> {
        let state = &self.state;
        let Some(artifact) = self.artifacts.get(url) else {
            bail!("{package}'s binary target `{name}` is downloaded from {url}, and {state} records no such download: run `swift package resolve`")
        };
        if checksum.is_some_and(|checksum| checksum != artifact.checksum) {
            bail!(
                "{package}'s binary target `{name}` wants {url} at checksum {}, and {state} records one downloaded at {}: \
                 run `swift package resolve`",
                checksum.unwrap_or_default(),
                artifact.checksum
            )
        }
        if !artifact.path.is_dir() {
            bail!("{state} records `{name}` extracted to {}, which is not there: run `swift package resolve`", artifact.path)
        }
        Ok(artifact.path.clone())
    }
}

/// The packages the root manifest depends on.
fn dependencies(root: &Utf8Path, workspace: &Workspace) -> Result<Vec<Utf8PathBuf>> {
    dependencies_of(&dump(root)?, root, workspace)
}

/// The packages `manifest` depends on: a local one's path, a remote one's
/// checkout.
fn dependencies_of(manifest: &Value, package: &Utf8Path, workspace: &Workspace) -> Result<Vec<Utf8PathBuf>> {
    let mut found = Vec::new();
    for dependency in manifest.get("dependencies").and_then(Value::as_array).into_iter().flatten() {
        if let Some(local) = dependency.pointer("/fileSystem/0/path").and_then(Value::as_str) {
            found.push(Utf8PathBuf::from(local));
        } else if let Some(identity) = dependency.pointer("/sourceControl/0/identity").and_then(Value::as_str) {
            let checkout = workspace.by_identity.get(identity).with_context(|| {
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
/// evaluates it -- once for each manifest, toolchain and place, as `SwiftPM`
/// caches a manifest itself. Evaluating one runs the Swift compiler, 0.2 s,
/// and a build resolved each package's once per product, target and binding:
/// 36 times for macos-spm's four, most of a rebuild's 16 s. Kept in the
/// process, and on disk (`~/.cache/nts/swiftpm-manifests`), keyed by what the
/// answer depends on: the manifest's text, where it is (a local dependency's
/// path comes back absolute), and the toolchain.
fn dump(package: &Utf8Path) -> Result<Value> {
    let tool = crate::swift::toolchain_root()?.join("usr").join("bin").join("swift-package");
    let cache = std::env::var_os("HOME").map(|home| std::path::Path::new(&home).join(".cache/nts/swiftpm-manifests"));
    dump_with(&tool, cache.as_deref(), package)
}

/// [`dump`], with `tool` for `swift-package` and `cache` for where the
/// answers are kept.
fn dump_with(tool: &std::path::Path, cache: Option<&std::path::Path>, package: &Utf8Path) -> Result<Value> {
    static KEPT: std::sync::OnceLock<std::sync::Mutex<BTreeMap<u64, Value>>> = std::sync::OnceLock::new();
    // One package reached by two spellings -- the root as the config names it,
    // and as a dependency's absolute path -- is one manifest.
    let canonical = std::fs::canonicalize(package).ok().and_then(|path| Utf8PathBuf::from_path_buf(path).ok());
    let package = canonical.as_deref().unwrap_or(package);
    let manifest = std::fs::read(package.join("Package.swift")).with_context(|| format!("reading {package}/Package.swift"))?;
    let stamp = std::fs::metadata(tool).map(|meta| format!("{}{:?}", meta.len(), meta.modified().ok())).unwrap_or_default();
    let key = fnv(&[package.as_str().as_bytes(), &manifest, tool.to_string_lossy().as_bytes(), stamp.as_bytes()]);
    let kept = KEPT.get_or_init(Default::default);
    if let Some(value) = kept.lock().ok().and_then(|kept| kept.get(&key).cloned()) {
        return Ok(value);
    }
    let file = cache.map(|cache| cache.join(format!("{key:016x}.json")));
    let stored: Option<Value> = file.as_ref().and_then(|file| std::fs::read(file).ok()).and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let value = if let Some(value) = stored {
        value
    } else {
        let value = evaluate(tool, package)?;
        // Written whole, then renamed into place: a reader never sees half.
        if let Some(file) = &file {
            let partial = file.with_extension(format!("{}.partial", std::process::id()));
            if file.parent().is_some_and(|dir| std::fs::create_dir_all(dir).is_ok())
                && std::fs::write(&partial, serde_json::to_vec(&value).unwrap_or_default()).is_ok()
            {
                let _ = std::fs::rename(&partial, file);
            }
        }
        value
    };
    if let Ok(mut kept) = kept.lock() {
        kept.insert(key, value.clone());
    }
    Ok(value)
}

/// FNV-1a over `parts`, each followed by a separator so two splits of one
/// text differ.
fn fnv(parts: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in parts.iter().flat_map(|part| part.iter().chain(&[0xff])) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// Runs `swift-package dump-package` for `package`.
fn evaluate(tool: &std::path::Path, package: &Utf8Path) -> Result<Value> {
    let output = Command::new(tool)
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
fn modules_of(manifest: &Value, package: &Utf8Path, workspace: &Workspace) -> Result<(Vec<NativeModule>, Vec<String>)> {
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
        wanted.extend(target_dependencies(target, &targets).iter().filter_map(|named| targets.get_key_value(named.as_str()).map(|(name, _)| *name)));
    }
    let mut modules = Vec::new();
    let mut libs = Vec::new();
    // Each target's public headers, which `SwiftPM` puts on the search path
    // of every target depending on it, directly or through another.
    let mut public: BTreeMap<&str, Utf8PathBuf> = BTreeMap::new();
    for name in &chosen {
        let target = targets[name];
        if target.get("type").and_then(Value::as_str) == Some("regular") {
            let root = package.join(target.get("path").and_then(Value::as_str).map_or_else(|| format!("Sources/{name}"), str::to_owned));
            let directory = root.join(target.get("publicHeadersPath").and_then(Value::as_str).unwrap_or("include"));
            if directory.is_dir() {
                public.insert(name, directory);
            }
        }
    }
    for name in chosen.iter().copied() {
        let target = targets[name];
        let kind = target.get("type").and_then(Value::as_str).unwrap_or_default();
        let path = target.get("path").and_then(Value::as_str);
        match kind {
            "regular" => {
                let root = package.join(path.map_or_else(|| format!("Sources/{name}"), str::to_owned));
                let excluded: Vec<Utf8PathBuf> = strings(target.get("exclude")).into_iter().map(|path| root.join(path)).collect();
                let listed = target.get("sources").and_then(Value::as_array).map(|sources| sources.iter().filter_map(Value::as_str).map(|path| root.join(path)).collect::<Vec<_>>());
                let files = files_under(&root, listed.as_deref(), &excluded);
                let own = root.join(target.get("publicHeadersPath").and_then(Value::as_str).unwrap_or("include"));
                let headers = files_under(&own, None, &[]).into_iter().filter(|path| path.extension() == Some("h")).collect();
                let depends = target_dependencies(target, &targets);
                let mut include: Vec<Utf8PathBuf> = [own, root.clone()].into_iter().filter(|dir| dir.is_dir()).collect();
                include.extend(reached(&depends, &targets).iter().filter_map(|dependency| public.get(dependency.as_str()).cloned()));
                modules.push(NativeModule { name: name.to_owned(), sources: root, files: Some(files), headers, include, frameworks: Vec::new(), depends });
            }
            "binary" => {
                let framework = match (path, target.get("url").and_then(Value::as_str)) {
                    (Some(path), _) => package.join(path),
                    (None, Some(url)) => workspace.artifact(package, name, url, target.get("checksum").and_then(Value::as_str))?,
                    (None, None) => bail!("{package}'s binary target `{name}` names neither a `path:` nor a `url:`"),
                };
                modules.push(NativeModule {
                    name: name.to_owned(),
                    sources: framework.clone(),
                    files: Some(Vec::new()),
                    headers: Vec::new(),
                    include: Vec::new(),
                    frameworks: vec![framework],
                    depends: Vec::new(),
                });
            }
            // Tests, executables, plugins and macros are not what a program links.
            _ => continue,
        }
        libs.extend(linker_settings(target));
    }
    Ok((modules, libs))
}

/// The targets of the same package `target` depends on: `"CShim"` and
/// `.target(name: "CShim")` both. A `.product` is another package's, which
/// that package's own resolution builds.
fn target_dependencies(target: &Value, targets: &BTreeMap<&str, &Value>) -> Vec<String> {
    target
        .get("dependencies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|dependency| dependency.pointer("/byName/0").or_else(|| dependency.pointer("/target/0")).and_then(Value::as_str))
        .filter(|named| targets.contains_key(named))
        .map(str::to_owned)
        .collect()
}

/// `depends` and what each of them depends on in turn, each once.
fn reached(depends: &[String], targets: &BTreeMap<&str, &Value>) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut pending: Vec<String> = depends.to_vec();
    while let Some(name) = pending.pop() {
        if found.contains(&name) {
            continue;
        }
        if let Some(target) = targets.get(name.as_str()) {
            pending.extend(target_dependencies(target, targets));
        }
        found.push(name);
    }
    found
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

    /// A manifest is evaluated once for its text, place and toolchain, its
    /// answer kept on disk, and evaluated again when its text changes. A cache
    /// that never hits passes every other test, so this counts evaluations.
    #[test]
    fn a_manifest_is_evaluated_once_for_its_text() {
        let dir = scratch("manifest-cache");
        let tool = dir.join("swift-package");
        let count = dir.join("count");
        std::fs::write(&tool, format!("#!/bin/sh\necho x >> {count}\necho '{{\"name\": \"Probe\"}}'\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let package = dir.join("Probe");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("Package.swift"), "// swift-tools-version:5.9\n").unwrap();
        let cache = dir.join("cache");
        let evaluations = || std::fs::read_to_string(&count).map_or(0, |text| text.lines().count());
        let first = dump_with(tool.as_std_path(), Some(cache.as_std_path()), &package).unwrap();
        assert_eq!(first.get("name").and_then(Value::as_str), Some("Probe"));
        dump_with(tool.as_std_path(), Some(cache.as_std_path()), &package).unwrap();
        assert_eq!(evaluations(), 1, "the process evaluated one manifest twice");
        // Kept on disk for the next process, which this one cannot be: its
        // own memory answers first. The next build's 0 evaluations are the
        // measurement's (macos-spm's rebuild), not this test's.
        let kept = std::fs::read_dir(&cache).unwrap().count();
        assert_eq!(kept, 1, "nothing, or more than one answer, was kept on disk");
        std::fs::write(package.join("Package.swift"), "// swift-tools-version:5.9\n// changed\n").unwrap();
        dump_with(tool.as_std_path(), Some(cache.as_std_path()), &package).unwrap();
        assert_eq!(evaluations(), 2, "a changed manifest was answered from the old one");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A binary target by `url:` is the `.xcframework` `SwiftPM` extracted,
    /// found under this root wherever the record says the root was -- a tree
    /// moved or committed after resolving -- and refused, naming `swift
    /// package resolve`, where the download is not recorded, is not there, or
    /// was checked against another checksum than the manifest's now. The
    /// state is the shape `swift package resolve` wrote for
    /// `GoogleAppMeasurement`'s binary target.
    #[test]
    fn a_downloaded_binary_target_is_where_swiftpm_extracted_it() {
        let dir = scratch("artifact");
        let url = "https://dl.google.com/firebase/ios/swiftpm/13.0.0/GoogleAppMeasurement.zip";
        std::fs::create_dir_all(dir.join(".build")).unwrap();
        std::fs::write(
            dir.join(".build/workspace-state.json"),
            format!(
                r#"{{ "object": {{ "artifacts": [ {{ "kind": {{ "xcframework": {{}} }},
                    "packageRef": {{ "identity": "probe", "kind": "root", "location": "/elsewhere/probe", "name": "probe" }},
                    "path": "/elsewhere/probe/.build/artifacts/probe/GoogleAppMeasurement/GoogleAppMeasurement.xcframework",
                    "source": {{ "checksum": "be3f", "type": "remote", "url": "{url}" }},
                    "targetName": "GoogleAppMeasurement" }} ], "dependencies": [], "prebuilts": [] }}, "version": 7 }}"#
            ),
        )
        .unwrap();
        let workspace = Workspace::read(&dir, &dir.join("Package.resolved")).unwrap();
        let package = Utf8Path::new("/elsewhere/probe");
        let missing = workspace.artifact(package, "GoogleAppMeasurement", url, Some("be3f")).unwrap_err().to_string();
        assert!(missing.contains("which is not there") && missing.contains("run `swift package resolve`"), "{missing}");
        let extracted = dir.join(".build/artifacts/probe/GoogleAppMeasurement/GoogleAppMeasurement.xcframework");
        std::fs::create_dir_all(&extracted).unwrap();
        assert_eq!(workspace.artifact(package, "GoogleAppMeasurement", url, Some("be3f")).unwrap(), extracted);
        let changed = workspace.artifact(package, "GoogleAppMeasurement", url, Some("0000")).unwrap_err().to_string();
        assert!(changed.contains("at checksum 0000") && changed.contains("downloaded at be3f"), "{changed}");
        let unknown = workspace.artifact(package, "Other", "https://example.invalid/Other.zip", None).unwrap_err().to_string();
        assert!(unknown.contains("records no such download"), "{unknown}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
