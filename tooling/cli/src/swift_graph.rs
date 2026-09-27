//! Swift's names for a project's own Objective-C header, extracted here.
//!
//! `nts bind-objc` takes every name from a Swift symbol graph -- `greet(withTimes:)`
//! for `-greetWithTimes:`, the `async` form of a completion handler -- rather
//! than reproducing the importer's rules. The SDK's frameworks have theirs,
//! fetched once per SDK (`tooling/apple/symbolgraph.sh`); a header the project
//! writes has none, and `nts build` never contacts a Mac. So it is extracted
//! on this machine, by the open-source Swift toolchain, against the synced SDK.
//!
//! Measured 2026-09-27: swift.org's Linux 6.3.2, the compiler the SDK's own
//! interfaces name, gives graphs identical to the Mac's -- every one of
//! `AppKit`'s 11221 Objective-C symbols, with the same Swift names.
//!
//! Two things the toolchain needs that its own layout gets wrong for an Apple
//! target: a resource directory without the Linux module maps beside the
//! stdlib's (its `dispatch/` redefines the SDK's `Dispatch`, and every
//! framework fails after it), and `SwiftShims` on the include path.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

/// The Swift toolchain graphs are extracted with.
pub(crate) struct Toolchain {
    /// `swift-symbolgraph-extract`: `swift-frontend` under the name that
    /// selects what it does.
    extract: PathBuf,
    /// A resource directory holding only what an Apple target reads from it.
    resource: PathBuf,
}

/// The toolchain `NTS_SWIFT_TOOLCHAIN` names -- the directory holding `usr/` --
/// else the newest under `~/.cache/nts/swift`.
pub(crate) fn toolchain() -> Result<Toolchain> {
    let root = match std::env::var_os("NTS_SWIFT_TOOLCHAIN") {
        Some(named) => PathBuf::from(named),
        None => newest_cached().context(
            "binding a project's Objective-C header needs Swift's names for it, which a Swift toolchain \
             extracts: unpack swift.org's Linux release matching the SDK's Swift (its \
             `usr/lib/swift/Swift.swiftmodule/*.swiftinterface` says which) under ~/.cache/nts/swift, \
             or name one with NTS_SWIFT_TOOLCHAIN",
        )?,
    };
    let usr = root.join("usr");
    let extract = usr.join("bin").join("swift-symbolgraph-extract");
    if !extract.is_file() {
        bail!("{} has no usr/bin/swift-symbolgraph-extract: NTS_SWIFT_TOOLCHAIN names the directory a Swift release unpacks to", root.display());
    }
    let resource = apple_resource(&root, &usr.join("lib").join("swift"))?;
    Ok(Toolchain { extract, resource })
}

fn newest_cached() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let cache = Path::new(&home).join(".cache").join("nts").join("swift");
    let mut found: Vec<PathBuf> = std::fs::read_dir(&cache)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.join("usr").join("bin").join("swift-symbolgraph-extract").is_file())
        .collect();
    found.sort();
    found.pop()
}

/// The toolchain's `shims` and `clang`, and not its Linux module maps: made
/// once per toolchain under `~/.cache/nts/swift-resource`, since the
/// toolchain's own directory may not be this user's to write.
fn apple_resource(root: &Path, swift: &Path) -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME is not set, and the Swift resource directory is kept under it")?;
    let name = root.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let path = root.to_string_lossy();
    let hash = path.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3));
    let resource = Path::new(&home).join(".cache").join("nts").join("swift-resource").join(format!("{name}-{hash:016x}"));
    for part in ["shims", "clang"] {
        let link = resource.join(part);
        if link.exists() {
            continue;
        }
        std::fs::create_dir_all(&resource).with_context(|| format!("creating {}", resource.display()))?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(swift.join(part), &link).with_context(|| format!("linking {}", link.display()))?;
        #[cfg(not(unix))]
        bail!("extracting a Swift graph is not implemented on this host");
    }
    Ok(resource)
}

/// What one extraction reads.
pub(crate) struct Extraction<'a> {
    /// The module the header is, `Greeter`: what `objc:Greeter` names.
    pub(crate) module: &'a str,
    pub(crate) header: &'a Path,
    /// Where its own imports are found.
    pub(crate) search: &'a [PathBuf],
    pub(crate) sdk: &'a Path,
    /// The clang target, `x86_64-apple-macos13`.
    pub(crate) target: &'a str,
}

impl Toolchain {
    /// `<module>.symbols.json` for `extraction`, into `out`: the header as a
    /// Clang module of its own, through a module map written there too,
    /// since a project's source tree is not the build's to write.
    pub(crate) fn extract(&self, extraction: &Extraction<'_>, out: &Path) -> Result<PathBuf> {
        let map = out.join("modulemap");
        std::fs::create_dir_all(&map).with_context(|| format!("creating {}", map.display()))?;
        let header = std::fs::canonicalize(extraction.header).with_context(|| format!("reading {}", extraction.header.display()))?;
        std::fs::write(
            map.join("module.modulemap"),
            format!("module {} {{\n  header {:?}\n  export *\n}}\n", extraction.module, header.display().to_string()),
        )?;
        let mut command = Command::new(&self.extract);
        command
            .args(["-module-name", extraction.module, "-target", extraction.target])
            .arg("-sdk")
            .arg(extraction.sdk)
            .arg("-resource-dir")
            .arg(&self.resource)
            .arg("-I")
            .arg(self.resource.join("shims"))
            .arg("-I")
            .arg(&map);
        for directory in extraction.search {
            command.arg("-I").arg(directory);
        }
        command.arg("-output-dir").arg(out).args(["-minimum-access-level", "private"]);
        let output = command.output().with_context(|| format!("running {}", self.extract.display()))?;
        let graph = out.join(format!("{}.symbols.json", extraction.module));
        if !output.status.success() || !graph.is_file() {
            bail!(
                "Swift could not read {} as module `{}`:\n{}",
                extraction.header.display(),
                extraction.module,
                String::from_utf8_lossy(&output.stderr).lines().filter(|line| line.contains("error")).take(12).collect::<Vec<_>>().join("\n")
            );
        }
        Ok(graph)
    }
}
