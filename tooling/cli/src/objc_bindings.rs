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
use std::sync::OnceLock;

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::generated::{Complaint, Generated};

use crate::bind_objc;
use crate::objc_imports::Imports;

/// This generator's source and what it runs: a change to any is a change to
/// the bindings it writes.
const GENERATOR: u64 = crate::apple_surface::fnv(&[
    include_bytes!("objc_bindings.rs"),
    include_bytes!("apple_surface.rs"),
    include_bytes!("bind_objc.rs"),
    include_bytes!("bind_objc/cf.rs"),
    include_bytes!("swift.rs"),
]);

/// The generator `nts build` and `nts check` open a project with, when its
/// `nts.config.ts` targets macOS or iOS.
#[derive(Debug)]
pub(crate) struct ObjcBindings {
    targets: Vec<nts_build::config::Target>,
    /// The project's `native:` directories, whose headers and Swift it may
    /// bind: part of what the identity fingerprints.
    native: Vec<Utf8PathBuf>,
    /// The package whose config declares `dependencies`, which its paths
    /// are relative to.
    package: Utf8PathBuf,
    /// Its config's dependency claims: the libraries its resolvers checked
    /// out, which it may bind, and which the identity fingerprints too.
    dependencies: BTreeMap<String, nts_build::dependencies::Dependencies>,
    /// Those libraries, resolved once and only when something asks -- a
    /// binding of one, or the identity. Never when the generator is made: a
    /// claim this build cannot read is the build's to refuse, after what
    /// it reports first (a missing toolchain), not the frontend's before it.
    libraries: OnceLock<Result<Vec<nts_build::dependencies::NativeModule>, String>>,
    /// What the program imports, read once.
    imports: Option<Imports>,
    /// Classes the checker found missing, by module, beyond the imports.
    reached: BTreeMap<String, BTreeSet<String>>,
    /// The `objc:` modules the checker could not find in the project as it
    /// is: the only ones generated.
    missing: Option<BTreeSet<String>>,
    /// The classes each module's last binding declared as stubs.
    stubs: BTreeMap<String, BTreeSet<String>>,
    /// Each module's bound classes, with the protocols they adopt and those
    /// protocols' members: see `bind_objc::Output::adoptions`.
    adoptions: BTreeMap<String, BTreeMap<String, BTreeMap<String, bind_objc::Adopted>>>,
    /// The platform packages installed for the program, once decided.
    platform: Option<Provided>,
}

/// What the platform packages installed for a program provide it.
#[derive(Debug, Default)]
struct Provided {
    /// The files the program holds for them.
    files: Vec<Utf8PathBuf>,
    /// The frameworks they declare, which are their `objc:` modules: what a
    /// binding generated from the program's imports imports rather than
    /// declares (`bind_objc::Request::provided`).
    frameworks: BTreeSet<String>,
    /// The C structs they declare, with the module each is declared in.
    records: BTreeMap<String, String>,
}

impl ObjcBindings {
    pub(crate) fn new(
        targets: Vec<nts_build::config::Target>,
        native: Vec<Utf8PathBuf>,
        package: Utf8PathBuf,
        dependencies: BTreeMap<String, nts_build::dependencies::Dependencies>,
    ) -> Self {
        Self {
            targets,
            native,
            package,
            dependencies,
            libraries: OnceLock::new(),
            imports: None,
            missing: None,
            reached: BTreeMap::new(),
            stubs: BTreeMap::new(),
            adoptions: BTreeMap::new(),
            platform: None,
        }
    }

    /// The libraries the dependencies of every target resolve to, in target
    /// order: the first a module's name finds is the one bound.
    fn libraries(&self) -> anyhow::Result<&[nts_build::dependencies::NativeModule]> {
        let resolved = self.libraries.get_or_init(|| {
            let mut found = Vec::new();
            for target in &self.targets {
                let needs = nts_build::dependencies::resolve(
                    &self.package,
                    &self.dependencies,
                    &target.id,
                    target.minimum_version.as_deref(),
                )
                .map_err(|error| format!("{error:#}"))?;
                found.extend(needs.native);
            }
            Ok(found)
        });
        resolved
            .as_deref()
            .map_err(|error| anyhow::anyhow!("{error}"))
    }

    /// The platform packages for the frameworks the program imports, from the
    /// store, linked into the project where an editor finds them: the files a
    /// program holds for them, and the modules they provide.
    fn install_platform(&self, project: &Utf8Path, imports: &Imports) -> anyhow::Result<Provided> {
        let store = nts_surfaces::Store::new(nts_surfaces::Store::default_root());
        let mut provided = Provided::default();
        for platform in crate::apple_surface::platforms(&self.targets) {
            let wanted = platform.modules().any(|module| {
                imports.names.contains_key(module) && !imports.declared.contains(module)
            });
            if !wanted || !crate::apple_surface::available(&platform) {
                continue;
            }
            let installed = store.ensure(&platform)?;
            let linked = nts_surfaces::link(&installed, project)?;
            // Once, when the platform first arrives: the build sees it through
            // the config it opens, and an editor only through `types`.
            let package = platform.platform_package();
            if linked.contains(&package) {
                eprintln!(
                    "note: linked {package} into {project}/node_modules; for an editor to see it, add \"types\": [\"{package}\"] to tsconfig.json's compilerOptions"
                );
            }
            provided
                .records
                .extend(crate::apple_surface::records_of(&installed.files()));
            provided.files.extend(installed.files());
            provided
                .frameworks
                .extend(platform.modules().map(str::to_owned));
        }
        Ok(provided)
    }
}

impl Generated for ObjcBindings {
    /// Everything a binding is read from: this generator, each target's SDK
    /// and the Swift graphs beside it, and the project's own headers and
    /// Swift. A snapshot cached under the same identity answers the build
    /// without asking this generator anything, so what the bindings would
    /// become must change it: a constant here kept a program on the bindings
    /// of the graphs it was first built against.
    fn identity(&self) -> String {
        let mut files: Vec<Utf8PathBuf> = Vec::new();
        for platform in ["macos", "ios"]
            .iter()
            .filter_map(|os| self.platform_for(os))
        {
            files.push(platform.sdk.join("SDKSettings.json"));
            let Some(symbols) = bind_objc::default_symbols(platform.sdk.as_str())
                .ok()
                .and_then(|path| Utf8PathBuf::from_path_buf(path).ok())
            else {
                continue;
            };
            files.extend(listed(&symbols, &["json"]));
        }
        for directory in &self.native {
            files.extend(listed(directory, &["h", "m", "swift"]));
        }
        // Each lockfile, and every file of what it checked out. A claim that
        // does not resolve contributes its lockfile alone: the build refuses
        // it, and a binding of it cannot be made.
        files.extend(
            self.dependencies
                .values()
                .filter_map(|claim| claim.lockfile.as_deref())
                .map(|lockfile| self.package.join(lockfile)),
        );
        for library in self.libraries().unwrap_or_default() {
            files.extend(library.source_files());
            files.extend(library.headers.iter().cloned());
            files.extend(
                library
                    .frameworks
                    .iter()
                    .map(|framework| framework.join("Info.plist")),
            );
        }
        files.sort();
        files.dedup();
        format!(
            "objc-bindings/2 {GENERATOR:016x} {}",
            nts_surfaces::fingerprint(&files)
        )
    }

    fn files(
        &mut self,
        tsconfig: &Utf8Path,
        roots: &[String],
        complaints: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        let answer = self.answer(tsconfig, roots, complaints)?;
        // **What the build opened the program with, recorded where the
        // binding is stored**: `.nts/objc/opened.txt`, one file a line. A
        // binding is reused from its keyed directory unchanged, so nothing
        // else says which files this build added -- whether a framework came
        // from a platform package or was generated from the imports, which
        // `examples/interop/apple-binding.sh` asserts. The config the program
        // was opened through said it while it was written to disk; it is
        // served to tsgo now (`open_adding`).
        if let Some(files) = &answer {
            let store = tsconfig
                .parent()
                .unwrap_or(Utf8Path::new("."))
                .join(".nts/objc");
            let listed: String = files
                .iter()
                .flat_map(|file| [file.as_str(), "\n"])
                .collect();
            std::fs::create_dir_all(&store)
                .and_then(|()| std::fs::write(store.join("opened.txt"), listed))
                .map_err(|error| {
                    format!("recording what the build opened under {store}: {error}")
                })?;
        }
        Ok(answer)
    }
}

impl ObjcBindings {
    /// [`Generated::files`]' answer, before it is recorded.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn answer(
        &mut self,
        tsconfig: &Utf8Path,
        roots: &[String],
        complaints: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
        let project = tsconfig.parent().unwrap_or(Utf8Path::new("."));
        let store = project.join(".nts/objc");
        if self.imports.is_none() {
            let mut imports = Imports::default();
            for root in roots
                .iter()
                .filter(|root| !Utf8Path::new(root).starts_with(&store))
            {
                if let Ok(text) = std::fs::read_to_string(root) {
                    imports.scan(&text);
                }
            }
            if let Some(whole) = imports
                .whole
                .iter()
                .find(|module| !imports.declared.contains(*module))
            {
                return Err(format!(
                    "`import * as ... from \"objc:{whole}\"` names no class, and the binding is generated \
                     from the names a program imports: import the classes it uses by name"
                ));
            }
            self.reached = read_reached(&store);
            self.imports = Some(imports);
        }
        let Some(imports) = &self.imports else {
            return Ok(None);
        };
        // The first round is given what the checker says of the project as
        // it is: the `objc:` modules it cannot find are the ones generated. A
        // platform package the project installed provides its modules, and
        // this is the fallback for one that did not.
        let first = self.missing.is_none();
        if first {
            let platform = self
                .install_platform(project, imports)
                .map_err(|error| format!("{error:#}"))?;
            // What no platform package provides is what is left to generate
            // from the program's imports: the fallback.
            self.missing = Some(
                complaints
                    .iter()
                    .filter_map(missing_module)
                    .filter(|module| !platform.frameworks.contains(*module))
                    .map(str::to_owned)
                    .collect(),
            );
            self.platform = Some(platform);
        }
        let missing = self.missing.clone().unwrap_or_default();
        let platform_files = self
            .platform
            .as_ref()
            .map(|platform| platform.files.clone())
            .unwrap_or_default();
        if missing.is_empty() {
            // Only the platform's packages, or nothing: a program whose
            // modules the project already has opens as it is.
            return Ok((first && !platform_files.is_empty()).then_some(platform_files));
        }
        let mut grew = false;
        for complaint in complaints.iter().filter(|_| !first) {
            let Some((member, class)) = missing_member_of(complaint) else {
                continue;
            };
            // A stub: the class itself, bound whole.
            for (module, stubs) in &self.stubs {
                if stubs.contains(class)
                    && self
                        .reached
                        .entry(module.clone())
                        .or_default()
                        .insert(class.to_owned())
                {
                    grew = true;
                }
            }
            // A bound class missing a member one of its protocols declares:
            // that protocol. Where several do, the one the others refine --
            // `UIKeyInput`'s `insertText`, which `UITextInput` declares again
            // differently -- since binding both makes the class extend two
            // interfaces that disagree.
            for (module, classes) in &self.adoptions {
                let Some(protocols) = classes.get(class) else {
                    continue;
                };
                let declaring: Vec<&String> = protocols
                    .iter()
                    .filter(|(_, adopted)| adopted.members.contains(member))
                    .map(|(name, _)| name)
                    .collect();
                for protocol in declaring.iter().filter(|name| {
                    !declaring
                        .iter()
                        .any(|other| other != *name && protocols[**name].refines.contains(*other))
                }) {
                    if self
                        .reached
                        .entry(module.clone())
                        .or_default()
                        .insert((*protocol).clone())
                    {
                        grew = true;
                    }
                }
            }
        }
        if !first && !grew {
            return Ok(None);
        }
        let mut modules: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (module, names) in &imports.names {
            if imports.declared.contains(module) || !missing.contains(module) {
                continue;
            }
            let mut all = names.clone();
            all.extend(self.reached.get(module).into_iter().flatten().cloned());
            modules.insert(module.clone(), all);
        }
        if modules.is_empty() {
            return Ok(None);
        }
        let files = self
            .generate(tsconfig, &store, &modules)
            .map_err(|error| format!("{error:#}"))?;
        if grew {
            write_reached(&store, &self.reached);
        }
        Ok(Some(files))
    }
}

impl ObjcBindings {
    /// Each module's binding and values module, under a directory keyed by
    /// everything that decides them, and the platform's packages' files: what
    /// the project is opened with.
    fn generate(
        &mut self,
        tsconfig: &Utf8Path,
        store: &Utf8Path,
        modules: &BTreeMap<String, BTreeSet<String>>,
    ) -> anyhow::Result<Vec<Utf8PathBuf>> {
        let mut requests = Vec::new();
        let project_dir = tsconfig.parent().unwrap_or(Utf8Path::new("."));
        for (module, names) in modules {
            let platform = self.platform(module)?;
            let symbols = bind_objc::default_symbols(platform.sdk.as_str())?;
            // The project's own Objective-C or Swift, where a `native:` entry
            // is the module: `objc:Greeter` is `Greeter.h`, or a directory
            // `Greeter` of Swift. Foundation is what every Objective-C header
            // reads beside it; its graph is extracted below, once the
            // directory it goes in is known.
            let project = self.project_module(project_dir, module, &platform)?;
            let frameworks = if project.is_some() {
                vec!["Foundation".to_owned()]
            } else {
                frameworks(module, &symbols)
            };
            requests.push(bind_objc::Request {
                frameworks,
                module: format!("objc:{module}"),
                classes: Vec::new(),
                protocols: Vec::new(),
                functions: Vec::new(),
                names: names.iter().cloned().collect(),
                package: false,
                sdk: platform.sdk.to_string(),
                target: platform.triple,
                symbols: Some(symbols),
                records: self
                    .platform
                    .as_ref()
                    .map(|platform| platform.records.clone())
                    .unwrap_or_default(),
                lent: bind_objc::Lent::default(),
                provided: self
                    .platform
                    .as_ref()
                    .map(|platform| platform.frameworks.clone())
                    .unwrap_or_default(),
                project,
            });
        }
        let key = key(&requests);
        let directory = store.join(&key);
        let mut files = Vec::new();
        for request in &mut requests {
            let module = request.module.trim_start_matches("objc:").to_owned();
            let binding = directory.join(format!("{module}.d.ts"));
            let values = directory.join(format!("{module}.values.ts"));
            let adoptions = directory.join(format!("{module}.adoptions.json"));
            if let Some(project) = &mut request.project {
                project.symbols = directory
                    .join(format!("{module}.graph"))
                    .into_std_path_buf();
            }
            if !binding.is_file() {
                std::fs::create_dir_all(&directory)?;
                if let Some(project) = &request.project {
                    let header = crate::swift::Header {
                        module: &module,
                        path: &project.header,
                        search: &project.search,
                        frameworks: &project.frameworks,
                    };
                    let target = crate::swift::Target {
                        sdk: std::path::Path::new(&request.sdk),
                        triple: &request.target,
                    };
                    crate::swift::toolchain()?.extract(&header, target, &project.symbols)?;
                }
                let output = bind_objc::run(request)?;
                std::fs::write(&values, &output.values)?;
                std::fs::write(&adoptions, serde_json::to_vec(&output.adoptions)?)?;
                std::fs::write(&binding, &output.binding)?;
            }
            let index = std::fs::read(&adoptions)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            self.adoptions.insert(module.clone(), index);
            let text = std::fs::read_to_string(&binding)?;
            self.stubs.insert(module.clone(), stubs(&text));
            files.push(binding);
            if std::fs::metadata(&values).is_ok_and(|meta| meta.len() > 0) {
                files.push(values);
            }
        }
        files.extend(
            self.platform
                .as_ref()
                .map(|platform| platform.files.clone())
                .unwrap_or_default(),
        );
        std::fs::create_dir_all(&directory)?;
        prune(store, &key);
        Ok(files)
    }

    /// The project's own module `module`, where a `native:` entry of its
    /// config is one: a header named for it -- `Greeter.h` for `objc:Greeter`
    /// -- or a directory of Swift named for it, as a `SwiftPM` target is, whose
    /// Objective-C header Swift writes. The graph's directory is decided by
    /// the key.
    fn project_module(
        &self,
        project: &Utf8Path,
        module: &str,
        platform: &Platform,
    ) -> anyhow::Result<Option<bind_objc::Project>> {
        let Some(config) = nts_build::config::above(&project.join(nts_build::config::FILE_NAME))
        else {
            return Ok(None);
        };
        let package = config.parent().unwrap_or(project);
        let resolved = nts_build::config::resolve(&config)?;
        let covered: Vec<&nts_build::config::NativeSources> = resolved
            .native
            .iter()
            .filter(|entry| {
                self.targets
                    .iter()
                    .any(|target| entry.covers(&target.id, target.minimum_version.as_deref()))
            })
            .collect();
        let headers: Vec<Utf8PathBuf> = covered
            .iter()
            .filter_map(|entry| entry.header.as_deref())
            .map(|header| package.join(header))
            .filter(|header| header.extension() == Some("h") && header.file_stem() == Some(module))
            .collect();
        let swift: Vec<Utf8PathBuf> = covered
            .iter()
            .map(|entry| package.join(&entry.dir))
            .filter(|dir| dir.file_name() == Some(module) && !swift_sources(dir).is_empty())
            .collect();
        let (header, runtime_names) = match (headers.as_slice(), swift.as_slice()) {
            ([], []) => return self.library_module(project, module, platform),
            ([header], []) => (header.clone(), BTreeMap::new()),
            ([], [dir]) => swift_header(
                project,
                module,
                &swift_sources(dir),
                &[],
                &[],
                &[],
                platform,
            )?,
            _ => anyhow::bail!(
                "`objc:{module}` is named by more than one `native:` entry in {config}: {}",
                headers
                    .iter()
                    .chain(&swift)
                    .map(|path| path.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        };
        Ok(Some(bind_objc::Project {
            search: header
                .parent()
                .map(|directory| directory.to_path_buf().into_std_path_buf())
                .into_iter()
                .collect(),
            header: header.into_std_path_buf(),
            frameworks: Vec::new(),
            symbols: std::path::PathBuf::new(),
            runtime_names,
        }))
    }

    /// A library a resolver checked out as source -- a pod -- that is
    /// `module`: bound from an umbrella header importing each of its public
    /// headers, with its header maps searched, and the header Swift writes for
    /// its Swift, where it has Swift.
    fn library_module(
        &self,
        project: &Utf8Path,
        module: &str,
        platform: &Platform,
    ) -> anyhow::Result<Option<bind_objc::Project>> {
        let libraries = self.libraries()?;
        let Some(library) = libraries.iter().find(|library| library.name == module) else {
            return Ok(None);
        };
        let search: Vec<std::path::PathBuf> = library
            .include
            .iter()
            .map(|directory| directory.clone().into_std_path_buf())
            .collect();
        let sources: Vec<std::path::PathBuf> = library
            .source_files()
            .into_iter()
            .filter(|path| path.extension() == Some("swift"))
            .map(Utf8PathBuf::into_std_path_buf)
            .collect();
        // A library that ships only binary frameworks: its API is their
        // headers, from the slice for this binding's platform.
        if library.headers.is_empty() && sources.is_empty() && !library.frameworks.is_empty() {
            return framework_module(project, module, &library.frameworks, platform).map(Some);
        }
        if library.headers.is_empty() && sources.is_empty() {
            anyhow::bail!(
                "`objc:{module}` is the library {}, which has neither public headers nor Swift to bind",
                library.sources
            );
        }
        // One umbrella: the library's Objective-C headers, then the header
        // Swift writes for its Swift -- compiled with that Objective-C as the
        // module Swift imports as its own, where it has both, as Xcode builds
        // a pod of both languages. The Swift header declares its classes
        // against the Objective-C ones, so it comes second.
        let headers: Vec<std::path::PathBuf> = library
            .headers
            .iter()
            .map(|header| header.clone().into_std_path_buf())
            .collect();
        let mut text = library
            .headers
            .iter()
            .fold(String::new(), |mut text, header| {
                let _ = writeln!(text, "#import \"{header}\"");
                text
            });
        let mut search = search;
        let mut runtime_names = BTreeMap::new();
        if !sources.is_empty() {
            // The C and Objective-C modules of the same package it imports.
            let imported: Vec<(&str, Vec<std::path::PathBuf>)> = library
                .clang_dependencies(libraries)
                .into_iter()
                .map(|dependency| {
                    (
                        dependency.name.as_str(),
                        dependency
                            .headers
                            .iter()
                            .map(|header| header.clone().into_std_path_buf())
                            .collect(),
                    )
                })
                .collect();
            let imports: Vec<crate::swift::Clang<'_>> = imported
                .iter()
                .map(|(name, headers)| crate::swift::Clang { name, headers })
                .collect();
            let (header, names) = swift_header(
                project, module, &sources, &headers, &search, &imports, platform,
            )?;
            let _ = writeln!(text, "#import \"{header}\"");
            search.extend(
                header
                    .parent()
                    .map(|directory| directory.to_path_buf().into_std_path_buf()),
            );
            runtime_names = names;
        }
        let umbrella = project
            .join(".nts")
            .join("libraries")
            .join(format!("{module}.h"));
        if std::fs::read_to_string(&umbrella).ok().as_deref() != Some(text.as_str()) {
            std::fs::create_dir_all(umbrella.parent().unwrap_or(project))?;
            std::fs::write(&umbrella, text)?;
        }
        Ok(Some(bind_objc::Project {
            header: umbrella.into_std_path_buf(),
            search,
            frameworks: Vec::new(),
            symbols: std::path::PathBuf::new(),
            runtime_names,
        }))
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
        wanted
            .iter()
            .find_map(|os| self.platform_for(os))
            .ok_or_else(|| anyhow::anyhow!("the program imports from `objc:{module}`, and nts.config.ts targets neither macOS nor iOS"))
    }

    /// The SDK and deployment target of the program's `os` targets, where it
    /// has one: from the lowest minimum version the config asks for.
    fn platform_for(&self, os: &str) -> Option<Platform> {
        if !self.targets.iter().any(|target| target.os == os) {
            return None;
        }
        let minimum = self
            .targets
            .iter()
            .filter(|target| target.os == os)
            .filter_map(|target| target.minimum_version.clone())
            .min_by(|a, b| version(a).cmp(&version(b)));
        let root = crate::apple_root();
        Some(if os == "ios" {
            let sdk = std::env::var("NTS_IOS_SIMULATOR_SDK")
                .map_or_else(|_| root.join("iPhoneSimulator.sdk"), Utf8PathBuf::from);
            Platform {
                sdk,
                triple: format!(
                    "x86_64-apple-ios{}-simulator",
                    minimum.as_deref().unwrap_or("13.0")
                ),
            }
        } else {
            let sdk = std::env::var("NTS_APPLE_SDK")
                .map_or_else(|_| root.join("MacOSX.sdk"), Utf8PathBuf::from);
            Platform {
                sdk,
                triple: format!("x86_64-apple-macos{}", minimum.as_deref().unwrap_or("11.0")),
            }
        })
    }
}

struct Platform {
    sdk: Utf8PathBuf,
    triple: String,
}

/// The C frameworks, whose headers C includes and whose binding names them
/// (`@ntsHeader`): Foundation is not one, and cannot be read beside them.
const C_FRAMEWORKS: &[&str] = &[
    "CoreFoundation",
    "CoreGraphics",
    "CoreText",
    "CoreVideo",
    "CoreMedia",
    "ImageIO",
];

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
    text.split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

/// The `objc:` module a complaint says cannot be found -- TypeScript's
/// `Cannot find module 'objc:AppKit' or its corresponding type declarations.`
/// (2307) -- by the name after the prefix.
fn missing_module(complaint: &Complaint) -> Option<&str> {
    if complaint.code != 2307 {
        return None;
    }
    complaint.text.split_once("'objc:")?.1.split('\'').next()
}

/// The member and the class a complaint says lacks it: TypeScript's
/// `Property 'x' does not exist on type 'UINavigationBar'.` (2339), and its
/// `Did you mean` sibling (2551).
fn missing_member_of(complaint: &Complaint) -> Option<(&str, &str)> {
    if !matches!(complaint.code, 2339 | 2551) {
        return None;
    }
    let member = complaint
        .text
        .strip_prefix("Property '")?
        .split('\'')
        .next()?;
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
        let _ = write!(
            text,
            "{}|{}|{}|{}|",
            request.module,
            request.frameworks.join(","),
            request.names.join(","),
            request.target
        );
        // What the platform provides changes what the binding declares.
        let _ = write!(text, "{:?}|{:?}|", request.provided, request.records);
        let settings =
            std::fs::read(Utf8Path::new(&request.sdk).join("SDKSettings.json")).unwrap_or_default();
        let _ = writeln!(text, "{}|{}", request.sdk, fnv(&settings));
        // A project's header, and every header beside it that it may import:
        // an edit to one is a new binding.
        if let Some(project) = &request.project {
            let _ = writeln!(
                text,
                "{}|{:016x}",
                project.header.display(),
                headers_fingerprint(&project.search)
            );
        }
    }
    let compiler = std::env::current_exe()
        .and_then(std::fs::metadata)
        .map(|meta| format!("{}{:?}", meta.len(), meta.modified().ok()))
        .unwrap_or_default();
    format!("{:016x}", fnv(format!("{text}{compiler}").as_bytes()))
}

/// The files in `dir` with one of `extensions`.
fn listed(dir: &Utf8Path, extensions: &[&str]) -> Vec<Utf8PathBuf> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extensions.contains(&extension))
        })
        .collect()
}

/// Every `.swift` in `dir`, sorted: one module's sources.
pub(crate) fn swift_sources(dir: &Utf8Path) -> Vec<std::path::PathBuf> {
    let mut sources: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "swift")
        })
        .collect();
    sources.sort();
    sources
}

/// A library that is binary frameworks, bound from their headers: an umbrella
/// importing each framework's own umbrella header (`<Beep/Beep.h>`) from the
/// slice for `platform`, with each slice's directory on the framework path.
fn framework_module(
    project: &Utf8Path,
    module: &str,
    frameworks: &[Utf8PathBuf],
    platform: &Platform,
) -> anyhow::Result<bind_objc::Project> {
    let (arch, rest) = platform
        .triple
        .split_once("-apple-")
        .ok_or_else(|| anyhow::anyhow!("`{}` is not an Apple target", platform.triple))?;
    let os = if rest.starts_with("ios") {
        "ios"
    } else {
        "macos"
    };
    let slice = crate::xcframework::Slice {
        platform: os,
        simulator: rest.ends_with("-simulator"),
        arch,
    };
    let mut text = String::new();
    let mut search = Vec::new();
    for framework in frameworks {
        let chosen = crate::xcframework::framework_for(framework, slice)?;
        let name = chosen.file_stem().unwrap_or(module);
        if !chosen.join("Headers").join(format!("{name}.h")).is_file() {
            anyhow::bail!(
                "{chosen} has no umbrella header, `Headers/{name}.h`, which is what a program imports from it"
            );
        }
        let _ = writeln!(text, "#import <{name}/{name}.h>");
        search.extend(
            chosen
                .parent()
                .map(|directory| directory.to_path_buf().into_std_path_buf()),
        );
    }
    let umbrella = project
        .join(".nts")
        .join("libraries")
        .join(format!("{module}.h"));
    if std::fs::read_to_string(&umbrella).ok().as_deref() != Some(text.as_str()) {
        std::fs::create_dir_all(umbrella.parent().unwrap_or(project))?;
        std::fs::write(&umbrella, text)?;
    }
    Ok(bind_objc::Project {
        header: umbrella.into_std_path_buf(),
        search: Vec::new(),
        frameworks: search,
        symbols: std::path::PathBuf::new(),
        runtime_names: BTreeMap::new(),
    })
}

/// The Objective-C header Swift writes for the module of `sources`, as an
/// Objective-C client reads it, under `.nts/swift/<module>/<fingerprint>`:
/// written again only when a source changes, and the one before it removed.
/// With the names the runtime has its classes and protocols under.
fn swift_header(
    project: &Utf8Path,
    module: &str,
    sources: &[std::path::PathBuf],
    headers: &[std::path::PathBuf],
    search: &[std::path::PathBuf],
    imports: &[crate::swift::Clang<'_>],
    platform: &Platform,
) -> anyhow::Result<(Utf8PathBuf, BTreeMap<String, String>)> {
    let mut bytes = Vec::new();
    // The module's Objective-C too, and what it imports, which its Swift is
    // compiled against.
    for source in sources
        .iter()
        .chain(headers)
        .chain(imports.iter().flat_map(|import| import.headers))
    {
        bytes.extend(source.to_string_lossy().as_bytes());
        bytes.extend(std::fs::read(source).unwrap_or_default());
    }
    bytes.extend(platform.triple.as_bytes());
    // And this compiler, which decides what is kept of the header.
    let compiler = std::env::current_exe()
        .and_then(std::fs::metadata)
        .map(|meta| format!("{}{:?}", meta.len(), meta.modified().ok()))
        .unwrap_or_default();
    bytes.extend(compiler.as_bytes());
    let modules = project.join(".nts").join("swift").join(module);
    let keep = format!("{:016x}", fnv(&bytes));
    let header = modules.join(&keep).join(format!("{module}-Swift.h"));
    if !header.is_file() {
        std::fs::create_dir_all(modules.join(&keep))?;
        let written = modules
            .join(&keep)
            .join(format!("{module}-Swift.written.h"));
        let target = crate::swift::Target {
            sdk: platform.sdk.as_std_path(),
            triple: &platform.triple,
        };
        crate::swift::toolchain()?.objc_header(
            &crate::swift::Module {
                name: module,
                sources,
                headers,
                search,
                imports,
            },
            target,
            written.as_std_path(),
        )?;
        std::fs::write(&header, as_objc_client(&std::fs::read_to_string(&written)?))?;
    }
    for entry in std::fs::read_dir(&modules).into_iter().flatten().flatten() {
        if entry.file_name().to_str() != Some(keep.as_str()) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
    let runtime_names = runtime_names(&std::fs::read_to_string(&header)?);
    Ok((header, runtime_names))
}

/// The header Swift writes, as an Objective-C client reads it. Swift marks
/// each declaration its own (`external_source_symbol(language="Swift")`), by
/// a pragma pushed around them, and the importer leaves a declaration so
/// marked out of the module's graph: it is Swift's, which Swift has already.
/// What remains is what any Objective-C client of the module compiles against.
fn as_objc_client(written: &str) -> String {
    let mut out = String::with_capacity(written.len());
    let mut pending = 0usize;
    for line in written.lines() {
        let trimmed = line.trim_start_matches(['#', ' ']);
        if trimmed.starts_with("pragma clang attribute push(__attribute__((external_source_symbol(")
        {
            pending += 1;
            continue;
        }
        if pending > 0 && trimmed == "pragma clang attribute pop" {
            pending -= 1;
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// The runtime name of each class and protocol the header declares where it
/// is not the declaration's own: `SWIFT_CLASS("_TtC7Greeter7Greeter")` above
/// `@interface Greeter`. A `_NAMED` one is registered under its own name.
fn runtime_names(header: &str) -> BTreeMap<String, String> {
    let mut names = BTreeMap::new();
    let mut runtime: Option<&str> = None;
    for line in header.lines().map(str::trim) {
        if let Some(rest) = line
            .strip_prefix("SWIFT_CLASS(\"")
            .or_else(|| line.strip_prefix("SWIFT_PROTOCOL(\""))
            .or_else(|| line.strip_prefix("SWIFT_RESILIENT_CLASS(\""))
        {
            runtime = rest.split('"').next();
            continue;
        }
        let declared = line
            .strip_prefix("@interface ")
            .or_else(|| line.strip_prefix("@protocol "));
        if let (Some(runtime), Some(declared)) = (runtime.take(), declared) {
            let name: String = declared
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if name != runtime {
                names.insert(name, runtime.to_owned());
            }
        }
    }
    names
}

/// The contents of every `.h` in `directories`, in a stable order.
fn headers_fingerprint(directories: &[std::path::PathBuf]) -> u64 {
    let mut headers: Vec<std::path::PathBuf> = directories
        .iter()
        .filter_map(|directory| std::fs::read_dir(directory).ok())
        .flat_map(|entries| entries.flatten().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "h"))
        .collect();
    headers.sort();
    let mut bytes = Vec::new();
    for header in headers {
        bytes.extend(header.to_string_lossy().as_bytes());
        bytes.extend(std::fs::read(&header).unwrap_or_default());
    }
    fnv(&bytes)
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Every keyed directory but the current one: an old binding is never read
/// again, and each is a framework's worth of text.
fn prune(store: &Utf8Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(store) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if entry.path().is_dir() && name.to_str() != Some(keep) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn read_reached(store: &Utf8Path) -> BTreeMap<String, BTreeSet<String>> {
    std::fs::read(store.join("names.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
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
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_member_names_its_class() {
        let complaint = |code, text: &str| Complaint {
            code,
            text: text.to_owned(),
        };
        assert_eq!(
            missing_member_of(&complaint(
                2339,
                "Property 'topItem' does not exist on type 'UINavigationBar'."
            )),
            Some(("topItem", "UINavigationBar"))
        );
        assert_eq!(
            missing_member_of(&complaint(
                2551,
                "Property 'tittle' does not exist on type 'NSArray<NSView>'. Did you mean 'title'?"
            )),
            Some(("tittle", "NSArray"))
        );
        assert_eq!(
            missing_member_of(&complaint(
                2322,
                "Type 'string' is not assignable to type 'number'."
            )),
            None
        );
    }

    #[test]
    fn a_binding_names_its_stubs() {
        let binding = "  /** Named by a signature here, and not bound: its ancestors' members only.\n   * @ntsClass UINavigationBar */\n  export class UINavigationBar extends UIView {}\n\
                       export class UIWindow extends UIView {\n  }\n";
        assert_eq!(
            stubs(binding),
            ["UINavigationBar".to_owned()].into_iter().collect()
        );
    }

    /// A header or Swift source of the project's changes the identity: a
    /// snapshot cached under the old one would answer the build with the
    /// bindings of the old header, and the generator would never be asked.
    #[test]
    fn a_changed_native_source_changes_the_identity() {
        use nts_frontend_ts::tsgo::generated::Generated as _;
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-objc-identity-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bindings =
            ObjcBindings::new(Vec::new(), vec![dir.clone()], dir.clone(), BTreeMap::new());
        std::fs::write(dir.join("Greeter.h"), "@interface Greeter\n@end\n").unwrap();
        let before = bindings.identity();
        assert_eq!(
            bindings.identity(),
            before,
            "the identity of unchanged sources is stable"
        );
        std::fs::write(
            dir.join("Greeter.h"),
            "@interface Greeter\n- (void)wave;\n@end\n",
        )
        .unwrap();
        let header = bindings.identity();
        assert_ne!(header, before, "an edited header kept the identity");
        std::fs::write(dir.join("Greeter.swift"), "").unwrap();
        assert_ne!(
            bindings.identity(),
            header,
            "a new Swift source kept the identity"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
