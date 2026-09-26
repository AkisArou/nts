//! A program's Objective-C binding, generated from what it imports.
//!
//! Swift's programmer writes `import AppKit` and has every class. Here the
//! program writes `import { NSWindow } from "objc:AppKit"`, and the binding of
//! the names it imports is generated into the project's `.nts/objc`, keyed by
//! the SDK, the deployment target and the names: a changed import is a cache
//! miss, not a file to regenerate by hand. No binding is committed.
//!
//! **What an import does not name.** `navigation.navigationBar.topItem` reads
//! a member of `UINavigationBar`, which the program reaches through a
//! signature and never imports. The binding declares such a class with its
//! ancestors' members only, since binding everything every signature mentions
//! is most of the framework. The checker then says the member is missing, the
//! class is added, and the binding is generated again, until nothing is
//! missing: the names only grow, so this ends. What was added is kept in
//! `names.json`, and the next build starts from it.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::generated::{Complaint, Generated};

use crate::bind_objc;
use crate::objc_imports::Imports;

/// The generator `nts build` and `nts check` open a project with, when its
/// `nts.config.ts` targets macOS or iOS.
#[derive(Debug)]
pub(crate) struct ObjcBindings {
    targets: Vec<nts_build::config::Target>,
    /// What the program imports, read once.
    imports: Option<Imports>,
    /// Classes the checker found missing, by module, beyond the imports.
    reached: BTreeMap<String, BTreeSet<String>>,
    /// The classes each module's last binding declared as stubs.
    stubs: BTreeMap<String, BTreeSet<String>>,
    /// Each module's bound classes, with the protocols they adopt and those
    /// protocols' members: see `bind_objc::Output::adoptions`.
    adoptions: BTreeMap<String, BTreeMap<String, BTreeMap<String, bind_objc::Adopted>>>,
}

impl ObjcBindings {
    pub(crate) fn new(targets: Vec<nts_build::config::Target>) -> Self {
        Self { targets, imports: None, reached: BTreeMap::new(), stubs: BTreeMap::new(), adoptions: BTreeMap::new() }
    }
}

impl Generated for ObjcBindings {
    fn identity(&self) -> String {
        "objc-bindings/1".to_owned()
    }

    fn config(&mut self, tsconfig: &Utf8Path, roots: &[String], complaints: &[Complaint]) -> Result<Option<Utf8PathBuf>, String> {
        let project = tsconfig.parent().unwrap_or(Utf8Path::new("."));
        let store = project.join(".nts/objc");
        if self.imports.is_none() {
            let mut imports = Imports::default();
            for root in roots.iter().filter(|root| !Utf8Path::new(root).starts_with(&store)) {
                if let Ok(text) = std::fs::read_to_string(root) {
                    imports.scan(&text);
                }
            }
            if let Some(whole) = imports.whole.iter().find(|module| !imports.declared.contains(*module)) {
                return Err(format!(
                    "`import * as ... from \"objc:{whole}\"` names no class, and the binding is generated \
                     from the names a program imports: import the classes it uses by name"
                ));
            }
            self.reached = read_reached(&store);
            self.imports = Some(imports);
        }
        let Some(imports) = &self.imports else { return Ok(None) };
        let mut grew = false;
        for complaint in complaints {
            let Some((member, class)) = missing_member_of(complaint) else { continue };
            // A stub: the class itself, bound whole.
            for (module, stubs) in &self.stubs {
                if stubs.contains(class) && self.reached.entry(module.clone()).or_default().insert(class.to_owned()) {
                    grew = true;
                }
            }
            // A bound class missing a member one of its protocols declares:
            // that protocol. Where several do, the one the others refine --
            // `UIKeyInput`'s `insertText`, which `UITextInput` declares again
            // differently -- since binding both makes the class extend two
            // interfaces that disagree.
            for (module, classes) in &self.adoptions {
                let Some(protocols) = classes.get(class) else { continue };
                let declaring: Vec<&String> = protocols.iter().filter(|(_, adopted)| adopted.members.contains(member)).map(|(name, _)| name).collect();
                for protocol in declaring.iter().filter(|name| !declaring.iter().any(|other| other != *name && protocols[**name].refines.contains(*other))) {
                    if self.reached.entry(module.clone()).or_default().insert((*protocol).clone()) {
                        grew = true;
                    }
                }
            }
        }
        if !complaints.is_empty() && !grew {
            return Ok(None);
        }
        let mut modules: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (module, names) in &imports.names {
            if imports.declared.contains(module) {
                continue;
            }
            let mut all = names.clone();
            all.extend(self.reached.get(module).into_iter().flatten().cloned());
            modules.insert(module.clone(), all);
        }
        if modules.is_empty() {
            return Ok(None);
        }
        let config = self.generate(tsconfig, &store, &modules).map_err(|error| format!("{error:#}"))?;
        if grew {
            write_reached(&store, &self.reached);
        }
        Ok(Some(config))
    }
}

impl ObjcBindings {
    /// Each module's binding and values module, and the config adding them,
    /// under a directory keyed by everything that decides them.
    fn generate(&mut self, tsconfig: &Utf8Path, store: &Utf8Path, modules: &BTreeMap<String, BTreeSet<String>>) -> anyhow::Result<Utf8PathBuf> {
        let mut requests = Vec::new();
        for (module, names) in modules {
            let platform = self.platform(module)?;
            let symbols = bind_objc::default_symbols(platform.sdk.as_str())?;
            let frameworks = frameworks(module, &symbols);
            requests.push(bind_objc::Request {
                frameworks,
                module: format!("objc:{module}"),
                classes: Vec::new(),
                protocols: Vec::new(),
                functions: Vec::new(),
                names: names.iter().cloned().collect(),
                sdk: platform.sdk.to_string(),
                target: platform.triple,
                symbols: Some(symbols),
            });
        }
        let key = key(&requests);
        let directory = store.join(&key);
        let config = directory.join("tsconfig.json");
        let mut files = Vec::new();
        for request in &requests {
            let module = request.module.trim_start_matches("objc:");
            let binding = directory.join(format!("{module}.d.ts"));
            let values = directory.join(format!("{module}.values.ts"));
            let adoptions = directory.join(format!("{module}.adoptions.json"));
            if !binding.is_file() {
                std::fs::create_dir_all(&directory)?;
                let output = bind_objc::run(request)?;
                std::fs::write(&values, &output.values)?;
                std::fs::write(&adoptions, serde_json::to_vec(&output.adoptions)?)?;
                std::fs::write(&binding, &output.binding)?;
            }
            let index = std::fs::read(&adoptions).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
            self.adoptions.insert(module.to_owned(), index);
            let text = std::fs::read_to_string(&binding)?;
            self.stubs.insert(module.to_owned(), stubs(&text));
            files.push(binding);
            if std::fs::metadata(&values).is_ok_and(|meta| meta.len() > 0) {
                files.push(values);
            }
        }
        let listed: Vec<String> = files.iter().map(|file| format!("{:?}", file.as_str())).collect();
        let text = format!("{{\n  \"extends\": {:?},\n  \"files\": [{}]\n}}\n", tsconfig.as_str(), listed.join(", "));
        std::fs::write(&config, text)?;
        prune(store, &key);
        Ok(config)
    }

    /// The SDK and deployment target a module's binding is for: iOS for
    /// `UIKit`, macOS for `AppKit`, and for any other the program's macOS
    /// target where it has one. Each from the lowest minimum version the
    /// config asks for, which is the one every product can rely on.
    fn platform(&self, module: &str) -> anyhow::Result<Platform> {
        let wanted = match module {
            "UIKit" => &["ios"][..],
            "AppKit" => &["macos"][..],
            _ => &["macos", "ios"][..],
        };
        let root = crate::apple_root();
        for os in wanted {
            let minimum = self
                .targets
                .iter()
                .filter(|target| target.os == *os)
                .filter_map(|target| target.minimum_version.clone())
                .min_by(|a, b| version(a).cmp(&version(b)));
            if !self.targets.iter().any(|target| target.os == *os) {
                continue;
            }
            return Ok(if *os == "ios" {
                let sdk = std::env::var("NTS_IOS_SIMULATOR_SDK").map_or_else(|_| root.join("iPhoneSimulator.sdk"), Utf8PathBuf::from);
                Platform { sdk, triple: format!("x86_64-apple-ios{}-simulator", minimum.as_deref().unwrap_or("13.0")) }
            } else {
                let sdk = std::env::var("NTS_APPLE_SDK").map_or_else(|_| root.join("MacOSX.sdk"), Utf8PathBuf::from);
                Platform { sdk, triple: format!("x86_64-apple-macos{}", minimum.as_deref().unwrap_or("11.0")) }
            });
        }
        anyhow::bail!("the program imports from `objc:{module}`, and nts.config.ts targets neither macOS nor iOS")
    }
}

struct Platform {
    sdk: Utf8PathBuf,
    triple: String,
}

/// The C frameworks, whose headers C includes and whose binding names them
/// (`@ntsHeader`): Foundation is not one, and cannot be read beside them.
const C_FRAMEWORKS: &[&str] = &["CoreFoundation", "CoreGraphics", "CoreText", "CoreVideo", "CoreMedia", "ImageIO"];

/// The frameworks a module's binding reads: its own, and Foundation, which
/// every Objective-C framework re-exports, and Core Graphics for the two that
/// re-export it too, where its graph was fetched.
fn frameworks(module: &str, symbols: &std::path::Path) -> Vec<String> {
    let mut frameworks = vec![module.to_owned()];
    if module != "Foundation" && !C_FRAMEWORKS.contains(&module) {
        frameworks.push("Foundation".to_owned());
    }
    if matches!(module, "AppKit" | "UIKit") && symbols.join("CoreGraphics.symbols.json").is_file() {
        frameworks.push("CoreGraphics".to_owned());
    }
    frameworks
}

/// A version's numbers, so that `9.0` sorts before `13.0`.
fn version(text: &str) -> Vec<u32> {
    text.split('.').map(|part| part.parse().unwrap_or(0)).collect()
}

/// The member and the class a complaint says lacks it: TypeScript's
/// `Property 'x' does not exist on type 'UINavigationBar'.` (2339), and its
/// `Did you mean` sibling (2551).
fn missing_member_of(complaint: &Complaint) -> Option<(&str, &str)> {
    if !matches!(complaint.code, 2339 | 2551) {
        return None;
    }
    let member = complaint.text.strip_prefix("Property '")?.split('\'').next()?;
    let (_, rest) = complaint.text.split_once("on type '")?;
    let class = rest.split(['\'', '<']).next()?;
    Some((member, class))
}

/// The classes a binding declares as stubs, by the name it exports them as.
fn stubs(binding: &str) -> BTreeSet<String> {
    binding
        .split("Named by a signature here, and not bound")
        .skip(1)
        .filter_map(|after| {
            let (_, class) = after.split_once("export class ")?;
            class.split([' ', '<', '{']).next().map(str::to_owned)
        })
        .collect()
}

/// Everything that decides the generated files, hashed: each request, the
/// SDK's own settings, and this compiler, whose generator they come from.
fn key(requests: &[bind_objc::Request]) -> String {
    let mut text = String::new();
    for request in requests {
        let _ = write!(text, "{}|{}|{}|{}|", request.module, request.frameworks.join(","), request.names.join(","), request.target);
        let settings = std::fs::read(Utf8Path::new(&request.sdk).join("SDKSettings.json")).unwrap_or_default();
        let _ = writeln!(text, "{}|{}", request.sdk, fnv(&settings));
    }
    let compiler = std::env::current_exe().and_then(std::fs::metadata).map(|meta| format!("{}{:?}", meta.len(), meta.modified().ok())).unwrap_or_default();
    format!("{:016x}", fnv(format!("{text}{compiler}").as_bytes()))
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3))
}

/// Every keyed directory but the current one: an old binding is never read
/// again, and each is a framework's worth of text.
fn prune(store: &Utf8Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(store) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if entry.path().is_dir() && name.to_str() != Some(keep) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn read_reached(store: &Utf8Path) -> BTreeMap<String, BTreeSet<String>> {
    std::fs::read(store.join("names.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// `names.json`: the classes the checker has had to add, so a later build
/// starts with them. What the checker reached, not the program's surface: a
/// typo on a stub's member adds that class as surely as a real read does.
fn write_reached(store: &Utf8Path, reached: &BTreeMap<String, BTreeSet<String>>) {
    if let Ok(text) = serde_json::to_string_pretty(reached) {
        let _ = std::fs::create_dir_all(store);
        let _ = std::fs::write(store.join("names.json"), text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_member_names_its_class() {
        let complaint = |code, text: &str| Complaint { code, text: text.to_owned() };
        assert_eq!(missing_member_of(&complaint(2339, "Property 'topItem' does not exist on type 'UINavigationBar'.")), Some(("topItem", "UINavigationBar")));
        assert_eq!(missing_member_of(&complaint(2551, "Property 'tittle' does not exist on type 'NSArray<NSView>'. Did you mean 'title'?")), Some(("tittle", "NSArray")));
        assert_eq!(missing_member_of(&complaint(2322, "Type 'string' is not assignable to type 'number'.")), None);
    }

    #[test]
    fn a_binding_names_its_stubs() {
        let binding = "  /** Named by a signature here, and not bound: its ancestors' members only.\n   * @ntsClass UINavigationBar */\n  export class UINavigationBar extends UIView {}\n\
                       export class UIWindow extends UIView {\n  }\n";
        assert_eq!(stubs(binding), ["UINavigationBar".to_owned()].into_iter().collect());
    }
}
