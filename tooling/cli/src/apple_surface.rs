//! Apple's platform packages, as `nts_surfaces` generates and keeps them:
//! one per framework, from the SDK and Swift's symbol graphs, and one per
//! platform naming them (`@nts/platform-macos`).
//!
//! Generated here, once per SDK and deployment target, rather than published:
//! whether declarations derived from Apple's SDK may be redistributed is an
//! open question (`docs/nts-config.md` 3a), and a store on the machine that
//! has the SDK does not ask it.

use std::collections::BTreeMap;
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
pub(crate) const fn fnv(parts: &[&[u8]]) -> u64 {
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
        let request = |framework: &str, reads: &[&str], records: &BTreeMap<String, String>, lent: bind_objc::Lent| bind_objc::Request {
            frameworks: std::iter::once(framework).chain(reads.iter().copied()).map(str::to_owned).collect(),
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
            lent,
            // The platform's other frameworks: a class one of them owns is
            // imported from it, whichever is generated first.
            provided: self.modules().filter(|other| *other != framework).map(str::to_owned).collect(),
            project: None,
        };
        let run = |request: &bind_objc::Request| bind_objc::run(request).with_context(|| format!("generating the `{}` package", request.module));
        // Each framework once, in order: the structs it declares are the
        // next one's to import, and what it adds to an earlier framework's
        // classes is collected for that framework's package.
        let mut outputs = Vec::new();
        let mut records = BTreeMap::new();
        let mut lends: BTreeMap<String, bind_objc::Lent> = BTreeMap::new();
        for (framework, reads) in self.frameworks() {
            let seen = records.clone();
            let output = run(&request(framework, reads, &seen, bind_objc::Lent::default()))?;
            records.extend(output.records.iter().map(|record| (record.clone(), format!("objc:{framework}"))));
            for (owner, lent) in &output.lends {
                lends.entry(owner.clone()).or_default().absorb(lent);
            }
            outputs.push((*framework, *reads, seen, output));
        }
        // Then each framework another lends to, again, with what it is lent:
        // only a class's own declaration can hold an initializer or a class
        // member (`bind_objc::Lent`). The structs it saw the first time are
        // the ones it sees now, so it declares the same ones.
        for (framework, reads, seen, output) in &mut outputs {
            if let Some(lent) = lends.remove(*framework) {
                *output = run(&request(framework, reads, seen, lent))?;
            }
        }
        let mut packages = Vec::new();
        let mut references = String::new();
        for (framework, _, _, output) in outputs {
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

/// The C structs the packages in `files` declare, by struct name, with the
/// module each is declared in: each `Struct<{ ... }, "CGRect">` in a
/// package's own `declare module` block. Read from the packages, which are
/// the store's record of what was generated.
pub(crate) fn records_of(files: &[Utf8PathBuf]) -> BTreeMap<String, String> {
    let mut records = BTreeMap::new();
    for file in files {
        let Ok(text) = std::fs::read_to_string(file) else { continue };
        let mut module = None;
        for line in text.lines() {
            if let Some(name) = line.strip_prefix("declare module \"").and_then(|rest| rest.strip_suffix("\" {")) {
                // The package's own block is the first; the rest extend
                // other modules.
                if module.is_some() {
                    break;
                }
                module = Some(name.to_owned());
            } else if let (Some(module), Some(rest)) = (&module, line.strip_prefix("  export type ")) {
                let Some(tag) = rest.contains(" = Struct<").then(|| rest.rsplit('"').nth(1)).flatten() else { continue };
                records.insert(tag.to_owned(), module.clone());
            }
        }
    }
    records
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

    /// The structs a package declares are read from its own module block
    /// only: a struct named in a block extending another module is not its.
    #[test]
    fn records_are_read_from_a_packages_own_module() {
        let dir = camino::Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-records-of-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("index.d.ts");
        std::fs::write(
            &file,
            "// @ts-nocheck\ndeclare module \"objc:CoreGraphics\" {\n  export type CGPoint = Struct<{ x: Double; y: Double }, \"CGPoint\">;\n  export type NSRange = Struct<{ location: UInt; length: UInt }, \"_NSRange\">;\n  export class CGColor {}\n}\ndeclare module \"objc:Foundation\" {\n  export type Elsewhere = Struct<{ a: Double }, \"Elsewhere\">;\n}\n",
        )
        .unwrap();
        let records = super::records_of(&[file]);
        assert_eq!(
            records.into_iter().collect::<Vec<_>>(),
            [("CGPoint".to_owned(), "objc:CoreGraphics".to_owned()), ("_NSRange".to_owned(), "objc:CoreGraphics".to_owned())]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// **Each platform's packages typecheck**, whole and together, with their
    /// values files and nothing else: the check a package's `// @ts-nocheck`
    /// spares every program that uses it, made here once. Needs each SDK and
    /// Swift's graphs for it, and says nothing of a platform without them.
    ///
    /// One test per platform, so the two run at once: as one loop they were
    /// the longest test binary's last two minutes (126-159 s of `tests`).
    #[test]
    fn the_macos_packages_typecheck() {
        typechecks("macos");
    }

    /// The same for iOS; see `the_macos_packages_typecheck`.
    #[test]
    fn the_ios_packages_typecheck() {
        typechecks("ios");
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
        // What the packages leave unbound, held to a ceiling: a change that
        // stops binding a shape adds a reason line and nothing else, which no
        // typecheck sees. Deprecated and too-new members are left out by
        // choice; a bare "a `T`" is a type no spelling handles yet.
        let reasons: Vec<&str> = packages.iter().flat_map(|package| not_bound(&package.declarations)).collect();
        let chosen = reasons.iter().filter(|why| why.starts_with("deprecated in") || why.starts_with("introduced in")).count();
        let unhandled = reasons.iter().filter(|why| why.starts_with("a `") && why.ends_with('`') && why.matches('`').count() == 2).count();
        // Measured 2026-09-27. Lower them when a shape is bound: the largest
        // named one is a toll-free type in a C function, whose prototype
        // lowering cannot yet write as the header's `CFStringRef`.
        let (most, most_unhandled) = match os {
            "macos" => (750, 173),
            "ios" => (551, 160),
            _ => unreachable!("the test names macos and ios"),
        };
        assert!(
            reasons.len() - chosen <= most && unhandled <= most_unhandled,
            "{os}: {} not bound, {chosen} of them by choice, {unhandled} of a type nothing spells; the ceilings are {most} and {most_unhandled}",
            reasons.len()
        );
        let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize_utf8().unwrap();
        let dir = camino::Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-apple-packages-{os}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // As a project has them, through `types`, but as the binder wrote
        // them: without the store's `// @ts-nocheck`.
        let mut files = vec![root.join("runtime/native/libc.d.ts"), root.join("runtime/objc/objc.d.ts")];
        for package in &packages {
            let at = dir.join("node_modules").join(&package.name);
            std::fs::create_dir_all(&at).unwrap();
            // A surface, as the store writes it: without `"nts": { "surface" }`
            // the frontend reads a package's `.d.ts` as an external library,
            // which it does not check, and this test passed over declarations
            // it never read. The control below keeps that honest.
            let manifest = format!(r#"{{ "name": {:?}, "types": "index.d.ts", "nts": {{ "surface": {:?} }} }}"#, package.name, package.surface.as_str());
            std::fs::write(at.join("package.json"), manifest).unwrap();
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
        let errors = || -> Vec<String> {
            let snapshot = nts_frontend_ts::TsgoApi::new(tsgo.clone()).snapshot(&dir.join("tsconfig.json")).unwrap();
            snapshot
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == nts_diagnostics::Severity::Error)
                .map(|diagnostic| format!("{} {}", diagnostic.code, diagnostic.message))
                .collect()
        };
        let found = errors();
        if !found.is_empty() {
            let mut codes: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
            for error in &found {
                *codes.entry(error.split(' ').next().unwrap_or_default()).or_default() += 1;
            }
            panic!("the {os} packages do not typecheck: {} errors, by code {codes:?}, the first {:#?}", found.len(), &found[..found.len().min(10)]);
        }
        // The control: one unresolved name in one package's declarations is
        // an error, so a clean answer above was a check of them.
        let first = dir.join("node_modules").join(&packages[0].name).join("index.d.ts");
        std::fs::write(&first, format!("{}\nexport type Unresolved = NoSuchName;\n", packages[0].declarations)).unwrap();
        let found = errors();
        assert!(found.iter().any(|error| error.contains("NoSuchName")), "{os}: an unresolved name in {} went unreported: {found:#?}", packages[0].name);
        // Kept when an assertion above fails, to be read; removed when none
        // does, or every run leaves the platform's packages in /tmp.
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Each reason a package gives for what it leaves unbound: a class
    /// member's `//   name: why`, and a free function's `// Not bound: name: why`.
    fn not_bound(declarations: &str) -> Vec<&str> {
        declarations
            .lines()
            .filter_map(|line| {
                let line = line.trim_start();
                let rest = line.strip_prefix("// Not bound: ").or_else(|| line.strip_prefix("//   "))?;
                rest.split_once(": ").map(|(_, why)| why)
            })
            .collect()
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
