//! `CocoaPods`, read from what `pod install` left: `Podfile.lock` for which pods,
//! and `Pods/` beside it for their sources and headers.
//!
//! Nothing here runs `pod`. A podspec is Ruby, and `CocoaPods` has already
//! applied it: it copies each pod's files into `Pods/<Pod>`, removing what the
//! podspec does not name, and links its public headers under
//! `Pods/Headers/Public/<Pod>` and every header under
//! `Pods/Headers/Private/<Pod>`, which is the header map Xcode compiles the
//! pod's own sources against. A development pod (`:path`) stays where it is,
//! and the lockfile says where -- and is not cleaned, so its directory may
//! hold more than the pod; which files are the pod is its podspec's, which
//! `CocoaPods` keeps as JSON in `Pods/Local Podspecs`.
//!
//! What the pods link against -- the frameworks and libraries their podspecs
//! name -- `CocoaPods` writes into each Podfile target's xcconfig as
//! `OTHER_LDFLAGS`, which is read too.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};

use super::{Dependencies, NativeModule, Resolution};

/// Each pod `lockfile` pins, as a module compiled from `Pods/`.
pub(super) fn resolve(dir: &Utf8Path, id: &str, claim: &Dependencies) -> Result<Resolution> {
    // Absolute, so every path this hands on is: a header an umbrella under
    // `.nts/` imports, or a module map names, is read from another directory
    // than the one `nts build examples/app` was run in.
    let dir = &super::absolute(dir)?;
    let Some(named) = &claim.lockfile else {
        bail!(
            "`dependencies.{id}` resolves with CocoaPods and names no `lockfile`. `Podfile.lock` is CocoaPods' resolved output and is the claim"
        )
    };
    let lockfile = dir.join(named.trim_start_matches("./"));
    let text = std::fs::read_to_string(&lockfile)
        .with_context(|| format!("reading the Podfile.lock `dependencies.{id}` names"))?;
    let lock = parse(&text, &lockfile)?;
    let root = lockfile.parent().unwrap_or(dir);
    let pods = root.join("Pods");
    // CocoaPods' own check, which an Xcode build runs first: `pod install`
    // copies the lockfile into `Pods/` as it finishes, so a `Pods/` that
    // does not hold the same one is from another install, or none.
    let manifest = pods.join("Manifest.lock");
    if lock.pods.is_empty() {
        return Ok(Resolution::default());
    }
    if std::fs::read_to_string(&manifest).ok().as_deref() != Some(text.as_str()) {
        bail!(
            "{manifest} is not the {lockfile} beside it, so {pods} is not what the lockfile pins: \
             run `pod install` there, which checks out the pods and writes it"
        )
    }
    let mut native = Vec::new();
    for pod in &lock.pods {
        let sources = lock
            .paths
            .get(pod)
            .map_or_else(|| pods.join(pod), |path| root.join(path));
        if !sources.is_dir() {
            bail!(
                "{lockfile} pins the pod `{pod}`, and {sources} does not exist: run `pod install` beside it, \
                 which checks the pod out there"
            )
        }
        let public = pods.join("Headers").join("Public");
        let include = [
            pods.join("Headers").join("Private").join(pod),
            public.join(pod),
            public.clone(),
        ]
        .into_iter()
        .filter(|directory| directory.is_dir())
        .collect();
        // The pod's own: a header CocoaPods writes for it -- the umbrella and
        // module map of a Swift pod, linked from `Target Support Files` --
        // is not its API.
        let own = std::fs::canonicalize(&sources).ok();
        let headers = headers_under(&public.join(pod))
            .into_iter()
            .filter(|header| {
                std::fs::canonicalize(header)
                    .ok()
                    .zip(own.as_ref())
                    .is_some_and(|(header, own)| header.starts_with(own))
            })
            .collect();
        let (files, frameworks) = if lock.paths.contains_key(pod) {
            let spec = local_podspec(&pods, pod, platform_of(id))?;
            let files = spec
                .source_files
                .iter()
                .flat_map(|pattern| glob(&sources, pattern, false))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let frameworks = spec
                .vendored_frameworks
                .iter()
                .flat_map(|pattern| glob(&sources, pattern, true))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            (Some(files), frameworks)
        } else {
            (None, frameworks_under(&sources))
        };
        let depends = lock.depends.get(pod).cloned().unwrap_or_default();
        native.push(NativeModule {
            name: pod.clone(),
            headers,
            sources,
            files,
            include,
            frameworks,
            depends,
        });
    }
    Ok(Resolution {
        libs: link_flags(&pods, &lock.pods)?,
        native,
        ..Resolution::default()
    })
}

/// What `CocoaPods` links each Podfile target with, `OTHER_LDFLAGS` in
/// `Pods/Target Support Files/Pods-<Target>/Pods-<Target>.release.xcconfig`:
/// the frameworks and libraries the pods' podspecs name. Not the pods
/// themselves (`-l"Chirp"`), whose sources are compiled here rather than
/// archived, and not `-ObjC`, which is for loading an archive's categories.
fn link_flags(pods: &Utf8Path, pinned: &[String]) -> Result<Vec<String>> {
    let support = pods.join("Target Support Files");
    let mut configs: Vec<Utf8PathBuf> = std::fs::read_dir(&support)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
        .filter(|dir| {
            dir.file_name()
                .is_some_and(|name| name.starts_with("Pods-"))
        })
        .map(|dir| {
            let name = dir.file_name().unwrap_or_default().to_owned();
            dir.join(format!("{name}.release.xcconfig"))
        })
        .collect();
    configs.sort();
    if configs.is_empty() {
        bail!(
            "{support} holds no Podfile target's xcconfig, which says what the pods link against: run `pod install` there"
        )
    }
    let mut flags: Vec<String> = Vec::new();
    for config in &configs {
        let text = std::fs::read_to_string(config).with_context(|| format!("reading {config}"))?;
        flags.extend(ldflags(&text, pinned));
    }
    Ok(super::dedup_link_flags(flags))
}

/// The link flags of one xcconfig's `OTHER_LDFLAGS`, less what does not apply.
fn ldflags(xcconfig: &str, pinned: &[String]) -> Vec<String> {
    let Some(line) = xcconfig
        .lines()
        .find_map(|line| line.trim().strip_prefix("OTHER_LDFLAGS"))
    else {
        return Vec::new();
    };
    let words: Vec<String> = line
        .trim_start()
        .trim_start_matches('=')
        .split_whitespace()
        .map(|word| word.trim_matches('"').to_owned())
        .collect();
    let mut flags = Vec::new();
    let mut at = 0;
    while at < words.len() {
        let word = &words[at];
        match word.as_str() {
            "-framework" | "-weak_framework" if at + 1 < words.len() => {
                flags.push(word.clone());
                flags.push(words[at + 1].clone());
                at += 2;
                continue;
            }
            "$(inherited)" | "-ObjC" => {}
            _ => {
                if let Some(library) = word.strip_prefix("-l") {
                    let library = library.trim_matches('"');
                    if !pinned.iter().any(|pod| pod == library) {
                        flags.push(format!("-l{library}"));
                    }
                } else {
                    flags.push(word.clone());
                }
            }
        }
        at += 1;
    }
    flags
}

/// The podspec key of the platform a claim's target id is for: `osx` for
/// `macos-13`, `ios` for `ios-17`.
fn platform_of(id: &str) -> &'static str {
    if id.starts_with("ios") { "ios" } else { "osx" }
}

/// What a development pod's podspec says its files are.
#[derive(Debug, Default, PartialEq, Eq)]
struct Podspec {
    source_files: Vec<String>,
    vendored_frameworks: Vec<String>,
}

/// `Pods/Local Podspecs/<pod>.podspec.json`, the podspec `pod install`
/// evaluated for a development pod: its patterns, and the platform's own
/// added to them (`"osx": { "source_files": ... }`).
fn local_podspec(pods: &Utf8Path, pod: &str, platform: &str) -> Result<Podspec> {
    let path = pods
        .join("Local Podspecs")
        .join(format!("{pod}.podspec.json"));
    let text = std::fs::read_to_string(&path).with_context(|| {
        format!("reading {path}, which `pod install` writes for a development pod: run it")
    })?;
    let json: serde_json::Value =
        serde_json::from_str(&text).with_context(|| format!("{path} is not JSON"))?;
    let strings = |value: Option<&serde_json::Value>| -> Vec<String> {
        match value {
            Some(serde_json::Value::String(one)) => vec![one.clone()],
            Some(serde_json::Value::Array(many)) => many
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect(),
            _ => Vec::new(),
        }
    };
    let mut spec = Podspec {
        source_files: strings(json.get("source_files")),
        vendored_frameworks: strings(json.get("vendored_frameworks")),
    };
    if let Some(own) = json.get(platform) {
        spec.source_files.extend(strings(own.get("source_files")));
        spec.vendored_frameworks
            .extend(strings(own.get("vendored_frameworks")));
    }
    Ok(spec)
}

/// The paths under `root` a podspec pattern names, as `CocoaPods` reads one:
/// `{a,b}` alternatives, `**` any number of directories, `*` and `?` within a
/// name. Files, or with `directories` the directories -- a framework bundle
/// is one -- without looking inside what matched.
fn glob(root: &Utf8Path, pattern: &str, directories: bool) -> Vec<Utf8PathBuf> {
    let mut found = Vec::new();
    for alternative in braces(pattern) {
        let parts: Vec<&str> = alternative
            .split('/')
            .filter(|part| !part.is_empty() && *part != ".")
            .collect();
        walk(root, &parts, directories, &mut found);
    }
    found.sort();
    found.dedup();
    found
}

fn walk(at: &Utf8Path, parts: &[&str], directories: bool, found: &mut Vec<Utf8PathBuf>) {
    let Some((first, rest)) = parts.split_first() else {
        return;
    };
    let entries: Vec<Utf8PathBuf> = std::fs::read_dir(at)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
        .collect();
    if *first == "**" {
        // Zero directories, then one more and still `**`.
        walk(at, rest, directories, found);
        for entry in entries.iter().filter(|entry| entry.is_dir()) {
            walk(entry, parts, directories, found);
        }
        return;
    }
    for entry in entries {
        if !entry.file_name().is_some_and(|name| wildcard(first, name)) {
            continue;
        }
        if rest.is_empty() {
            if entry.is_dir() == directories {
                found.push(entry);
            }
        } else if entry.is_dir() {
            walk(&entry, rest, directories, found);
        }
    }
}

/// `*` any run of characters and `?` one, within a name.
fn wildcard(pattern: &str, name: &str) -> bool {
    let (pattern, name): (Vec<char>, Vec<char>) =
        (pattern.chars().collect(), name.chars().collect());
    let (mut p, mut n, mut star, mut mark) = (0, 0, None, 0);
    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            mark = n;
            p += 1;
        } else if let Some(at) = star {
            p = at + 1;
            mark += 1;
            n = mark;
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

/// Each alternative a pattern's `{a,b}` groups spell, the first group
/// expanded first.
fn braces(pattern: &str) -> Vec<String> {
    let Some(open) = pattern.find('{') else {
        return vec![pattern.to_owned()];
    };
    let Some(close) = pattern[open..].find('}').map(|at| open + at) else {
        return vec![pattern.to_owned()];
    };
    let (head, tail) = (&pattern[..open], &pattern[close + 1..]);
    pattern[open + 1..close]
        .split(',')
        .flat_map(|choice| braces(&format!("{head}{choice}{tail}")))
        .collect()
}

/// What a `Podfile.lock` pins.
#[derive(Debug, Default, PartialEq, Eq)]
struct Lock {
    /// The pods, by name: a subspec's (`Firebase/Core`) is its pod's.
    pods: Vec<String>,
    /// Where a development pod is, relative to the lockfile (`:path`).
    paths: BTreeMap<String, String>,
    /// The pods each pod depends on, from its entries at the second indent:
    /// what a Swift pod imports (`import Chirp`) and an Objective-C one
    /// searches. A subspec's is its pod's, and a pod's own subspecs are not
    /// a dependency of it.
    depends: BTreeMap<String, Vec<String>>,
}

/// The two sections of the lockfile that say what to build: `PODS`, whose
/// entries at the first indent are the pods and the rest their dependencies,
/// and `EXTERNAL SOURCES`, whose `:path` places a development pod. `CocoaPods`
/// writes this YAML in one shape; a line in either section that is not that
/// shape is refused rather than skipped, since a pod read as absent is one
/// the program would link without.
fn parse(text: &str, path: &Utf8Path) -> Result<Lock> {
    let mut lock = Lock::default();
    let mut seen = BTreeSet::new();
    let mut section = "";
    let mut external: Option<String> = None;
    let mut current: Option<String> = None;
    for (index, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') {
            section = line.trim_end_matches(':').trim();
            continue;
        }
        let malformed = || {
            anyhow::anyhow!(
                "{path}:{}: `{}` is not an entry CocoaPods writes under `{section}`",
                index + 1,
                line.trim()
            )
        };
        match section {
            "PODS" if line.starts_with("  - ") => {
                let entry = unquote(line.trim_start_matches("  - ").trim_end_matches(':'));
                let name = entry
                    .split(" (")
                    .next()
                    .filter(|name| !name.is_empty())
                    .ok_or_else(malformed)?;
                let pod = name.split('/').next().unwrap_or(name).to_owned();
                if seen.insert(pod.clone()) {
                    lock.pods.push(pod.clone());
                }
                current = Some(pod);
            }
            "PODS" if line.starts_with("    - ") => {
                let pod = current.clone().ok_or_else(malformed)?;
                let entry = unquote(line.trim_start_matches("    - "));
                let name = entry
                    .split(" (")
                    .next()
                    .filter(|name| !name.is_empty())
                    .ok_or_else(malformed)?;
                let dependency = name.split('/').next().unwrap_or(name).to_owned();
                let depends = lock.depends.entry(pod.clone()).or_default();
                if dependency != pod && !depends.contains(&dependency) {
                    depends.push(dependency);
                }
            }
            "PODS" => return Err(malformed()),
            "EXTERNAL SOURCES" if line.starts_with("    ") => {
                let pod = external.clone().ok_or_else(malformed)?;
                if let Some(value) = line.trim().strip_prefix(":path:") {
                    lock.paths.insert(pod, unquote(value.trim()).to_owned());
                }
            }
            "EXTERNAL SOURCES" => {
                external = Some(unquote(line.trim().trim_end_matches(':')).to_owned());
            }
            _ => {}
        }
    }
    Ok(lock)
}

/// A YAML scalar `CocoaPods` quotes where it must: `"Firebase/Core (10.0)"`.
fn unquote(value: &str) -> &str {
    value.trim().trim_matches('"').trim_matches('\'')
}

/// The binary frameworks under `dir`, sorted, and not what is inside them:
/// `pod install` keeps only the files a podspec names, so a bundle here is
/// one of its `vendored_frameworks`.
pub(super) fn frameworks_under(dir: &Utf8Path) -> Vec<Utf8PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(at) = pending.pop() {
        for entry in std::fs::read_dir(&at).into_iter().flatten().flatten() {
            let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) else {
                continue;
            };
            if !path.is_dir() {
                continue;
            }
            if matches!(path.extension(), Some("framework" | "xcframework")) {
                found.push(path);
            } else {
                pending.push(path);
            }
        }
    }
    found.sort();
    found
}

/// Every header under `dir`, sorted: the files of `Pods/Headers/Public/<Pod>`,
/// which `CocoaPods` links there in the layout the pod's `#import`s use.
fn headers_under(dir: &Utf8Path) -> Vec<Utf8PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(at) = pending.pop() {
        for entry in std::fs::read_dir(&at).into_iter().flatten().flatten() {
            let Ok(path) = Utf8PathBuf::from_path_buf(entry.path()) else {
                continue;
            };
            if path.is_dir() {
                pending.push(path);
            } else if path.extension() == Some("h") {
                found.push(path);
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

    /// The shape `pod install` writes: a pod with subspecs and dependencies,
    /// a quoted name, and a development pod placed by `:path`.
    #[test]
    fn a_lockfile_names_its_pods_and_where_a_development_pod_is() {
        let text = "PODS:\n  - AFNetworking (4.0.1):\n    - AFNetworking/NSURLSession (= 4.0.1)\n  - AFNetworking/NSURLSession (4.0.1)\n  - \"Greeter (0.1.0)\":\n    - AFNetworking/NSURLSession\n    - Reachability\n  - Reachability (3.2)\n\n\
                    DEPENDENCIES:\n  - AFNetworking\n  - Greeter (from `../Greeter`)\n\n\
                    EXTERNAL SOURCES:\n  Greeter:\n    :path: \"../Greeter\"\n\n\
                    SPEC CHECKSUMS:\n  Reachability: 33e18b67625424e47b6cde6d202dce689ad9c8a9\n\n\
                    PODFILE CHECKSUM: 0f5d3d5c\n\nCOCOAPODS: 1.15.2\n";
        let lock = parse(text, Utf8Path::new("Podfile.lock")).unwrap();
        assert_eq!(lock.pods, ["AFNetworking", "Greeter", "Reachability"]);
        assert_eq!(
            lock.paths.get("Greeter").map(String::as_str),
            Some("../Greeter")
        );
        // A pod's dependencies are pods: another's subspec is that pod, and
        // a pod's own subspec is not a dependency of it.
        assert_eq!(
            lock.depends.get("Greeter").map(Vec::as_slice),
            Some(&["AFNetworking".to_owned(), "Reachability".to_owned()][..])
        );
        assert_eq!(
            lock.depends.get("AFNetworking").map(Vec::as_slice),
            Some(&[][..])
        );
    }

    /// A line in `PODS` of no shape `CocoaPods` writes is an error: read as
    /// nothing, the pod would be missing from the link.
    #[test]
    fn a_malformed_entry_is_refused() {
        let error = parse(
            "PODS:\n Reachability (3.2)\n",
            Utf8Path::new("Podfile.lock"),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("Podfile.lock:2"), "{error}");
    }

    /// A `Pods/` from another install than the lockfile is refused by name,
    /// as `CocoaPods`' own check refuses it; the same one resolves each pod.
    #[test]
    fn pods_must_be_the_lockfiles() {
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-cocoapods-{}", std::process::id()));
        let lock = "PODS:\n  - Chirp (0.1.0)\n\nEXTERNAL SOURCES:\n  Chirp:\n    :path: Chirp\n\nCOCOAPODS: 1.11.3\n";
        std::fs::create_dir_all(dir.join("Chirp/Classes")).unwrap();
        std::fs::create_dir_all(dir.join("Pods/Headers/Public/Chirp")).unwrap();
        std::fs::write(dir.join("Podfile.lock"), lock).unwrap();
        // As `pod install` links them: into the pod's own sources.
        std::fs::write(dir.join("Chirp/Classes/Chirp.h"), "").unwrap();
        std::os::unix::fs::symlink(
            "../../../../Chirp/Classes/Chirp.h",
            dir.join("Pods/Headers/Public/Chirp/Chirp.h"),
        )
        .unwrap();
        std::fs::write(dir.join("Pods/Headers/Public/Chirp/Chirp-umbrella.h"), "").unwrap();
        std::fs::create_dir_all(dir.join("Pods/Local Podspecs")).unwrap();
        std::fs::write(
            dir.join("Pods/Local Podspecs/Chirp.podspec.json"),
            r#"{ "name": "Chirp", "source_files": "Classes/**/*.{h,m}" }"#,
        )
        .unwrap();
        std::fs::write(dir.join("Chirp/README.md"), "").unwrap();
        std::fs::create_dir_all(dir.join("Pods/Target Support Files/Pods-Host")).unwrap();
        std::fs::write(
            dir.join("Pods/Target Support Files/Pods-Host/Pods-Host.release.xcconfig"),
            "OTHER_LDFLAGS = $(inherited) -ObjC -l\"Chirp\" -framework \"Foundation\"\n",
        )
        .unwrap();
        let claim = Dependencies {
            from: super::super::Resolver::Cocoapods,
            lockfile: Some("Podfile.lock".to_owned()),
            packages: None,
        };
        let error = resolve(&dir, "macos-13", &claim).unwrap_err().to_string();
        assert!(error.contains("run `pod install`"), "{error}");
        std::fs::write(dir.join("Pods/Manifest.lock"), lock).unwrap();
        let resolved = resolve(&dir, "macos-13", &claim).unwrap();
        assert_eq!(resolved.native.len(), 1);
        assert_eq!(resolved.native[0].sources, dir.join("Chirp"));
        // The pod's header, and not one CocoaPods wrote for it elsewhere.
        assert_eq!(
            resolved.native[0].headers,
            [dir.join("Pods/Headers/Public/Chirp/Chirp.h")]
        );
        assert_eq!(resolved.libs, ["-framework", "Foundation"]);
        // A development pod's files are its podspec's, not its directory's.
        assert_eq!(
            resolved.native[0].files,
            Some(vec![dir.join("Chirp/Classes/Chirp.h")])
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A Podfile target's link line, as `CocoaPods` writes it: the frameworks
    /// and system libraries, not the pods, and not `-ObjC`.
    #[test]
    fn the_link_line_is_the_frameworks_and_libraries_not_the_pods() {
        let config = "OTHER_LDFLAGS = $(inherited) -ObjC -l\"Reachability\" -l\"sqlite3\" -framework \"SystemConfiguration\" -weak_framework \"UserNotifications\"\n";
        assert_eq!(
            ldflags(config, &["Reachability".to_owned()]),
            [
                "-lsqlite3",
                "-framework",
                "SystemConfiguration",
                "-weak_framework",
                "UserNotifications"
            ]
        );
    }

    /// A podspec's patterns, as `CocoaPods` reads them: alternatives, `**`
    /// through any depth, and a framework bundle matched whole.
    #[test]
    fn a_podspec_pattern_names_its_files() {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-podspec-glob-{}", std::process::id()));
        for file in [
            "Classes/Chirp.h",
            "Classes/Chirp.m",
            "Classes/Internal/Tweeter.m",
            "Classes/notes.txt",
            "Tests/ChirpTests.m",
            "Beep.xcframework/Info.plist",
        ] {
            std::fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            std::fs::write(root.join(file), "").unwrap();
        }
        let relative = |paths: Vec<Utf8PathBuf>| {
            paths
                .iter()
                .map(|path| path.strip_prefix(&root).unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            relative(glob(&root, "Classes/**/*.{h,m}", false)),
            [
                "Classes/Chirp.h",
                "Classes/Chirp.m",
                "Classes/Internal/Tweeter.m"
            ]
        );
        assert_eq!(
            relative(glob(&root, "Beep.xcframework", true)),
            ["Beep.xcframework"]
        );
        assert!(glob(&root, "Classes/*.swift", false).is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// An empty lockfile, as `macos-brownfield` commits, pins nothing.
    #[test]
    fn an_empty_lockfile_pins_nothing() {
        assert_eq!(
            parse(
                "PODS: []\nCOCOAPODS: 1.15.2\n",
                Utf8Path::new("Podfile.lock")
            )
            .unwrap(),
            Lock::default()
        );
    }
}
