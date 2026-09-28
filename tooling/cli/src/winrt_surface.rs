//! The Windows Runtime's platform packages, as `nts_surfaces` generates and
//! keeps them: one per namespace a program imports from and each namespace
//! those name (`@nts/winrt-windows.foundation`, ...), and one naming them all
//! (`@nts/platform-winrt`).
//!
//! Generated from the Windows SDK's and the Windows App SDK's metadata, once
//! per set of namespaces imported and metadata release, and shared by every
//! project on the machine: a program that imports `winrt:Windows.Data.Json`
//! finds the module in the store rather than in a `types/winrt` of its own.
//! The module names are the metadata's, so the program's imports do not
//! change.
//!
//! **Keyed by the namespaces imported, not the whole SDK.** A namespace a
//! program imports is bound whole, and one its declarations name only for
//! the types named (`winrt::generate`), so a package's contents depend on
//! the roots, which are in the identity. Binding the whole contract instead
//! -- 282 namespaces, 26 MB, 4 s -- made every program's check 0.11 s and
//! 280 MB where its own closure is 0.03 s and 48 MB (measured 2026-09-28).

use std::collections::BTreeSet;
use std::fmt::Write as _;

use anyhow::Result;
use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::generated::{Complaint, Generated};
use nts_surfaces::{Binder, Package, Surface};

use crate::bind_winmd::winrt;

/// The generator's own source, hashed when this compiler is built: the
/// packages change when it does, and only then. `every_generator_file_is_hashed`
/// keeps the list whole.
const GENERATOR: u64 = fnv(&[
    include_bytes!("winrt_surface.rs"),
    include_bytes!("bind_winmd/check.rs"),
    include_bytes!("bind_winmd/ctype.rs"),
    include_bytes!("bind_winmd/emit.rs"),
    include_bytes!("bind_winmd/facts.rs"),
    include_bytes!("bind_winmd/iid.rs"),
    include_bytes!("bind_winmd/map.rs"),
    include_bytes!("bind_winmd/mod.rs"),
    include_bytes!("bind_winmd/read.rs"),
    include_bytes!("bind_winmd/winrt.rs"),
]);

/// FNV-1a over `parts` in order, at compile time.
const fn fnv(parts: &[&[u8]]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut part = 0;
    while part < parts.len() {
        let bytes = parts[part];
        let mut at = 0;
        while at < bytes.len() {
            hash = (hash ^ bytes[at] as u64).wrapping_mul(0x0100_0000_01b3);
            at += 1;
        }
        part += 1;
    }
    hash
}

/// The platform package, which names every namespace's.
pub(crate) const PLATFORM_PACKAGE: &str = "@nts/platform-winrt";

/// The Windows Runtime's packages for one set of namespaces imported.
#[derive(Debug, Clone)]
pub(crate) struct WinrtPlatform {
    /// The namespaces a program imports: `Windows.Data.Json`,
    /// `Microsoft.UI.Xaml.Controls`.
    pub(crate) roots: BTreeSet<String>,
    /// The directories of `.winmd`s bound from (`winrt::default_metadata`).
    pub(crate) metadata: Vec<Utf8PathBuf>,
}

impl WinrtPlatform {
    /// A namespace's package name: `@nts/winrt-windows.data.json`.
    fn package(namespace: &str) -> String {
        format!("@nts/winrt-{}", namespace.to_lowercase())
    }
}

impl Binder for WinrtPlatform {
    /// The metadata releases and the roots: every root while they are short,
    /// and past that the first, how many more, and a hash of them all -- the
    /// identity is a directory's name, which a program importing fifteen
    /// namespaces made longer than a file system takes.
    fn identity(&self) -> String {
        let roots: Vec<&str> = self.roots.iter().map(String::as_str).collect();
        let joined = roots.join("+");
        let named = if joined.len() <= 120 {
            joined
        } else {
            let bytes: Vec<&[u8]> = roots.iter().map(|root| root.as_bytes()).collect();
            format!("{}+{}-more-{:016x}", roots[0], roots.len() - 1, fnv(&bytes))
        };
        format!("winrt {} winappsdk {} {named}", winrt::WINRT_METADATA_VERSION, winrt::WINAPPSDK_VERSION)
    }

    fn version(&self) -> String {
        format!("{GENERATOR:016x}")
    }

    fn inputs(&self) -> Vec<Utf8PathBuf> {
        winrt::metadata_markers(&self.metadata)
    }

    fn generate(&self) -> Result<Vec<Package>> {
        let roots: Vec<String> = self.roots.iter().cloned().collect();
        let command = format!("nts build (winrt:{})", roots.join(" winrt:"));
        let mut packages = Vec::new();
        let mut references = String::new();
        for module in winrt::generate(&roots, &self.metadata, &command)? {
            let name = Self::package(&module.namespace);
            let _ = writeln!(references, "/// <reference types=\"{name}\" />");
            packages.push(Package {
                name,
                surface: Surface::Winrt,
                values: module.values.map(|values| (format!("{}.values.ts", module.namespace), values)),
                declarations: module.text,
            });
        }
        packages.push(Package { name: PLATFORM_PACKAGE.to_owned(), surface: Surface::Winrt, declarations: references, values: None });
        Ok(packages)
    }
}

/// The generator `nts build` and `nts check` open a Windows project with:
/// when the checker cannot find a `winrt:` module, the packages of what the
/// program imports are installed from the store, linked into the project,
/// and the program is opened with their files added.
#[derive(Debug, Default)]
pub(crate) struct WinrtBindings {
    /// Whether the first round has been answered.
    decided: bool,
}

impl Generated for WinrtBindings {
    /// What keys the snapshot cache: the binder's source and the metadata it
    /// binds from, so a build after either changes asks this generator again.
    fn identity(&self) -> String {
        let metadata = winrt::metadata_markers(&winrt::default_metadata());
        format!("winrt-bindings/1 {GENERATOR:016x} {}", nts_surfaces::fingerprint(&metadata))
    }

    fn config(&mut self, tsconfig: &Utf8Path, _roots: &[String], complaints: &[Complaint]) -> Result<Option<Utf8PathBuf>, String> {
        if std::mem::replace(&mut self.decided, true) {
            return Ok(None);
        }
        let roots: BTreeSet<String> = complaints.iter().filter_map(missing_namespace).map(str::to_owned).collect();
        if roots.is_empty() {
            return Ok(None);
        }
        let platform = WinrtPlatform { roots, metadata: winrt::default_metadata() };
        install(tsconfig, &platform).map(Some).map_err(|error| format!("{error:#}"))
    }
}

/// The platform's packages, from the store and linked into the project, and
/// the config opening the project with their files.
fn install(tsconfig: &Utf8Path, platform: &WinrtPlatform) -> Result<Utf8PathBuf> {
    let project = tsconfig.parent().unwrap_or(Utf8Path::new("."));
    let installed = nts_surfaces::Store::new(nts_surfaces::Store::default_root()).ensure(platform)?;
    let linked = nts_surfaces::link(&installed, project)?;
    // Once, when the platform first arrives: the build sees it through the
    // config it opens, and an editor only through `types`.
    if linked.iter().any(|name| name == PLATFORM_PACKAGE) {
        eprintln!(
            "note: linked {PLATFORM_PACKAGE} into {project}/node_modules; for an editor to see it, add \"types\": [\"{PLATFORM_PACKAGE}\"] to tsconfig.json's compilerOptions"
        );
    }
    nts_surfaces::wrapper(tsconfig, "winrt", &installed.files())
}

/// The namespace of the `winrt:` module a complaint says cannot be found --
/// TypeScript's `Cannot find module 'winrt:Windows.Data.Json' or its
/// corresponding type declarations.` (2307) -- or `None` for any other.
fn missing_namespace(complaint: &Complaint) -> Option<&str> {
    if complaint.code != 2307 {
        return None;
    }
    let namespace = complaint.text.split_once("'winrt:")?.1.split('\'').next()?;
    winrt::is_winrt(namespace).then_some(namespace)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use nts_frontend_ts::SemanticSource;

    /// **The Windows Runtime's packages typecheck**, whole and together, with
    /// their values files: the check a package's `// @ts-nocheck` spares
    /// every program that uses it, made here once, over the namespaces the
    /// lane's examples import. Needs tsgo and the metadata, and says nothing
    /// on a machine without them.
    #[test]
    fn the_winrt_packages_typecheck() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            eprintln!("skipped: no tsgo");
            return;
        };
        let metadata = winrt::default_metadata();
        if winrt::index(&metadata).is_err() {
            eprintln!("skipped: no Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
            return;
        }
        let roots: BTreeSet<String> = ["Windows.Data.Json", "Windows.Foundation.Collections", "Windows.Storage", "Windows.Web.Http"]
            .iter()
            .map(|root| (*root).to_owned())
            .collect();
        let platform = WinrtPlatform { roots, metadata };
        let packages = platform.generate().unwrap();
        assert!(packages.iter().any(|package| package.name == "@nts/winrt-windows.data.json"), "no package for a root");
        assert!(packages.iter().any(|package| package.name == "@nts/winrt-windows.foundation"), "no package for a namespace a root names");
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize_utf8().unwrap();
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-winrt-packages-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut files = vec![root.join("runtime/native/libc.d.ts"), root.join("runtime/winrt/winrt.d.ts")];
        for package in &packages {
            let at = dir.join("node_modules").join(&package.name);
            std::fs::create_dir_all(&at).unwrap();
            // With its surface, as the store writes it: the frontend keeps a
            // `.d.ts` under `node_modules` among the program's sources only
            // then, and one it skips is one whose errors nothing reports.
            std::fs::write(
                at.join("package.json"),
                format!(r#"{{ "name": {:?}, "types": "index.d.ts", "nts": {{ "surface": "winrt" }} }}"#, package.name),
            )
            .unwrap();
            std::fs::write(at.join("index.d.ts"), &package.declarations).unwrap();
            if let Some((name, text)) = &package.values {
                std::fs::write(dir.join(name), text).unwrap();
                files.push(dir.join(name));
            }
        }
        let listed: Vec<String> = files.iter().map(|file| format!("{file:?}")).collect();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(
                r#"{{ "extends": "{root}/tsconfig.fixtures.json", "compilerOptions": {{ "types": [{PLATFORM_PACKAGE:?}] }}, "files": [{}] }}"#,
                listed.join(", ")
            ),
        )
        .unwrap();
        let snapshot = nts_frontend_ts::TsgoApi::new(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
        let errors: Vec<String> = snapshot
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == nts_diagnostics::Severity::Error)
            .take(10)
            .map(|diagnostic| format!("{} {}", diagnostic.code, diagnostic.message))
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(errors.is_empty(), "the Windows Runtime's packages do not typecheck: {errors:#?}");
        eprintln!("{} packages, {} sources checked", packages.len(), snapshot.sources.len());
    }

    /// Every source file the generator is made of is in `GENERATOR`: one left
    /// out would keep stale packages when it changes.
    #[test]
    fn every_generator_file_is_hashed() {
        let this = include_str!("winrt_surface.rs");
        let dir = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bind_winmd");
        for entry in std::fs::read_dir(&dir).expect("bind_winmd") {
            let name = entry.expect("entry").file_name().into_string().expect("utf-8");
            assert!(this.contains(&format!("include_bytes!(\"bind_winmd/{name}\")")), "bind_winmd/{name} is not hashed into GENERATOR");
        }
    }
}
