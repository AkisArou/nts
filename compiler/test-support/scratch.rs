//! Owned test artifacts, shared by integration tests without a product dependency.

use camino::{Utf8Path, Utf8PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// Keep this owner alive until the last compiler or tool has read its files.
/// Unwinding removes them too; `NTS_KEEP_TEST_SCRATCH=1` keeps and names them.
#[derive(Debug)]
struct ScratchRoot {
    path: Utf8PathBuf,
    keep: bool,
}

#[derive(Debug)]
struct OwnedValue<T> {
    value: T,
    root: Arc<ScratchRoot>,
}

#[derive(Debug)]
#[must_use = "hold the scratch directory until its artifacts have been read"]
pub(crate) struct ScratchValue<T> {
    state: Arc<OwnedValue<T>>,
}

pub(crate) type ScratchDir<P = Utf8PathBuf> = ScratchValue<P>;

impl ScratchDir {
    /// Plain cargo tests fall back to the compile-time target directory.
    #[allow(dead_code)] // Included by tests that use custom parents too.
    pub(crate) fn in_target(name: &str) -> Self {
        Self::new(&target_parent(), name)
    }

    pub(crate) fn new(parent: &Utf8Path, name: &str) -> Self {
        Self::create(parent, name, std::convert::identity, true)
    }

    /// A fresh owned path, initially absent, for a file or a directory that
    /// the fixture itself creates. The private namespace already exists.
    #[allow(dead_code)]
    pub(crate) fn path_in_target(name: &str) -> Self {
        Self::create(&target_parent(), name, std::convert::identity, false)
    }
}

#[allow(dead_code)]
fn target_parent() -> Utf8PathBuf {
    std::env::var("NTS_TEST_SCRATCH_ROOT").map_or_else(
        |_| {
            if let Some(parent) = option_env!("CARGO_TARGET_TMPDIR") {
                parent.into()
            } else {
                // Cargo sets CARGO_TARGET_TMPDIR only for integration targets.
                // Library tests still own scratch inside their pool tree.
                let manifest = Utf8Path::new(env!("CARGO_MANIFEST_DIR"));
                let workspace = manifest
                    .ancestors()
                    .find(|at| {
                        std::fs::read_to_string(at.join("Cargo.toml"))
                            .is_ok_and(|text| text.lines().any(|line| line.trim() == "[workspace]"))
                    })
                    .unwrap_or(manifest);
                workspace.join("target/tmp")
            }
        },
        Utf8PathBuf::from,
    )
}

/// The same owner for tests that use standard-library paths.
#[allow(dead_code)]
pub(crate) type StdScratchDir = ScratchDir<std::path::PathBuf>;

impl StdScratchDir {
    #[allow(dead_code)]
    pub(crate) fn in_std_target(name: &str) -> Self {
        Self::create(&target_parent(), name, Utf8PathBuf::into_std_path_buf, true)
    }

    #[allow(dead_code)]
    pub(crate) fn path_in_std_target(name: &str) -> Self {
        Self::create(
            &target_parent(),
            name,
            Utf8PathBuf::into_std_path_buf,
            false,
        )
    }
}

impl<P: AsRef<std::path::Path>> ScratchDir<P> {
    fn create(
        parent: &Utf8Path,
        name: &str,
        convert: fn(Utf8PathBuf) -> P,
        directory: bool,
    ) -> Self {
        assert!(
            !name.is_empty()
                && std::path::Path::new(name)
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_))),
            "test scratch name must be a relative path: {name}"
        );
        let label: String = name
            .chars()
            .take(80)
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        std::fs::create_dir_all(parent)
            .unwrap_or_else(|error| panic!("create test scratch parent {parent}: {error}"));
        let root = loop {
            let serial = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!("{}-{label}-{serial}", std::process::id()));
            match std::fs::create_dir(&path) {
                Ok(()) => break path,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("create test scratch {path}: {error}"),
            }
        };
        let keep = std::env::var_os("NTS_KEEP_TEST_SCRATCH").is_some_and(|value| value == "1");
        if keep {
            eprintln!("NTS_KEEP_TEST_SCRATCH=1: {root}");
        }
        let path = convert(root.join(name));
        let owner = Self {
            state: Arc::new(OwnedValue {
                value: path,
                root: Arc::new(ScratchRoot { path: root, keep }),
            }),
        };
        if directory {
            std::fs::create_dir_all(owner.state.value.as_ref()).unwrap_or_else(|error| {
                panic!(
                    "create test scratch path {}: {error}",
                    owner.state.value.as_ref().display()
                )
            });
        }
        owner
    }
}

impl<T> ScratchValue<T> {
    /// A unit or another resource may borrow this fixture's unique namespace.
    #[allow(dead_code)]
    pub(crate) fn namespace(&self) -> &str {
        self.state
            .root
            .path
            .file_name()
            .expect("a private scratch root")
    }

    #[allow(dead_code)]
    pub(crate) fn share(&self) -> Self {
        Self {
            state: Arc::clone(&self.state),
        }
    }

    /// The result and its files share one lifetime, even when the result is a
    /// config path, a snapshot or a prepared program rather than a directory.
    #[allow(dead_code)]
    pub(crate) fn hold<U>(&self, value: U) -> ScratchValue<U> {
        ScratchValue {
            state: Arc::new(OwnedValue {
                value,
                root: Arc::clone(&self.state.root),
            }),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn map<U>(&self, map: impl FnOnce(&T) -> U) -> ScratchValue<U> {
        self.hold(map(&self.state.value))
    }
}

impl<T: std::fmt::Display> std::fmt::Display for ScratchValue<T> {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.state.value.fmt(out)
    }
}

impl<T> std::ops::Deref for ScratchValue<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.state.value
    }
}

impl<T, U: ?Sized> AsRef<U> for ScratchValue<T>
where
    T: AsRef<U>,
{
    fn as_ref(&self) -> &U {
        self.state.value.as_ref()
    }
}

/// Cache only while a fixture is held. The last owned value removes its
/// scratch; a static cache never retains a directory after the binary exits.
#[derive(Debug)]
#[allow(dead_code)]
pub(crate) struct SharedScratch<T> {
    state: Mutex<Weak<OwnedValue<T>>>,
}

#[allow(dead_code)]
impl<T> SharedScratch<T> {
    pub(crate) const fn new() -> Self {
        Self {
            state: Mutex::new(Weak::new()),
        }
    }

    pub(crate) fn get(
        &self,
        create: impl FnOnce() -> Option<ScratchValue<T>>,
    ) -> Option<ScratchValue<T>> {
        let mut cached = self
            .state
            .lock()
            .unwrap_or_else(|error| panic!("shared test scratch lock: {error}"));
        if let Some(state) = cached.upgrade() {
            return Some(ScratchValue { state });
        }
        let value = create()?;
        *cached = Arc::downgrade(&value.state);
        Some(value)
    }
}

impl Drop for ScratchRoot {
    fn drop(&mut self) {
        if !self.keep
            && let Err(error) = std::fs::remove_dir_all(&self.path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!("remove test scratch {}: {error}", self.path);
            // Preserve the original panic during unwinding. The checked runner
            // reports and removes the leftover in either case.
            assert!(std::thread::panicking(), "test scratch cleanup failed");
        }
    }
}
