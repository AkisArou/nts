//! A binary framework a library ships instead of sources -- a pod's
//! `vendored_frameworks` -- and the slice of it one target links.
//!
//! An `.xcframework` is a directory of slices, one per platform and variant,
//! each a `.framework` (or a library) built for some architectures, and its
//! `Info.plist` says which is which: `AvailableLibraries`, each with a
//! `LibraryIdentifier` (the slice's directory), a `LibraryPath` (the
//! framework inside it), a `SupportedPlatform` (`macos`, `ios`), an optional
//! `SupportedPlatformVariant` (`simulator`), and `SupportedArchitectures`.
//! Xcode picks the slice the same way, from the same keys. A bare
//! `.framework` is one slice already.

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};

/// What a target is, as an `.xcframework`'s `Info.plist` names platforms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Slice<'a> {
    /// `macos` or `ios`.
    pub(crate) platform: &'a str,
    /// The iOS simulator, which is a variant of `ios`.
    pub(crate) simulator: bool,
    /// `x86_64` or `arm64`, as Apple spells them.
    pub(crate) arch: &'a str,
}

/// The `.framework` of `framework` that `slice` links: the framework itself
/// where it is one, else the `.xcframework` slice the plist says fits.
pub(crate) fn framework_for(framework: &Utf8Path, slice: Slice<'_>) -> Result<Utf8PathBuf> {
    if framework.extension() == Some("framework") {
        return Ok(framework.to_path_buf());
    }
    let plist = framework.join("Info.plist");
    let text = std::fs::read_to_string(&plist).with_context(|| format!("reading {plist}"))?;
    let libraries = available_libraries(&text).with_context(|| format!("reading {plist}"))?;
    let fits = libraries.iter().find(|library| {
        library.platform == slice.platform
            && library.variant.as_deref() == slice.simulator.then_some("simulator")
            && library.architectures.iter().any(|arch| arch == slice.arch)
    });
    let Some(library) = fits else {
        bail!(
            "{framework} has no slice for {}{} {}: it has {}",
            slice.platform,
            if slice.simulator { " simulator" } else { "" },
            slice.arch,
            libraries
                .iter()
                .map(|library| library.identifier.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    Ok(framework.join(&library.identifier).join(&library.path))
}

/// One entry of `AvailableLibraries`.
#[derive(Debug, PartialEq, Eq)]
struct Library {
    identifier: String,
    path: String,
    platform: String,
    variant: Option<String>,
    architectures: Vec<String>,
}

/// `AvailableLibraries`, from an XML property list: a `dict` of `key` and
/// value pairs, whose value here is a `string` or an `array` of them.
fn available_libraries(text: &str) -> Result<Vec<Library>> {
    // Every Apple plist names its DTD, which roxmltree refuses unless asked.
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..roxmltree::ParsingOptions::default()
    };
    let document = roxmltree::Document::parse_with_options(text, options)
        .context("an Info.plist that is not XML (a binary plist is not read)")?;
    let root = document
        .root_element()
        .children()
        .find(roxmltree::Node::is_element)
        .context("an empty plist")?;
    let libraries = value_of(root, "AvailableLibraries").context("no AvailableLibraries")?;
    let mut found = Vec::new();
    for entry in libraries
        .children()
        .filter(|node| node.has_tag_name("dict"))
    {
        let string = |key: &str| {
            value_of(entry, key)
                .and_then(|node| node.text())
                .map(str::to_owned)
        };
        found.push(Library {
            identifier: string("LibraryIdentifier")
                .context("a library with no LibraryIdentifier")?,
            path: string("LibraryPath").context("a library with no LibraryPath")?,
            platform: string("SupportedPlatform").context("a library with no SupportedPlatform")?,
            variant: string("SupportedPlatformVariant"),
            architectures: value_of(entry, "SupportedArchitectures")
                .map(|array| {
                    array
                        .children()
                        .filter_map(|node| node.text())
                        .map(str::trim)
                        .filter(|arch| !arch.is_empty())
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    Ok(found)
}

/// The element after `<key>{key}</key>` in `dict`.
fn value_of<'a, 'i>(dict: roxmltree::Node<'a, 'i>, key: &str) -> Option<roxmltree::Node<'a, 'i>> {
    let mut children = dict.children().filter(roxmltree::Node::is_element);
    while let Some(node) = children.next() {
        if node.has_tag_name("key") && node.text() == Some(key) {
            return children.next();
        }
    }
    None
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AvailableLibraries</key>
	<array>
		<dict>
			<key>LibraryIdentifier</key>
			<string>macos-arm64_x86_64</string>
			<key>LibraryPath</key>
			<string>Beep.framework</string>
			<key>SupportedArchitectures</key>
			<array>
				<string>arm64</string>
				<string>x86_64</string>
			</array>
			<key>SupportedPlatform</key>
			<string>macos</string>
		</dict>
		<dict>
			<key>LibraryIdentifier</key>
			<string>ios-arm64_x86_64-simulator</string>
			<key>LibraryPath</key>
			<string>Beep.framework</string>
			<key>SupportedArchitectures</key>
			<array>
				<string>arm64</string>
				<string>x86_64</string>
			</array>
			<key>SupportedPlatform</key>
			<string>ios</string>
			<key>SupportedPlatformVariant</key>
			<string>simulator</string>
		</dict>
	</array>
	<key>CFBundlePackageType</key>
	<string>XFWK</string>
	<key>XCFrameworkFormatVersion</key>
	<string>1.0</string>
</dict>
</plist>
"#;

    /// A slice is the platform, the variant and the architecture together:
    /// the simulator's is not the device's, and macOS's is neither.
    #[test]
    fn the_slice_is_the_platform_variant_and_architecture() {
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-xcframework-{}", std::process::id()))
            .join("Beep.xcframework");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Info.plist"), PLIST).unwrap();
        let mac = framework_for(
            &dir,
            Slice {
                platform: "macos",
                simulator: false,
                arch: "x86_64",
            },
        )
        .unwrap();
        assert_eq!(mac, dir.join("macos-arm64_x86_64/Beep.framework"));
        let simulator = framework_for(
            &dir,
            Slice {
                platform: "ios",
                simulator: true,
                arch: "x86_64",
            },
        )
        .unwrap();
        assert_eq!(
            simulator,
            dir.join("ios-arm64_x86_64-simulator/Beep.framework")
        );
        let device = framework_for(
            &dir,
            Slice {
                platform: "ios",
                simulator: false,
                arch: "arm64",
            },
        )
        .unwrap_err()
        .to_string();
        assert!(device.contains("no slice for ios arm64"), "{device}");
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }
}
