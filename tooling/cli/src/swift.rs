//! The Swift toolchain, on this machine, for Apple targets: Swift's names for a
//! project's own Objective-C header, and a project's own Swift, compiled.
//!
//! `nts bind-objc` takes every name from a Swift symbol graph -- `greet(withTimes:)`
//! for `-greetWithTimes:`, the `async` form of a completion handler -- rather
//! than reproducing the importer's rules. The SDK's frameworks have theirs,
//! fetched once per SDK (`tooling/apple/symbolgraph.sh`); a header the project
//! writes has none, and `nts build` never contacts a Mac. So it is extracted
//! here, by the open-source Swift toolchain, against the synced SDK.
//!
//! Measured 2026-09-27: swift.org's Linux 6.3.2, the compiler the SDK's own
//! interfaces name, gives graphs identical to the Mac's -- every one of
//! `AppKit`'s 11221 Objective-C symbols, with the same Swift names -- and
//! compiles an `@objc` class into a Mach-O object whose Objective-C header is
//! the one Xcode writes; linked with an Objective-C `main`, it ran on the Mac.
//!
//! What the toolchain needs that its own layout gets wrong for an Apple
//! target: a resource directory without the Linux module maps beside the
//! stdlib's (its `dispatch/` redefines the SDK's `Dispatch`, and every
//! framework fails after it), and `SwiftShims` on the include path. And a
//! module cache that outlives the build: the SDK's modules take 30 s to build,
//! and a compile against them, once they are built, 0.1 s.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

/// The Swift toolchain.
pub(crate) struct Toolchain {
    /// `swift-frontend`, which compiles.
    frontend: PathBuf,
    /// `swift-symbolgraph-extract`: the frontend under the name that selects
    /// what it does.
    extract: PathBuf,
    /// A resource directory holding only what an Apple target reads from it.
    resource: PathBuf,
    /// The modules the SDK's headers and interfaces are built into, kept.
    modules: PathBuf,
}

/// The toolchain `nts_build::swift` finds, set up for an Apple target.
pub(crate) fn toolchain() -> Result<Toolchain> {
    let root = nts_build::swift::toolchain_root()?;
    let bin = root.join("usr").join("bin");
    let (frontend, extract) = (bin.join("swift-frontend"), bin.join("swift-symbolgraph-extract"));
    if !frontend.is_file() || !extract.is_file() {
        bail!("{} has no usr/bin/swift-frontend: NTS_SWIFT_TOOLCHAIN names the directory a Swift release unpacks to", root.display());
    }
    let cache = kept(&root)?;
    let resource = apple_resource(&cache.join("resource"), &root.join("usr").join("lib").join("swift"))?;
    Ok(Toolchain { frontend, extract, resource, modules: cache.join("modules") })
}

/// What is kept for one toolchain, under `~/.cache/nts/swift-kept`, since the
/// toolchain's own directory may not be this user's to write.
fn kept(root: &Path) -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME is not set, and what the Swift toolchain keeps is kept under it")?;
    let name = root.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let hash = root.to_string_lossy().bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3));
    Ok(Path::new(&home).join(".cache").join("nts").join("swift-kept").join(format!("{name}-{hash:016x}")))
}

/// The toolchain's `shims` and `clang`, and not its Linux module maps.
fn apple_resource(resource: &Path, swift: &Path) -> Result<PathBuf> {
    for part in ["shims", "clang"] {
        let link = resource.join(part);
        if link.exists() {
            continue;
        }
        std::fs::create_dir_all(resource).with_context(|| format!("creating {}", resource.display()))?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(swift.join(part), &link).with_context(|| format!("linking {}", link.display()))?;
        #[cfg(not(unix))]
        bail!("the Swift toolchain is not supported on this host");
    }
    Ok(resource.to_path_buf())
}

/// The SDK and clang target a Swift command is for.
#[derive(Clone, Copy)]
pub(crate) struct Target<'a> {
    pub(crate) sdk: &'a Path,
    /// `x86_64-apple-macos13`, `arm64-apple-macos13`.
    pub(crate) triple: &'a str,
}

/// A project's header, read as a Clang module of its own.
pub(crate) struct Header<'a> {
    /// The module the header is, `Greeter`: what `objc:Greeter` names.
    pub(crate) module: &'a str,
    pub(crate) path: &'a Path,
    /// Where its own imports are found.
    pub(crate) search: &'a [PathBuf],
    /// Where the frameworks it imports are.
    pub(crate) frameworks: &'a [PathBuf],
}

/// A project's Swift: every `.swift` in one directory, one module, as a
/// `SwiftPM` target is.
pub(crate) struct Module<'a> {
    /// The module's name: the directory's, `Greeter`.
    pub(crate) name: &'a str,
    pub(crate) sources: &'a [PathBuf],
    /// The module's own Objective-C, where it has some -- a pod of both --
    /// as its public headers: the module Swift imports as its underlying
    /// one, as Xcode builds a target of both languages, so its Swift sees
    /// the Objective-C classes beside it without importing anything.
    pub(crate) headers: &'a [PathBuf],
    /// Where its headers', and its imports', own `#import`s are found.
    pub(crate) search: &'a [PathBuf],
    /// The C and Objective-C modules its Swift imports by name -- a
    /// `SwiftPM` target's dependencies, `import CShim` -- each a Clang module
    /// of its public headers.
    pub(crate) imports: &'a [Clang<'a>],
}

/// A C or Objective-C module Swift imports: its name and public headers.
pub(crate) struct Clang<'a> {
    pub(crate) name: &'a str,
    pub(crate) headers: &'a [PathBuf],
}

impl Toolchain {
    /// What a cache of this toolchain's output is keyed by: its frontend,
    /// by where it is and which build of it.
    pub(crate) fn identity(&self) -> String {
        let stamp = std::fs::metadata(&self.frontend).map(|meta| format!("{}{:?}", meta.len(), meta.modified().ok())).unwrap_or_default();
        format!("{} {stamp}", self.frontend.display())
    }

    /// The arguments every command for `target` takes.
    fn for_target(&self, command: &mut Command, target: Target<'_>) {
        command.args(["-target", target.triple]).arg("-sdk").arg(target.sdk);
        command.arg("-resource-dir").arg(&self.resource).arg("-I").arg(self.resource.join("shims"));
        command.arg("-module-cache-path").arg(&self.modules);
    }

    /// `<module>.symbols.json` for `header`, into `out`: the header as a
    /// Clang module of its own, through a module map written there too,
    /// since a project's source tree is not the build's to write.
    pub(crate) fn extract(&self, header: &Header<'_>, target: Target<'_>, out: &Path) -> Result<PathBuf> {
        let map = out.join("modulemap");
        std::fs::create_dir_all(&map).with_context(|| format!("creating {}", map.display()))?;
        let file = std::fs::canonicalize(header.path).with_context(|| format!("reading {}", header.path.display()))?;
        std::fs::write(map.join("module.modulemap"), format!("module {} {{\n  header {:?}\n  export *\n}}\n", header.module, file.display().to_string()))?;
        let mut command = Command::new(&self.extract);
        command.args(["-module-name", header.module]);
        self.for_target(&mut command, target);
        command.arg("-I").arg(&map);
        for directory in header.search {
            command.arg("-I").arg(directory);
        }
        for directory in header.frameworks {
            command.arg("-F").arg(directory);
        }
        command.arg("-output-dir").arg(out).args(["-minimum-access-level", "private"]);
        let graph = out.join(format!("{}.symbols.json", header.module));
        run(command, &graph, &format!("Swift could not read {} as module `{}`", header.path.display(), header.module))?;
        Ok(graph)
    }

    /// The Objective-C header Swift writes for `module`'s `@objc`
    /// declarations, `<Module>-Swift.h`: what the program's binding is read
    /// from, as another Objective-C client of the module reads it.
    pub(crate) fn objc_header(&self, module: &Module<'_>, target: Target<'_>, out: &Path) -> Result<()> {
        let mut command = self.frontend_for(module, target, out)?;
        command.arg("-typecheck").arg("-emit-objc-header-path").arg(out);
        run(command, out, &format!("Swift could not typecheck module `{}`", module.name))
    }

    /// `module` compiled into one object, as a whole module.
    pub(crate) fn compile(&self, module: &Module<'_>, target: Target<'_>, out: &Path) -> Result<()> {
        let mut command = self.frontend_for(module, target, out)?;
        command.arg("-c").arg("-O").arg("-o").arg(out);
        run(command, out, &format!("Swift could not compile module `{}` for {}", module.name, target.triple))
    }

    /// The frontend for `module`, and the module map of its Objective-C
    /// half beside `out` where it has one.
    fn frontend_for(&self, module: &Module<'_>, target: Target<'_>, out: &Path) -> Result<Command> {
        let mut command = Command::new(&self.frontend);
        command.arg("-frontend").args(["-module-name", module.name, "-parse-as-library"]);
        self.for_target(&mut command, target);
        if !module.headers.is_empty() {
            let map = module_map(out, module.name, module.headers)?;
            command.arg("-import-underlying-module").arg("-Xcc").arg(format!("-fmodule-map-file={}", map.display()));
        }
        for import in module.imports {
            let map = module_map(out, import.name, import.headers)?;
            command.arg("-Xcc").arg(format!("-fmodule-map-file={}", map.display()));
        }
        for directory in module.search {
            command.arg("-Xcc").arg(format!("-I{}", directory.display()));
        }
        command.args(module.sources);
        Ok(command)
    }
}

/// A module map of `headers` as the Clang module `name`, written beside `out`
/// -- the build's, since a checkout is not the build's to write into.
fn module_map(out: &Path, name: &str, headers: &[PathBuf]) -> Result<PathBuf> {
    let map = out.with_extension(format!("{name}.modulemap"));
    let mut text = format!("module {name} {{\n");
    for header in headers {
        let file = std::fs::canonicalize(header).with_context(|| format!("reading {}", header.display()))?;
        let _ = writeln!(text, "  header {:?}", file.display().to_string());
    }
    text.push_str("  export *\n}\n");
    std::fs::write(&map, text).with_context(|| format!("writing {}", map.display()))?;
    Ok(map)
}

/// Runs `command`, which must write `made`; its errors, where it does not.
fn run(mut command: Command, made: &Path, failed: &str) -> Result<()> {
    let _ = std::fs::remove_file(made);
    let output = command.output().with_context(|| format!("running {}", command.get_program().to_string_lossy()))?;
    if !output.status.success() || !made.exists() {
        let errors: Vec<&str> = std::str::from_utf8(&output.stderr).unwrap_or_default().lines().filter(|line| line.contains("error")).take(12).collect();
        bail!("{failed}:\n{}", errors.join("\n"));
    }
    Ok(())
}
