//! Apple's platform packages, as `nts_surfaces` generates and keeps them:
//! one per framework, from the SDK and Swift's symbol graphs, and one per
//! platform naming them (`@nts/platform-macos`).
//!
//! Generated here, once per SDK and deployment target, rather than published:
//! whether declarations derived from Apple's SDK may be redistributed is an
//! open question (`docs/nts-config.md` 3a), and a store on the machine that
//! has the SDK does not ask it.

use std::fmt::Write as _;

use anyhow::{Context, Result};
use camino::Utf8PathBuf;
use nts_surfaces::{Binder, Package, Surface};

use crate::bind_objc;

/// The generator's own source, hashed when this compiler is built: the
/// packages change when it does, and only then. A rebuild that leaves it alone
/// keeps the packages, which the executable's size and time did not.
/// `every_generator_file_is_hashed` keeps the list whole.
const GENERATOR: u64 = fnv(&[include_bytes!("apple_surface.rs"), include_bytes!("bind_objc.rs"), include_bytes!("bind_objc/cf.rs")]);

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

/// An Apple platform's packages for one SDK and deployment target.
#[derive(Debug, Clone)]
pub(crate) struct ApplePlatform {
    /// `macos` or `ios`, as the config spells it.
    pub(crate) os: &'static str,
    pub(crate) sdk: Utf8PathBuf,
    /// The clang target, whose version is the deployment target members are
    /// bound for: `x86_64-apple-macos13`.
    pub(crate) triple: String,
}

impl ApplePlatform {
    /// Each framework a package is made of, with the frameworks it reads and
    /// re-exports, in the order they are generated.
    ///
    /// **The order decides who declares a struct.** A C struct is declared by
    /// the first package that uses it, and imported by those after, so one
    /// struct is one layout. Each framework comes before those that build on
    /// it -- Core Graphics before Foundation, whose `NSRect` is `CGRect` --
    /// so a struct lands in the framework whose header defines it: the CG
    /// geometry in Core Graphics, `_NSRange` in Foundation. iOS has no Core
    /// Graphics package, so there Foundation declares them.
    fn frameworks(&self) -> &'static [(&'static str, &'static [&'static str])] {
        match self.os {
            "ios" => &[("Foundation", &[]), ("UIKit", &["Foundation"])],
            _ => &[("CoreGraphics", &[]), ("Foundation", &[]), ("AppKit", &["Foundation", "CoreGraphics"])],
        }
    }

    /// The `objc:` modules its packages provide: `AppKit`, `Foundation`.
    pub(crate) fn modules(&self) -> impl Iterator<Item = &'static str> {
        self.frameworks().iter().map(|(framework, _)| *framework)
    }

    /// Whether a build installs these packages for a program, in place of the
    /// binding derived from its imports.
    ///
    /// **Not yet iOS's.** Swift lets a framework add an initializer to
    /// another's class -- `UIKit`'s `NSIndexPath(row:section:)` on Foundation's
    /// -- and TypeScript cannot add a construct signature, or a static, to a
    /// class another file declares (TS2433). So `UIKit`'s package lists them as
    /// not bound, and a `UIKit` program needs them: `ios-list`'s
    /// `new NSIndexPath({ forRow, inSection })` does not typecheck on it. iOS
    /// keeps the derived binding, which declares the class and what `UIKit`
    /// adds in one place, until the owner's package can declare them
    /// (`docs/nts-config.md` 3a). Its packages still generate and typecheck:
    /// `the_platform_packages_typecheck`.
    pub(crate) fn installed(&self) -> bool {
        self.os == "macos"
    }

    /// The platform package's name: `@nts/platform-macos`.
    pub(crate) fn platform_package(&self) -> String {
        format!("@nts/platform-{}", self.os)
    }

    fn symbols(&self) -> Result<std::path::PathBuf> {
        bind_objc::default_symbols(self.sdk.as_str())
    }
}

impl Binder for ApplePlatform {
    fn identity(&self) -> String {
        let version = std::fs::read_to_string(self.sdk.join("SDKSettings.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|settings| settings.get("CanonicalName").and_then(serde_json::Value::as_str).map(str::to_owned))
            .unwrap_or_else(|| "unknown-sdk".to_owned());
        format!("apple-{} {version} {}", self.os, self.triple)
    }

    fn version(&self) -> String {
        format!("{GENERATOR:016x}")
    }

    fn inputs(&self) -> Vec<Utf8PathBuf> {
        let mut inputs = vec![self.sdk.join("SDKSettings.json")];
        if let Ok(symbols) = self.symbols() {
            for (framework, _) in self.frameworks() {
                if let Ok(path) = Utf8PathBuf::from_path_buf(symbols.join(format!("{framework}.symbols.json"))) {
                    inputs.push(path);
                }
            }
        }
        inputs
    }

    fn generate(&self) -> Result<Vec<Package>> {
        let symbols = self.symbols()?;
        let mut packages = Vec::new();
        let mut references = String::new();
        let mut records = std::collections::BTreeMap::new();
        for (framework, reads) in self.frameworks() {
            let request = bind_objc::Request {
                frameworks: std::iter::once(*framework).chain(reads.iter().copied()).map(str::to_owned).collect(),
                module: format!("objc:{framework}"),
                classes: Vec::new(),
                protocols: Vec::new(),
                functions: Vec::new(),
                names: Vec::new(),
                package: true,
                sdk: self.sdk.to_string(),
                target: self.triple.clone(),
                symbols: Some(symbols.clone()),
                records: records.clone(),
            };
            let output = bind_objc::run(&request).with_context(|| format!("generating the `objc:{framework}` package"))?;
            records.extend(output.records.iter().map(|record| (record.clone(), format!("objc:{framework}"))));
            let name = format!("@nts/apple-{}", framework.to_lowercase());
            let _ = writeln!(references, "/// <reference types=\"{name}\" />");
            packages.push(Package {
                name,
                surface: Surface::Objc,
                declarations: output.binding,
                values: (!output.values.is_empty()).then(|| (format!("{framework}.values.ts"), output.values)),
            });
        }
        packages.push(Package {
            name: self.platform_package(),
            surface: Surface::Objc,
            declarations: format!("// {}'s frameworks, for a project's `types`.\n{references}", self.os),
            values: None,
        });
        Ok(packages)
    }
}

/// The Apple platform a target is, with the SDK the build reads for it and
/// the deployment target: the lowest the config's targets for that platform
/// ask for, which is the one every product can rely on.
pub(crate) fn platforms(targets: &[nts_build::config::Target]) -> Vec<ApplePlatform> {
    let root = crate::apple_root();
    let version = |text: &str| -> Vec<u32> { text.split('.').map(|part| part.parse().unwrap_or(0)).collect() };
    let mut platforms = Vec::new();
    for os in ["macos", "ios"] {
        let Some(minimum) = targets
            .iter()
            .filter(|target| target.os == os)
            .map(|target| target.minimum_version.clone().unwrap_or_else(|| if os == "ios" { "13.0" } else { "11.0" }.to_owned()))
            .min_by(|a, b| version(a).cmp(&version(b)))
        else {
            continue;
        };
        platforms.push(if os == "ios" {
            let sdk = std::env::var("NTS_IOS_SIMULATOR_SDK").map_or_else(|_| root.join("iPhoneSimulator.sdk"), Utf8PathBuf::from);
            ApplePlatform { os: "ios", sdk, triple: format!("x86_64-apple-ios{minimum}-simulator") }
        } else {
            let sdk = std::env::var("NTS_APPLE_SDK").map_or_else(|_| root.join("MacOSX.sdk"), Utf8PathBuf::from);
            ApplePlatform { os: "macos", sdk, triple: format!("x86_64-apple-macos{minimum}") }
        });
    }
    platforms
}

/// Whether an SDK for `platform` is on this machine, with Swift's graphs for
/// it: what generating its packages needs.
pub(crate) fn available(platform: &ApplePlatform) -> bool {
    platform.sdk.join("SDKSettings.json").is_file() && platform.symbols().is_ok_and(|symbols| symbols.join("Foundation.symbols.json").is_file())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use nts_frontend_ts::SemanticSource;
    use nts_surfaces::Binder;

    /// **Each platform's packages typecheck**, whole and together, with their
    /// values files and nothing else: the check a package's `// @ts-nocheck`
    /// spares every program that uses it, made here once. Needs each SDK and
    /// Swift's graphs for it, and says nothing of a platform without them.
    #[test]
    fn the_platform_packages_typecheck() {
        for os in ["macos", "ios"] {
            typechecks(os);
        }
    }

    fn typechecks(os: &str) {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else { return };
        let target = nts_build::config::Target {
            id: os.to_owned(),
            os: os.to_owned(),
            arch: None,
            backend: "c".to_owned(),
            minimum_version: None,
        };
        let platform = super::platforms(&[target]).remove(0);
        if !super::available(&platform) {
            return;
        }
        let packages = platform.generate().unwrap();
        // Each class is declared once, by the framework that owns it, and
        // imported by the rest. Two modules may each declare a class of one
        // name without the checker minding, so this is asserted here: two
        // declarations of one Objective-C class would be two unrelated types.
        // And each struct, once: two are two native layouts of one name,
        // which lowering refuses (NTS2006) in a program that meets both.
        let mut owners: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::new();
        let mut structs = 0;
        for package in &packages {
            for line in package.declarations.lines() {
                let name = if let Some(rest) = line.strip_prefix("  export class ") {
                    rest.split([' ', '<']).next()
                } else if let Some(rest) = line.strip_prefix("  export type ").filter(|rest| rest.contains(" = Struct<")) {
                    structs += 1;
                    rest.split(' ').next()
                } else {
                    None
                };
                let Some(name) = name else { continue };
                if let Some(first) = owners.insert(name, &package.name) {
                    panic!("{os}: `{name}` is declared by both {first} and {}", package.name);
                }
            }
        }
        assert!(owners.len() > 100 && structs > 3, "{os}: {} declarations, {structs} structs: the scan does not match the packages", owners.len());
        let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize_utf8().unwrap();
        let dir = camino::Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-apple-packages-{os}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // As a project has them, through `types`, but as the binder wrote
        // them: without the store's `// @ts-nocheck`.
        let mut files = vec![root.join("runtime/native/libc.d.ts"), root.join("runtime/objc/objc.d.ts")];
        for package in &packages {
            let at = dir.join("node_modules").join(&package.name);
            std::fs::create_dir_all(&at).unwrap();
            std::fs::write(at.join("package.json"), format!(r#"{{ "name": {:?}, "types": "index.d.ts" }}"#, package.name)).unwrap();
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
                r#"{{ "extends": "{root}/tsconfig.fixtures.json", "compilerOptions": {{ "types": [{:?}] }}, "files": [{}] }}"#,
                platform.platform_package(),
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
        assert!(errors.is_empty(), "the {os} packages do not typecheck: {errors:#?}");
    }

    /// The files [`super::GENERATOR`] hashes are every file of the
    /// generator: one added beside `bind_objc.rs` and left out would change
    /// the packages without changing their key.
    #[test]
    fn every_generator_file_is_hashed() {
        let source = include_str!("apple_surface.rs");
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bind_objc");
        for entry in std::fs::read_dir(&dir).unwrap_or_else(|error| panic!("{}: {error}", dir.display())) {
            let name = entry.unwrap_or_else(|error| panic!("{error}")).file_name();
            let named = format!("include_bytes!(\"bind_objc/{}\")", name.to_string_lossy());
            assert!(source.contains(&named), "the generator's key does not hash bind_objc/{}", name.to_string_lossy());
        }
    }
}
