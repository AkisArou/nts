//! Platform type surfaces: packages of declarations a binder generates, and
//! the store they are kept in (`docs/nts-config.md` 3a).
//!
//! Every lane binds a platform the same way -- the macOS SDK, Win32 metadata,
//! GIR -- and differs only in its generator. So a generator implements
//! [`Binder`], and everything else is here, once: where packages are written,
//! when they are written again, how a package says it is a surface, and how a
//! project sees one. A build, `--watch` and a language server all go through
//! this, and none of them knows which platform it is.
//!
//! **A package is declarations only.** A surface's code -- Swift's `async`
//! forms, GIR's checked casts -- must be lowered, and nothing under
//! `node_modules` is, so it is kept beside the packages as a values file.
//!
//! **A package is checked where it is made, not where it is used.** Each
//! `index.d.ts` begins with `// @ts-nocheck`, so neither a build nor an
//! editor type-checks a framework's declarations again for every program
//! that names it: on a program naming `AppKit` that was an eighth of the
//! frontend. What a binder generates must typecheck, and its tests say so
//! (`apple_surface`'s `the_platform_packages_typecheck`). The pragma silences
//! only diagnostics; the declarations bind and merge as before.

use std::fmt::Write as _;

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};

/// What a package declares itself to be, in its `package.json` (`"nts": {
/// "surface": "objc" }`): the family of the modules it declares, which the
/// frontend reads it for. The same closed set the frontend accepts
/// (`nts_frontend_ts::tsgo::SURFACES`), which a test compares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Objc,
    Gobject,
    Winrt,
    Win32,
    Java,
    C,
}

impl Surface {
    pub const ALL: [Self; 6] = [Self::Objc, Self::Gobject, Self::Winrt, Self::Win32, Self::Java, Self::C];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Objc => "objc",
            Self::Gobject => "gobject",
            Self::Winrt => "winrt",
            Self::Win32 => "win32",
            Self::Java => "java",
            Self::C => "c",
        }
    }
}

/// One package a binder generates: `@nts/apple-appkit`, the declarations of
/// the modules it provides, and the values file its code is in, if any.
#[derive(Debug, Clone)]
pub struct Package {
    /// The package's name, scoped: `@nts/apple-appkit`.
    pub name: String,
    pub surface: Surface,
    /// Its `index.d.ts`.
    pub declarations: String,
    /// Code the declarations name, which is lowered: a file name and its text.
    pub values: Option<(String, String)>,
}

/// A generator of a platform's packages.
pub trait Binder {
    /// What is generated, as one line: the store's directory for it.
    /// `apple-macos macosx26.5 x86_64-apple-macos13.0`.
    fn identity(&self) -> String;

    /// The generator's own version: changed packages, for the same identity.
    /// It keys the store and does not name it, so the packages an older
    /// generator made are replaced and pruned rather than kept beside the new.
    fn version(&self) -> String;

    /// The files whose contents decide the packages: an SDK's settings, the
    /// symbol graphs, a lockfile. What a store is keyed by, and what a
    /// watcher watches.
    fn inputs(&self) -> Vec<Utf8PathBuf>;

    /// The packages, generated.
    ///
    /// # Errors
    /// Why they could not be, said to the person building.
    fn generate(&self) -> Result<Vec<Package>>;
}

/// Packages a store holds for one binder's key: where each package is, and
/// the values files beside them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installed {
    /// Each package's name and directory.
    pub packages: Vec<(String, Utf8PathBuf)>,
    pub values: Vec<Utf8PathBuf>,
}

impl Installed {
    /// Every file a program holds for these packages: each package's
    /// declarations, then the values files.
    #[must_use]
    pub fn files(&self) -> Vec<Utf8PathBuf> {
        self.packages.iter().map(|(_, dir)| dir.join("index.d.ts")).chain(self.values.iter().cloned()).collect()
    }
}

/// Where generated packages are kept: one directory per binder identity and
/// key, written whole or not at all.
#[derive(Debug, Clone)]
pub struct Store {
    root: Utf8PathBuf,
}

impl Store {
    #[must_use]
    pub const fn new(root: Utf8PathBuf) -> Self {
        Self { root }
    }

    /// `~/.cache/nts/types`, or `NTS_TYPES_ROOT`.
    #[must_use]
    pub fn default_root() -> Utf8PathBuf {
        if let Ok(root) = std::env::var("NTS_TYPES_ROOT") {
            return Utf8PathBuf::from(root);
        }
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_owned());
        Utf8PathBuf::from(home).join(".cache/nts/types")
    }

    /// The packages `binder` makes, generated only when the store has no
    /// complete set for its identity and inputs.
    ///
    /// # Errors
    /// The binder's, or the filesystem's.
    pub fn ensure(&self, binder: &dyn Binder) -> Result<Installed> {
        let directory = self.root.join(slug(&binder.identity())).join(key(binder));
        let manifest = directory.join("manifest.json");
        if let Ok(installed) = read_manifest(&manifest, &directory) {
            return Ok(installed);
        }
        let packages = binder.generate()?;
        // Written beside, then moved into place: a store is complete or absent,
        // never half of one a build then reads.
        let partial = directory.with_extension(format!("partial-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&partial);
        write_packages(&partial, &packages)?;
        let _ = std::fs::remove_dir_all(&directory);
        let identity = directory.parent().unwrap_or(&self.root);
        std::fs::create_dir_all(identity)?;
        std::fs::rename(&partial, &directory).with_context(|| format!("moving {partial} to {directory}"))?;
        // What this identity was generated for before its inputs changed is
        // stale, and nothing asks for it again: a project still linked to it
        // relinks on its next build. Another identity -- another SDK -- is
        // left alone, since another project may be building for it.
        for entry in std::fs::read_dir(identity)?.flatten() {
            if entry.path() != directory.as_std_path() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
        read_manifest(&manifest, &directory)
    }
}

/// The first line of every package's declarations: see the module's header.
pub const NOCHECK: &str = "// @ts-nocheck";

/// Link each package into `project`'s `node_modules`, where an editor and
/// plain `tsc` find it through `"types"`, replacing a link to an older one.
///
/// # Errors
/// The filesystem's.
pub fn link(installed: &Installed, project: &Utf8Path) -> Result<()> {
    for (name, dir) in &installed.packages {
        let at = project.join("node_modules").join(name);
        if std::fs::read_link(&at).is_ok_and(|target| target == dir.as_std_path()) {
            continue;
        }
        if let Some(parent) = at.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if at.symlink_metadata().is_ok() {
            std::fs::remove_file(&at).or_else(|_| std::fs::remove_dir_all(&at)).with_context(|| format!("replacing {at}"))?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir, &at).with_context(|| format!("linking {at} to {dir}"))?;
        #[cfg(not(unix))]
        bail!("linking a platform package into {project} is not implemented on this host");
    }
    Ok(())
}

fn write_packages(directory: &Utf8Path, packages: &[Package]) -> Result<()> {
    let mut listed = Vec::new();
    let mut values = Vec::new();
    for package in packages {
        let Some(short) = package.name.strip_prefix("@nts/") else {
            bail!("a surface package is named `@nts/...`, and `{}` is not", package.name);
        };
        let dir = directory.join("node_modules/@nts").join(short);
        std::fs::create_dir_all(&dir)?;
        let manifest = format!(
            "{{\n  \"name\": {:?},\n  \"version\": \"0.0.0\",\n  \"types\": \"index.d.ts\",\n  \"nts\": {{ \"surface\": {:?} }}\n}}\n",
            package.name,
            package.surface.as_str()
        );
        std::fs::write(dir.join("package.json"), manifest)?;
        std::fs::write(dir.join("index.d.ts"), format!("{NOCHECK}\n{}", package.declarations))?;
        listed.push(format!("{:?}", package.name));
        if let Some((file, text)) = &package.values {
            std::fs::create_dir_all(directory.join("values"))?;
            std::fs::write(directory.join("values").join(file), text)?;
            values.push(format!("{file:?}"));
        }
    }
    let text = format!("{{\n  \"packages\": [{}],\n  \"values\": [{}]\n}}\n", listed.join(", "), values.join(", "));
    std::fs::write(directory.join("manifest.json"), text)?;
    Ok(())
}

fn read_manifest(manifest: &Utf8Path, directory: &Utf8Path) -> Result<Installed> {
    let text = std::fs::read_to_string(manifest)?;
    let value: serde_json::Value = serde_json::from_str(&text)?;
    let strings = |field: &str| -> Vec<String> {
        value.get(field).and_then(serde_json::Value::as_array).map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect()).unwrap_or_default()
    };
    let packages = strings("packages")
        .into_iter()
        .map(|name| {
            let short = name.trim_start_matches("@nts/").to_owned();
            (name, directory.join("node_modules/@nts").join(short))
        })
        .collect();
    let values = strings("values").into_iter().map(|file| directory.join("values").join(file)).collect();
    Ok(Installed { packages, values })
}

/// A binder's key: its identity, its version, and each input's path, size and time, which
/// change whenever the input does, without reading it.
fn key(binder: &dyn Binder) -> String {
    let mut text = format!("{}|{}", binder.identity(), binder.version());
    for input in binder.inputs() {
        let meta = std::fs::metadata(&input).ok();
        let _ = write!(text, "|{input}|{:?}|{:?}", meta.as_ref().map(std::fs::Metadata::len), meta.and_then(|m| m.modified().ok()));
    }
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3));
    format!("{hash:016x}")
}

/// An identity as a directory name.
fn slug(identity: &str) -> String {
    identity.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// The surfaces a package may declare are the ones the frontend reads a
    /// package for: two lists of one fact.
    #[test]
    fn the_surfaces_are_the_frontends() {
        let ours: Vec<&str> = Surface::ALL.iter().map(|surface| surface.as_str()).collect();
        assert_eq!(ours, nts_frontend_ts::tsgo::SURFACES);
    }

    struct Counting(std::cell::Cell<u32>, Utf8PathBuf, std::cell::Cell<u32>);

    impl Binder for Counting {
        fn identity(&self) -> String {
            "test surface".to_owned()
        }
        fn version(&self) -> String {
            self.2.get().to_string()
        }
        fn inputs(&self) -> Vec<Utf8PathBuf> {
            vec![self.1.clone()]
        }
        fn generate(&self) -> Result<Vec<Package>> {
            self.0.set(self.0.get() + 1);
            Ok(vec![Package {
                name: "@nts/test-one".to_owned(),
                surface: Surface::Objc,
                declarations: "declare module \"objc:One\" {}\n".to_owned(),
                values: Some(("one.values.ts".to_owned(), "export const one = 1;\n".to_owned())),
            }])
        }
    }

    /// A store generates once per key, again when an input changes, and a
    /// package it writes says what surface it is.
    #[test]
    fn a_store_generates_once_per_input() {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-surfaces-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("input.txt");
        std::fs::write(&input, "a").unwrap();
        let binder = Counting(std::cell::Cell::new(0), input.clone(), std::cell::Cell::new(1));
        let store = Store::new(root.join("store"));
        let first = store.ensure(&binder).unwrap();
        let again = store.ensure(&binder).unwrap();
        assert_eq!(first, again);
        assert_eq!(binder.0.get(), 1, "a second ensure generated again");
        let manifest = std::fs::read_to_string(first.packages[0].1.join("package.json")).unwrap();
        assert!(manifest.contains("\"surface\": \"objc\""), "{manifest}");
        let declarations = std::fs::read_to_string(first.packages[0].1.join("index.d.ts")).unwrap();
        assert!(declarations.starts_with("// @ts-nocheck\ndeclare module"), "{declarations}");
        assert!(first.files().iter().all(|file| file.is_file()), "{first:?}");
        std::fs::write(&input, "changed").unwrap();
        let second = store.ensure(&binder).unwrap();
        assert_eq!(binder.0.get(), 2, "a changed input did not generate again");
        assert!(!first.packages[0].1.exists(), "the packages the changed input superseded were kept");
        assert!(second.files().iter().all(|file| file.is_file()), "{second:?}");
        // A new generator for the same identity replaces what the old one
        // made, in the same identity's directory.
        binder.2.set(2);
        let third = store.ensure(&binder).unwrap();
        assert_eq!(binder.0.get(), 3, "a changed generator did not generate again");
        assert!(!second.packages[0].1.exists(), "the packages the old generator made were kept");
        let identities = std::fs::read_dir(root.join("store")).unwrap().count();
        assert_eq!(identities, 1, "a generator version made an identity of its own");
        assert!(third.files().iter().all(|file| file.is_file()), "{third:?}");
        let project = root.join("project");
        link(&third, &project).unwrap();
        link(&third, &project).unwrap();
        assert!(project.join("node_modules/@nts/test-one/index.d.ts").is_file());
    }
}
