//! Read-only source overlays, using the native filesystem and path rules.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::fmt::Write as _;
use std::sync::Mutex;
use std::time::SystemTime;

use camino::{Utf8Path, Utf8PathBuf};
use tsrs_core::tspath;
use tsrs_vfs::{Entries, FS, FileInfo, FileMode};
use xxhash_rust::xxh3::xxh3_128;

/// The kind of host observation on which a checked program depends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum InputKind {
    File,
    FileExists,
    DirectoryExists,
    DirectoryEntries,
    Metadata,
    RealPath,
}

impl InputKind {
    pub(crate) fn absent_fingerprint(self) -> u128 {
        let answer: &[u8] = match self {
            Self::File | Self::FileExists | Self::DirectoryExists => &[0],
            Self::DirectoryEntries => b"[][]",
            Self::Metadata => b"None",
            // The native FS trait has no Option here. An empty answer is our
            // failure sentinel for a path that cannot name any UTF-8 file.
            Self::RealPath => b"",
        };
        xxh3_128(answer)
    }
}

/// An owned lookup key. A non-Unicode JS path never becomes a Rust path.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum InputPath {
    Utf8(Utf8PathBuf),
    /// A path with an unpaired UTF-16 surrogate; deterministically absent.
    Utf16(Vec<u16>),
}

impl InputPath {
    #[must_use]
    pub fn utf8(&self) -> Option<&Utf8Path> {
        match self {
            Self::Utf8(path) => Some(path),
            Self::Utf16(_) => None,
        }
    }
    #[must_use]
    pub fn utf16(&self) -> Cow<'_, [u16]> {
        match self {
            Self::Utf8(path) => Cow::Owned(path.as_str().encode_utf16().collect()),
            Self::Utf16(path) => Cow::Borrowed(path),
        }
    }
}

impl fmt::Display for InputPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Utf8(path) => path.fmt(f),
            Self::Utf16(path) => {
                for unit in char::decode_utf16(path.iter().copied()) {
                    match unit {
                        Ok(ch) => f.write_char(ch)?,
                        Err(lone) => write!(f, "\\u{:04X}", lone.unpaired_surrogate())?,
                    }
                }
                Ok(())
            }
        }
    }
}

/// Path-shaped native strings must have passed the UTF-8 host boundary.
pub(crate) fn native_path(path: &str) -> &Utf8Path {
    Utf8Path::new(
        std::str::from_utf8(path.as_bytes()).expect("native filesystem path must be valid UTF-8"),
    )
}

/// One actual filesystem answer, including failed lookups.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Input {
    pub path: InputPath,
    pub kind: InputKind,
    pub fingerprint: u128,
}

pub(crate) struct Host {
    cwd: String,
    base: Box<dyn FS>,
    overlays: BTreeMap<String, String>,
    directories: BTreeMap<String, Entries>,
    inputs: Mutex<BTreeMap<(InputKind, InputPath), u128>>,
}

impl fmt::Debug for Host {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Host")
            .field("cwd", &self.cwd)
            .field("overlays", &self.overlays.keys())
            .finish_non_exhaustive()
    }
}

impl Host {
    pub(crate) fn new(cwd: &str, overlays: &BTreeMap<Utf8PathBuf, String>) -> Self {
        let mut host = Self {
            cwd: cwd.to_owned(),
            base: Box::new(tsrs_vfs::bundled::wrap_fs(tsrs_vfs::osvfs::fs())),
            overlays: BTreeMap::new(),
            directories: BTreeMap::new(),
            inputs: Mutex::default(),
        };
        for (path, text) in overlays {
            let path = host.key(path.as_str());
            host.overlays.insert(path.clone(), text.clone());
            let mut child = Utf8PathBuf::from(path);
            let mut is_file = true;
            while let Some(parent) = child.parent() {
                let Some(name) = child.file_name() else { break };
                let entries = host.directories.entry(parent.to_string()).or_default();
                if is_file {
                    entries.files.push(name.to_owned());
                } else {
                    entries.directories.push(name.to_owned());
                }
                child = parent.to_owned();
                is_file = false;
            }
        }
        host
    }

    fn key(&self, path: &str) -> String {
        tspath::to_path(path, &self.cwd, self.base.use_case_sensitive_file_names()).to_string()
    }

    fn observe(&self, kind: InputKind, path: &str, answer: &[u8]) {
        self.inputs
            .lock()
            .expect("input observations lock poisoned")
            .insert(
                (kind, InputPath::Utf8(self.key(path).into())),
                xxh3_128(answer),
            );
    }

    /// Validate before normalization, overlay lookup or any OS call. Adjacent
    /// sentinel surrogate pairs do have a Unicode spelling and use that path.
    fn lookup<'a>(&self, kind: InputKind, path: &'a str) -> Option<Cow<'a, str>> {
        if let Ok(path) = std::str::from_utf8(path.as_bytes()) {
            return Some(Cow::Borrowed(path));
        }
        let units = crate::strings::decode(path.as_bytes());
        if let Ok(path) = String::from_utf16(&units) {
            return Some(Cow::Owned(path));
        }
        self.inputs
            .lock()
            .expect("input observations lock poisoned")
            .insert((kind, InputPath::Utf16(units)), kind.absent_fingerprint());
        None
    }

    pub(crate) fn inputs(&self) -> Vec<Input> {
        self.inputs
            .lock()
            .expect("input observations lock poisoned")
            .iter()
            .map(|((kind, path), fingerprint)| Input {
                path: path.clone(),
                kind: *kind,
                fingerprint: *fingerprint,
            })
            .collect()
    }
}

impl tsrs_tsoptions::ParseConfigHost for Host {
    fn fs(&self) -> &dyn FS {
        self
    }
    fn get_current_directory(&self) -> &str {
        &self.cwd
    }
}

impl FS for Host {
    fn use_case_sensitive_file_names(&self) -> bool {
        self.base.use_case_sensitive_file_names()
    }

    fn file_exists(&self, path: &str) -> bool {
        let Some(path) = self.lookup(InputKind::FileExists, path) else {
            return false;
        };
        let path = path.as_ref();
        let answer = self.overlays.contains_key(&self.key(path)) || self.base.file_exists(path);
        self.observe(InputKind::FileExists, path, &[u8::from(answer)]);
        answer
    }

    fn read_file(&self, path: &str) -> Option<String> {
        let path = self.lookup(InputKind::File, path)?;
        let path = path.as_ref();
        let answer = self
            .overlays
            .get(&self.key(path))
            .cloned()
            .or_else(|| self.base.read_file(path));
        // Prefix distinguishes a missing file from an existing empty file.
        let mut fingerprint_input = vec![u8::from(answer.is_some())];
        if let Some(text) = &answer {
            fingerprint_input.extend_from_slice(text.as_bytes());
        }
        self.observe(InputKind::File, path, &fingerprint_input);
        answer
    }

    fn directory_exists(&self, path: &str) -> bool {
        let Some(path) = self.lookup(InputKind::DirectoryExists, path) else {
            return false;
        };
        let path = path.as_ref();
        let answer =
            self.directories.contains_key(&self.key(path)) || self.base.directory_exists(path);
        self.observe(InputKind::DirectoryExists, path, &[u8::from(answer)]);
        answer
    }

    fn get_accessible_entries(&self, path: &str) -> Entries {
        let Some(path) = self.lookup(InputKind::DirectoryEntries, path) else {
            return Entries::default();
        };
        let path = path.as_ref();
        let mut answer = self.base.get_accessible_entries(path);
        if let Some(overlay) = self.directories.get(&self.key(path)) {
            answer.files.extend(overlay.files.iter().cloned());
            answer
                .directories
                .extend(overlay.directories.iter().cloned());
        }
        answer.files.sort();
        answer.files.dedup();
        answer.directories.sort();
        answer.directories.dedup();
        let mut names = format!("{:?}{:?}", answer.files, answer.directories);
        if let Some(symlinks) = &answer.symlinks {
            let mut symlinks: Vec<_> = symlinks.iter().collect();
            symlinks.sort();
            write!(names, "{symlinks:?}").expect("writing to a String cannot fail");
        }
        self.observe(InputKind::DirectoryEntries, path, names.as_bytes());
        answer
    }

    fn stat(&self, path: &str) -> Option<FileInfo> {
        let path = self.lookup(InputKind::Metadata, path)?;
        let path = path.as_ref();
        let key = self.key(path);
        let answer = if let Some(text) = self.overlays.get(&key) {
            Some(FileInfo {
                name: Utf8PathBuf::from(&key).file_name().unwrap_or("").to_owned(),
                size: i64::try_from(text.len()).expect("source length fits i64"),
                mode: FileMode::None,
                mod_time: None,
            })
        } else if self.directories.contains_key(&key) {
            Some(FileInfo {
                name: Utf8PathBuf::from(&key).file_name().unwrap_or("").to_owned(),
                size: 0,
                mode: FileMode::Dir,
                mod_time: None,
            })
        } else {
            self.base.stat(path)
        };
        self.observe(InputKind::Metadata, path, format!("{answer:?}").as_bytes());
        answer
    }

    fn realpath(&self, path: &str) -> String {
        let Some(path) = self.lookup(InputKind::RealPath, path) else {
            return String::new();
        };
        let path = path.as_ref();
        let key = self.key(path);
        let answer = if self.overlays.contains_key(&key) || self.directories.contains_key(&key) {
            key
        } else {
            self.base.realpath(path)
        };
        self.observe(InputKind::RealPath, path, answer.as_bytes());
        answer
    }

    fn write_file(&self, _: &str, _: &str) -> Result<(), String> {
        Err("native source host is read-only".to_owned())
    }
    fn append_file(&self, _: &str, _: &str) -> Result<(), String> {
        Err("native source host is read-only".to_owned())
    }
    fn remove(&self, _: &str) -> Result<(), String> {
        Err("native source host is read-only".to_owned())
    }
    fn chtimes(&self, _: &str, _: SystemTime, _: SystemTime) -> Result<(), String> {
        Err("native source host is read-only".to_owned())
    }
}
