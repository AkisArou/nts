//! Where the Swift toolchain is: the one directory both the build's own
//! readers (`dependencies::swiftpm`, which runs `swift-package`) and the CLI's
//! compiles look in.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// The toolchain `NTS_SWIFT_TOOLCHAIN` names -- the directory a Swift release
/// unpacks to, holding `usr/` -- else the newest under `~/.cache/nts/swift`.
///
/// # Errors
///
/// No toolchain named, and none unpacked there.
pub fn toolchain_root() -> Result<PathBuf> {
    if let Some(named) = std::env::var_os("NTS_SWIFT_TOOLCHAIN") {
        return Ok(PathBuf::from(named));
    }
    newest_cached().context(
        "this needs a Swift toolchain, which reads Swift's names and compiles and reads Swift: unpack \
         swift.org's Linux release matching the SDK's Swift (its \
         `usr/lib/swift/Swift.swiftmodule/*.swiftinterface` says which) under ~/.cache/nts/swift, or \
         name one with NTS_SWIFT_TOOLCHAIN",
    )
}

fn newest_cached() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let cache = Path::new(&home).join(".cache").join("nts").join("swift");
    let mut found: Vec<PathBuf> = std::fs::read_dir(&cache)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.join("usr")
                .join("bin")
                .join("swift-frontend")
                .is_file()
        })
        .collect();
    found.sort();
    found.pop()
}
