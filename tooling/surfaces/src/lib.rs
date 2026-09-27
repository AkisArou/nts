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
    /// It names a directory under the identity's, beside other versions':
    /// another worktree's `nts` is another version, and a project may be
    /// linked to its packages, so they stay while builds use them
    /// ([`Store::ensure`]).
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

/// Where generated packages are kept: one directory per binder identity,
/// version and inputs, written whole or not at all.
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
    /// complete set for its identity, version and inputs.
    ///
    /// Laid out `<identity>/<version>/<inputs>`. Several generators share one
    /// store -- every worktree's `nts` is its own version -- and each keeps
    /// only its own current entry: one for inputs that have since changed is
    /// stale and goes at once, but another version's is another binary's,
    /// which a project may be linked to right now. Evicting it made two
    /// binaries regenerate each other's packages on every build and left the
    /// other's projects linked to nothing. So a version is removed only once
    /// no build has used it for [`RETAIN`].
    ///
    /// # Errors
    /// The binder's, or the filesystem's.
    pub fn ensure(&self, binder: &dyn Binder) -> Result<Installed> {
        let identity = self.root.join(slug(&binder.identity()));
        let version = identity.join(slug(&binder.version()));
        let directory = version.join(fingerprint(&binder.inputs()));
        let manifest = directory.join("manifest.json");
        let installed = if let Ok(installed) = read_manifest(&manifest, &directory) {
            installed
        } else {
            let packages = binder.generate()?;
            // Written beside, then moved into place: a store is complete or
            // absent, never half of one a build then reads.
            let partial = directory.with_extension(format!("partial-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&partial);
            write_packages(&partial, &packages)?;
            let _ = std::fs::remove_dir_all(&directory);
            std::fs::rename(&partial, &directory).with_context(|| format!("moving {partial} to {directory}"))?;
            // This version's entry for inputs that have since changed: nothing
            // of this version asks for it again, and a project still linked
            // to it relinks on its next build.
            prune(&version, |entry| entry != directory.as_std_path());
            read_manifest(&manifest, &directory)?
        };
        touch(&version);
        let now = std::time::SystemTime::now();
        prune(&identity, |entry| {
            entry != version.as_std_path()
                && std::fs::metadata(entry)
                    .and_then(|meta| meta.modified())
                    .is_ok_and(|used| now.duration_since(used).is_ok_and(|idle| idle > RETAIN))
        });
        Ok(installed)
    }
}

/// How long a generator's packages outlive the last build that used them:
/// a worktree's `nts` idle for a week has been rebuilt or removed.
pub const RETAIN: std::time::Duration = std::time::Duration::from_hours(7 * 24);

/// Remove each entry of `directory` that `stale` names; a directory that
/// cannot be read has nothing to remove.
fn prune(directory: &Utf8Path, stale: impl Fn(&std::path::Path) -> bool) {
    for entry in std::fs::read_dir(directory).into_iter().flatten().flatten() {
        if stale(&entry.path()) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Mark `directory` as used now: its modification time is how long it has
/// been idle. Best effort -- a store that cannot be marked is still read.
fn touch(directory: &Utf8Path) {
    if let Ok(file) = std::fs::File::open(directory) {
        let _ = file.set_modified(std::time::SystemTime::now());
    }
}

/// The first line of every package's declarations: see the module's header.
pub const NOCHECK: &str = "// @ts-nocheck";

/// Link each package into `project`'s `node_modules`, where an editor and
/// plain `tsc` find it through `"types"`, replacing a link to an older one.
/// Answers the packages linked where none was: what a build tells the person
/// building, once, since their editor needs a line of config to see them.
///
/// # Errors
/// The filesystem's.
pub fn link(installed: &Installed, project: &Utf8Path) -> Result<Vec<String>> {
    let mut new = Vec::new();
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
        } else {
            new.push(name.clone());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir, &at).with_context(|| format!("linking {at} to {dir}"))?;
        #[cfg(not(unix))]
        bail!("linking a platform package into {project} is not implemented on this host");
    }
    Ok(new)
}

/// The config that opens the project at `tsconfig` with `files` added --
/// an installed platform's files -- written beside it as
/// `tsconfig.<lane>.json`: it `extends` the project's, whose `include` it
/// keeps, and lists `files` besides.
///
/// **Beside the project's own config, and nowhere else.** A config may spell
/// a path `${configDir}/src/...`, and TypeScript reads `${configDir}` as the
/// directory of the config it opened -- this one. A wrapper under `.nts/`
/// moved every such path: react-gtk binds its renderer fork that way, and the
/// reconciler found no host config, so nothing imported the program's and it
/// was published as an entry. Each lane writes its own file name, since a
/// project may be two lanes'.
///
/// # Errors
/// The filesystem's.
pub fn wrapper(tsconfig: &Utf8Path, lane: &str, files: &[Utf8PathBuf]) -> Result<Utf8PathBuf> {
    let project = tsconfig.parent().unwrap_or_else(|| Utf8Path::new("."));
    let config = project.join(format!("tsconfig.{lane}.json"));
    let listed: Vec<String> = files.iter().map(|file| format!("{:?}", file.as_str())).collect();
    let text = format!("{{\n  \"extends\": {:?},\n  \"files\": [{}]\n}}\n", tsconfig.as_str(), listed.join(", "));
    std::fs::write(&config, text).with_context(|| format!("writing {config}"))?;
    Ok(config)
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

/// A hash of files' paths, sizes and modification times, which changes whenever one of them
/// does, without reading any; a missing file hashes as missing. The store keys an entry on its
/// binder's inputs this way, and a `Generated` hook in front of the store keys the snapshot
/// cache on it too: an identity that leaves the inputs out lets a cached snapshot answer, and
/// the store is never asked, after an input changed.
pub fn fingerprint(files: &[Utf8PathBuf]) -> String {
    let mut text = String::new();
    for file in files {
        let meta = std::fs::metadata(file).ok();
        let _ = write!(text, "|{file}|{:?}|{:?}", meta.as_ref().map(std::fs::Metadata::len), meta.and_then(|m| m.modified().ok()));
    }
    format!("{:016x}", fnv(text.as_bytes()))
}

/// FNV-1a.
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, &byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3))
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

    /// A fingerprint is stable while its files are, and changes when one is
    /// written, created or removed: a missing file is not an empty one.
    #[test]
    fn a_fingerprint_follows_its_files() {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-fingerprint-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let files = [root.join("a.gir"), root.join("b.gir")];
        std::fs::write(&files[0], "a").unwrap();
        let missing = fingerprint(&files);
        std::fs::write(&files[1], "").unwrap();
        let empty = fingerprint(&files);
        assert_ne!(missing, empty, "a missing file and an empty one fingerprint alike");
        assert_eq!(empty, fingerprint(&files), "an unchanged set fingerprinted differently");
        std::fs::write(&files[0], "ab").unwrap();
        assert_ne!(empty, fingerprint(&files), "a written file did not change the fingerprint");
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// Two generators of one identity -- two worktrees' `nts` -- keep their
    /// packages side by side, each regenerating nothing the other made; one
    /// no build has used for [`RETAIN`] is removed by the next.
    #[test]
    fn two_versions_share_a_store_until_one_is_idle() {
        let root = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-versions-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("input.txt");
        std::fs::write(&input, "a").unwrap();
        let store = Store::new(root.join("store"));
        let old = Counting(std::cell::Cell::new(0), input.clone(), std::cell::Cell::new(1));
        let new = Counting(std::cell::Cell::new(0), input.clone(), std::cell::Cell::new(2));
        let old_packages = store.ensure(&old).unwrap();
        let new_packages = store.ensure(&new).unwrap();
        assert!(old_packages.files().iter().all(|file| file.is_file()), "a newer version evicted an older one in use");
        store.ensure(&old).unwrap();
        store.ensure(&new).unwrap();
        assert_eq!((old.0.get(), new.0.get()), (1, 1), "a version regenerated what the other left in place");
        // The older version, idle past RETAIN, goes at the newer one's next build.
        // `<identity>/<version>/<inputs>/node_modules/@nts/<package>`.
        let old_version = old_packages.packages[0].1.ancestors().nth(4).unwrap().to_owned();
        let idle = std::time::SystemTime::now() - RETAIN - std::time::Duration::from_mins(1);
        std::fs::File::open(&old_version).unwrap().set_modified(idle).unwrap();
        store.ensure(&new).unwrap();
        assert!(!old_version.exists(), "a version idle past RETAIN was kept");
        assert!(new_packages.files().iter().all(|file| file.is_file()));
        std::fs::remove_dir_all(&root).unwrap();
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
        // A new generator for the same identity makes its own, in the same
        // identity's directory, beside the old one's: another binary may be
        // using those (`two_versions_share_a_store_until_one_is_idle`).
        binder.2.set(2);
        let third = store.ensure(&binder).unwrap();
        assert_eq!(binder.0.get(), 3, "a changed generator did not generate again");
        assert!(second.packages[0].1.exists(), "the old generator's packages, which may be in use, were removed");
        let identities = std::fs::read_dir(root.join("store")).unwrap().count();
        assert_eq!(identities, 1, "a generator version made an identity of its own");
        assert!(third.files().iter().all(|file| file.is_file()), "{third:?}");
        let project = root.join("project");
        assert_eq!(link(&third, &project).unwrap(), ["@nts/test-one"], "a first link is new");
        assert!(link(&third, &project).unwrap().is_empty(), "a link already there is not new");
        assert!(project.join("node_modules/@nts/test-one/index.d.ts").is_file());
    }
}
